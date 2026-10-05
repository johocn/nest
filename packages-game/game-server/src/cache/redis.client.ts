import { createClient, RedisClientType } from 'redis';

export function createRedisClient(): RedisClientType {
  return createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },
    password: process.env.REDIS_PASSWORD || undefined,
    database: parseInt(process.env.REDIS_DB || '0', 10),
    // 兼容老版本 Redis（< 6.0）不支持 RESP3 HELLO 命令
    ...(process.env.REDIS_PROTOCOL === 'RESP2' ? { protocol: 'RESP2' } : {}),
  });
}
