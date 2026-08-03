import { Test } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { CacheService } from '@cache/cache.service';

const mockHealthCheckService = {
  check: jest.fn((checks) => {
    // Run each check and merge results into the terminus-style shape
    return Promise.all(checks.map((fn: () => Promise<any>) => fn())).then(
      (results) => Object.assign({}, ...results),
    );
  }),
};

const mockTypeOrmHealthIndicator = {
  pingCheck: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
};

const healthyClient = {
  ping: jest.fn().mockResolvedValue('PONG'),
  keys: jest.fn().mockResolvedValue([]),
};

const mockCacheService = {
  getRawClient: jest.fn().mockReturnValue(healthyClient),
};

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockHealthCheckService.check.mockClear();
    // Reset to a healthy client by default
    mockCacheService.getRawClient.mockReturnValue(healthyClient);
    healthyClient.ping.mockResolvedValue('PONG');
    healthyClient.keys.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealthCheckService },
        {
          provide: TypeOrmHealthIndicator,
          useValue: mockTypeOrmHealthIndicator,
        },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();
    controller = moduleRef.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return health check results', async () => {
    const result = await controller.check();
    expect(result).toHaveProperty('database');
    expect(result).toHaveProperty('redis');
    expect(result).toHaveProperty('bullmq');
  });

  it('should report redis down when ping fails', async () => {
    mockCacheService.getRawClient.mockReturnValue({
      ping: jest.fn().mockRejectedValue(new Error('Connection refused')),
      keys: jest.fn().mockResolvedValue([]),
    });
    const result = await controller.check();
    expect(result.redis.status).toBe('down');
  });

  it('should report bullmq degraded when too many waiting queues', async () => {
    const manyKeys = Array(1001).fill('bull:queue:wait');
    mockCacheService.getRawClient.mockReturnValue({
      ping: jest.fn().mockResolvedValue('PONG'),
      keys: jest.fn().mockResolvedValue(manyKeys),
    });
    const result = await controller.check();
    expect(result.bullmq.status).toBe('degraded');
    expect(result.bullmq.waitingQueues).toBe(1001);
  });
});
