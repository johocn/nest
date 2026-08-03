import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UseFilters, OnApplicationShutdown } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '@modules/auth/auth.service';
import { WorldService } from '@modules/world/world.service';
import { ConnectionService } from './connection.service';
import { WsExceptionFilter } from './ws-exception.filter';
import { ErrorCodes } from '@constants/error-codes';
import { GameEvents } from '@event-bus/game-events';
import type { JwtPayload } from '@modules/auth/auth.service';

@WebSocketGateway({
  namespace: '/game',
  cors: {
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map((o: string) => o.trim())
      : ['http://localhost:3000'],
    credentials: true,
  },
  pingInterval: 30000,
  pingTimeout: 90000,
  transports: ['websocket'],
})
@UseFilters(WsExceptionFilter)
export class GameGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  private readonly logger = new Logger(GameGateway.name);

  @WebSocketServer()
  private server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly connectionService: ConnectionService,
    private readonly worldService: WorldService,
  ) {}

  setServer(server: Server) {
    this.server = server;
  }

  async handleConnection(client: Socket) {
    const token = client.handshake?.query?.token as string;

    if (!token) {
      this.logger.warn(`Connection rejected: no token, socket=${client.id}`);
      client.disconnect();
      return;
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      this.logger.warn(
        `Connection rejected: invalid token, socket=${client.id}`,
      );
      client.disconnect();
      return;
    }

    const isValid = await this.authService.validateToken(payload);
    if (!isValid) {
      this.logger.warn(
        `Connection rejected: token version mismatch, player=${payload.playerId}`,
      );
      client.disconnect();
      return;
    }

    client.data.playerId = payload.playerId;
    client.data.accountId = payload.accountId;
    client.data.sceneId = null;

    const loginIp = (client.handshake?.address as string) ?? '';
    const deviceId = (client.handshake?.query?.deviceId as string) ?? '';

    await this.connectionService.playerConnect(
      payload.playerId,
      client.id,
      loginIp,
      deviceId,
    );

    this.logger.log(
      `Player connected: ${payload.playerId}, socket=${client.id}`,
    );
  }

  async handleDisconnect(client: Socket) {
    const playerId = client.data?.playerId;
    if (!playerId) return;

    const sceneId = client.data?.sceneId;
    if (sceneId) {
      await this.worldService.leaveScene(playerId, sceneId);
    }

    await this.connectionService.playerDisconnect(playerId, 'disconnect');

    this.logger.log(`Player disconnected: ${playerId}, socket=${client.id}`);
  }

  @OnEvent(GameEvents.PLAYER_OFFLINE_SYNC)
  async onOfflineSync(payload: {
    playerId: string;
    socketId: string;
    offlineData: any;
  }) {
    this.logger.log(`Pushing offline data to player ${payload.playerId}`);
    this.server.to(payload.socketId).emit('offline:data', {
      lastOnline: payload.offlineData.lastOnline,
      messages: payload.offlineData.offlineMessages,
    });
  }

  onApplicationShutdown(signal?: string) {
    this.logger.log(`Server shutting down (${signal}), notifying clients...`);
    this.server.emit('server:shutdown', {
      message: '服务器即将关闭，请重新连接',
    });
    this.server.disconnectSockets(true);
  }

  @SubscribeMessage('player.heartbeat')
  async handleHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() message: any,
  ) {
    const playerId = client.data?.playerId;
    if (!playerId) return;

    await this.connectionService.updateHeartbeat(playerId);

    client.emit('message', {
      cmd: 'player.heartbeat',
      seq: message?.seq ?? 0,
      code: 0,
      msg: 'success',
      data: { timestamp: Date.now() },
    });
  }

  @SubscribeMessage('world.enter-scene')
  async handleEnterScene(
    @ConnectedSocket() client: Socket,
    @MessageBody() message: any,
  ) {
    const playerId = client.data?.playerId;
    if (!playerId) {
      return {
        cmd: 'world.enter_scene_sync',
        seq: message?.seq ?? 0,
        code: ErrorCodes.TOKEN_INVALID,
        msg: '未认证',
      };
    }

    const sceneId = message?.data?.sceneId;
    if (!sceneId) {
      return {
        cmd: 'world.enter_scene_sync',
        seq: message?.seq ?? 0,
        code: ErrorCodes.PARAM_INVALID,
        msg: '缺少场景ID',
      };
    }

    await this.worldService.checkEnterRequirement(sceneId, 1);

    const oldSceneId = client.data?.sceneId;
    if (oldSceneId) {
      client.leave(`scene:${oldSceneId}`);
      await this.worldService.leaveScene(playerId, oldSceneId);
    }

    const sceneData = await this.worldService.enterScene(playerId, sceneId);

    client.join(`scene:${sceneId}`);
    client.data.sceneId = sceneId;
    await this.connectionService.updatePlayerScene(playerId, sceneId);

    return {
      cmd: 'world.enter_scene_sync',
      seq: message?.seq ?? 0,
      code: 0,
      msg: 'success',
      data: {
        scene: sceneData.scene,
        spawns: sceneData.spawns,
        triggers: sceneData.triggers,
      },
    };
  }

  @SubscribeMessage('world.move')
  async handleMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() message: any,
  ) {
    const playerId = client.data?.playerId;
    const sceneId = client.data?.sceneId;
    if (!playerId || !sceneId) return;

    const { x, y, rotation } = message?.data ?? {};

    this.server.to(`scene:${sceneId}`).emit('message', {
      cmd: 'world.entity_update',
      seq: 0,
      code: 0,
      msg: 'success',
      data: {
        entityId: `player:${playerId}`,
        entityType: 'player',
        playerId,
        pos: { x, y },
        rotation,
        state: 'move',
      },
    });

    return {
      cmd: 'world.move',
      seq: message?.seq ?? 0,
      code: 0,
      msg: 'success',
      data: {},
    };
  }
}
