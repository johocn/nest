import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Server, Socket } from 'socket.io';
import { MatchmakingService } from './matchmaking.service';
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
    for (const playerId of payload.players) {
      try {
        const conn = await this.connectionService.getPlayerConnection(playerId);
        if (conn?.socketId) {
          this.server.to(conn.socketId).emit('matchmaking:matched', {
            mode: payload.mode,
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
