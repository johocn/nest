import { createClient, RedisClientType } from 'redis';

export function createRedisClient(): RedisClientType {
  const client = createClient({
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
    // 兼容老版本 Redis（< 6.0）不支持 RESP3 HELLO 命令：node-redis 6.x 需用 RESP 选项回退 RESP2
    ...(process.env.REDIS_PROTOCOL === 'RESP2' ? { RESP: 2 } : {}),
  });
  // RESP2 时泛型与默认 RESP3 返回签名不同，运行时行为等价
  return client as unknown as RedisClientType;
}
