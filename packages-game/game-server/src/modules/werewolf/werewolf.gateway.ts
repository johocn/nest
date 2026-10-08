import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { WerewolfService } from './werewolf.service';
import { ConnectionService } from '@modules/gateway/connection.service';
import { GameEvents } from '@event-bus/game-events';
import { ActionPayload, CreateRoomOptions } from './werewolf.types';

interface WsEnvelope {
  cmd: string;
  seq: number;
  data: any;
}

/**
 * 狼人杀实时网关：复用 /game 命名空间（与 game.gateway / matchmaking.gateway 共存）。
 * 上行命令均以 cmd 为事件名（werewolf.create / join / leave / start / action），
 * handler 直接 return 走 socket.io ack（client.send 的 Promise 解析）。
 * 房间状态变化由 WerewolfService 经 event-bus 广播，本网关订阅后逐玩家推送。
 */
@WebSocketGateway({ namespace: '/game' })
export class WerewolfGateway {
  private readonly logger = new Logger(WerewolfGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly werewolfService: WerewolfService,
    private readonly connectionService: ConnectionService,
  ) {}

  private pid(client: Socket): string | undefined {
    return client.data?.playerId;
  }

  private ack(envelope: WsEnvelope, data: any, code = 0, msg = 'success') {
    return { cmd: 'werewolf.sync', seq: envelope?.seq ?? 0, code, msg, data };
  }

  @SubscribeMessage('werewolf.create')
  handleCreate(client: Socket, envelope: WsEnvelope) {
    const playerId = this.pid(client);
    if (!playerId) return this.ack(envelope, null, 401, '未认证');
    const d = envelope?.data ?? {};
    const opts: CreateRoomOptions = {
      roomId:
        d.roomId ??
        `ww_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`,
      hostPlayerId: playerId,
      hostName: d.name ?? `玩家${playerId}`,
      roles: d.roles,
      playerCount: d.playerCount,
      durations: d.durations,
    };
    try {
      const snap = this.werewolfService.createRoom(opts);
      return this.ack(envelope, { roomId: opts.roomId, snapshot: snap });
    } catch (err: any) {
      return this.ack(envelope, null, 45000, err?.message ?? '建房失败');
    }
  }

  @SubscribeMessage('werewolf.join')
  handleJoin(client: Socket, envelope: WsEnvelope) {
    const playerId = this.pid(client);
    if (!playerId) return this.ack(envelope, null, 401, '未认证');
    const d = envelope?.data ?? {};
    try {
      const snap = this.werewolfService.joinRoom(
        d.roomId,
        playerId,
        d.name ?? `玩家${playerId}`,
      );
      return this.ack(envelope, { snapshot: snap });
    } catch (err: any) {
      return this.ack(envelope, null, 45001, err?.message ?? '加入失败');
    }
  }

  @SubscribeMessage('werewolf.leave')
  handleLeave(client: Socket, envelope: WsEnvelope) {
    const playerId = this.pid(client);
    if (!playerId) return this.ack(envelope, null, 401, '未认证');
    const d = envelope?.data ?? {};
    this.werewolfService.leaveRoom(d.roomId, playerId);
    return this.ack(envelope, { ok: true });
  }

  @SubscribeMessage('werewolf.start')
  handleStart(client: Socket, envelope: WsEnvelope) {
    const playerId = this.pid(client);
    if (!playerId) return this.ack(envelope, null, 401, '未认证');
    const d = envelope?.data ?? {};
    try {
      const snap = this.werewolfService.startRoom(d.roomId, playerId);
      return this.ack(envelope, { snapshot: snap });
    } catch (err: any) {
      return this.ack(envelope, null, 45004, err?.message ?? '开局失败');
    }
  }

  @SubscribeMessage('werewolf.action')
  handleAction(client: Socket, envelope: WsEnvelope) {
    const playerId = this.pid(client);
    if (!playerId) return this.ack(envelope, null, 401, '未认证');
    const d = envelope?.data ?? {};
    try {
      const view = this.werewolfService.submitAction(
        d.roomId,
        playerId,
        (d.payload ?? {}) as ActionPayload,
      );
      return this.ack(envelope, view);
    } catch (err: any) {
      return this.ack(envelope, null, 45005, err?.message ?? '行动失败');
    }
  }

  @SubscribeMessage('werewolf.say')
  handleSay(client: Socket, envelope: WsEnvelope) {
    const playerId = this.pid(client);
    if (!playerId) return this.ack(envelope, null, 401, '未认证');
    const d = envelope?.data ?? {};
    try {
      const snap = this.werewolfService.say(
        d.roomId,
        playerId,
        String(d.text ?? ''),
      );
      return this.ack(envelope, { snapshot: snap });
    } catch (err: any) {
      return this.ack(envelope, null, 45013, err?.message ?? '发言失败');
    }
  }

  @SubscribeMessage('werewolf.wolf_say')
  handleWolfSay(client: Socket, envelope: WsEnvelope) {
    const playerId = this.pid(client);
    if (!playerId) return this.ack(envelope, null, 401, '未认证');
    const d = envelope?.data ?? {};
    try {
      const snap = this.werewolfService.wolfSay(
        d.roomId,
        playerId,
        String(d.text ?? ''),
      );
      return this.ack(envelope, { snapshot: snap });
    } catch (err: any) {
      return this.ack(
        envelope,
        null,
        45014,
        err?.message ?? '狼人频道发言失败',
      );
    }
  }

  /** 开发/演示专用：房主填充机器人，便于单人体验 */
  @SubscribeMessage('werewolf.dev_fill')
  handleDevFill(client: Socket, envelope: WsEnvelope) {
    const playerId = this.pid(client);
    if (!playerId) return this.ack(envelope, null, 401, '未认证');
    const d = envelope?.data ?? {};
    try {
      const snap = this.werewolfService.devFillRoom(
        d.roomId,
        playerId,
        Number(d.count) || 0,
      );
      return this.ack(envelope, { snapshot: snap });
    } catch (err: any) {
      return this.ack(envelope, null, 45003, err?.message ?? '填充失败');
    }
  }

  /** 监听房间状态广播，逐玩家推送（公共快照 + 各自私有视图） */
  @OnEvent(GameEvents.WEREWOLF_BROADCAST)
  async onBroadcast(payload: {
    roomId: string;
    public: any;
    privates: Record<string, any>;
  }): Promise<void> {
    for (const [playerId, priv] of Object.entries(payload.privates)) {
      try {
        const conn = await this.connectionService.getPlayerConnection(playerId);
        if (!conn?.socketId) continue;
        this.server.to(conn.socketId).emit('message', {
          cmd: 'werewolf.sync',
          seq: 0,
          code: 0,
          msg: '',
          data: { public: payload.public, private: priv },
        });
      } catch {
        /* 玩家不在线则跳过 */
      }
    }
  }
}
