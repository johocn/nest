import { Test } from '@nestjs/testing';
import { CacheService } from './cache.service';

// Mock Redis client
const mockRedis = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  expire: jest.fn(),
  hSet: jest.fn(),
  hGet: jest.fn(),
  hGetAll: jest.fn(),
  hDel: jest.fn(),
  sAdd: jest.fn(),
  sRem: jest.fn(),
  sMembers: jest.fn(),
  zAdd: jest.fn(),
  zRange: jest.fn(),
  ping: jest.fn().mockResolvedValue('PONG'),
};

jest.mock('./redis.client', () => ({
  createRedisClient: () => mockRedis,
}));

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(async () => {
    // 每个测试前重置 mock 调用记录
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [CacheService],
    }).compile();
    service = moduleRef.get<CacheService>(CacheService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should set and get a value', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.get.mockResolvedValue('test-value');

    await service.set('key', 'test-value', 60);
    const result = await service.get('key');

    expect(mockRedis.set).toHaveBeenCalledWith('key', 'test-value', { EX: 60 });
    expect(result).toBe('test-value');
  });

  it('should delete a key', async () => {
    mockRedis.del.mockResolvedValue(1);
    const result = await service.del('key');
    expect(result).toBe(1);
  });

  it('should acquire and release a lock', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);

    const lockKey = 'lock:player:1';
    const acquired = await service.acquireLock(lockKey, 10);
    expect(acquired).toBe(true);

    const released = await service.releaseLock(lockKey);
    expect(released).toBe(true);
  });

  it('should fail to acquire lock when already held', async () => {
    mockRedis.set.mockResolvedValue(null);
    const acquired = await service.acquireLock('lock:test', 10);
    expect(acquired).toBe(false);
  });

  it('should execute withLock callback', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);

    const callback = jest.fn().mockResolvedValue('result');
    const result = await service.withLock('lock:test', callback, {
      ttl: 10,
      retry: 1,
    });

    expect(callback).toHaveBeenCalled();
    expect(result).toBe('result');
  });
});
