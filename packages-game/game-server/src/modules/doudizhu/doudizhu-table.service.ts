import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';
import { DoudizhuMode, DoudizhuTableStatus } from '@constants/enums';
import {
  DoudizhuGame,
  Card,
  AiLevel,
  serializeGame,
  restoreGame,
  resolveCardsById,
  addPlayedCount,
  chooseBotAction,
  findHints,
} from './engine';
import {
  DoudizhuView,
  DoudizhuActionDto,
  DoudizhuClientPlayer,
  DoudizhuClientState,
  DoudizhuActionLogEntry,
} from './doudizhu.types';
import { DoudizhuRoom, DoudizhuRecord, DoudizhuReplay } from './entities';
import { PlayerService } from '@modules/player/player.service';

interface DoudizhuTable {
  id: string;
  mode: DoudizhuMode;
  status: DoudizhuTableStatus;
  /** 长度 3：playerId / 'bot-N' / null */
  members: (string | null)[];
  /** 长度 3：各座位当前 socketId */
  sockets: (string | null)[];
  /** 长度 3：真人是否开启托管 */
  hosted: boolean[];
  /** 当前手动出牌倒计时截止时间戳(ms) */
  turnDeadline?: number;
  aiLevel: AiLevel;
  /** 序列化的 DoudizhuGame（类实例按 JSON 往返，方法在原型、函数字段不序列化） */
  state: Record<string, any>;
  /** 记牌器：rank -> 已出现张数 */
  playedCount: Record<number, number>;
  /** 动作日志（复盘用） */
  actionLog: DoudizhuActionLogEntry[];
  createdAt: string;
  /** 匹配桌：真人全部入座后才推进首个回合（避免未连接的真人在建房瞬间被 AI 代打完整局） */
  kickOffPending?: boolean;
}

const TABLE_TTL = 3600; // 1 小时
/** 匹配桌等待真人入座上限：超时则缺位按 AI 托管推进 */
const KICK_OFF_WAIT_MS = 15_000;
/** 好友房等待满员上限：超时自动 AI 补位开局 */
const ROOM_AUTO_START_MS = 60_000;

@Injectable()
export class DoudizhuTableService {
  private readonly logger = new Logger(DoudizhuTableService.name);
  private readonly KEY = (id: string) => `doudizhu:table:${id}`;
  private readonly TURN_MS = 30_000; // 手动操作倒计时 30s
  private socketIndex = new Map<string, string>(); // socketId -> tableId
  private timers = new Map<string, NodeJS.Timeout>(); // tableId -> 倒计时定时器
  /** 匹配桌等待真人入座的兜底定时器 */
  private kickOffTimers = new Map<string, NodeJS.Timeout>();
  /** 牌桌级串行锁（入座并发保护） */
  private tableLocks = new Map<string, Promise<unknown>>();
  /** 好友房等待满员的兜底定时器 */
  private autoStartTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly cache: CacheService,
    @InjectRepository(DoudizhuRoom)
    private readonly roomRepo: Repository<DoudizhuRoom>,
    @InjectRepository(DoudizhuRecord)
    private readonly recordRepo: Repository<DoudizhuRecord>,
    @InjectRepository(DoudizhuReplay)
    private readonly replayRepo: Repository<DoudizhuReplay>,
    private readonly eventBus: EventBusService,
    private readonly playerService: PlayerService,
  ) {}

  private buildTableId(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `doudizhu-${ts}-${rand}`;
  }

  private isBot(table: DoudizhuTable, seat: number): boolean {
    const m = table.members[seat];
    return !!m && m.startsWith('bot');
  }

  // ===== 创建牌桌 =====
  async createTable(
    hostPlayerId: string,
    mode: DoudizhuMode,
    socketId?: string,
    aiLevel: AiLevel = 'normal',
  ): Promise<{ tableId: string; seat: number; view: DoudizhuView }> {
    const id = this.buildTableId();
    const ai = mode === DoudizhuMode.AI;
    // AI 模式：房主 + 2 个 bot；NET 模式：房主 + 2 空位（开局时补 bot）
    const members: (string | null)[] = ai
      ? [hostPlayerId, 'bot-1', 'bot-2']
      : [hostPlayerId, null, null];
    const hostSeat = 0;

    const g = new DoudizhuGame({
      rng: Math.random,
      onEvent: undefined,
      doubleMode: false,
    });
    g.start();

    const table: DoudizhuTable = {
      id,
      mode,
      status: ai ? DoudizhuTableStatus.PLAYING : DoudizhuTableStatus.WAITING,
      members,
      sockets: [null, null, null],
      hosted: [false, false, false],
      turnDeadline: undefined,
      aiLevel,
      state: serializeGame(g),
      playedCount: {},
      actionLog: [],
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
        landlordSeat: null,
        baseScore: g.baseScore,
        multiplier: g.multiplier,
        winnerSeat: null,
        landlordWin: null,
        scoresJson: null,
        playersJson: members,
      });
      await this.roomRepo.save(room);
    }, `create room ${id}`);

    this.eventBus.emit('doudizhu:table:created', {
      tableId: id,
      mode,
      hostPlayerId,
    });
    this.logger.log(
      `[Doudizhu] create ${id} mode=${mode} host=${hostPlayerId}`,
    );

    if (ai) {
      // AI 模式立即进入抢地主，bot 自动叫；停止在真人（房主）回合
      await this.progress(table);
      this.scheduleTurn(table);
      await this.saveTable(table);
      this.eventBus.emit('doudizhu:table:updated', { tableId: id });
    } else {
      // 好友房：1 分钟内未满员则自动补 AI 开局
      this.scheduleAutoStart(id);
    }
    return {
      tableId: id,
      seat: hostSeat,
      view: await this.toView(table, hostSeat),
    };
  }

  // ===== 加入牌桌 =====
  async joinTable(
    tableId: string,
    playerId: string,
    socketId?: string,
  ): Promise<{ seat: number; view: DoudizhuView }> {
    // 匹配成功后 3 名真人在同一时刻入座，串行化避免并发读写 Redis 互相覆盖座位 socket
    return this.withTableLock(tableId, () =>
      this.joinTableInner(tableId, playerId, socketId),
    );
  }

  private async joinTableInner(
    tableId: string,
    playerId: string,
    socketId?: string,
  ): Promise<{ seat: number; view: DoudizhuView }> {
    const table = await this.loadTable(tableId);
    if (!table)
      throw new GameException(
        ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND,
        '牌桌不存在或已解散',
      );

    const existing = table.members.indexOf(playerId);
    if (existing !== -1) {
      if (socketId && table.sockets[existing] !== socketId) {
        this.setSocket(table, existing, socketId);
        table.hosted[existing] = false; // 重连后恢复手动控制
      }
      if (socketId) await this.tryKickOff(table);
      await this.saveTable(table);
      return { seat: existing, view: await this.toView(table, existing) };
    }

    const seat = table.members.indexOf(null);
    if (seat === -1)
      throw new GameException(
        ErrorCodes.DOUDIZHU_TABLE_FULL,
        '牌桌已满（3 人）',
      );
    table.members[seat] = playerId;
    this.setSocket(table, seat, socketId ?? null);

    await this.tryKickOff(table);
    this.scheduleTurn(table);
    await this.saveTable(table);
    this.eventBus.emit('doudizhu:table:updated', { tableId });

    // 好友房 3 名真人已齐：无需房主点开始，直接开局
    if (
      table.mode === DoudizhuMode.NET &&
      table.status === DoudizhuTableStatus.WAITING &&
      table.members.every((m) => !!m && !m.startsWith('bot'))
    ) {
      const host = table.members[0] as string;
      await this.startTable(tableId, host).catch((err: any) =>
        this.logger.warn(
          `[Doudizhu] auto start ${tableId} failed: ${err?.message}`,
        ),
      );
    }
    return { seat, view: await this.toView(table, seat) };
  }

  // ===== 好友房自动开局（1 分钟未满员补 AI） =====

  private scheduleAutoStart(tableId: string): void {
    this.clearAutoStart(tableId);
    const timer = setTimeout(() => {
      void this.autoStartRoom(tableId).catch((err: any) =>
        this.logger.warn(
          `[Doudizhu] auto start ${tableId} failed: ${err?.message}`,
        ),
      );
    }, ROOM_AUTO_START_MS);
    timer.unref?.();
    this.autoStartTimers.set(tableId, timer);
  }

  private clearAutoStart(tableId: string): void {
    const timer = this.autoStartTimers.get(tableId);
    if (timer) {
      clearTimeout(timer);
      this.autoStartTimers.delete(tableId);
    }
  }

  /** 房主选择「等待好友上线」：取消 1 分钟自动补位，牌桌保持等待；3 名真人齐仍会自动开局。 */
  async waitForFriends(
    tableId: string,
    playerId: string,
  ): Promise<{ ok: boolean }> {
    const table = await this.loadTable(tableId);
    if (!table)
      throw new GameException(
        ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND,
        '牌桌不存在或已解散',
      );
    if (table.members[0] !== playerId)
      throw new GameException(
        ErrorCodes.DOUDIZHU_NOT_HOST,
        '只有房主可以设置等待',
      );
    if (table.mode !== DoudizhuMode.NET)
      throw new GameException(
        ErrorCodes.DOUDIZHU_INVALID_ACTION,
        '仅联网好友房支持等待好友',
      );
    if (table.status === DoudizhuTableStatus.PLAYING)
      throw new GameException(ErrorCodes.DOUDIZHU_INVALID_ACTION, '对局已开始');

    this.clearAutoStart(tableId);
    this.logger.log(
      `[Doudizhu] ${tableId} 房主选择等待好友上线，已取消 AI 自动补位`,
    );
    return { ok: true };
  }

  private async autoStartRoom(tableId: string): Promise<void> {
    this.autoStartTimers.delete(tableId);
    const table = await this.loadTable(tableId);
    if (!table || table.mode !== DoudizhuMode.NET) return;
    if (table.status !== DoudizhuTableStatus.WAITING) return;
    const human = table.members.find((m) => !!m && !m.startsWith('bot'));
    if (!human) return; // 无人在座，等 Redis TTL 回收
    this.logger.log(`[Doudizhu] ${tableId} 1 分钟未满员，自动 AI 补位开局`);
    await this.startTable(tableId, human);
  }

  /** 断线：清空 socket 并保留座位便于重连；若正轮到该座位则立即 AI 接管 */
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
    const g = restoreGame(table.state);
    if (
      table.status === DoudizhuTableStatus.PLAYING &&
      g.phase !== 'over' &&
      g.current === seat
    ) {
      await this.progress(table);
      this.scheduleTurn(table);
    }
    await this.saveTable(table);
    this.eventBus.emit('doudizhu:table:timeout', { tableId });
  }

  /** 空位补 AI（联网模式开局时） */
  private fillBots(table: DoudizhuTable) {
    table.members = table.members.map((m, i) => m ?? `bot-${i}`);
  }

  // ===== 房主开局（联网模式）：空位 AI 补位并重建对局 =====
  async startTable(
    tableId: string,
    playerId: string,
  ): Promise<{ view: DoudizhuView }> {
    const table = await this.loadTable(tableId);
    if (!table)
      throw new GameException(
        ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND,
        '牌桌不存在或已解散',
      );
    if (table.members[0] !== playerId && table.members[0])
      throw new GameException(ErrorCodes.DOUDIZHU_NOT_HOST, '只有房主可以开局');
    if (table.mode !== DoudizhuMode.NET)
      throw new GameException(
        ErrorCodes.DOUDIZHU_INVALID_ACTION,
        '仅联网模式需要手动开局',
      );
    if (table.status === DoudizhuTableStatus.PLAYING)
      throw new GameException(ErrorCodes.DOUDIZHU_INVALID_ACTION, '对局已开始');

    this.clearAutoStart(tableId);
    this.fillBots(table);
    const g = new DoudizhuGame({
      rng: Math.random,
      onEvent: undefined,
      doubleMode: false,
    });
    g.start();
    table.state = serializeGame(g);
    table.hosted = [false, false, false];
    table.status = DoudizhuTableStatus.PLAYING;

    await this.safePersist(async () => {
      const room = await this.roomRepo.findOne({ where: { tableId } });
      if (room) {
        room.status = DoudizhuTableStatus.PLAYING;
        room.startedAt = new Date();
        room.playersJson = table.members;
        await this.roomRepo.save(room);
      }
    }, `mark playing ${tableId}`);

    this.scheduleTurn(table);
    await this.saveTable(table);
    this.eventBus.emit('doudizhu:table:updated', { tableId });
    this.logger.log(`[Doudizhu] start ${tableId} by ${playerId} (AI 补位)`);

    // bot 自动抢地主，停止在真人回合
    await this.progress(table);
    this.scheduleTurn(table);
    await this.saveTable(table);
    this.eventBus.emit('doudizhu:table:updated', { tableId });

    const seat = table.members.indexOf(playerId);
    return {
      view: await this.toView(table, seat === -1 ? 0 : seat),
    };
  }

  /** 匹配成功后由 DoudizhuMatchService 调用：3 名真人直接开局（无需房主/补 bot） */
  async createMatchTable(
    playerIds: string[],
    aiLevel: AiLevel = 'normal',
  ): Promise<string> {
    const id = this.buildTableId();
    const members: (string | null)[] = [...playerIds];
    while (members.length < 3) members.push(`bot-${members.length}`);
    const g = new DoudizhuGame({
      rng: Math.random,
      onEvent: undefined,
      doubleMode: false,
    });
    g.start();
    const table: DoudizhuTable = {
      id,
      mode: DoudizhuMode.NET,
      status: DoudizhuTableStatus.PLAYING,
      members,
      sockets: [null, null, null],
      hosted: [false, false, false],
      turnDeadline: undefined,
      aiLevel,
      state: serializeGame(g),
      playedCount: {},
      actionLog: [],
      createdAt: new Date().toISOString(),
      kickOffPending: true, // 等真人入座后再推进，避免未连接座位被 AI 代打成结算态
    };
    await this.saveTable(table);
    await this.safePersist(async () => {
      const room = this.roomRepo.create({
        tableId: id,
        mode: DoudizhuMode.NET,
        hostPlayerId: members[0] as string,
        status: DoudizhuTableStatus.PLAYING,
        landlordSeat: null,
        baseScore: g.baseScore,
        multiplier: g.multiplier,
        winnerSeat: null,
        landlordWin: null,
        scoresJson: null,
        playersJson: members,
      });
      await this.roomRepo.save(room);
    }, `create match room ${id}`);
    this.eventBus.emit(GameEvents.DOUDIZHU_TABLE_CREATED, {
      tableId: id,
      mode: DoudizhuMode.NET,
      players: members,
    });
    this.scheduleKickOff(id);
    return id;
  }

  // ===== 匹配桌开局闸门：真人全部入座才推进首个回合 =====

  /** 同一牌桌的写操作串行执行，避免并发读改写互相覆盖 */
  private async withTableLock<T>(
    tableId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.tableLocks.get(tableId) ?? Promise.resolve();
    const task = prev.then(fn, fn);
    const tail = task.then(
      () => undefined,
      () => undefined,
    );
    this.tableLocks.set(tableId, tail);
    try {
      return await task;
    } finally {
      if (this.tableLocks.get(tableId) === tail) {
        this.tableLocks.delete(tableId);
      }
    }
  }

  private scheduleKickOff(tableId: string): void {
    this.clearKickOff(tableId);
    const timer = setTimeout(() => {
      void this.forceKickOff(tableId).catch((err: any) =>
        this.logger.warn(
          `[Doudizhu] force kick off failed ${tableId}: ${err?.message}`,
        ),
      );
    }, KICK_OFF_WAIT_MS);
    timer.unref?.();
    this.kickOffTimers.set(tableId, timer);
  }

  private clearKickOff(tableId: string): void {
    const timer = this.kickOffTimers.get(tableId);
    if (timer) {
      clearTimeout(timer);
      this.kickOffTimers.delete(tableId);
    }
  }

  /** 真人全部入座则放行首个回合 */
  private async tryKickOff(table: DoudizhuTable): Promise<void> {
    if (!table.kickOffPending) return;
    for (let i = 0; i < 3; i++) {
      const m = table.members[i];
      if (m && !m.startsWith('bot') && table.sockets[i] == null) return;
    }
    table.kickOffPending = false;
    this.clearKickOff(table.id);
    await this.progress(table);
  }

  /** 等待超时：仍未入座的真人按 AI 托管推进，避免整桌卡死 */
  private async forceKickOff(tableId: string): Promise<void> {
    this.kickOffTimers.delete(tableId);
    const table = await this.loadTable(tableId);
    if (!table || !table.kickOffPending) return;
    table.kickOffPending = false;
    this.logger.warn(`[Doudizhu] ${tableId} kick off by timeout (AI 托管)`);
    await this.progress(table);
    this.scheduleTurn(table);
    await this.saveTable(table);
    this.eventBus.emit('doudizhu:table:updated', { tableId });
  }

  // ===== 应用动作：抢地主/加倍/出牌/不出，随后推进 bot 与回合切换 =====
  async applyAction(
    tableId: string,
    playerId: string,
    dto: DoudizhuActionDto,
  ): Promise<DoudizhuView> {
    const table = await this.loadTable(tableId);
    if (!table)
      throw new GameException(
        ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND,
        '牌桌不存在或已解散',
      );
    if (table.status !== DoudizhuTableStatus.PLAYING)
      throw new GameException(ErrorCodes.DOUDIZHU_INVALID_ACTION, '对局未开始');

    const seat = table.members.indexOf(playerId);
    if (seat === -1)
      throw new GameException(
        ErrorCodes.DOUDIZHU_PLAYER_NOT_IN_TABLE,
        '你不在该牌桌',
      );
    if (this.isBot(table, seat))
      throw new GameException(
        ErrorCodes.DOUDIZHU_INVALID_ACTION,
        'AI 座位不可操作',
      );

    const g = restoreGame(table.state);
    try {
      if (dto.type === 'bid') {
        // 抢地主按座位轮转，未集满三家时 done=false 属正常中间态，只有非本人回合/非 bidding 才非法
        if (g.phase !== 'bidding' || g.current !== seat)
          throw new GameException(
            ErrorCodes.DOUDIZHU_ILLEGAL_COMBO,
            '当前不能叫地主',
          );
        const r = g.grab(seat, dto.choice);
        this.logAction(table, seat, 'bid', { choice: dto.choice });
        if (r.redeal) {
          // 三家都不抢：重发牌继续抢，保留累计重发次数（超过 3 次由引擎强制首叫者当地主）
          const redealCount = g.redealCount;
          g.start();
          g.redealCount = redealCount;
        }
      } else if (dto.type === 'double') {
        if (g.phase !== 'doubling' || g.current !== seat)
          throw new GameException(
            ErrorCodes.DOUDIZHU_ILLEGAL_COMBO,
            '当前不能加倍',
          );
        g.double(dto.action);
        this.logAction(table, seat, 'double', { action: dto.action });
      } else if (dto.type === 'play') {
        const cards = resolveCardsById(g.hands[seat], dto.cards);
        const ok = g.play(seat, cards);
        if (!ok)
          throw new GameException(
            ErrorCodes.DOUDIZHU_ILLEGAL_COMBO,
            '非法出牌/无法压制上家',
          );
        addPlayedCount(table.playedCount, cards);
        this.logAction(table, seat, 'play', { cards: dto.cards });
      } else if (dto.type === 'pass') {
        const ok = g.pass(seat);
        if (!ok)
          throw new GameException(
            ErrorCodes.DOUDIZHU_ILLEGAL_COMBO,
            '当前不能不出',
          );
        this.logAction(table, seat, 'pass');
      }
    } catch (err: any) {
      if (err instanceof GameException) throw err;
      throw new GameException(
        ErrorCodes.DOUDIZHU_ILLEGAL_COMBO,
        err?.message || '非法动作',
      );
    }

    table.state = serializeGame(g);
    await this.progress(table);
    this.scheduleTurn(table);
    await this.saveTable(table);
    this.eventBus.emit('doudizhu:table:updated', { tableId });
    return this.toView(table, seat);
  }

  /** 循环：结算→bot 自动抢/加倍/出牌，直到轮到真人（或整局结束） */
  private async progress(table: DoudizhuTable) {
    let guard = 0;
    while (guard++ < 3000) {
      const g = restoreGame(table.state);
      if (g.phase === 'over') {
        await this.persistFinished(table);
        return;
      }
      const seat = g.current;
      const auto =
        this.isBot(table, seat) ||
        !!table.hosted[seat] ||
        table.sockets[seat] == null;
      if (!auto) return;
      const action = chooseBotAction(g, seat, table.aiLevel, table.playedCount);
      if (action.type === 'bid') {
        g.grab(seat, action.choice);
        this.logAction(table, seat, 'bid', { choice: action.choice });
      } else if (action.type === 'double') {
        g.double(action.action);
        this.logAction(table, seat, 'double', { action: action.action });
      } else if (action.type === 'play') {
        g.play(seat, action.cards);
        addPlayedCount(table.playedCount, action.cards);
        this.logAction(table, seat, 'play', {
          cards: action.cards.map((c) => c.id),
        });
      } else if (action.type === 'pass') {
        g.pass(seat);
        this.logAction(table, seat, 'pass');
      }
      table.state = serializeGame(g);
    }
  }

  async getView(tableId: string, playerId: string): Promise<DoudizhuView> {
    const table = await this.loadTable(tableId);
    if (!table)
      throw new GameException(
        ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND,
        '牌桌不存在或已解散',
      );
    const seat = table.members.indexOf(playerId);
    return this.toView(table, seat === -1 ? 0 : seat);
  }

  async viewBySeat(tableId: string, seat: number): Promise<DoudizhuView> {
    const table = await this.loadTable(tableId);
    if (!table)
      throw new GameException(
        ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND,
        '牌桌不存在或已解散',
      );
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
      if (m && !m.startsWith('bot') && sid)
        out.push({ seat: i, socketId: sid });
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
    const landlordMap = new Map(rooms.map((r) => [r.tableId, r.landlordSeat]));
    return recs.map((r) => ({
      tableId: r.tableId,
      seat: r.seat,
      isLandlord: r.isLandlord,
      isWinner: r.isWinner,
      deltaScore: r.deltaScore,
      landlordSeat: landlordMap.get(r.tableId) ?? null,
      status: statusMap.get(r.tableId) ?? null,
      createdAt: r.createdAt,
    }));
  }

  /** 复盘：取该牌桌整局回放（仅房主或参与者可见） */
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
    const mine = await this.recordRepo.findOne({
      where: { tableId, playerId },
    });
    if (!isHost && !mine) return [];

    const rows = await this.replayRepo.find({
      where: { tableId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((r) => ({
      id: String(r.id),
      tableId: r.tableId,
      players: r.playersJson,
      initialHands: r.initialHandsJson,
      actions: r.actionsJson,
      settlement: r.settlementJson,
      createdAt: r.createdAt,
    }));
  }

  async leaveTable(tableId: string, playerId: string): Promise<void> {
    const table = await this.loadTable(tableId);
    if (!table) return;
    const seat = table.members.indexOf(playerId);
    if (seat === -1) return;
    this.setSocket(table, seat, null);
    if (table.mode === DoudizhuMode.NET) table.members[seat] = null;
    await this.saveTable(table);
  }

  // ===== 托管 / 倒计时 / 断线兜底 =====
  /** 真人切换托管；开启且轮到本人时立即由 AI 接管 */
  async setHost(
    tableId: string,
    playerId: string,
    on: boolean,
  ): Promise<{ view: DoudizhuView }> {
    const table = await this.loadTable(tableId);
    if (!table)
      throw new GameException(
        ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND,
        '牌桌不存在或已解散',
      );
    const seat = table.members.indexOf(playerId);
    if (seat === -1)
      throw new GameException(
        ErrorCodes.DOUDIZHU_PLAYER_NOT_IN_TABLE,
        '你不在该牌桌',
      );
    table.hosted[seat] = on;
    if (on && table.status === DoudizhuTableStatus.PLAYING) {
      const g = restoreGame(table.state);
      if (g.phase !== 'over' && g.current === seat) {
        const action = chooseBotAction(
          g,
          seat,
          table.aiLevel,
          table.playedCount,
        );
        if (action.type === 'bid') g.grab(seat, action.choice);
        else if (action.type === 'double') g.double(action.action);
        else if (action.type === 'play') {
          g.play(seat, action.cards);
          addPlayedCount(table.playedCount, action.cards);
          this.logAction(table, seat, 'play', {
            cards: action.cards.map((c) => c.id),
          });
        } else if (action.type === 'pass') g.pass(seat);
        table.state = serializeGame(g);
        await this.progress(table);
      }
    }
    this.scheduleTurn(table);
    await this.saveTable(table);
    this.eventBus.emit('doudizhu:table:updated', { tableId });
    return { view: await this.toView(table, seat) };
  }

  /** 安排当前回合倒计时：仅当轮到「手动真人」时设置截止时间并启动定时器 */
  private scheduleTurn(table: DoudizhuTable) {
    this.clearTimer(table.id);
    const g = restoreGame(table.state);
    table.turnDeadline = undefined;
    if (table.status !== DoudizhuTableStatus.PLAYING) return;
    if (g.phase === 'over') return;
    const seat = g.current;
    const manual =
      !this.isBot(table, seat) &&
      !table.hosted[seat] &&
      table.sockets[seat] != null;
    if (!manual) return;
    table.turnDeadline = Date.now() + this.TURN_MS;
    const timer = setTimeout(
      () => void this.onTurnTimeout(table.id),
      this.TURN_MS + 250,
    );
    timer.unref?.();
    this.timers.set(table.id, timer);
  }

  private clearTimer(tableId: string) {
    const t = this.timers.get(tableId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(tableId);
    }
  }

  /** 倒计时到点：超时玩家由 AI 代打一次（抢地主/加倍/最小压牌） */
  private async onTurnTimeout(tableId: string) {
    this.clearTimer(tableId);
    const table = await this.loadTable(tableId);
    if (!table) return;
    const g = restoreGame(table.state);
    if (g.phase === 'over') return;
    const seat = g.current;
    if (
      this.isBot(table, seat) ||
      table.hosted[seat] ||
      table.sockets[seat] == null
    )
      return;
    table.turnDeadline = undefined;
    const action = chooseBotAction(g, seat, table.aiLevel, table.playedCount);
    if (action.type === 'bid') g.grab(seat, action.choice);
    else if (action.type === 'double') g.double(action.action);
    else if (action.type === 'play') {
      g.play(seat, action.cards);
      addPlayedCount(table.playedCount, action.cards);
      this.logAction(table, seat, 'play', {
        cards: action.cards.map((c) => c.id),
      });
    } else if (action.type === 'pass') g.pass(seat);
    table.state = serializeGame(g);
    await this.progress(table);
    this.scheduleTurn(table);
    await this.saveTable(table);
    this.eventBus.emit('doudizhu:table:timeout', { tableId });
  }

  /** 更新某座位 socket 并同步索引（旧 socket 自动失效） */
  private setSocket(
    table: DoudizhuTable,
    seat: number,
    socketId: string | null,
  ) {
    const old = table.sockets[seat];
    if (old && old !== socketId) this.socketIndex.delete(old);
    table.sockets[seat] = socketId;
    if (socketId) this.socketIndex.set(socketId, table.id);
  }

  private logAction(
    table: DoudizhuTable,
    seat: number,
    type: DoudizhuActionLogEntry['type'],
    extra?: Partial<DoudizhuActionLogEntry>,
  ) {
    table.actionLog.push({ seat, type, ...extra });
  }

  // ===== 内部：视图构建 =====
  private async namesOf(table: DoudizhuTable): Promise<string[]> {
    const names: string[] = [];
    for (let i = 0; i < 3; i++) {
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

  private async toView(
    table: DoudizhuTable,
    seat: number,
  ): Promise<DoudizhuView> {
    const g = restoreGame(table.state);
    const reveal = g.phase === 'over';
    const names = await this.namesOf(table);
    const myTurn = g.current === seat && g.phase !== 'over';

    const players: DoudizhuClientPlayer[] = table.members.map((m, i) => {
      const isMe = i === seat;
      return {
        seat: i,
        playerId: m,
        nickname: names[i],
        isBot: !!m && m.startsWith('bot'),
        handCount: g.hands[i].length,
        isCurrent: g.current === i && g.phase !== 'over',
        isLandlord: i === g.landlord,
        lastPlay:
          g.lastPlay && g.lastPlay.player === i
            ? { cards: g.lastPlay.cards, type: g.lastPlay.type }
            : null,
        hand: reveal || isMe ? g.hands[i] : [],
        actionHint:
          myTurn && i === seat && g.phase === 'playing'
            ? findHints(g.hands[seat], g.lastPlay ? g.lastPlay.type : null)
            : undefined,
        connected: table.sockets[i] != null,
        hosted: !!table.hosted[i],
      };
    });

    const state: DoudizhuClientState = {
      phase: g.phase,
      current: g.current,
      landlord: g.landlord,
      multiplier: g.multiplier,
      baseScore: g.baseScore,
      bottom: g.landlord >= 0 ? g.bottom : [],
      lastPlay: g.lastPlay
        ? {
            seat: g.lastPlay.player,
            cards: g.lastPlay.cards,
            type: g.lastPlay.type,
          }
        : null,
      spring: g.spring,
      scores: g.scores,
      winner: g.winner,
      landlordWin: g.landlordWin,
      doubleMode: g.doubleMode,
      doubleDecisions: g.doubleDecisions,
      turnDeadline: table.turnDeadline ?? null,
      playedCount: table.playedCount,
    };

    return {
      roomId: table.id,
      mode: table.mode,
      state,
      players,
      yourSeat: seat,
      seated: table.members.filter((m) => m).length,
      awaiting: myTurn ? [seat] : [],
    };
  }

  private async saveTable(table: DoudizhuTable) {
    await this.cache.set(this.KEY(table.id), JSON.stringify(table), TABLE_TTL);
  }

  private async loadTable(id: string): Promise<DoudizhuTable | null> {
    const raw = await this.cache.get(this.KEY(id));
    if (!raw) return null;
    const t = JSON.parse(raw as string) as DoudizhuTable;
    if (!Array.isArray(t.hosted) || t.hosted.length !== 3) {
      t.hosted = [false, false, false];
    }
    if (!t.playedCount) t.playedCount = {};
    if (!t.actionLog) t.actionLog = [];
    if (
      t.aiLevel !== 'easy' &&
      t.aiLevel !== 'normal' &&
      t.aiLevel !== 'hard'
    ) {
      t.aiLevel = 'normal';
    }
    return t;
  }

  private async persistFinished(table: DoudizhuTable) {
    const g = restoreGame(table.state);
    await this.safePersist(async () => {
      const room = await this.roomRepo.findOne({
        where: { tableId: table.id },
      });
      if (room) {
        room.status = DoudizhuTableStatus.FINISHED;
        room.finishedAt = new Date();
        room.landlordSeat = g.landlord;
        room.winnerSeat = g.winner;
        room.landlordWin = g.landlordWin;
        room.multiplier = g.multiplier;
        room.scoresJson = g.scores;
        room.settlementJson = {
          spring: g.spring,
          baseScore: g.baseScore,
          scores: g.scores,
        };
        await this.roomRepo.save(room);
      }
    }, `finish ${table.id}`);

    await this.safePersist(async () => {
      const humans = table.members
        .map((m, i) => ({ m, i }))
        .filter((x) => x.m && !x.m.startsWith('bot'));
      for (const { m, i } of humans) {
        const isLandlord = i === g.landlord;
        const isWinner =
          (g.landlordWin && isLandlord) || (!g.landlordWin && !isLandlord);
        const rec = this.recordRepo.create({
          tableId: table.id,
          playerId: m!,
          seat: i,
          isLandlord,
          isWinner,
          deltaScore: g.scores[i],
          detailJson: {
            multiplier: g.multiplier,
            spring: g.spring,
            baseScore: g.baseScore,
          },
        });
        await this.recordRepo.save(rec);
      }
    }, `records ${table.id}`);

    await this.saveReplay(table);
    const seats = table.members
      .map((m, i) => ({ seat: i, playerId: m }))
      .filter((x) => x.playerId && !x.playerId.startsWith('bot'));
    this.eventBus.emit(GameEvents.DOUDIZHU_TABLE_FINISHED, {
      tableId: table.id,
      seats,
      scores: g.scores,
      landlordSeat: g.landlord,
      landlordWin: g.landlordWin,
      baseScore: g.baseScore,
      multiplier: g.multiplier,
    });
  }

  /** 归档整局回放：开局手牌快照 + 动作日志（供复盘逐步重放） */
  private async saveReplay(table: DoudizhuTable) {
    const g = restoreGame(table.state);
    await this.safePersist(async () => {
      const names = await this.namesOf(table);
      const row = this.replayRepo.create({
        tableId: table.id,
        playersJson: table.members.map((m, i) => ({
          seat: i,
          playerId: m,
          nickname: names[i],
          isBot: !!m && m.startsWith('bot'),
        })),
        initialHandsJson: g.hands,
        actionsJson: table.actionLog,
        settlementJson: {
          phase: g.phase,
          landlord: g.landlord,
          winner: g.winner,
          landlordWin: g.landlordWin,
          multiplier: g.multiplier,
          scores: g.scores,
          spring: g.spring,
        },
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
