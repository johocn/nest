import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';
import {
  SanguoshaMode,
  SanguoshaTableStatus,
  Identity,
  SgsPhase,
} from '@constants/enums';
import {
  SgsGameState,
  SgsClientAction,
  DEFAULT_RULES,
} from './engine';
import * as engine from './engine';
import { chooseAction, chooseRespond } from './engine/bot';
import { SanguoshaRoom, SanguoshaRecord } from './entities';
import { ActionDto, ClientGameView, ClientPlayerView } from './sanguosha.types';
import { PlayerService } from '@modules/player/player.service';

interface SgsTable {
  id: string;
  tenantId: string;
  mode: SanguoshaMode;
  status: SanguoshaTableStatus;
  members: (string | null)[]; // 长度 8
  sockets: (string | null)[];
  hostSeat: number;
  state: SgsGameState;
  createdAt: string;
}

const TABLE_TTL = 3600;
const SEATS = 8;

@Injectable()
export class SanguoshaTableService {
  private readonly logger = new Logger(SanguoshaTableService.name);
  private readonly KEY = (id: string) => `sanguosha:table:${id}`;

  constructor(
    private readonly cache: CacheService,
    @InjectRepository(SanguoshaRoom) private readonly roomRepo: Repository<SanguoshaRoom>,
    @InjectRepository(SanguoshaRecord) private readonly recordRepo: Repository<SanguoshaRecord>,
    private readonly eventBus: EventBusService,
    private readonly playerService: PlayerService,
  ) {}

  private buildTableId(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `sgs-${ts}-${rand}`;
  }

  private isBot(table: SgsTable, seat: number): boolean {
    const m = table.members[seat];
    return !!m && m.startsWith('bot');
  }

  private humanSeats(table: SgsTable): number[] {
    return table.members
      .map((m, i) => (m && !m.startsWith('bot') ? i : -1))
      .filter((i) => i >= 0);
  }

  // ===== 创建牌桌（运营商级隔离：tenantId 落库） =====
  async createTable(
    hostPlayerId: string,
    mode: SanguoshaMode,
    tenantId: string,
    socketId?: string,
  ): Promise<{ tableId: string; seat: number; view: ClientGameView }> {
    const id = this.buildTableId();
    const ai = mode === SanguoshaMode.AI;
    const members: (string | null)[] = ai
      ? [hostPlayerId, 'bot-1', 'bot-2', 'bot-3', 'bot-4', 'bot-5', 'bot-6', 'bot-7']
      : [hostPlayerId, null, null, null, null, null, null, null];
    const hostSeat = 0;

    const isBotArr = members.map((m) => !!m && m.startsWith('bot'));
    const state = engine.createGame(isBotArr, { ...DEFAULT_RULES, seats: SEATS });
    const table: SgsTable = {
      id,
      tenantId,
      mode,
      status: ai ? SanguoshaTableStatus.PLAYING : SanguoshaTableStatus.WAITING,
      members,
      sockets: [socketId ?? null, null, null, null, null, null, null, null],
      hostSeat,
      state,
      createdAt: new Date().toISOString(),
    };
    await this.saveTable(table);

    await this.safePersist(async () => {
      const room = this.roomRepo.create({
        tableId: id,
        tenantId,
        mode,
        hostPlayerId,
        status: table.status,
        playersJson: members,
        socketsJson: table.sockets,
        stateJson: state,
        eventsJson: state.log,
      });
      await this.roomRepo.save(room);
    }, `create room ${id}`);

    this.eventBus.emit(GameEvents.SANGUOSHA_TABLE_CREATED, { tableId: id, mode, hostPlayerId, tenantId });
    this.logger.log(`[Sanguosha] create ${id} mode=${mode} tenant=${tenantId} host=${hostPlayerId}`);
    return { tableId: id, seat: hostSeat, view: await this.toView(table, hostSeat) };
  }

  // ===== 加入牌桌 =====
  async joinTable(
    tableId: string,
    playerId: string,
    tenantId: string,
    socketId?: string,
  ): Promise<{ seat: number; view: ClientGameView }> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.SANGUOSHA_TABLE_NOT_FOUND, '牌桌不存在或已解散');
    if (table.tenantId !== tenantId)
      throw new GameException(ErrorCodes.SANGUOSHA_TENANT_MISMATCH, '租户不匹配');

    const existing = table.members.indexOf(playerId);
    if (existing !== -1) {
      if (socketId && table.sockets[existing] !== socketId) {
        table.sockets[existing] = socketId;
        await this.saveTable(table);
      }
      return { seat: existing, view: await this.toView(table, existing) };
    }

    const seat = table.members.indexOf(null);
    if (seat === -1) throw new GameException(ErrorCodes.SANGUOSHA_TABLE_FULL, '牌桌已满（8 人）');
    table.members[seat] = playerId;
    table.sockets[seat] = socketId ?? null;

    if (table.mode === SanguoshaMode.NET && table.members.every((m) => m)) {
      this.fillBots(table);
      table.state = engine.createGame(
        table.members.map((m) => !!m && m.startsWith('bot')),
        { ...DEFAULT_RULES, seats: SEATS },
      );
      table.status = SanguoshaTableStatus.PLAYING;
      await this.safePersist(async () => {
        const room = await this.roomRepo.findOne({ where: { tableId } });
        if (room) {
          room.status = SanguoshaTableStatus.PLAYING;
          room.startedAt = new Date();
          room.playersJson = table.members;
          room.stateJson = table.state;
          await this.roomRepo.save(room);
        }
      }, `mark playing ${tableId}`);
    }

    await this.saveTable(table);
    this.eventBus.emit(GameEvents.SANGUOSHA_TABLE_UPDATED, { tableId });
    return { seat, view: await this.toView(table, seat) };
  }

  private fillBots(table: SgsTable) {
    table.members = table.members.map((m, i) => m ?? `bot-${i}`);
  }

  async startTable(tableId: string, playerId: string, tenantId: string): Promise<{ view: ClientGameView }> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.SANGUOSHA_TABLE_NOT_FOUND, '牌桌不存在或已解散');
    if (table.tenantId !== tenantId)
      throw new GameException(ErrorCodes.SANGUOSHA_TENANT_MISMATCH, '租户不匹配');
    if (table.members[table.hostSeat] !== playerId)
      throw new GameException(ErrorCodes.SANGUOSHA_NOT_HOST, '只有房主可以开局');
    if (table.mode !== SanguoshaMode.NET)
      throw new GameException(ErrorCodes.SANGUOSHA_INVALID_ACTION, '仅联网模式需要手动开局');
    if (table.status === SanguoshaTableStatus.PLAYING)
      throw new GameException(ErrorCodes.SANGUOSHA_INVALID_ACTION, '对局已开始');

    this.fillBots(table);
    table.state = engine.createGame(
      table.members.map((m) => !!m && m.startsWith('bot')),
      { ...DEFAULT_RULES, seats: SEATS },
    );
    table.status = SanguoshaTableStatus.PLAYING;

    await this.safePersist(async () => {
      const room = await this.roomRepo.findOne({ where: { tableId } });
      if (room) {
        room.status = SanguoshaTableStatus.PLAYING;
        room.startedAt = new Date();
        room.playersJson = table.members;
        room.stateJson = table.state;
        await this.roomRepo.save(room);
      }
    }, `mark playing ${tableId}`);

    await this.saveTable(table);
    this.eventBus.emit(GameEvents.SANGUOSHA_TABLE_UPDATED, { tableId });
    const seat = table.members.indexOf(playerId);
    return { view: await this.toView(table, seat === -1 ? table.hostSeat : seat) };
  }

  // ===== 应用动作（play/respond/end_turn/skill），随后推进 bot 与响应 =====
  async applyAction(
    tableId: string,
    playerId: string,
    tenantId: string,
    dto: ActionDto,
  ): Promise<ClientGameView> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.SANGUOSHA_TABLE_NOT_FOUND, '牌桌不存在或已解散');
    if (table.tenantId !== tenantId)
      throw new GameException(ErrorCodes.SANGUOSHA_TENANT_MISMATCH, '租户不匹配');
    if (table.status !== SanguoshaTableStatus.PLAYING)
      throw new GameException(ErrorCodes.SANGUOSHA_INVALID_ACTION, '对局未开始');

    const seat = table.members.indexOf(playerId);
    if (seat === -1) throw new GameException(ErrorCodes.SANGUOSHA_PLAYER_NOT_IN_TABLE, '你不在该牌桌');

    try {
      const act: SgsClientAction = this.toEngineAction(dto);
      if (dto.type === 'play') table.state = engine.playCard(table.state, seat, act);
      else if (dto.type === 'respond') table.state = engine.respond(table.state, seat, act);
      else if (dto.type === 'end_turn') table.state = engine.endTurn(table.state, seat);
      else if (dto.type === 'skill')
        table.state = engine.useSkill(table.state, seat, dto.skillId!, {
          cardIds: dto.cardIds,
          target: dto.target,
        });
    } catch (err: any) {
      throw new GameException(ErrorCodes.SANGUOSHA_INVALID_ACTION, err?.message || '非法动作');
    }

    await this.progress(table);
    await this.saveTable(table);
    this.eventBus.emit(GameEvents.SANGUOSHA_TABLE_UPDATED, { tableId });
    return this.toView(table, seat);
  }

  private toEngineAction(dto: ActionDto): SgsClientAction {
    if (dto.type === 'play')
      return { type: 'play', cardIds: dto.cardIds ?? [], target: dto.target };
    if (dto.type === 'respond') return { type: 'respond', dodge: dto.dodge, wuxie: dto.wuxie };
    if (dto.type === 'skill')
      return { type: 'skill', skillId: dto.skillId!, cardIds: dto.cardIds, target: dto.target };
    return { type: 'end_turn' };
  }

  /** 推进：结算响应→bot 出牌→回合切换，直到轮到真人或整局结束 */
  private async progress(table: SgsTable) {
    let guard = 0;
    while (guard++ < 300) {
      const s = table.state;
      if (s.winner != null) {
        await this.persistFinished(table);
        return;
      }
      if (s.pendingAsk) {
        const tgt = s.pendingAsk.target;
        if (this.isBot(table, tgt)) {
          const resp = chooseRespond(s, tgt);
          try {
            table.state = engine.respond(s, tgt, resp);
          } catch {
            table.state = engine.respond(s, tgt, { type: 'pass' });
          }
        } else {
          return; // 等待真人响应
        }
        continue;
      }
      if (s.phase === SgsPhase.PLAY) {
        const cur = s.turn;
        if (this.isBot(table, cur)) {
          const act = chooseAction(s, cur);
          try {
            if (act.type === 'end_turn') table.state = engine.endTurn(s, cur);
            else if (act.type === 'play') table.state = engine.playCard(s, cur, act);
            else if (act.type === 'respond') table.state = engine.respond(s, cur, act);
            else if (act.type === 'skill')
              table.state = engine.useSkill(s, cur, (act as any).skillId, {
                cardIds: (act as any).cardIds,
                target: (act as any).target,
              });
          } catch {
            table.state = engine.endTurn(s, cur);
          }
        } else {
          return; // 等待真人操作
        }
        continue;
      }
      // 非出牌阶段且无 pendingAsk：兜底推进（play 分支已 continue，到此必为非出牌阶段）
      engine.startTurn(s, engine.nextAlive(s, s.turn));
    }
  }

  // ===== 视图（按座位裁剪，杜绝信息泄露） =====
  async getView(tableId: string, playerId: string, tenantId: string): Promise<ClientGameView> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.SANGUOSHA_TABLE_NOT_FOUND, '牌桌不存在或已解散');
    if (table.tenantId !== tenantId)
      throw new GameException(ErrorCodes.SANGUOSHA_TENANT_MISMATCH, '租户不匹配');
    const seat = table.members.indexOf(playerId);
    return this.toView(table, seat === -1 ? 0 : seat);
  }

  async viewBySeat(tableId: string, seat: number): Promise<ClientGameView> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.SANGUOSHA_TABLE_NOT_FOUND, '牌桌不存在或已解散');
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

  async history(playerId: string, tenantId: string, limit = 20) {
    try {
      const recs = await this.recordRepo.find({
        where: { playerId, tenantId },
        order: { createdAt: 'DESC' },
        take: limit,
      });
      if (!recs.length) return [];
      const ids = [...new Set(recs.map((r) => r.tableId))];
      const rooms = await this.roomRepo.find({ where: { tableId: ids as any, tenantId } });
      const statusMap = new Map(rooms.map((r) => [r.tableId, r.status]));
      return recs.map((r) => ({
        tableId: r.tableId,
        seat: r.seat,
        identity: r.identity,
        isWinner: r.isWinner,
        status: statusMap.get(r.tableId) ?? null,
        createdAt: r.createdAt,
      }));
    } catch (err: any) {
      this.logger.error(`[history failed] ${playerId}: ${err?.message}`);
      return [];
    }
  }

  async leaveTable(tableId: string, playerId: string, tenantId: string): Promise<void> {
    const table = await this.loadTable(tableId);
    if (!table) return;
    if (table.tenantId !== tenantId) return;
    const seat = table.members.indexOf(playerId);
    if (seat === -1) return;
    table.sockets[seat] = null;
    if (table.mode === SanguoshaMode.NET) table.members[seat] = null;
    await this.saveTable(table);
  }

  /** 断线：仅清空 socket，保留座位便于重连（房间级隔离：座位状态不丢） */
  async disconnectBySocket(socketId: string): Promise<void> {
    // 断线重连由 join（同一 playerId）恢复 socket，这里无需扫描缓存
  }

  // ===== 视图构建 =====
  private async namesOf(table: SgsTable): Promise<string[]> {
    const names: string[] = [];
    for (let i = 0; i < SEATS; i++) {
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

  private async toView(table: SgsTable, seat: number): Promise<ClientGameView> {
    const s = table.state;
    const reveal = s.winner != null;
    const names = await this.namesOf(table);
    const myTurn = s.turn === seat && s.phase === 'play' && !s.pendingAsk && s.winner == null;
    const needRespond = !!s.pendingAsk && s.pendingAsk.target === seat;
    const heroNameOf = (hid: string | null) => {
      const h = hid ? engine.getHero(hid) : null;
      return h?.name ?? '';
    };

    const players: ClientPlayerView[] = table.members.map((m, i) => {
      const ps = s.players[i];
      const isMe = i === seat;
      const isLord = ps.identity === Identity.LORD;
      let identity: string | null = null;
      if (reveal || isMe || isLord) identity = ps.identity;
      return {
        seat: i,
        playerId: m,
        nickname: names[i],
        heroId: ps.heroId,
        heroName: heroNameOf(ps.heroId),
        isBot: !!m && m.startsWith('bot'),
        isAlive: ps.isAlive,
        hp: ps.hp,
        maxHp: ps.maxHp,
        identity,
        handCount: ps.hand.length,
        hand: isMe ? ps.hand.map((id) => s.cards[id]) : [],
        weapon: ps.weapon,
        armor: ps.armor,
        horsePlus: ps.horsePlus,
        horseMinus: ps.horseMinus,
        judge: ps.judge,
        isCurrentTurn: s.turn === i && s.phase === 'play' && s.winner == null,
      };
    });

    const recentLogs = s.log.slice(-10).map((e) => ({ type: e.type, text: e.text, seat: e.seat }));

    return {
      roomId: table.id,
      mode: table.mode,
      turn: s.turn,
      phase: s.phase,
      round: s.round,
      lordSeat: s.lordSeat,
      winner: s.winner,
      players,
      pendingAsk: s.pendingAsk
        ? { kind: s.pendingAsk.kind, target: s.pendingAsk.target, desc: s.pendingAsk.desc }
        : null,
      awaiting: myTurn || needRespond ? [seat] : [],
      yourSeat: seat,
      seated: table.members.filter((m) => m).length,
      recentLogs,
    };
  }

  // ===== 缓存 / 持久化 =====
  private async saveTable(table: SgsTable) {
    await this.cache.set(this.KEY(table.id), JSON.stringify(table), TABLE_TTL);
    // 房间级隔离：每次动作落库整局快照，支持重启/断线重连与回放
    await this.safePersist(async () => {
      const room = await this.roomRepo.findOne({ where: { tableId: table.id } });
      if (room) {
        room.stateJson = table.state;
        room.eventsJson = table.state.log;
        room.status = table.status;
        await this.roomRepo.save(room);
      }
    }, `save ${table.id}`);
  }

  private async loadTable(id: string): Promise<SgsTable | null> {
    const raw = await this.cache.get(this.KEY(id));
    if (!raw) return null;
    return JSON.parse(raw as string) as SgsTable;
  }

  private async persistFinished(table: SgsTable) {
    await this.safePersist(async () => {
      const room = await this.roomRepo.findOne({ where: { tableId: table.id } });
      if (room) {
        room.status = SanguoshaTableStatus.FINISHED;
        room.finishedAt = new Date();
        room.stateJson = table.state;
        room.eventsJson = table.state.log;
        await this.roomRepo.save(room);
      }
      // 写入每人战绩（运营商级隔离：带 tenantId）
      const humans = table.members
        .map((m, i) => ({ m, i }))
        .filter((x) => x.m && !x.m.startsWith('bot'));
      for (const { m, i } of humans) {
        const pl = table.state.players[i];
        const rec = this.recordRepo.create({
          tableId: table.id,
          tenantId: table.tenantId,
          playerId: m!,
          seat: i,
          identity: pl.identity,
          isWinner: table.state.winner != null && pl.identity === table.state.winner,
          detailJson: { winner: table.state.winner },
        });
        await this.recordRepo.save(rec);
      }
    }, `finish ${table.id}`);
    this.eventBus.emit(GameEvents.SANGUOSHA_TABLE_FINISHED, { tableId: table.id });
  }

  private async safePersist(fn: () => Promise<void>, what: string) {
    try {
      await fn();
    } catch (err: any) {
      this.logger.error(`[persist failed] ${what}: ${err?.message}`);
    }
  }
}
