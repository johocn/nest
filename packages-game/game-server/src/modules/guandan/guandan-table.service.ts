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
  AiLevel,
  GameState,
  Rules,
} from './engine';
import { ActionDto } from './guandan.types';
import { chooseAction } from './engine/bot';
import * as engine from './engine';
import { RANK_LABEL } from './engine/cards';
import { GuandanRoom, GuandanRecord, GuandanReplay } from './entities';
import { PlayerService } from '@modules/player/player.service';

interface GuandanTable {
  id: string;
  mode: GuandanMode;
  status: GuandanTableStatus;
  members: (string | null)[]; // 长度 4：playerId / 'bot-N' / null
  sockets: (string | null)[]; // 长度 4：各座位当前 socketId
  hosted: boolean[]; // 长度 4：真人是否开启托管
  turnDeadline?: number; // 当前手动出牌截止时间戳(ms)，仅手动真人回合存在
  hostSeat: number;
  state: GameState;
  /** AI 强度档位（对 bot 座位与托管生效） */
  aiLevel: AiLevel;
  createdAt: string;
}

const TABLE_TTL = 3600; // 1 小时

@Injectable()
export class GuandanTableService {
  private readonly logger = new Logger(GuandanTableService.name);
  private readonly KEY = (id: string) => `guandan:table:${id}`;
  private readonly TURN_MS = 30_000; // 手动出牌倒计时 30s
  private socketIndex = new Map<string, string>(); // socketId -> tableId
  private timers = new Map<string, NodeJS.Timeout>(); // tableId -> 倒计时定时器

  constructor(
    private readonly cache: CacheService,
    @InjectRepository(GuandanRoom) private readonly roomRepo: Repository<GuandanRoom>,
    @InjectRepository(GuandanRecord) private readonly recordRepo: Repository<GuandanRecord>,
    @InjectRepository(GuandanReplay) private readonly replayRepo: Repository<GuandanReplay>,
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
    aiLevel: AiLevel = 'normal',
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
      sockets: [null, null, null, null],
      hosted: [false, false, false, false],
      turnDeadline: undefined,
      hostSeat,
      state,
      aiLevel,
      createdAt: new Date().toISOString(),
    };
    if (socketId) this.setSocket(table, 0, socketId);
    this.scheduleTurn(table);
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
        this.setSocket(table, existing, socketId);
        table.hosted[existing] = false; // 重连后恢复手动控制
        await this.saveTable(table);
      }
      return { seat: existing, view: await this.toView(table, existing) };
    }

    const seat = table.members.indexOf(null);
    if (seat === -1) throw new GameException(ErrorCodes.GUANDAN_TABLE_FULL, '牌桌已满（4 人）');
    table.members[seat] = playerId;
    this.setSocket(table, seat, socketId ?? null);

    if (table.mode === GuandanMode.NET && table.members.every((m) => m)) {
      this.fillBots(table);
      table.state = engine.createGame(
        table.members.map((m) => !!m && m.startsWith('bot')),
        table.state.rules,
        table.state.levelIndex,
      );
      table.hosted = [false, false, false, false];
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

    this.scheduleTurn(table);
    await this.saveTable(table);
    this.eventBus.emit(GameEvents.GUANDAN_TABLE_UPDATED, { tableId });
    return { seat, view: await this.toView(table, seat) };
  }

  /** 断线：清空 socket 并保留座位便于重连；若正轮到该座位则立即 AI 接管（断线兜底） */
  async disconnectBySocket(socketId: string): Promise<void> {
    const tableId = this.socketIndex.get(socketId);
    if (!tableId) return;
    const table = await this.loadTable(tableId);
    if (!table) {
      this.socketIndex.delete(socketId);
      return;
    }
    const seat = table.sockets.indexOf(socketId);
    if (seat === -1) {
      this.socketIndex.delete(socketId);
      return;
    }
    this.setSocket(table, seat, null);
    if (
      table.status === GuandanTableStatus.PLAYING &&
      table.state.matchWinner == null &&
      !table.state.roundOver &&
      table.state.turn === seat
    ) {
      await this.progress(table);
      this.scheduleTurn(table);
    }
    await this.saveTable(table);
    this.eventBus.emit(GameEvents.GUANDAN_TABLE_TIMEOUT, { tableId });
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
    table.hosted = [false, false, false, false];
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

    this.scheduleTurn(table);
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
    this.scheduleTurn(table);
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
      const seat = s.turn;
      const auto =
        this.isBot(table, seat) || !!table.hosted[seat] || table.sockets[seat] == null;
      if (!auto) return;
      const action = chooseAction(s, seat, table.aiLevel);
      try {
        table.state = engine.applyAction(s, seat, action as any);
      } catch {
        table.state = engine.applyAction(s, seat, { type: 'pass' as any });
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

  /** 复盘：取该牌桌全部回合回放（仅房主或参与者可见） */
  async replay(tableId: string, playerId: string) {
    try {
      return await this.queryReplay(tableId, playerId);
    } catch (err: any) {
      this.logger.error(`[replay failed] ${tableId}: ${err?.message}`);
      return [];
    }
  }

  private async queryReplay(tableId: string, playerId: string) {
    const room = await this.roomRepo.findOne({ where: { tableId } });
    const isHost = room?.hostPlayerId === playerId;
    const mine = await this.recordRepo.findOne({ where: { tableId, playerId } });
    if (!isHost && !mine) return [];

    const rows = await this.replayRepo.find({
      where: { tableId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((r) => ({
      id: String(r.id),
      tableId: r.tableId,
      level: r.level,
      players: r.playersJson,
      initialHands: r.initialHandsJson,
      actions: r.actionsJson,
      settlement: r.settlementJson,
      kowtow: r.kowtowJson,
      createdAt: r.createdAt,
    }));
  }

  async leaveTable(tableId: string, playerId: string): Promise<void> {
    const table = await this.loadTable(tableId);
    if (!table) return;
    const seat = table.members.indexOf(playerId);
    if (seat === -1) return;
    this.setSocket(table, seat, null);
    if (table.mode === GuandanMode.NET) table.members[seat] = null;
    await this.saveTable(table);
  }

  // ===== 托管 / 倒计时 / 断线兜底 =====
  /** 真人切换托管；开启且轮到本人时立即由 AI 接管 */
  async setHost(tableId: string, playerId: string, on: boolean): Promise<{ view: any }> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.GUANDAN_TABLE_NOT_FOUND, '牌桌不存在或已解散');
    const seat = table.members.indexOf(playerId);
    if (seat === -1) throw new GameException(ErrorCodes.GUANDAN_PLAYER_NOT_IN_TABLE, '你不在该牌桌');
    table.hosted[seat] = on;
    if (
      on &&
      table.status === GuandanTableStatus.PLAYING &&
      table.state.matchWinner == null &&
      !table.state.roundOver &&
      table.state.turn === seat
    ) {
      const action = chooseAction(table.state, seat, table.aiLevel);
      try {
        table.state = engine.applyAction(table.state, seat, action as any);
      } catch {
        table.state = engine.applyAction(table.state, seat, { type: 'pass' as any });
      }
      await this.progress(table);
    }
    this.scheduleTurn(table);
    await this.saveTable(table);
    this.eventBus.emit(GameEvents.GUANDAN_TABLE_UPDATED, { tableId });
    return { view: await this.toView(table, seat) };
  }

  /** 安排当前回合倒计时：仅当轮到「手动真人」时设置截止时间并启动定时器 */
  private scheduleTurn(table: GuandanTable) {
    this.clearTimer(table.id);
    const s = table.state;
    table.turnDeadline = undefined;
    if (table.status !== GuandanTableStatus.PLAYING) return;
    if (s.matchWinner != null || s.roundOver) return;
    const seat = s.turn;
    const manual = !this.isBot(table, seat) && !table.hosted[seat] && table.sockets[seat] != null;
    if (!manual) return;
    table.turnDeadline = Date.now() + this.TURN_MS;
    this.timers.set(
      table.id,
      setTimeout(() => void this.onTurnTimeout(table.id), this.TURN_MS + 250),
    );
  }

  private clearTimer(tableId: string) {
    const t = this.timers.get(tableId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(tableId);
    }
  }

  /** 倒计时到点：超时玩家由 AI 代打一次（领出则出最小牌，跟牌则过牌/最小压牌） */
  private async onTurnTimeout(tableId: string) {
    this.clearTimer(tableId);
    const table = await this.loadTable(tableId);
    if (!table) return;
    const s = table.state;
    if (s.matchWinner != null || s.roundOver) return;
    const seat = s.turn;
    if (this.isBot(table, seat) || table.hosted[seat] || table.sockets[seat] == null) return;
    table.turnDeadline = undefined;
    const action = chooseAction(s, seat, table.aiLevel);
    try {
      table.state = engine.applyAction(s, seat, action as any);
    } catch {
      table.state = engine.applyAction(s, seat, { type: 'pass' as any });
    }
    await this.progress(table);
    this.scheduleTurn(table);
    await this.saveTable(table);
    this.eventBus.emit(GameEvents.GUANDAN_TABLE_TIMEOUT, { tableId });
  }

  /** 更新某座位 socket 并同步索引（旧 socket 自动失效） */
  private setSocket(table: GuandanTable, seat: number, socketId: string | null) {
    const old = table.sockets[seat];
    if (old && old !== socketId) this.socketIndex.delete(old);
    table.sockets[seat] = socketId;
    if (socketId) this.socketIndex.set(socketId, table.id);
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
        connected: table.sockets[i] != null,
        hosted: !!table.hosted[i],
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
      aiLevel: table.aiLevel,
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
        turnDeadline: table.turnDeadline ?? null,
        counter: this.buildCounter(s, seat),
        kowtow: s.kowtow ?? null,
        bombCount: s.bombCount,
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

  /** 记牌器：以查看座位视角统计各点数/王还剩多少张未现（= 总张数 - 自己手牌 - 已打出） */
  private buildCounter(s: GameState, seat: number): {
    rank: number;
    label: string;
    left: number;
    total: number;
  }[] {
    const total: Record<number, number> = {};
    for (const r of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) total[r] = 8;
    total[16] = 2; // 小王
    total[17] = 2; // 大王
    const me = s.players[seat];
    for (const c of me.hand) total[c.rank] = (total[c.rank] ?? 0) - 1;
    for (const c of s.played ?? []) total[c.rank] = (total[c.rank] ?? 0) - 1;
    const order = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
    return order.map((r) => ({
      rank: r,
      label: r <= 15 ? RANK_LABEL[r] : r === 16 ? '小' : '大',
      left: Math.max(0, total[r] ?? 0),
      total: r <= 15 ? 8 : 2,
    }));
  }

  private async saveTable(table: GuandanTable) {
    await this.cache.set(this.KEY(table.id), JSON.stringify(table), TABLE_TTL);
  }

  private async loadTable(id: string): Promise<GuandanTable | null> {
    const raw = await this.cache.get(this.KEY(id));
    if (!raw) return null;
    const t = JSON.parse(raw as string) as GuandanTable;
    if (!Array.isArray(t.hosted) || t.hosted.length !== 4) {
      t.hosted = [false, false, false, false];
    }
    // 旧存档无 aiLevel，兜底为标准档
    if (t.aiLevel !== 'easy' && t.aiLevel !== 'normal' && t.aiLevel !== 'hard') {
      t.aiLevel = 'normal';
    }
    return t;
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
    await this.saveReplay(table);
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
    await this.saveReplay(table);
    this.eventBus.emit(GameEvents.GUANDAN_TABLE_FINISHED, { tableId: table.id });
  }

  /** 归档本回合回放：开局手牌快照 + 动作日志（供复盘逐步重放） */
  private async saveReplay(table: GuandanTable) {
    const s = table.state;
    if (!s.log?.length) return;
    await this.safePersist(async () => {
      const names = await this.namesOf(table);
      const row = this.replayRepo.create({
        tableId: table.id,
        level: s.level,
        playersJson: table.members.map((m, i) => ({
          seat: i,
          nickname: names[i],
          isBot: !!m && m.startsWith('bot'),
        })),
        initialHandsJson: s.initialHands,
        actionsJson: s.log,
        settlementJson: s.lastSettlement,
        kowtowJson: s.kowtow,
      });
      await this.replayRepo.save(row);
    }, `replay ${table.id}`);
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
