import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';

const OFFLINE_KEY = (playerId: string) => `offline:data:${playerId}`;

export interface OfflineData {
  lastOnline: string;
  offlineMessages: any[];
}

@Injectable()
export class OfflineSyncService {
  private readonly logger = new Logger(OfflineSyncService.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
  ) {}

  @OnEvent(GameEvents.PLAYER_OFFLINE)
  async onPlayerOffline(payload: { playerId: string; reason: string }) {
    await this.saveOfflineData(payload.playerId);
  }

  @OnEvent(GameEvents.PLAYER_ONLINE)
  async onPlayerOnline(payload: { playerId: string; socketId: string }) {
    const data = await this.getOfflineData(payload.playerId);
    if (data) {
      // Emit event so the gateway can push data to the client
      this.eventBus.emit(GameEvents.PLAYER_OFFLINE_SYNC, {
        playerId: payload.playerId,
        socketId: payload.socketId,
        offlineData: data,
      });
      await this.clearOfflineData(payload.playerId);
      this.logger.log(
        `Synced offline data for player ${payload.playerId}: ${data.offlineMessages.length} messages`,
      );
    }
  }

  async saveOfflineData(playerId: string): Promise<void> {
    const now = Date.now().toString();
    await this.cacheService.hSet(OFFLINE_KEY(playerId), 'lastOnline', now);
    await this.cacheService.hSet(
      OFFLINE_KEY(playerId),
      'offlineMessages',
      '[]',
    );
    await this.cacheService.expire(OFFLINE_KEY(playerId), 604800); // 7 day TTL

    this.eventBus.emit(GameEvents.PLAYER_OFFLINE_SAVED, {
      playerId,
      lastOnline: now,
    });
    this.logger.log(`Saved offline data for player ${playerId}`);
  }

  async getOfflineData(playerId: string): Promise<OfflineData | null> {
    const data = await this.cacheService.hGetAll(OFFLINE_KEY(playerId));
    if (!data || !data.lastOnline) {
      return null;
    }
    return {
      lastOnline: data.lastOnline,
      offlineMessages: data.offlineMessages
        ? JSON.parse(data.offlineMessages)
        : [],
    };
  }

  async pushOfflineMessage(playerId: string, message: any): Promise<void> {
    const existing = await this.cacheService.hGet(
      OFFLINE_KEY(playerId),
      'offlineMessages',
    );
    const messages = existing ? JSON.parse(existing) : [];
    messages.push(message);
    await this.cacheService.hSet(
      OFFLINE_KEY(playerId),
      'offlineMessages',
      JSON.stringify(messages),
    );
  }

  async clearOfflineData(playerId: string): Promise<void> {
    await this.cacheService.del(OFFLINE_KEY(playerId));
  }
}
