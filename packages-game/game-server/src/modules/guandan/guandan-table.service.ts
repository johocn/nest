import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';
import { GuandanMode, GuandanTableStatus } from '@constants/enums';
import {
  GameState,
  Rules,
} from './engine';
import { ActionDto } from './guandan.types';
import { chooseAction } from './engine/bot';
import * as engine from './engine';
import { GuandanRoom, GuandanRecord } from './entities';
import { PlayerService } from '@modules/player/player.service';

interface GuandanTable {
  id: string;
  mode: GuandanMode;
  status: GuandanTableStatus;
  members: (string | null)[]; // 长度 4：playerId / 'bot-N' / null
  sockets: (string | null)[]; // 长度 4：各座位当前 socketId
  hostSeat: number;
  state: GameState;
  createdAt: string;
}

const TABLE_TTL = 3600; // 1 小时

@Injectable()
export class GuandanTableService {
  private readonly logger = new Logger(GuandanTableService.name);
  private readonly KEY = (id: string) => `guandan:table:${id}`;

  constructor(
    private readonly cache: CacheService,
    @InjectRepository(GuandanRoom) private readonly roomRepo: Repository<GuandanRoom>,
    @InjectRepository(GuandanRecord) private readonly recordRepo: Repository<GuandanRecord>,
    private readonly eventBus: EventBusService,
    private readonly playerService: PlayerService,
  ) {}

  private buildTableId(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `guandan-${ts}-${rand}`;
  }

  private isBot(table: GuandanTable, seat: number): boolean {
    const m = table.members[seat];
    return !!m && m.startsWith('bot');
  }

  private humanSeats(table: GuandanTable): number[] {
    return table.members
      .map((m, i) => (m && !m.startsWith('bot') ? i : -1))
      .filter((i) => i >= 0);
  }

  // ===== 创建牌桌 =====
  async createTable(
    hostPlayerId: string,
    mode: GuandanMode,
    socketId?: string,
    rules?: Partial<Rules>,
  ): Promise<{ tableId: string; seat: number; view: any }> {
    const id = this.buildTableId();
    const ai = mode === GuandanMode.AI;
    const members: (string | null)[] = ai
      ? [hostPlayerId, 'bot-1', 'bot-2', 'bot-3']
      : [hostPlayerId, null, null, null];
    const isBot = ai ? [false, true, true, true] : [false, false, false, false];
    const hostSeat = 0;

    const state = engine.createGame(isBot, rules ?? {});
    const table: GuandanTable = {
      id,
      mode,
      status: ai ? GuandanTableStatus.PLAYING : GuandanTableStatus.WAITING,
      members,
      sockets: [socketId ?? null, null, null, null],
      hostSeat,
      state,
      createdAt: new Date().toISOString(),
    };
    await this.saveTable(table);

    await this.safePersist(async () => {
      const room = this.roomRepo.create({
        tableId: id,
        mode,
        hostPlayerId,
        status: table.status,
        levelIndex: state.levelIndex,
        playersJson: members,
      });
      await this.roomRepo.save(room);
    }, `create room ${id}`);

    this.eventBus.emit(GameEvents.GUANDAN_TABLE_CREATED, { tableId: id, mode, hostPlayerId });
    this.logger.log(`[Guandan] create ${id} mode=${mode} host=${hostPlayerId}`);
    return { tableId: id, seat: hostSeat, view: await this.toView(table, hostSeat) };
  }

  // ===== 加入牌桌 =====
  async joinTable(
    tableId: string,
    playerId: string,
    socketId?: string,
  ): Promise<{ seat: number; view: any }> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.GUANDAN_TABLE_NOT_FOUND, '牌桌不存在或已解散');

    const existing = table.members.indexOf(playerId);
    if (existing !== -1) {
      if (socketId && table.sockets[existing] !== socketId) {
        table.sockets[existing] = socketId;
        await this.saveTable(table);
      }
      return { seat: existing, view: await this.toView(table, existing) };
    }

    const seat = table.members.indexOf(null);
    if (seat === -1) throw new GameException(ErrorCodes.GUANDAN_TABLE_FULL, '牌桌已满（4 人）');
    table.members[seat] = playerId;
    table.sockets[seat] = socketId ?? null;

    if (table.mode === GuandanMode.NET && table.members.every((m) => m)) {
      this.fillBots(table);
      table.state = engine.createGame(
        table.members.map((m) => !!m && m.startsWith('bot')),
        table.state.rules,
        table.state.levelIndex,
      );
      table.status = GuandanTableStatus.PLAYING;
      await this.safePersist(async () => {
        const room = await this.roomRepo.findOne({ where: { tableId } });
        if (room) {
          room.status = GuandanTableStatus.PLAYING;
          room.startedAt = new Date();
          room.playersJson = table.members;
          await this.roomRepo.save(room);
        }
      }, `mark playing ${tableId}`);
    }

    await this.saveTable(table);
    this.eventBus.emit(GameEvents.GUANDAN_TABLE_UPDATED, { tableId });
    return { seat, view: await this.toView(table, seat) };
  }

  /** 断线：仅清空 socket，保留座位便于重连 */
  async disconnectBySocket(socketId: string): Promise<void> {
    const tables = await this.allTables();
    for (const table of tables) {
      const seat = table.sockets.indexOf(socketId);
      if (seat !== -1) {
        table.sockets[seat] = null;
        await this.saveTable(table);
        return;
      }
    }
  }

  private async allTables(): Promise<GuandanTable[]> {
    // 断线场景少，遍历缓存成本高；改为按已知房间号扫描不现实，这里用 event-bus 反查成本高，
    // 退化为：从最近活跃房间无法定位，直接忽略（重连时 join 会恢复 socket）。
    return [];
  }

  /** 空位补 AI（联网模式开局时） */
  private fillBots(table: GuandanTable) {
    table.members = table.members.map((m, i) => m ?? `bot-${i}`);
  }

  // ===== 房主开局（联网模式）：空位 AI 补位 =====
  async startTable(tableId: string, playerId: string): Promise<{ view: any }> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.GUANDAN_TABLE_NOT_FOUND, '牌桌不存在或已解散');
    if (table.members[table.hostSeat] !== playerId)
      throw new GameException(ErrorCodes.GUANDAN_NOT_HOST, '只有房主可以开局');
    if (table.mode !== GuandanMode.NET)
      throw new GameException(ErrorCodes.GUANDAN_INVALID_ACTION, '仅联网模式需要手动开局');
    if (table.status === GuandanTableStatus.PLAYING)
      throw new GameException(ErrorCodes.GUANDAN_INVALID_ACTION, '对局已开始');

    this.fillBots(table);
    table.state = engine.createGame(
      table.members.map((m) => !!m && m.startsWith('bot')),
      table.state.rules,
      table.state.levelIndex,
    );
    table.status = GuandanTableStatus.PLAYING;

    await this.safePersist(async () => {
      const room = await this.roomRepo.findOne({ where: { tableId } });
      if (room) {
        room.status = GuandanTableStatus.PLAYING;
        room.startedAt = new Date();
        room.playersJson = table.members;
        await this.roomRepo.save(room);
      }
    }, `mark playing ${tableId}`);

    await this.saveTable(table);
    this.eventBus.emit(GameEvents.GUANDAN_TABLE_UPDATED, { tableId });
    this.logger.log(`[Guandan] start ${tableId} by ${playerId} (AI 补位)`);
    const seat = table.members.indexOf(playerId);
    return { view: await this.toView(table, seat === -1 ? table.hostSeat : seat) };
  }

  // ===== 应用动作：出牌 / 过牌，随后推进 AI 与回合切换 =====
  async applyAction(tableId: string, playerId: string, dto: ActionDto): Promise<any> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.GUANDAN_TABLE_NOT_FOUND, '牌桌不存在或已解散');
    if (table.status !== GuandanTableStatus.PLAYING)
      throw new GameException(ErrorCodes.GUANDAN_INVALID_ACTION, '对局未开始');

    const seat = table.members.indexOf(playerId);
    if (seat === -1) throw new GameException(ErrorCodes.GUANDAN_PLAYER_NOT_IN_TABLE, '你不在该牌桌');

    try {
      table.state = engine.applyAction(table.state, seat, {
        type: dto.type,
        cards: dto.cards,
      } as any);
    } catch (err: any) {
      throw new GameException(ErrorCodes.GUANDAN_ILLEGAL_COMBO, err?.message || '非法出牌');
    }

    await this.progress(table);
    await this.saveTable(table);
    this.eventBus.emit(GameEvents.GUANDAN_TABLE_UPDATED, { tableId });
    return this.toView(table, seat);
  }

  /** 循环：结算回合→开下一回合→AI 自动出牌，直到轮到真人或整局结束 */
  private async progress(table: GuandanTable) {
    let guard = 0;
    while (guard++ < 3000) {
      const s = table.state;
      if (s.matchWinner != null) {
        await this.persistFinished(table);
        return;
      }
      if (s.roundOver) {
        await this.persistRound(table);
        engine.startNextRound(s);
        continue;
      }
      if (!this.isBot(table, s.turn)) return;
      const action = chooseAction(s, s.turn);
      try {
        table.state = engine.applyAction(s, s.turn, action as any);
      } catch {
        table.state = engine.applyAction(s, s.turn, { type: 'pass' } as any);
      }
    }
  }

  async getView(tableId: string, playerId: string): Promise<any> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.GUANDAN_TABLE_NOT_FOUND, '牌桌不存在或已解散');
    const seat = table.members.indexOf(playerId);
    return this.toView(table, seat === -1 ? 0 : seat);
  }

  async viewBySeat(tableId: string, seat: number): Promise<any> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.GUANDAN_TABLE_NOT_FOUND, '牌桌不存在或已解散');
    return this.toView(table, seat);
  }

  /** 需要推送的真人座位及其 socketId */
  async broadcastTargets(tableId: string): Promise<{ seat: number; socketId: string }[]> {
    const table = await this.loadTable(tableId);
    if (!table) return [];
    const out: { seat: number; socketId: string }[] = [];
    table.members.forEach((m, i) => {
      const sid = table.sockets[i];
      if (m && !m.startsWith('bot') && sid) out.push({ seat: i, socketId: sid });
    });
    return out;
  }

  async history(playerId: string, limit = 20) {
    try {
      return await this.queryHistory(playerId, limit);
    } catch (err: any) {
      this.logger.error(`[history failed] ${playerId}: ${err?.message}`);
      return [];
    }
  }

  private async queryHistory(playerId: string, limit: number) {
    const recs = await this.recordRepo.find({
      where: { playerId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    if (!recs.length) return [];
    const ids = [...new Set(recs.map((r) => r.tableId))];
    const rooms = await this.roomRepo.find({ where: { tableId: In(ids) } });
    const statusMap = new Map(rooms.map((r) => [r.tableId, r.status]));
    const levelMap = new Map(rooms.map((r) => [r.tableId, r.levelIndex]));
    return recs.map((r) => ({
      tableId: r.tableId,
      seat: r.seat,
      team: r.team,
      levelUp: r.levelUp,
      isWinner: r.isWinner,
      detail: r.detailJson,
      levelIndex: levelMap.get(r.tableId) ?? null,
      status: statusMap.get(r.tableId) ?? null,
      createdAt: r.createdAt,
    }));
  }

  async leaveTable(tableId: string, playerId: string): Promise<void> {
    const table = await this.loadTable(tableId);
    if (!table) return;
    const seat = table.members.indexOf(playerId);
    if (seat === -1) return;
    table.sockets[seat] = null;
    if (table.mode === GuandanMode.NET) table.members[seat] = null;
    await this.saveTable(table);
  }

  // ===== 内部：视图构建 =====
  private async namesOf(table: GuandanTable): Promise<string[]> {
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      const m = table.members[i];
      if (!m || m.startsWith('bot')) {
        names.push(m ? `AI-${m.split('-')[1]}` : '空位');
      } else {
        try {
          const p = await this.playerService.getById(m);
          names.push(p?.nickname || `玩家${m.slice(0, 4)}`);
        } catch {
          names.push(`玩家${m.slice(0, 4)}`);
        }
      }
    }
    return names;
  }

  private async toView(table: GuandanTable, seat: number): Promise<any> {
    const s = table.state;
    const reveal = s.roundOver || s.matchWinner != null;
    const names = await this.namesOf(table);
    const myTurn = s.turn === seat && !s.roundOver && s.matchWinner == null;

    const players = table.members.map((m, i) => {
      const ps = s.players[i];
      const isMe = i === seat;
      return {
        seat: i,
        playerId: m,
        nickname: names[i],
        isBot: !!m && m.startsWith('bot'),
        isOut: ps.isOut,
        finishOrder: ps.finishOrder,
        partnerSeat: ps.partnerSeat,
        handCount: ps.hand.length,
        isCurrentTurn: s.turn === i && !s.roundOver && s.matchWinner == null,
        passed: ps.passedThisTrick,
        hand: reveal || isMe ? ps.hand : [],
      };
    });

    let actionHint: any[] = [];
    if (myTurn) {
      const combos = engine.findBeatingCombos(
        s.players[seat].hand,
        s.level,
        s.rules,
        s.lastPlay ? s.lastPlay.combo : null,
      );
      actionHint = combos;
    }

    return {
      roomId: table.id,
      mode: table.mode,
      state: {
        level: s.level,
        levelLabel: this.levelLabel(s.level),
        phase: s.phase,
        turn: s.turn,
        lastPlay: s.lastPlay
          ? { seat: s.lastPlay.seat, combo: s.lastPlay.combo }
          : null,
        kittyCount: s.kitty.length,
        roundOver: s.roundOver,
        matchWinner: s.matchWinner,
        settlement: s.lastSettlement,
        rules: s.rules,
      },
      players,
      awaiting: myTurn ? [seat] : [],
      actionHint,
      yourSeat: seat,
      seated: table.members.filter((m) => m).length,
    };
  }

  private levelLabel(level: number): string {
    const map: Record<number, string> = {
      3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
      11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2',
    };
    return map[level] ?? String(level);
  }

  private async saveTable(table: GuandanTable) {
    await this.cache.set(this.KEY(table.id), JSON.stringify(table), TABLE_TTL);
  }

  private async loadTable(id: string): Promise<GuandanTable | null> {
    const raw = await this.cache.get(this.KEY(id));
    if (!raw) return null;
    return JSON.parse(raw as string) as GuandanTable;
  }

  private async persistRound(table: GuandanTable) {
    const settlement = table.state.lastSettlement;
    if (!settlement) return;
    await this.safePersist(async () => {
      const room = await this.roomRepo.findOne({ where: { tableId: table.id } });
      if (room) {
        room.levelIndex = table.state.levelIndex;
        room.settlementJson = settlement;
        await this.roomRepo.save(room);
      }
      const humans = table.members
        .map((m, i) => ({ m, i }))
        .filter((x) => x.m && !x.m.startsWith('bot'));
      for (const { m, i } of humans) {
        const isWinner = settlement.winningTeam === i % 2;
        const rec = this.recordRepo.create({
          tableId: table.id,
          playerId: m!,
          seat: i,
          team: i % 2,
          levelUp: isWinner ? settlement.levelUp : 0,
          isWinner,
          detailJson: settlement,
        });
        await this.recordRepo.save(rec);
      }
    }, `round ${table.id}`);
    this.eventBus.emit(GameEvents.GUANDAN_TABLE_FINISHED, { tableId: table.id, round: true });
  }

  private async persistFinished(table: GuandanTable) {
    await this.safePersist(async () => {
      const room = await this.roomRepo.findOne({ where: { tableId: table.id } });
      if (room) {
        room.status = GuandanTableStatus.FINISHED;
        room.finishedAt = new Date();
        room.levelIndex = table.state.levelIndex;
        room.settlementJson = table.state.lastSettlement;
        await this.roomRepo.save(room);
      }
    }, `finish ${table.id}`);
    this.eventBus.emit(GameEvents.GUANDAN_TABLE_FINISHED, { tableId: table.id });
  }

  /** 落库失败只记日志，不影响牌局进行 */
  private async safePersist(fn: () => Promise<void>, what: string) {
    try {
      await fn();
    } catch (err: any) {
      this.logger.error(`[persist failed] ${what}: ${err?.message}`);
    }
  }
}
