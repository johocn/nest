import { createClient, RedisClientType } from 'redis';

export function createRedisClient(): RedisClientType {
  return createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      reconnectStrategy: (retries: number) => {
        // 最多重试 3 次（约 2s），之后停止，避免无 Redis 时无限刷屏
        if (retries > 3) return false;
        return Math.min(retries * 200, 1000);
      },
    },
    password: process.env.REDIS_PASSWORD || undefined,
    database: parseInt(process.env.REDIS_DB || '0', 10),
  });
}
