import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  RATE_LIMIT_KEY,
  RateLimitOptions,
} from '@common/decorators/rate-limit.decorator';
import { CacheService } from '@cache/cache.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cacheService: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!options) return true;

    const request = context.switchToHttp().getRequest();
    const playerId = request.user?.playerId ?? request.ip ?? 'anonymous';
    const routeKey = `${context.getHandler().name}:${playerId}`;
    const redisKey = `rate_limit:${routeKey}`;

    const current = await this.cacheService.get(redisKey);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= options.maxRequests) {
      throw new GameException(
        ErrorCodes.RATE_LIMIT_EXCEEDED,
        '请求过于频繁，请稍后再试',
      );
    }

    if (count === 0) {
      await this.cacheService.set(redisKey, '1', options.windowSeconds);
    } else {
      await this.cacheService.set(
        redisKey,
        (count + 1).toString(),
        options.windowSeconds,
      );
    }

    return true;
  }
}
