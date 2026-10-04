import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { Cron } from '@nestjs/schedule';

export type RoomStatus = 'matching' | 'forming' | 'ready' | 'in_progress' | 'finished' | 'timeout';

export interface RoomPlayer {
  playerId: string;
  role: 'attacker' | 'defender' | 'pve' | 'spectator';
  ready: boolean;
  joinedAt: string;
}

export interface Room {
  id: string;
  mode: string; // ranked / casual / pve
  status: RoomStatus;
  players: RoomPlayer[];
  maxPlayers: number;
  minPlayers: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  battleConfig?: Record<string, any>;
}

/** Redis key 设计：
 *
 *  room:{roomId}       → Hash 存 Room 状态 + players JSON（TTL = 15 分钟）
 *  room:player:{pId}   → String 存玩家当前所在 roomId（TTL = 同 room）
 *  rooms:{mode}        → Set 存活跃 roomId（按模式过滤）
 */
const ROOM_KEY = (roomId: string) => `room:${roomId}`;
const PLAYER_ROOM_KEY = (pId: string) => `room:player:${pId}`;
const MODE_INDEX_KEY = (mode: string) => `rooms:mode:${mode}`;

const ROOM_TTL_SEC = 15 * 60; // 15 分钟：匹配→准备→开打 足够

@Injectable()
export class RoomService {
  private readonly logger = new Logger(RoomService.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
  ) {}

  // ===== 创建 / 销毁 =====

  async create(opts: {
    mode: string;
    players: string[];
    maxPlayers?: number;
    minPlayers?: number;
    battleConfig?: Record<string, any>;
  }): Promise<Room> {
    const roomId = this.buildRoomId();
    const now = new Date().toISOString();

    const players: RoomPlayer[] = opts.players.map((pid, i) => ({
      playerId: pid,
      role: this.pickRole(opts.mode, i, opts.players.length),
      ready: false,
      joinedAt: now,
    }));

    const room: Room = {
      id: roomId,
      mode: opts.mode,
      status: 'forming',
      players,
      maxPlayers: opts.maxPlayers ?? opts.players.length,
      minPlayers: opts.minPlayers ?? opts.players.length,
      createdAt: now,
      battleConfig: opts.battleConfig,
    };

    // 并行写 Room Hash + 每个玩家的反向索引 + mode Set + TTL
    const pipe = [
      this.cacheService.set(ROOM_KEY(roomId), JSON.stringify(room), ROOM_TTL_SEC),
      ...opts.players.map((pid) =>
        this.cacheService.set(PLAYER_ROOM_KEY(pid), roomId, ROOM_TTL_SEC),
      ),
      this.cacheService.sAdd(MODE_INDEX_KEY(opts.mode), roomId),
    ];
    await Promise.all(pipe);

    this.eventBus.emit(GameEvents.ROOM_CREATED, {
      roomId,
      mode: opts.mode,
      players: opts.players,
    });

    this.logger.log(`[Room] create ${roomId} mode=${opts.mode} players=${opts.players.join(',')}`);
    return room;
  }

  async destroy(roomId: string, reason: string = 'manual'): Promise<void> {
    const room = await this.get(roomId);
    if (!room) return;

    // 清 Room Hash + 玩家反向索引 + mode Set
    const pipe = [
      this.cacheService.del(ROOM_KEY(roomId)),
      ...room.players.map((p) => this.cacheService.del(PLAYER_ROOM_KEY(p.playerId))),
      this.cacheService.sRem(MODE_INDEX_KEY(room.mode), roomId),
    ];
    await Promise.all(pipe);

    this.eventBus.emit(GameEvents.ROOM_DESTROYED, { roomId, reason, mode: room.mode });
    this.logger.log(`[Room] destroy ${roomId} reason=${reason}`);
  }

  // ===== 查询 =====

  async get(roomId: string): Promise<Room | null> {
    const json = await this.cacheService.get(ROOM_KEY(roomId));
    if (!json) return null;
    try {
      return JSON.parse(json) as Room;
    } catch {
      return null;
    }
  }

  async getByPlayer(playerId: string): Promise<Room | null> {
    const roomId = await this.cacheService.get(PLAYER_ROOM_KEY(playerId));
    if (!roomId) return null;
    return this.get(roomId);
  }

  async listByMode(mode: string): Promise<Room[]> {
    const ids = await this.cacheService.sMembers(MODE_INDEX_KEY(mode));
    if (!ids?.length) return [];
    const rooms = await Promise.all(ids.map((id) => this.get(id)));
    return rooms.filter((r): r is Room => r !== null);
  }

  // ===== 成员操作 =====

  /** 玩家确认 ready —— 所有人 ready 自动进入 in_progress */
  async setReady(roomId: string, playerId: string, ready = true): Promise<Room | null> {
    const room = await this.get(roomId);
    if (!room) return null;

    const target = room.players.find((p) => p.playerId === playerId);
    if (!target) return room;

    target.ready = ready;
    await this.cacheService.set(ROOM_KEY(roomId), JSON.stringify(room), ROOM_TTL_SEC);

    // 所有人 ready 且人数达标 → 自动开打
    const allReady = room.players.every((p) => p.ready);
    if (allReady && room.players.length >= room.minPlayers && room.status === 'forming') {
      room.status = 'in_progress';
      room.startedAt = new Date().toISOString();
      await this.cacheService.set(ROOM_KEY(roomId), JSON.stringify(room), ROOM_TTL_SEC);
      this.eventBus.emit(GameEvents.ROOM_STARTED, { roomId, mode: room.mode });
      this.logger.log(`[Room] start ${roomId}`);
    }

    this.eventBus.emit(GameEvents.ROOM_PLAYER_READY, {
      roomId,
      playerId,
      ready,
    });
    return room;
  }

  /** 玩家离开房间 —— 房间人数不够 → 解散 */
  async leave(roomId: string, playerId: string, reason: string = 'leave'): Promise<Room | null> {
    const room = await this.get(roomId);
    if (!room) return null;

    // 清玩家反向索引
    await this.cacheService.del(PLAYER_ROOM_KEY(playerId));

    room.players = room.players.filter((p) => p.playerId !== playerId);
    const remaining = room.players.length;

    if (remaining < room.minPlayers || reason === 'disconnect') {
      // 人数不够或断线 → 解散
      await this.destroy(roomId, `player-left:${reason}`);
      return null;
    }

    // 更新 Room + 刷新 TTL
    await this.cacheService.set(ROOM_KEY(roomId), JSON.stringify(room), ROOM_TTL_SEC);
    this.eventBus.emit(GameEvents.ROOM_PLAYER_LEFT, { roomId, playerId, reason });
    return room;
  }

  /** 游戏结束 → Room finished */
  async finish(roomId: string, result?: Record<string, any>): Promise<Room | null> {
    const room = await this.get(roomId);
    if (!room) return null;

    room.status = 'finished';
    room.finishedAt = new Date().toISOString();
    await this.cacheService.set(ROOM_KEY(roomId), JSON.stringify(room), ROOM_TTL_SEC);

    this.eventBus.emit(GameEvents.ROOM_FINISHED, { roomId, mode: room.mode, ...result });
    return room;
  }

  // ===== 定时清理（兜底：Room 已经 TTL 过期但玩家反向索引还留着）=====

  /** 每 5 分钟扫一次 rooms:mode:* Set，清掉 Redis 已经 TTL 过期的 Room */
  @Cron('*/5 * * * *')
  async cleanupStaleRooms(): Promise<void> {
    const allModes = ['ranked', 'casual', 'pve', 'party'];
    for (const mode of allModes) {
      const ids = await this.cacheService.sMembers(MODE_INDEX_KEY(mode));
      if (!ids?.length) continue;

      let removed = 0;
      for (const id of ids) {
        const exists = await this.cacheService.exists(ROOM_KEY(id));
        if (!exists) {
          await this.cacheService.sRem(MODE_INDEX_KEY(mode), id);
          removed++;
        }
      }
      if (removed > 0) {
        this.logger.log(`[Room.cleanup] removed ${removed} stale from ${mode}`);
      }
    }
  }

  // ===== 工具 =====

  private buildRoomId(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `R-${ts}-${rand}`;
  }

  private pickRole(mode: string, index: number, total: number): RoomPlayer['role'] {
    if (mode === 'pve') return 'pve';
    if (total === 2) return index === 0 ? 'attacker' : 'defender';
    return 'spectator';
  }
}
