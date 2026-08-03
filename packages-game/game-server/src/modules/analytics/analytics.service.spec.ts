import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { PlayerBehaviorLog, RetentionStat } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { BehaviorType, StatPeriod } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let logRepo: jest.Mocked<Repository<PlayerBehaviorLog>>;
  let retentionRepo: jest.Mocked<Repository<RetentionStat>>;
  let eventBus: jest.Mocked<EventBusService>;

  // Shared query builder mock
  const mockQb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn().mockResolvedValue({ count: '0' }),
  };

  beforeEach(async () => {
    // Reset mock call tracking but keep implementations
    jest.clearAllMocks();
    mockQb.getRawMany.mockResolvedValue([]);
    mockQb.getRawOne.mockResolvedValue({ count: '0' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: getRepositoryToken(PlayerBehaviorLog),
          useValue: {
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            createQueryBuilder: jest.fn(() => mockQb),
          },
        },
        {
          provide: getRepositoryToken(RetentionStat),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
          },
        },
        {
          provide: EventBusService,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(AnalyticsService);
    logRepo = module.get(getRepositoryToken(PlayerBehaviorLog));
    retentionRepo = module.get(getRepositoryToken(RetentionStat));
    eventBus = module.get(EventBusService);
  });

  describe('logBehavior', () => {
    it('should save behavior log and emit event', async () => {
      const result = await service.logBehavior('p1', BehaviorType.LOGIN, {
        device: 'mobile',
      });

      expect(result.playerId).toBe('p1');
      expect(result.behaviorType).toBe(BehaviorType.LOGIN);
      expect(eventBus.emit).toHaveBeenCalled();
    });
  });

  describe('getBehaviorStats', () => {
    it('should return behavior counts by type', async () => {
      mockQb.getRawMany.mockResolvedValue([
        { behavior_type: 'login', count: '50' },
        { behavior_type: 'purchase', count: '20' },
      ]);

      const result = await service.getBehaviorStats(
        new Date(Date.now() - 86400000),
        new Date(),
      );

      expect(result).toHaveLength(2);
      expect(result[0].behaviorType).toBe('login');
      expect(result[0].count).toBe(50);
    });
  });

  describe('getDailyActiveUsers', () => {
    it('should return DAU count', async () => {
      mockQb.getRawOne.mockResolvedValue({ count: '42' });

      const result = await service.getDailyActiveUsers(
        new Date().toISOString().slice(0, 10),
      );

      expect(result).toBe(42);
    });
  });

  describe('calculateRetention', () => {
    it('should calculate and save retention rate', async () => {
      // Mock: 100 users in cohort, 25 retained
      mockQb.getRawOne
        .mockResolvedValueOnce({ count: '100' }) // cohort size
        .mockResolvedValueOnce({ count: '25' }); // retained count

      retentionRepo.findOne.mockResolvedValue(null);

      const result = await service.calculateRetention(
        '2026-07-01',
        '2026-07-02',
        StatPeriod.DAILY,
      );

      expect(result.cohortSize).toBe(100);
      expect(result.retainedCount).toBe(25);
      expect(result.retentionRate).toBe(25);
    });
  });

  describe('getRetentionStats', () => {
    it('should return retention records for a cohort date', async () => {
      retentionRepo.find.mockResolvedValue([
        {
          id: '1',
          cohortDate: '2026-07-01',
          retainedCount: 80,
          retentionRate: 80,
        },
      ] as any);

      const result = await service.getRetentionStats('2026-07-01');

      expect(result).toHaveLength(1);
    });
  });

  describe('getDashboard', () => {
    it('should return dashboard summary', async () => {
      mockQb.getRawOne.mockResolvedValue({ count: '15' });
      mockQb.getRawMany.mockResolvedValue([]);

      const result = await service.getDashboard();

      expect(result).toHaveProperty('dau');
      expect(result).toHaveProperty('behaviorStats');
      expect(result).toHaveProperty('generatedAt');
    });
  });
});
