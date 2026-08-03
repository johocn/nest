import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AchievementService } from './achievement.service';
import { AchievementTemplate, PlayerAchievement } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { AchievementCategory, AchievementCondition } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('AchievementService', () => {
  let service: AchievementService;
  let templateRepo: jest.Mocked<Repository<AchievementTemplate>>;
  let playerAchievementRepo: jest.Mocked<Repository<PlayerAchievement>>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AchievementService,
        {
          provide: getRepositoryToken(AchievementTemplate),
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
          provide: getRepositoryToken(PlayerAchievement),
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

    service = module.get(AchievementService);
    templateRepo = module.get(getRepositoryToken(AchievementTemplate));
    playerAchievementRepo = module.get(getRepositoryToken(PlayerAchievement));
    eventBus = module.get(EventBusService);
  });

  describe('updateProgress', () => {
    it('should create new progress record and unlock when target reached', async () => {
      templateRepo.findOne.mockResolvedValue({
        id: 'a1',
        name: '百战之王',
        targetValue: 100,
        condition: AchievementCondition.KILL_COUNT,
        rewardJson: { gold: 1000 },
      } as any);
      playerAchievementRepo.findOne.mockResolvedValue(null);

      const result = await service.updateProgress('p1', 'a1', 100);

      expect(result.isUnlocked).toBe(true);
      expect(result.unlockedAt).toBeDefined();
      expect(eventBus.emit).toHaveBeenCalled();
    });

    it('should update existing progress without unlocking when below target', async () => {
      templateRepo.findOne.mockResolvedValue({
        id: 'a1',
        targetValue: 100,
        condition: AchievementCondition.KILL_COUNT,
      } as any);
      playerAchievementRepo.findOne.mockResolvedValue({
        id: 'pa1',
        playerId: 'p1',
        achievementId: 'a1',
        currentValue: 10,
        isUnlocked: false,
      } as any);

      const result = await service.updateProgress('p1', 'a1', 50);

      expect(result.currentValue).toBe(50);
      expect(result.isUnlocked).toBe(false);
    });

    it('should not update when already unlocked', async () => {
      templateRepo.findOne.mockResolvedValue({
        id: 'a1',
        targetValue: 100,
      } as any);
      playerAchievementRepo.findOne.mockResolvedValue({
        id: 'pa1',
        playerId: 'p1',
        achievementId: 'a1',
        currentValue: 100,
        isUnlocked: true,
        unlockedAt: new Date(),
      } as any);

      const result = await service.updateProgress('p1', 'a1', 200);

      expect(result.isUnlocked).toBe(true);
      expect(result.currentValue).toBe(100); // unchanged
    });
  });

  describe('claimReward', () => {
    it('should claim reward for unlocked achievement', async () => {
      templateRepo.findOne.mockResolvedValue({
        id: 'a1',
        rewardJson: { gold: 500, diamond: 10 },
      } as any);
      playerAchievementRepo.findOne.mockResolvedValue({
        id: 'pa1',
        playerId: 'p1',
        achievementId: 'a1',
        isUnlocked: true,
        isRewardClaimed: false,
      } as any);

      const result = await service.claimReward('p1', 'a1');

      expect(result.reward).toEqual({ gold: 500, diamond: 10 });
      expect(result.isRewardClaimed).toBe(true);
    });

    it('should throw when achievement not unlocked', async () => {
      playerAchievementRepo.findOne.mockResolvedValue({
        id: 'pa1',
        isUnlocked: false,
      } as any);

      await expect(service.claimReward('p1', 'a1')).rejects.toThrow(
        GameException,
      );
    });

    it('should throw when reward already claimed', async () => {
      playerAchievementRepo.findOne.mockResolvedValue({
        id: 'pa1',
        isUnlocked: true,
        isRewardClaimed: true,
      } as any);

      await expect(service.claimReward('p1', 'a1')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('getPlayerAchievements', () => {
    it('should return player achievement list', async () => {
      playerAchievementRepo.find.mockResolvedValue([
        { id: '1', playerId: 'p1', achievementId: 'a1', isUnlocked: true },
      ] as any);

      const result = await service.getPlayerAchievements('p1');

      expect(result).toHaveLength(1);
    });
  });

  describe('getAchievementList', () => {
    it('should return all achievement templates', async () => {
      templateRepo.find.mockResolvedValue([
        { id: 'a1', name: '新手', category: AchievementCategory.COMBAT },
      ] as any);

      const result = await service.getAchievementList();

      expect(result).toHaveLength(1);
    });

    it('should filter by category', async () => {
      templateRepo.find.mockResolvedValue([
        { id: 'a1', category: AchievementCategory.SOCIAL },
      ] as any);

      const result = await service.getAchievementList(
        AchievementCategory.SOCIAL,
      );

      expect(result).toHaveLength(1);
    });
  });

  describe('admin CRUD', () => {
    it('should create achievement template', async () => {
      const result = await service.createTemplate({
        name: '杀敌100',
        category: AchievementCategory.COMBAT,
        condition: AchievementCondition.KILL_COUNT,
        targetValue: 100,
      } as any);

      expect(result.name).toBe('杀敌100');
    });

    it('should return paginated templates', async () => {
      templateRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getTemplates(1, 20);

      expect(result.total).toBe(0);
    });
  });
});
