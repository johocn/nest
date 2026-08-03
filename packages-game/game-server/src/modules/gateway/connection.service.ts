import { Injectable } from '@nestjs/common';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';

export interface PlayerConnection {
  socketId: string;
  sceneId: string;
  characterId: string;
  loginAt: string;
  loginIp: string;
  deviceId: string;
  lastHeartbeat: string;
}

@Injectable()
export class ConnectionService {
  private readonly ONLINE_SET = 'online:players';
  private readonly PLAYER_KEY = (playerId: string) =>
    `online:player:${playerId}`;
  private readonly SOCKET_KEY = (socketId: string) =>
    `online:socket:${socketId}`;

  constructor(
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
  ) {}

  async playerConnect(
    playerId: string,
    socketId: string,
    loginIp: string,
    deviceId: string,
  ): Promise<void> {
    const now = Date.now().toString();
    await this.cacheService.sAdd(this.ONLINE_SET, playerId);
    await this.cacheService.hSet(
      this.PLAYER_KEY(playerId),
      'socketId',
      socketId,
    );
    await this.cacheService.hSet(this.PLAYER_KEY(playerId), 'sceneId', '');
    await this.cacheService.hSet(this.PLAYER_KEY(playerId), 'characterId', '');
    await this.cacheService.hSet(this.PLAYER_KEY(playerId), 'loginAt', now);
    await this.cacheService.hSet(this.PLAYER_KEY(playerId), 'loginIp', loginIp);
    await this.cacheService.hSet(
      this.PLAYER_KEY(playerId),
      'deviceId',
      deviceId,
    );
    await this.cacheService.hSet(
      this.PLAYER_KEY(playerId),
      'lastHeartbeat',
      now,
    );
    await this.cacheService.hSet(
      this.SOCKET_KEY(socketId),
      'playerId',
      playerId,
    );
    await this.cacheService.expire(`online:player:${playerId}`, 3600); // 1 hour
    await this.cacheService.expire(`online:socket:${socketId}`, 3600);
    this.eventBus.emit(GameEvents.PLAYER_ONLINE, { playerId, socketId });
  }

  async playerDisconnect(
    playerId: string,
    reason: string = 'disconnect',
  ): Promise<void> {
    const conn = await this.getPlayerConnection(playerId);
    await this.cacheService.sRem(this.ONLINE_SET, playerId);
    await this.cacheService.del(this.PLAYER_KEY(playerId));
    if (conn?.socketId) {
      await this.cacheService.del(this.SOCKET_KEY(conn.socketId));
    }
    this.eventBus.emit(GameEvents.PLAYER_OFFLINE, { playerId, reason });
  }

  async isOnline(playerId: string): Promise<boolean> {
    return this.cacheService.exists(this.PLAYER_KEY(playerId));
  }

  async getOnlinePlayers(): Promise<string[]> {
    return this.cacheService.sMembers(this.ONLINE_SET);
  }

  async getPlayerConnection(
    playerId: string,
  ): Promise<PlayerConnection | null> {
    const data = await this.cacheService.hGetAll(this.PLAYER_KEY(playerId));
    if (!data || !data.socketId) {
      return null;
    }
    return data as unknown as PlayerConnection;
  }

  async updateHeartbeat(playerId: string): Promise<void> {
    await this.cacheService.hSet(
      this.PLAYER_KEY(playerId),
      'lastHeartbeat',
      Date.now().toString(),
    );
    await this.cacheService.expire(`online:player:${playerId}`, 3600);
    const socketId = await this.cacheService.hGet(
      this.PLAYER_KEY(playerId),
      'socketId',
    );
    if (socketId) {
      await this.cacheService.expire(`online:socket:${socketId}`, 3600);
    }
  }

  async updatePlayerScene(playerId: string, sceneId: string): Promise<void> {
    await this.cacheService.hSet(this.PLAYER_KEY(playerId), 'sceneId', sceneId);
  }

  async getPlayerBySocket(socketId: string): Promise<string | null> {
    const playerId = await this.cacheService.hGet(
      this.SOCKET_KEY(socketId),
      'playerId',
    );
    return playerId;
  }

  async getOnlineCount(): Promise<number> {
    const players = await this.cacheService.sMembers(this.ONLINE_SET);
    return players.length;
  }
}
