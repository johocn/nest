import { Test, TestingModule } from '@nestjs/testing';
import { OfflineSyncService } from './offline-sync.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';

describe('OfflineSyncService', () => {
  let service: OfflineSyncService;
  let cacheService: jest.Mocked<CacheService>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfflineSyncService,
        {
          provide: CacheService,
          useValue: {
            set: jest.fn(),
            get: jest.fn(),
            del: jest.fn(),
            exists: jest.fn(),
            hSet: jest.fn(),
            hGetAll: jest.fn().mockResolvedValue({}),
            hGet: jest.fn().mockResolvedValue(null),
            expire: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: EventBusService,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(OfflineSyncService);
    cacheService = module.get(CacheService);
    eventBus = module.get(EventBusService);
  });

  describe('saveOfflineData', () => {
    it('should cache player offline data to Redis', async () => {
      await service.saveOfflineData('p1');

      expect(cacheService.hSet).toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalled();
    });
  });

  describe('getOfflineData', () => {
    it('should return offline data from Redis', async () => {
      cacheService.hGetAll.mockResolvedValue({
        lastOnline: Date.now().toString(),
        offlineMessages: '[]',
      });

      const result = await service.getOfflineData('p1');

      expect(result).toBeDefined();
      expect(result.lastOnline).toBeDefined();
    });

    it('should return null when no offline data', async () => {
      cacheService.hGetAll.mockResolvedValue({});

      const result = await service.getOfflineData('p1');

      expect(result).toBeNull();
    });
  });

  describe('pushOfflineMessage', () => {
    it('should add message to offline list', async () => {
      cacheService.hGet.mockResolvedValue('[]');

      await service.pushOfflineMessage('p1', { type: 'mail', content: 'test' });

      expect(cacheService.hSet).toHaveBeenCalled();
    });
  });

  describe('clearOfflineData', () => {
    it('should delete offline data after sync', async () => {
      await service.clearOfflineData('p1');

      expect(cacheService.del).toHaveBeenCalled();
    });
  });
});
