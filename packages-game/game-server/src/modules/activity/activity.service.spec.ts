import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ActivityService } from './activity.service';
import { ActivityTemplate, PlayerActivity, SignInRecord } from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { ActivityType, ActivityStatus, SignInCycle } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('ActivityService', () => {
  let service: ActivityService;
  let templateRepo: jest.Mocked<Repository<ActivityTemplate>>;
  let playerActivityRepo: jest.Mocked<Repository<PlayerActivity>>;
  let signInRepo: jest.Mocked<Repository<SignInRecord>>;
  let cacheService: jest.Mocked<CacheService>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityService,
        {
          provide: getRepositoryToken(ActivityTemplate),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            findAndCount: jest.fn(),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
          },
        },
        {
          provide: getRepositoryToken(PlayerActivity),
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
          provide: getRepositoryToken(SignInRecord),
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
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: EventBusService,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ActivityService);
    templateRepo = module.get(getRepositoryToken(ActivityTemplate));
    playerActivityRepo = module.get(getRepositoryToken(PlayerActivity));
    signInRepo = module.get(getRepositoryToken(SignInRecord));
    cacheService = module.get(CacheService);
    eventBus = module.get(EventBusService);
  });

  describe('getActiveActivities', () => {
    it('should return active activities within time range', async () => {
      const now = new Date();
      const mockActivities = [
        {
          id: '1',
          name: '夏日活动',
          status: ActivityStatus.ACTIVE,
          startAt: now,
          endAt: new Date(now.getTime() + 86400000),
        },
        {
          id: '2',
          name: '周末双倍',
          status: ActivityStatus.ACTIVE,
          startAt: now,
          endAt: new Date(now.getTime() + 86400000),
        },
      ];
      templateRepo.find.mockResolvedValue(mockActivities as any);

      const result = await service.getActiveActivities();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('夏日活动');
    });
  });

  describe('joinActivity', () => {
    it('should create player activity record', async () => {
      const now = new Date();
      templateRepo.findOne.mockResolvedValue({
        id: '1',
        name: '限时活动',
        status: ActivityStatus.ACTIVE,
        startAt: new Date(now.getTime() - 3600000),
        endAt: new Date(now.getTime() + 3600000),
        activityType: ActivityType.LIMITED_TIME,
        maxParticipants: 100,
      } as any);
      playerActivityRepo.findOne.mockResolvedValue(null);

      const result = await service.joinActivity('p1', '1');

      expect(result.playerId).toBe('p1');
      expect(result.activityId).toBe('1');
    });

    it('should throw when activity not found', async () => {
      templateRepo.findOne.mockResolvedValue(null);

      await expect(service.joinActivity('p1', '999')).rejects.toThrow(
        GameException,
      );
    });

    it('should throw when activity is not active', async () => {
      templateRepo.findOne.mockResolvedValue({
        id: '1',
        status: ActivityStatus.DRAFT,
        startAt: new Date(),
        endAt: new Date(),
      } as any);

      await expect(service.joinActivity('p1', '1')).rejects.toThrow(
        GameException,
      );
    });

    it('should throw when already joined', async () => {
      const now = new Date();
      templateRepo.findOne.mockResolvedValue({
        id: '1',
        status: ActivityStatus.ACTIVE,
        startAt: new Date(now.getTime() - 3600000),
        endAt: new Date(now.getTime() + 3600000),
      } as any);
      playerActivityRepo.findOne.mockResolvedValue({
        id: '1',
        playerId: 'p1',
        activityId: '1',
      } as any);

      await expect(service.joinActivity('p1', '1')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('signIn', () => {
    it('should create sign-in record for first time', async () => {
      const today = new Date().toISOString().slice(0, 10);
      templateRepo.findOne.mockResolvedValue({
        id: '1',
        name: '每日签到',
        status: ActivityStatus.ACTIVE,
        activityType: ActivityType.SIGN_IN,
        signInCycle: SignInCycle.DAILY,
        startAt: new Date(Date.now() - 86400000),
        endAt: new Date(Date.now() + 86400000),
        rewardJson: { day1: { gold: 100 } },
      } as any);
      signInRepo.findOne.mockResolvedValue(null);

      const result = await service.signIn('p1', '1');

      expect(result.playerId).toBe('p1');
      expect(result.consecutiveDays).toBe(1);
      expect(eventBus.emit).toHaveBeenCalled();
    });

    it('should increment consecutive days when signed yesterday', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000)
        .toISOString()
        .slice(0, 10);
      templateRepo.findOne.mockResolvedValue({
        id: '1',
        name: '每日签到',
        status: ActivityStatus.ACTIVE,
        activityType: ActivityType.SIGN_IN,
        signInCycle: SignInCycle.DAILY,
        startAt: new Date(Date.now() - 86400000 * 2),
        endAt: new Date(Date.now() + 86400000),
        rewardJson: {},
      } as any);
      signInRepo.findOne
        .mockResolvedValueOnce(null) // today's record check
        .mockResolvedValueOnce({
          // yesterday's record check
          id: 'old',
          playerId: 'p1',
          activityId: '1',
          signInDate: yesterday,
          consecutiveDays: 3,
          rewardClaimed: true,
        } as any);

      const result = await service.signIn('p1', '1');

      expect(result.consecutiveDays).toBe(4);
    });

    it('should throw when already signed in today', async () => {
      const today = new Date().toISOString().slice(0, 10);
      templateRepo.findOne.mockResolvedValue({
        id: '1',
        status: ActivityStatus.ACTIVE,
        activityType: ActivityType.SIGN_IN,
        signInCycle: SignInCycle.DAILY,
        startAt: new Date(Date.now() - 86400000),
        endAt: new Date(Date.now() + 86400000),
      } as any);
      signInRepo.findOne.mockResolvedValue({
        id: '1',
        playerId: 'p1',
        activityId: '1',
        signInDate: today,
        consecutiveDays: 1,
      } as any);

      await expect(service.signIn('p1', '1')).rejects.toThrow(GameException);
    });
  });

  describe('claimReward', () => {
    it('should claim reward and mark as claimed', async () => {
      templateRepo.findOne.mockResolvedValue({
        id: '1',
        rewardJson: { gold: 500 },
      } as any);
      playerActivityRepo.findOne.mockResolvedValue({
        id: 'pa1',
        playerId: 'p1',
        activityId: '1',
        isRewardClaimed: false,
      } as any);

      const result = await service.claimReward('p1', '1');

      expect(result.reward).toEqual({ gold: 500 });
      expect(result.isRewardClaimed).toBe(true);
    });

    it('should throw when reward already claimed', async () => {
      playerActivityRepo.findOne.mockResolvedValue({
        id: 'pa1',
        playerId: 'p1',
        activityId: '1',
        isRewardClaimed: true,
      } as any);

      await expect(service.claimReward('p1', '1')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('getPlayerActivities', () => {
    it('should return player activity records', async () => {
      playerActivityRepo.find.mockResolvedValue([
        { id: '1', playerId: 'p1', activityId: 'a1', progress: 50 },
      ] as any);

      const result = await service.getPlayerActivities('p1');

      expect(result).toHaveLength(1);
    });
  });

  describe('admin CRUD', () => {
    it('should create activity template', async () => {
      const result = await service.createTemplate({
        name: '新春活动',
        activityType: ActivityType.LIMITED_TIME,
      } as any);

      expect(result.name).toBe('新春活动');
    });

    it('should return paginated templates', async () => {
      templateRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getTemplates(1, 20);

      expect(result.total).toBe(0);
    });
  });
});
