import { Test, TestingModule } from '@nestjs/testing';
import { MatchmakingService } from './matchmaking.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';

describe('MatchmakingService', () => {
  let service: MatchmakingService;
  let cacheService: jest.Mocked<CacheService>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchmakingService,
        {
          provide: CacheService,
          useValue: {
            zAdd: jest.fn().mockResolvedValue(1),
            zRange: jest.fn().mockResolvedValue([]),
            zRem: jest.fn().mockResolvedValue(1),
            hSet: jest.fn(),
            hGet: jest.fn(),
            hGetAll: jest.fn().mockResolvedValue({}),
            del: jest.fn(),
            exists: jest.fn().mockResolvedValue(false),
            expire: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: EventBusService,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(MatchmakingService);
    cacheService = module.get(CacheService);
    eventBus = module.get(EventBusService);
  });

  describe('joinQueue', () => {
    it('should add player to queue', async () => {
      const result = await service.joinQueue('p1', 'ranked', 5000);

      expect(result.queued).toBe(true);
      expect(cacheService.zAdd).toHaveBeenCalled();
    });

    it('should throw when already in queue', async () => {
      cacheService.exists.mockResolvedValue(true);

      await expect(service.joinQueue('p1', 'ranked', 5000)).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('cancelQueue', () => {
    it('should remove player from queue', async () => {
      cacheService.exists.mockResolvedValue(true);

      const result = await service.cancelQueue('p1', 'ranked');

      expect(result.cancelled).toBe(true);
      expect(cacheService.zRem).toHaveBeenCalled();
      expect(cacheService.del).toHaveBeenCalled();
    });
  });

  describe('tryMatch', () => {
    it('should not match when only one player in queue', async () => {
      cacheService.zRange.mockResolvedValue(['p1']);

      const result = await service.tryMatch('ranked');

      expect(result.matched).toBe(false);
    });

    it('should match two players with similar power', async () => {
      cacheService.zRange.mockResolvedValue(['p1', 'p2']);
      cacheService.hGet
        .mockResolvedValueOnce('5000') // p1 score
        .mockResolvedValueOnce('5200'); // p2 score

      const result = await service.tryMatch('ranked');

      expect(result.matched).toBe(true);
      expect(eventBus.emit).toHaveBeenCalled();
      expect(cacheService.zRem).toHaveBeenCalledWith(
        expect.any(String),
        'p1',
        'p2',
      );
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue info', async () => {
      cacheService.exists.mockResolvedValue(true);
      cacheService.hGet.mockResolvedValue('5000');

      const result = await service.getQueueStatus('p1', 'ranked');

      expect(result.inQueue).toBe(true);
      expect(result.score).toBe(5000);
    });
  });
});
