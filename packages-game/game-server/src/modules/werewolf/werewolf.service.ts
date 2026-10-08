import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { WerewolfRoom } from './werewolf-room';
import { CreateRoomOptions, RoomSnapshot } from './werewolf.types';
import {
  WerewolfMatch,
  WerewolfMatchStatus,
} from './entities/werewolf-match.entity';
import { WerewolfPlayerStat } from './entities/werewolf-player-stat.entity';

/**
 * 狼人杀房间管理器（有状态、单例）。
 * 负责：内存房间表、按阶段时长调度定时器、对局结束持久化、通过 event-bus 广播状态。
 * 网络推送由 WerewolfGateway 监听 WEREWOLF_BROADCAST 完成，本类不直接持有 socket。
 */
@Injectable()
export class WerewolfService {
  private readonly logger = new Logger(WerewolfService.name);
  private readonly rooms = new Map<string, WerewolfRoom>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @InjectRepository(WerewolfMatch)
    private readonly matchRepo: Repository<WerewolfMatch>,
    @InjectRepository(WerewolfPlayerStat)
    private readonly statRepo: Repository<WerewolfPlayerStat>,
    private readonly eventBus: EventBusService,
  ) {}

  // ----------------------------------------------------------------- 建房/进出
  createRoom(opts: CreateRoomOptions): RoomSnapshot {
    if (this.rooms.has(opts.roomId)) {
      throw new Error('ROOM_ALREADY_EXISTS');
    }
    const room = new WerewolfRoom(opts);
    this.rooms.set(opts.roomId, room);
    this.persistMatch(room, WerewolfMatchStatus.LOBBY).catch(() => undefined);
    return room.getPublicSnapshot();
  }

  joinRoom(roomId: string, playerId: string, name: string): RoomSnapshot {
    const room = this.requireRoom(roomId);
    room.addPlayer(playerId, name);
    this.broadcast(room);
    return room.getPublicSnapshot();
  }

  leaveRoom(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.removePlayer(playerId);
    if (room.players.length === 0) {
      this.disposeRoom(roomId);
      return;
    }
    if (room.isRunning) this.driveRoom(room);
    else this.broadcast(room);
  }

  startRoom(roomId: string, playerId: string): RoomSnapshot {
    const room = this.requireRoom(roomId);
    if (room.hostPlayerId !== playerId) {
      throw new Error('WEREWOLF_NOT_HOST');
    }
    room.start(Date.now());
    this.persistMatch(room, WerewolfMatchStatus.PLAYING).catch(() => undefined);
    this.driveRoom(room);
    return room.getPublicSnapshot();
  }

  // -------------------------------------------------------------------- 行动
  submitAction(
    roomId: string,
    playerId: string,
    payload: import('./werewolf.types').ActionPayload,
  ) {
    const room = this.requireRoom(roomId);
    const view = room.submitAction(playerId, payload, Date.now());
    this.driveRoom(room);
    return view;
  }

  /** 发言 / 遗言：校验通过后广播（房间内所有人可见） */
  say(roomId: string, playerId: string, text: string): RoomSnapshot {
    const room = this.requireRoom(roomId);
    const err = room.say(playerId, text);
    if (err) throw new Error(err);
    this.broadcast(room);
    return room.getPublicSnapshot();
  }

  /** 狼人夜间频道发言：仅对狼人可见，不改变阶段 */
  wolfSay(roomId: string, playerId: string, text: string): RoomSnapshot {
    const room = this.requireRoom(roomId);
    const err = room.wolfSay(playerId, text);
    if (err) throw new Error(err);
    this.broadcast(room);
    return room.getPublicSnapshot();
  }

  /** 定时器到点（由 setTimeout 触发） */
  timeoutRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || !room.isRunning) return;
    room.timeout(Date.now());
    this.driveRoom(room);
  }

  getSnapshot(roomId: string): RoomSnapshot {
    return this.requireRoom(roomId).getPublicSnapshot();
  }

  getPrivateView(roomId: string, playerId: string) {
    return this.requireRoom(roomId).getPrivateView(playerId);
  }

  listRooms(): RoomSnapshot[] {
    return [...this.rooms.values()].map((r) => r.getPublicSnapshot());
  }

  /**
   * 开发/演示专用：房主向房间填充若干机器人。机器人会自动行动
   * （狼刀/查验/女巫解药与毒药/守卫/投票/猎人开枪，见 WerewolfRoom.botAutoAct），
   * 便于单人本地体验完整对局流程；正式环境可通过 WEREWOLF_DEV 关闭。
   */
  devFillRoom(roomId: string, playerId: string, count: number): RoomSnapshot {
    const room = this.requireRoom(roomId);
    if (room.hostPlayerId !== playerId) {
      throw new Error('WEREWOLF_NOT_HOST');
    }
    const n = Math.max(0, Math.min(count, 12 - room.players.length));
    for (let i = 1; i <= n; i++) {
      room.addPlayer(`bot_${room.roomId}_${i}`, `机器人${i}`, false, true);
    }
    this.broadcast(room);
    return room.getPublicSnapshot();
  }

  // ----------------------------------------------------------------- 广播/定时
  /**
   * 统一的「变更后」处理：广播最新状态 →（若仍在进行）驱动机器人自动行动
   * 直到某阶段需要真人操作或游戏结束 → 再次广播 → 重新调度阶段定时器
   * （机器人推进会改变当前阶段，因此定时器必须基于最新 phaseEndsAt 重设，
   * 否则旧定时器到点会在已被机器人推进走的新阶段上误结算）。
   */
  private driveRoom(room: WerewolfRoom): void {
    if (!room.isRunning) {
      this.broadcast(room);
      this.onGameFinished(room);
      return;
    }
    let guard = 0;
    while (guard++ < 64) {
      if (!room.isRunning) break;
      const acted = room.botAutoAct(Date.now());
      if (!acted) break;
    }
    this.broadcast(room);
    if (room.isRunning) this.scheduleTimer(room);
    else this.onGameFinished(room);
  }

  private broadcast(room: WerewolfRoom): void {
    const { public: pub, privates } = room.getBroadcastViews();
    this.eventBus.emit(GameEvents.WEREWOLF_BROADCAST, {
      roomId: room.roomId,
      public: pub,
      privates,
    });
  }

  private scheduleTimer(room: WerewolfRoom): void {
    const existing = this.timers.get(room.roomId);
    if (existing) clearTimeout(existing);
    if (!room.phaseEndsAt) return;
    const delay = Math.max(0, room.phaseEndsAt - Date.now());
    const timer = setTimeout(() => this.timeoutRoom(room.roomId), delay + 50);
    // 避免测试/异常退出时因遗留定时器导致进程挂起
    (timer as any).unref?.();
    this.timers.set(room.roomId, timer);
  }

  private disposeRoom(roomId: string): void {
    const t = this.timers.get(roomId);
    if (t) clearTimeout(t);
    this.timers.delete(roomId);
    this.rooms.delete(roomId);
  }

  private onGameFinished(room: WerewolfRoom): void {
    this.persistMatch(room, WerewolfMatchStatus.FINISHED).catch(
      () => undefined,
    );
    this.updateStats(room).catch(() => undefined);
    const t = this.timers.get(room.roomId);
    if (t) clearTimeout(t);
    this.timers.delete(room.roomId);
    // 对局结束后保留房间一段时间供复盘，随后清理
    setTimeout(() => this.disposeRoom(room.roomId), 10 * 60 * 1000);
  }

  private requireRoom(roomId: string): WerewolfRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new NotFoundException('WEREWOLF room not found');
    return room;
  }

  // ----------------------------------------------------------------- 持久化
  private async persistMatch(
    room: WerewolfRoom,
    status: WerewolfMatchStatus,
  ): Promise<void> {
    const snap = room.getPublicSnapshot();
    const existing = await this.matchRepo.findOne({
      where: { roomId: room.roomId },
    });
    const roles: Record<number, string> = {};
    room.players.forEach((p) => {
      if (p.role) roles[p.seat] = p.role;
    });
    if (existing) {
      existing.status = status;
      existing.roles = roles;
      existing.playerCount = room.players.length;
      existing.cycles = snap.cycle;
      existing.winnerCamp = snap.winner;
      if (status === WerewolfMatchStatus.FINISHED) {
        existing.finishedAt = new Date();
      }
      await this.matchRepo.save(existing);
    } else {
      await this.matchRepo.save(
        this.matchRepo.create({
          roomId: room.roomId,
          hostPlayerId: room.hostPlayerId,
          status,
          roles,
          winnerCamp: snap.winner,
          playerCount: room.players.length,
          cycles: snap.cycle,
          finishedAt:
            status === WerewolfMatchStatus.FINISHED ? new Date() : null,
        }),
      );
    }
  }

  private async updateStats(room: WerewolfRoom): Promise<void> {
    const winner = room.winner;
    if (!winner) return;
    for (const p of room.players) {
      const stat =
        (await this.statRepo.findOne({
          where: { playerId: p.playerId },
        })) ?? this.statRepo.create({ playerId: p.playerId });
      stat.games = (stat.games ?? 0) + 1;
      const won = p.camp === winner;
      if (won) {
        stat.wins = (stat.wins ?? 0) + 1;
        if (p.camp === 'evil') stat.wolfWins = (stat.wolfWins ?? 0) + 1;
        else stat.goodWins = (stat.goodWins ?? 0) + 1;
      } else {
        stat.losses = (stat.losses ?? 0) + 1;
      }
      await this.statRepo.save(stat);
    }
  }
}
