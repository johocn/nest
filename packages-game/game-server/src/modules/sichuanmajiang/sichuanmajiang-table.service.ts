import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';
import { SichuanMahjongTableStatus, SichuanMahjongMode } from '@constants/enums';
import {
  GameState,
  Suit,
  ActionType,
  createGame,
  submitQueMen,
  submitTurnAction,
  getResponses,
  getTurnActions,
  resolveDiscard,
  chooseQueMen,
  chooseTurnAction,
  chooseResponse,
} from './engine';
import { SichuanMahjongRoom, SichuanMahjongRecord } from './entities';
import {
  GameView,
  ActionDto,
  ClientGameState,
  ClientPlayerState,
} from './sichuanmajiang.types';

interface SichuanMahjongTable {
  id: string;
  mode: SichuanMahjongMode;
  status: SichuanMahjongTableStatus;
  members: (string | null)[]; // 长度 4：playerId / 'bot-N' / null
  sockets: (string | null)[]; // 长度 4：各座位当前 socketId（按人推送个性化视图）
  hostSeat: number;
  state: GameState;
  respAwaiting: number[]; // 响应窗口中待操作的人类座位
  baseChoices: Record<number, ActionType>; // AI 预设选择
  collected: Record<number, ActionType>; // 已收集的人类响应
  createdAt: string;
}

const TABLE_TTL = 3600; // 1 小时
const RESPONSE_TIMEOUT_MS = 15000; // 响应窗口超时：15 秒未操作自动过牌

@Injectable()
export class SichuanMahjongTableService {
  private readonly logger = new Logger(SichuanMahjongTableService.name);
  private readonly KEY = (id: string) => `sichuanmajiang:table:${id}`;

  constructor(
    private readonly cache: CacheService,
    @InjectRepository(SichuanMahjongRoom)
    private readonly roomRepo: Repository<SichuanMahjongRoom>,
    @InjectRepository(SichuanMahjongRecord)
    private readonly recordRepo: Repository<SichuanMahjongRecord>,
    private readonly eventBus: EventBusService,
  ) {}

  // ===== 房间号：以 sichuanmajiang 开头 =====
  private buildTableId(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `sichuanmajiang-${ts}-${rand}`;
  }

  private isHuman(table: SichuanMahjongTable, seat: number): boolean {
    const m = table.members[seat];
    return !!m && !m.startsWith('bot');
  }

  private humanSeats(table: SichuanMahjongTable): number[] {
    const out: number[] = [];
    table.members.forEach((m, i) => {
      if (m && !m.startsWith('bot')) out.push(i);
    });
    return out;
  }

  // ===== 创建牌桌（用户共享：房主 + 其余席位）=====
  async createTable(
    hostPlayerId: string,
    mode: SichuanMahjongMode,
    socketId?: string,
  ): Promise<{ tableId: string; seat: number; view: GameView }> {
    const id = this.buildTableId();
    const members: (string | null)[] =
      mode === SichuanMahjongMode.AI
        ? [hostPlayerId, 'bot-1', 'bot-2', 'bot-3']
        : [hostPlayerId, null, null, null];
    const hostSeat = 0;

    let state = createGame(mode === SichuanMahjongMode.AI ? 'ai' : 'net');
    if (mode === SichuanMahjongMode.AI) {
      for (let s = 1; s <= 3; s++) state = submitQueMen(state, s, chooseQueMen(state, s));
    }

    const table: SichuanMahjongTable = {
      id,
      mode,
      status: mode === SichuanMahjongMode.AI ? SichuanMahjongTableStatus.PLAYING : SichuanMahjongTableStatus.WAITING,
      members,
      sockets: [socketId ?? null, null, null, null],
      hostSeat,
      state,
      respAwaiting: [],
      baseChoices: {},
      collected: {},
      createdAt: new Date().toISOString(),
    };
    await this.saveTable(table);

    // 持久化是"尽力而为"：牌局实时态在 Redis，数据库故障不应阻断开局
    await this.safePersist(
      async () => {
        const room = this.roomRepo.create({
          tableId: id,
          mode,
          hostPlayerId,
          status: table.status,
          playersJson: members,
        });
        await this.roomRepo.save(room);
      },
      `create room ${id}`,
    );

    this.eventBus.emit(GameEvents.SICHUANMAJIANG_TABLE_CREATED, { tableId: id, mode, hostPlayerId });
    this.logger.log(`[SichuanMahjong] create ${id} mode=${mode} host=${hostPlayerId}`);
    return { tableId: id, seat: hostSeat, view: this.toView(table, hostSeat) };
  }

  // ===== 加入牌桌 =====
  async joinTable(
    tableId: string,
    playerId: string,
    socketId?: string,
  ): Promise<{ seat: number; view: GameView }> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.SICHUANMAJIANG_TABLE_NOT_FOUND, '牌桌不存在或已解散');

    const existing = table.members.indexOf(playerId);
    if (existing !== -1) {
      // 重连：刷新 socket 后返回原座位
      if (socketId && table.sockets[existing] !== socketId) {
        table.sockets[existing] = socketId;
        await this.saveTable(table);
      }
      return { seat: existing, view: this.toView(table, existing) };
    }

    const seat = table.members.indexOf(null);
    if (seat === -1) throw new GameException(ErrorCodes.SICHUANMAJIANG_TABLE_FULL, '牌桌已满（4 人）');
    table.members[seat] = playerId;
    table.sockets[seat] = socketId ?? null;

    if (table.mode === SichuanMahjongMode.NET && table.members.every((m) => m)) {
      table.state = createGame('net');
      table.status = SichuanMahjongTableStatus.PLAYING;
      await this.safePersist(async () => {
        const room = await this.roomRepo.findOne({ where: { tableId } });
        if (room) {
          room.status = SichuanMahjongTableStatus.PLAYING;
          room.startedAt = new Date();
          room.playersJson = table.members;
          await this.roomRepo.save(room);
        }
      }, `mark playing ${tableId}`);
    }

    await this.saveTable(table);
    this.eventBus.emit(GameEvents.SICHUANMAJIANG_TABLE_UPDATED, { tableId });
    return { seat, view: this.toView(table, seat) };
  }

  /** 落库失败只记日志，不影响牌局进行 */
  private async safePersist(fn: () => Promise<void>, what: string) {
    try {
      await fn();
    } catch (err: any) {
      this.logger.error(`[persist failed] ${what}: ${err?.message}`);
    }
  }

  // ===== 房主开局：空位由 AI 补上，避免 2~3 人时卡在等待 =====
  async startTable(tableId: string, playerId: string): Promise<{ view: GameView }> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.SICHUANMAJIANG_TABLE_NOT_FOUND, '牌桌不存在或已解散');
    if (table.members[table.hostSeat] !== playerId)
      throw new GameException(ErrorCodes.SICHUANMAJIANG_NOT_YOUR_TURN, '只有房主可以开局');
    if (table.mode !== SichuanMahjongMode.NET)
      throw new GameException(ErrorCodes.SICHUANMAJIANG_INVALID_ACTION, '仅联网模式需要手动开局');
    if (table.state.phase !== 'queMen')
      throw new GameException(ErrorCodes.SICHUANMAJIANG_INVALID_ACTION, '牌局已开始');

    // 未入座的空位交给 AI
    table.members = table.members.map((m, i) => m ?? `bot-${i}`);
    let state = createGame('net');
    for (let s = 0; s < 4; s++) {
      if (!this.isHuman(table, s)) state = submitQueMen(state, s, chooseQueMen(state, s));
    }
    table.state = state;
    table.status = SichuanMahjongTableStatus.PLAYING;

    await this.safePersist(async () => {
      const room = await this.roomRepo.findOne({ where: { tableId } });
      if (room) {
        room.status = SichuanMahjongTableStatus.PLAYING;
        room.startedAt = new Date();
        room.playersJson = table.members;
        await this.roomRepo.save(room);
      }
    }, `mark playing ${tableId}`);

    await this.saveTable(table);
    this.eventBus.emit(GameEvents.SICHUANMAJIANG_TABLE_UPDATED, { tableId });
    this.logger.log(`[SichuanMahjong] start ${tableId} by ${playerId} (AI 补位)`);
    const seat = table.members.indexOf(playerId);
    return { view: this.toView(table, seat === -1 ? table.hostSeat : seat) };
  }

  // ===== 应用动作（出牌/碰杠胡/定缺/过）=====
  async applyAction(
    tableId: string,
    playerId: string,
    dto: ActionDto,
  ): Promise<GameView> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.SICHUANMAJIANG_TABLE_NOT_FOUND, '牌桌不存在或已解散');

    const seat = table.members.indexOf(playerId);
    if (seat === -1) throw new GameException(ErrorCodes.SICHUANMAJIANG_NOT_YOUR_TURN, '你不在该牌桌');

    const s = table.state;

    if (dto.type === 'queMen') {
      if (s.phase !== 'queMen' || s.players[seat].queuedSuit)
        throw new GameException(ErrorCodes.SICHUANMAJIANG_ALREADY_QUEUED, '已定缺或不在定缺阶段');
      table.state = submitQueMen(s, seat, dto.suit as Suit);
      this.advanceAi(table);
    } else if (s.phase === 'discard' && s.turn === seat) {
      table.state = submitTurnAction(s, seat, { type: dto.type, seat, tile: dto.tile } as any);
      this.afterMaybeResponse(table);
      this.advanceAi(table);
    } else if (s.phase === 'response' && table.respAwaiting.includes(seat)) {
      table.collected[seat] = dto.type;
      table.respAwaiting = table.respAwaiting.filter((x) => x !== seat);
      if (table.respAwaiting.length === 0) {
        const choices = { ...table.baseChoices, ...table.collected };
        table.state = resolveDiscard(table.state, choices);
        table.baseChoices = {};
        table.collected = {};
        this.afterMaybeResponse(table);
        this.advanceAi(table);
      }
    } else {
      throw new GameException(ErrorCodes.SICHUANMAJIANG_NOT_YOUR_TURN, '不是你的操作时机');
    }

    await this.saveTable(table);
    if (table.state.ended) await this.persistFinished(table);
    this.eventBus.emit(GameEvents.SICHUANMAJIANG_TABLE_UPDATED, { tableId });
    return this.toView(table, seat);
  }

  async getView(tableId: string, playerId: string): Promise<GameView> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.SICHUANMAJIANG_TABLE_NOT_FOUND, '牌桌不存在或已解散');
    const seat = table.members.indexOf(playerId);
    return this.toView(table, seat === -1 ? 0 : seat);
  }

  /** 按座位取视图（推送给同桌每位玩家时使用，保证 yourSeat 各自正确） */
  async viewBySeat(tableId: string, seat: number): Promise<GameView> {
    const table = await this.loadTable(tableId);
    if (!table) throw new GameException(ErrorCodes.SICHUANMAJIANG_TABLE_NOT_FOUND, '牌桌不存在或已解散');
    return this.toView(table, seat);
  }

  /** 需要推送的真人座位及其 socketId */
  async broadcastTargets(
    tableId: string,
  ): Promise<{ seat: number; socketId: string }[]> {
    const table = await this.loadTable(tableId);
    if (!table) return [];
    const out: { seat: number; socketId: string }[] = [];
    table.members.forEach((m, i) => {
      const sid = table.sockets[i];
      if (m && !m.startsWith('bot') && sid) out.push({ seat: i, socketId: sid });
    });
    return out;
  }

  /** 指定玩家的历史对局（带牌桌状态，用于战绩展示） */
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
    return recs.map((r) => ({
      tableId: r.tableId,
      seat: r.seat,
      scoreDelta: Number(r.scoreDelta ?? 0),
      fanDetail: r.fanDetail,
      createdAt: r.createdAt,
      status: statusMap.get(r.tableId) ?? null,
    }));
  }

  async leaveTable(tableId: string, playerId: string): Promise<void> {
    const table = await this.loadTable(tableId);
    if (!table) return;
    const seat = table.members.indexOf(playerId);
    if (seat === -1) return;
    table.sockets[seat] = null;
    if (table.mode === SichuanMahjongMode.NET) table.members[seat] = null;
    await this.saveTable(table);
  }

  // ===== 内部：响应窗口 + AI 推进 =====

  private afterMaybeResponse(table: SichuanMahjongTable) {
    const s = table.state;
    if (s.phase !== 'response') return;
    const resp = getResponses(s);
    table.baseChoices = {};
    table.collected = {};
    table.respAwaiting = [];
    for (const r of resp) {
      if (this.isHuman(table, r.seat)) table.respAwaiting.push(r.seat);
      else table.baseChoices[r.seat] = chooseResponse(s, r.seat, r.actions);
    }
    if (table.respAwaiting.length === 0) {
      table.state = resolveDiscard(s, table.baseChoices);
      table.baseChoices = {};
      table.respAwaiting = [];
    } else {
      // 有人类玩家待响应：为每人挂超时，超时自动过牌，避免故意拖延
      for (const seat of table.respAwaiting) this.scheduleAutoPass(table.id, seat);
    }
  }

  private scheduleAutoPass(tableId: string, seat: number) {
    setTimeout(() => void this.autoPass(tableId, seat), RESPONSE_TIMEOUT_MS);
  }

  /** 超时自动过牌：仅在该座位仍处于同一响应窗口时生效 */
  private async autoPass(tableId: string, seat: number) {
    try {
      const table = await this.loadTable(tableId);
      if (!table || table.state.ended) return;
      if (table.state.phase !== 'response') return;
      if (!table.respAwaiting.includes(seat)) return;

      table.collected[seat] = 'pass';
      table.respAwaiting = table.respAwaiting.filter((x) => x !== seat);
      if (table.respAwaiting.length === 0) {
        const choices = { ...table.baseChoices, ...table.collected };
        table.state = resolveDiscard(table.state, choices);
        table.baseChoices = {};
        table.collected = {};
        this.afterMaybeResponse(table);
        this.advanceAi(table);
      }
      await this.saveTable(table);
      if (table.state.ended) await this.persistFinished(table);
      this.eventBus.emit(GameEvents.SICHUANMAJIANG_TABLE_TIMEOUT, { tableId, seat });
      this.logger.log(`[SichuanMahjong] auto-pass ${tableId} seat=${seat}`);
    } catch (err: any) {
      this.logger.error(`autoPass failed: ${err?.message}`);
    }
  }

  private advanceAi(table: SichuanMahjongTable) {
    let guard = 0;
    while (!table.state.ended && guard++ < 3000) {
      const s = table.state;
      if (s.phase === 'discard') {
        if (this.isHuman(table, s.turn)) return;
        const act = chooseTurnAction(s, s.turn);
        table.state = submitTurnAction(s, s.turn, act as any);
        this.afterMaybeResponse(table);
        if (table.state.phase === 'response' && table.respAwaiting.length > 0) return;
        continue;
      }
      if (s.phase === 'response') {
        const resp = getResponses(table.state);
        const humanResp = resp.filter((r) => this.isHuman(table, r.seat));
        if (humanResp.length) return;
        const choices: Record<number, ActionType> = {};
        for (const r of resp) choices[r.seat] = chooseResponse(table.state, r.seat, r.actions);
        table.state = resolveDiscard(table.state, choices);
        continue;
      }
      return;
    }
  }

  /**
   * 按座位净化出参：非终局时隐藏他人手牌与整副牌墙（只给张数），
   * 终局揭示全部手牌便于复盘。仅作用于出参，不污染服务端持有的完整状态。
   */
  private sanitizeForSeat(state: GameState, seat: number): ClientGameState {
    const reveal = state.ended;
    const players: ClientPlayerState[] = state.players.map((p) => ({
      ...p,
      hand: reveal || p.seat === seat ? p.hand : [],
      handCount: p.hand.length,
    }));
    return {
      ...state,
      players,
      wall: reveal ? state.wall : [],
      wallCount: state.wall.length,
      // 只暴露本人刚摸到的牌，避免泄露他人摸牌
      lastDrawn: state.turn === seat ? state.lastDrawn : undefined,
    };
  }

  private toView(table: SichuanMahjongTable, seat: number): GameView {
    const s = table.state;
    let awaiting: number[] = [];
    let actionHint: ActionType[] = [];
    if (s.phase === 'queMen') {
      awaiting = this.humanSeats(table).filter((x) => !s.players[x].queuedSuit);
    } else if (s.phase === 'discard') {
      if (this.isHuman(table, s.turn)) {
        awaiting = [s.turn];
        actionHint = getTurnActions(s, s.turn);
      }
    } else if (s.phase === 'response') {
      awaiting = table.respAwaiting;
      const r = getResponses(s).find((x) => x.seat === seat);
      if (r) actionHint = r.actions;
    }
    return {
      roomId: table.id,
      mode: table.mode,
      state: this.sanitizeForSeat(s, seat),
      seated: table.members.filter((m) => m).length,
      awaiting,
      actionHint,
      yourSeat: seat,
    };
  }

  private async saveTable(table: SichuanMahjongTable) {
    await this.cache.set(this.KEY(table.id), JSON.stringify(table), TABLE_TTL);
  }

  private async loadTable(id: string): Promise<SichuanMahjongTable | null> {
    const raw = await this.cache.get(this.KEY(id));
    if (!raw) return null;
    return JSON.parse(raw) as SichuanMahjongTable;
  }

  private async persistFinished(table: SichuanMahjongTable) {
    await this.safePersist(async () => {
      const room = await this.roomRepo.findOne({ where: { tableId: table.id } });
      if (room) {
        room.status = SichuanMahjongTableStatus.FINISHED;
        room.finishedAt = new Date();
        room.settlementJson = table.state.settlement;
        await this.roomRepo.save(room);
      }
      const players = table.members
        .map((m, i) => ({ m, i }))
        .filter((x) => x.m && !x.m.startsWith('bot'));
      for (const { m, i } of players) {
        const rec = this.recordRepo.create({
          tableId: table.id,
          playerId: m!,
          seat: i,
          scoreDelta: String(table.state.scores[i] ?? 0),
          fanDetail: table.state.settlement?.details?.[i] ?? null,
        });
        await this.recordRepo.save(rec);
      }
    }, `finish ${table.id}`);
    this.eventBus.emit(GameEvents.SICHUANMAJIANG_TABLE_FINISHED, { tableId: table.id });
  }
}
