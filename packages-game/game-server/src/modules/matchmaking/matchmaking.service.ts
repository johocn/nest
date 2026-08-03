import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

const QUEUE_KEY = (mode: string) => `matchmaking:queue:${mode}`;
const PLAYER_QUEUE_KEY = (playerId: string) => `matchmaking:player:${playerId}`;
const POWER_RANGE = 0.2; // 20% power range for matching

@Injectable()
export class MatchmakingService {
  private readonly logger = new Logger(MatchmakingService.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
  ) {}

  async joinQueue(
    playerId: string,
    mode: string,
    combatPower: number,
  ): Promise<{ queued: boolean; position: number }> {
    const exists = await this.cacheService.exists(PLAYER_QUEUE_KEY(playerId));
    if (exists) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '已在匹配队列中');
    }

    await this.cacheService.zAdd(QUEUE_KEY(mode), combatPower, playerId);
    await this.cacheService.hSet(PLAYER_QUEUE_KEY(playerId), 'mode', mode);
    await this.cacheService.hSet(
      PLAYER_QUEUE_KEY(playerId),
      'score',
      combatPower.toString(),
    );
    await this.cacheService.expire(PLAYER_QUEUE_KEY(playerId), 600); // 10 min TTL

    const queue = await this.cacheService.zRange(QUEUE_KEY(mode), 0, -1);
    return { queued: true, position: queue.length };
  }

  async cancelQueue(
    playerId: string,
    mode: string,
  ): Promise<{ cancelled: boolean }> {
    const exists = await this.cacheService.exists(PLAYER_QUEUE_KEY(playerId));
    if (!exists) {
      return { cancelled: false };
    }
    await this.cacheService.zRem(QUEUE_KEY(mode), playerId);
    await this.cacheService.del(PLAYER_QUEUE_KEY(playerId));
    return { cancelled: true };
  }

  async tryMatch(
    mode: string,
  ): Promise<{ matched: boolean; players?: string[] }> {
    const queue = await this.cacheService.zRange(QUEUE_KEY(mode), 0, -1);
    if (queue.length < 2) {
      return { matched: false };
    }

    // Try to find a match within power range
    for (let i = 0; i < queue.length - 1; i++) {
      const p1 = queue[i];
      const p2 = queue[i + 1];

      const score1Str = await this.cacheService.hGet(
        PLAYER_QUEUE_KEY(p1),
        'score',
      );
      const score2Str = await this.cacheService.hGet(
        PLAYER_QUEUE_KEY(p2),
        'score',
      );

      const score1 = Number(score1Str) || 0;
      const score2 = Number(score2Str) || 0;

      const lowerBound = score1 * (1 - POWER_RANGE);
      const upperBound = score1 * (1 + POWER_RANGE);

      if (score2 >= lowerBound && score2 <= upperBound) {
        // Match found!
        await this.cacheService.zRem(QUEUE_KEY(mode), p1, p2);
        await this.cacheService.del(PLAYER_QUEUE_KEY(p1));
        await this.cacheService.del(PLAYER_QUEUE_KEY(p2));

        this.eventBus.emit(GameEvents.MATCH_SUCCESS, {
          mode,
          players: [p1, p2],
        });

        this.logger.log(`Match found: ${p1} vs ${p2} (mode: ${mode})`);
        return { matched: true, players: [p1, p2] };
      }
    }

    return { matched: false };
  }

  async getQueueStatus(
    playerId: string,
    mode: string,
  ): Promise<{ inQueue: boolean; score?: number }> {
    const exists = await this.cacheService.exists(PLAYER_QUEUE_KEY(playerId));
    if (!exists) {
      return { inQueue: false };
    }
    const scoreStr = await this.cacheService.hGet(
      PLAYER_QUEUE_KEY(playerId),
      'score',
    );
    return { inQueue: true, score: Number(scoreStr) || 0 };
  }
}
