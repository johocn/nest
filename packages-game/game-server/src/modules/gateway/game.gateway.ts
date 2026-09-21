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
import { Namespace, Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '@modules/auth/auth.service';
import { WorldService } from '@modules/world/world.service';
import { ConnectionService } from './connection.service';
import { WsExceptionFilter } from './ws-exception.filter';
import { ErrorCodes } from '@constants/error-codes';
import { GameEvents } from '@event-bus/game-events';
import { ChatService } from '@modules/chat/chat.service';
import { ChatChannel } from '@constants/enums';
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
    private readonly chatService: ChatService,
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

    // 先落身份再 await：handleConnection 是异步的，客户端 connect 后可能立刻发第一条业务消息，
    // 若等到 validateToken 之后才写 data，那条消息会被判成「未认证」。
    client.data.playerId = payload.playerId;
    client.data.accountId = payload.accountId;
    client.data.sceneId = null;

    const isValid = await this.authService.validateToken(payload);
    if (!isValid) {
      this.logger.warn(
        `Connection rejected: token version mismatch, player=${payload.playerId}`,
      );
      client.disconnect();
      return;
    }

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

  /**
   * NPC 位置校正（S4）：tick 推进结果 → 向场景房间广播 world.entity_update。
   * 沿用 world.move 的同一 cmd 与事件名 'message'，仅 entityType 用 'npc'。
   */
  @OnEvent(GameEvents.NPC_POSITIONS_UPDATED)
  handleNpcPositions(payload: {
    sceneId: string;
    npcs: Array<{
      npcId: string;
      npcTemplateId: string;
      x: number;
      y: number;
      rotation?: number;
      state?: string;
    }>;
  }) {
    // 空房间直接返回（双重保险，A6：无人在场不产生广播）
    // 注意：命名空间网关注入的 @WebSocketServer() 实为 Namespace（不是 Server），
    // 房间表挂在 namespace.adapter.rooms 上（server.sockets.adapter 为 undefined）。
    const namespace = this.server as unknown as Namespace;
    const room = namespace?.adapter?.rooms?.get(`scene:${payload.sceneId}`);
    if (!room || room.size === 0) return;

    for (const npc of payload.npcs) {
      this.server.to(`scene:${payload.sceneId}`).emit('message', {
        cmd: 'world.entity_update',
        seq: 0,
        code: 0,
        msg: 'success',
        data: {
          entityId: npc.npcId,
          entityType: 'npc',
          npcTemplateId: npc.npcTemplateId,
          pos: { x: npc.x, y: npc.y },
          rotation: npc.rotation ?? 0,
          state: npc.state ?? 'move',
        },
      });
    }
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

    const rawSceneId = message?.data?.sceneId;
    if (!rawSceneId) {
      return {
        cmd: 'world.enter_scene_sync',
        seq: message?.seq ?? 0,
        code: ErrorCodes.PARAM_INVALID,
        msg: '缺少场景ID',
      };
    }
    // 场景 id 统一为字符串：下游 redis 集合键与 NPC 实例缓存键都按字符串寻址
    const sceneId = String(rawSceneId);

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
        // S4：新增 NPC 实例下发（旧字段零变更）
        npcs: sceneData.npcs,
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

  @SubscribeMessage('chat.send')
  async handleChatSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() message: any,
  ) {
    const playerId = client.data?.playerId;
    if (!playerId) {
      return {
        cmd: 'chat.send',
        seq: message?.seq ?? 0,
        code: ErrorCodes.TOKEN_INVALID,
        msg: '未认证',
      };
    }

    const { channel, content, recipientId, guildId } = message?.data ?? {};
    if (!channel || !content) {
      return {
        cmd: 'chat.send',
        seq: message?.seq ?? 0,
        code: ErrorCodes.PARAM_INVALID,
        msg: '缺少频道或内容',
      };
    }

    const senderName = await this.chatService.getSenderName(playerId);
    const result = await this.chatService.sendChannelMessage({
      senderId: playerId,
      senderName,
      channel,
      content,
      recipientId,
      guildId,
    });

    const payload = {
      cmd: 'chat.message',
      seq: 0,
      code: 0,
      msg: 'success',
      data: {
        channel,
        senderId: playerId,
        senderName,
        content: result.message.content,
        messageId: result.message.id,
        recipientId: recipientId ?? null,
        guildId: guildId ?? null,
      },
    };
    if (channel === ChatChannel.WORLD) {
      this.server.emit('message', payload);
    } else if (channel === ChatChannel.GUILD && guildId) {
      this.server.to(`guild:${guildId}`).emit('message', payload);
    } else if (channel === ChatChannel.PRIVATE && recipientId) {
      const [sender, recipient] = await Promise.all([
        this.connectionService.getPlayerConnection(playerId),
        this.connectionService.getPlayerConnection(recipientId),
      ]);
      if (sender?.socketId) this.server.to(sender.socketId).emit('message', payload);
      if (recipient?.socketId)
        this.server.to(recipient.socketId).emit('message', payload);
    }

    if (result.supportReply) {
      client.emit('message', {
        cmd: 'chat.support_reply',
        seq: 0,
        code: 0,
        msg: 'success',
        data: { reply: result.supportReply },
      });
    }

    return {
      cmd: 'chat.send',
      seq: message?.seq ?? 0,
      code: 0,
      msg: 'success',
      data: { messageId: result.message.id },
    };
  }
}
