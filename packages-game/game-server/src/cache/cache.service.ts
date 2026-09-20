import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { createRedisClient } from './redis.client';
import type { RedisClientType } from 'redis';

export interface LockOptions {
  ttl: number; // 锁超时秒数
  retry: number; // 获取失败重试次数
  retryDelay?: number; // 重试间隔毫秒
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: RedisClientType;

  constructor() {
    this.client = createRedisClient();
  }

  async onModuleInit() {
    this.client.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
    this.client.on('connect', () => {
      this.logger.log('Redis connected');
    });
    await this.client.connect();
  }

  async onModuleDestroy() {
    await this.client.disconnect();
  }

  // ===== String 操作 =====
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, { EX: ttlSeconds });
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.expire(key, ttlSeconds);
    return result === 1;
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  // ===== Hash 操作 =====
  async hSet(key: string, field: string, value: string): Promise<number> {
    return this.client.hSet(key, field, value);
  }

  async hGet(key: string, field: string): Promise<string | null> {
    return this.client.hGet(key, field);
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return this.client.hGetAll(key);
  }

  async hDel(key: string, field: string): Promise<number> {
    return this.client.hDel(key, field);
  }

  // ===== Set 操作 =====
  async sAdd(key: string, ...members: string[]): Promise<number> {
    return this.client.sAdd(key, members);
  }

  async sRem(key: string, ...members: string[]): Promise<number> {
    return this.client.sRem(key, members);
  }

  async sMembers(key: string): Promise<string[]> {
    return this.client.sMembers(key);
  }

  // ===== ZSet 操作 =====
  async zAdd(key: string, score: number, member: string): Promise<number> {
    return this.client.zAdd(key, [{ score, value: member }]);
  }

  async zRange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zRange(key, start, stop);
  }

  async zRangeWithScores(
    key: string,
    start: number,
    stop: number,
    rev = false,
  ): Promise<Array<{ value: string; score: number }>> {
    if (rev) {
      return this.client.zRangeWithScores(key, start, stop, { REV: true });
    }
    return this.client.zRangeWithScores(key, start, stop);
  }

  async zRem(key: string, ...members: string[]): Promise<number> {
    return this.client.zRem(key, members);
  }

  // ===== 分布式锁 =====
  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, 'locked', {
      NX: true,
      EX: ttlSeconds,
    });
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<boolean> {
    const result = await this.client.del(key);
    return result > 0;
  }

  async withLock<T>(
    lockKey: string,
    callback: () => Promise<T>,
    options: LockOptions,
  ): Promise<T> {
    const { ttl, retry, retryDelay = 100 } = options;
    let acquired = false;
    for (let i = 0; i <= retry; i++) {
      acquired = await this.acquireLock(lockKey, ttl);
      if (acquired) break;
      if (i < retry) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
    if (!acquired) {
      throw new Error(`Failed to acquire lock: ${lockKey}`);
    }
    try {
      return await callback();
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  // ===== 获取原始客户端（特殊场景） =====
  getRawClient(): RedisClientType {
    return this.client;
  }
}
