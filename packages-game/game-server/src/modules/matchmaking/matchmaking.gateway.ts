import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Server, Socket } from 'socket.io';
import { MatchmakingService } from './matchmaking.service';
import { RoomService } from './room.service';
import { PlayerService } from '@modules/player/player.service';
import { GameEvents } from '@event-bus/game-events';
import { ConnectionService } from '@modules/gateway/connection.service';
import { MatchMode } from '@constants/enums';

@WebSocketGateway({ namespace: '/game' })
export class MatchmakingGateway {
  private readonly logger = new Logger(MatchmakingGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly matchmakingService: MatchmakingService,
    private readonly roomService: RoomService,
    private readonly playerService: PlayerService,
    private readonly connectionService: ConnectionService,
  ) {}

  @SubscribeMessage('matchmaking:join')
  async handleJoinQueue(client: Socket, data: { mode: string }) {
    const playerId = client.data?.playerId;
    if (!playerId) {
      return { code: 401, msg: '未认证' };
    }

    const validModes = Object.values(MatchMode);
    if (!validModes.includes(data.mode as MatchMode)) {
      return { code: 400, msg: '无效的匹配模式' };
    }

    // Query player level from server (NOT from client)
    const player = await this.playerService.getById(playerId);
    if (!player) {
      return { code: 404, msg: '玩家不存在' };
    }

    // Use player level * 1000 + exp as combat power proxy
    const combatPower = player.level * 1000 + Number(player.exp);

    try {
      const result = await this.matchmakingService.joinQueue(
        playerId,
        data.mode,
        combatPower,
      );
      return { code: 200, msg: '已加入匹配队列', data: result };
    } catch (err: any) {
      return { code: err.getStatus?.() ?? 400, msg: err.message };
    }
  }

  @OnEvent(GameEvents.MATCH_SUCCESS)
  async onMatchSuccess(payload: { mode: string; players: string[] }) {
    this.logger.log(
      `Match success: ${payload.players.join(' vs ')} (${payload.mode})`,
    );

    // 创建 Room —— 所有后续流程（ready → start → finish）走 RoomService
    const room = await this.roomService.create({
      mode: payload.mode,
      players: payload.players,
    });

    for (const playerId of payload.players) {
      try {
        const conn = await this.connectionService.getPlayerConnection(playerId);
        if (conn?.socketId) {
          this.server.to(conn.socketId).emit('matchmaking:matched', {
            mode: payload.mode,
            roomId: room.id,
            players: payload.players,
          });
        }
      } catch (err) {
        this.logger.error(
          `Failed to notify player ${playerId}`,
          (err as Error).message,
        );
      }
    }
  }

  // ===== Room WebSocket 消息 =====

  @SubscribeMessage('room:ready')
  async handleRoomReady(client: Socket, data: { roomId: string; ready?: boolean }) {
    const playerId = client.data?.playerId;
    if (!playerId) return { code: 401, msg: '未认证' };

    const room = await this.roomService.get(data.roomId);
    if (!room) return { code: 404, msg: '房间不存在或已解散' };

    const inRoom = room.players.some((p) => p.playerId === playerId);
    if (!inRoom) return { code: 403, msg: '你不在这个房间' };

    const updated = await this.roomService.setReady(data.roomId, playerId, data.ready ?? true);

    // 广播房间状态给所有成员
    for (const p of room.players) {
      const conn = await this.connectionService.getPlayerConnection(p.playerId);
      if (conn?.socketId) {
        this.server.to(conn.socketId).emit('room:update', updated);
      }
    }
    return { code: 200, data: updated };
  }

  @SubscribeMessage('room:leave')
  async handleRoomLeave(client: Socket, data: { roomId: string; reason?: string }) {
    const playerId = client.data?.playerId;
    if (!playerId) return { code: 401, msg: '未认证' };

    const room = await this.roomService.get(data.roomId);
    if (!room) return { code: 404, msg: '房间不存在' };

    await this.roomService.leave(data.roomId, playerId, data.reason ?? 'leave');
    // 广播解散/房间更新
    for (const p of room.players) {
      if (p.playerId === playerId) continue;
      const conn = await this.connectionService.getPlayerConnection(p.playerId);
      if (conn?.socketId) {
        const updated = await this.roomService.get(data.roomId);
        if (updated) {
          this.server.to(conn.socketId).emit('room:update', updated);
        } else {
          this.server.to(conn.socketId).emit('room:destroyed', {
            roomId: data.roomId,
            reason: 'player-leave',
          });
        }
      }
    }
    return { code: 200, msg: '已离开房间' };
  }

  @SubscribeMessage('matchmaking:cancel')
  async handleCancelQueue(client: Socket, data: { mode: string }) {
    const playerId = client.data?.playerId;
    if (!playerId) {
      return { code: 401, msg: '未认证' };
    }

    const result = await this.matchmakingService.cancelQueue(
      playerId,
      data.mode,
    );
    return { code: 200, msg: '已取消匹配', data: result };
  }

  @SubscribeMessage('matchmaking:status')
  async handleQueueStatus(client: Socket, data: { mode: string }) {
    const playerId = client.data?.playerId;
    if (!playerId) {
      return { code: 401, msg: '未认证' };
    }

    const result = await this.matchmakingService.getQueueStatus(
      playerId,
      data.mode,
    );
    return { code: 200, msg: 'OK', data: result };
  }
}
