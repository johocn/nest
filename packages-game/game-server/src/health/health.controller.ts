import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { CacheService } from '@cache/cache.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly cacheService: CacheService,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      async () => {
        try {
          const client = this.cacheService.getRawClient();
          await client.ping();
          return { redis: { status: 'up' } } as HealthIndicatorResult;
        } catch {
          return { redis: { status: 'down' } } as HealthIndicatorResult;
        }
      },
      async () => {
        try {
          const client = this.cacheService.getRawClient();
          const keys = await client.keys('bull:*:wait');
          const totalWaiting = keys.length;
          return {
            bullmq: {
              status: totalWaiting > 1000 ? 'degraded' : 'up',
              waitingQueues: totalWaiting,
            },
          } as HealthIndicatorResult;
        } catch {
          return {
            bullmq: { status: 'up', waitingQueues: 0 },
          } as HealthIndicatorResult;
        }
      },
    ]);
  }
}
