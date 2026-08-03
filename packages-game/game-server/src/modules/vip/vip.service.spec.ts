import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VipService } from './vip.service';
import { VipConfig } from './entities/vip-config.entity';
import { PlayerService } from '@modules/player/player.service';
import { EconomyService } from '@modules/economy/economy.service';
import { CacheService } from '@cache/cache.service';
import { GameException } from '@common/exceptions/game.exception';
import type { Repository } from 'typeorm';

describe('VipService', () => {
  let service: VipService;
  let configRepo: jest.Mocked<Repository<VipConfig>>;
  let playerService: jest.Mocked<PlayerService>;
  let cacheService: jest.Mocked<CacheService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VipService,
        {
          provide: getRepositoryToken(VipConfig),
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
          provide: PlayerService,
          useValue: {
            getById: jest.fn(),
            addVipExp: jest
              .fn()
              .mockResolvedValue({ vipLevel: 2, vipExp: 100, leveledUp: true }),
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
          provide: EconomyService,
          useValue: {
            addCurrency: jest.fn().mockResolvedValue({ balanceAfter: '1000' }),
          },
        },
      ],
    }).compile();

    service = module.get(VipService);
    configRepo = module.get(getRepositoryToken(VipConfig));
    playerService = module.get(PlayerService);
    cacheService = module.get(CacheService);
  });

  describe('addVipExp', () => {
    it('should delegate to PlayerService.addVipExp', async () => {
      const result = await service.addVipExp('p1', 500);

      expect(playerService.addVipExp).toHaveBeenCalledWith('p1', 500);
      expect(result.vipLevel).toBe(2);
    });
  });

  describe('getVipInfo', () => {
    it('should return player vip info with config', async () => {
      playerService.getById.mockResolvedValue({
        id: 'p1',
        vipLevel: 3,
        vipExp: 200,
      } as any);
      configRepo.findOne.mockResolvedValue({
        level: 3,
        requiredExp: 3000,
        privilegeJson: { discount: 0.9 },
      } as any);

      const result = await service.getVipInfo('p1');

      expect(result.vipLevel).toBe(3);
      expect(result.privilege).toEqual({ discount: 0.9 });
    });
  });

  describe('claimDailyReward', () => {
    it('should claim reward when not claimed today', async () => {
      playerService.getById.mockResolvedValue({
        id: 'p1',
        vipLevel: 1,
        vipExp: 0,
      } as any);
      configRepo.findOne.mockResolvedValue({
        level: 1,
        dailyRewardJson: { gold: 500 },
      } as any);
      cacheService.get.mockResolvedValue(null);

      const result = await service.claimDailyReward('p1');

      expect(result.reward).toEqual({ gold: 500 });
      expect(result.delivered).toBe(true);
      expect(cacheService.set).toHaveBeenCalled();
    });

    it('should throw when already claimed today', async () => {
      playerService.getById.mockResolvedValue({
        id: 'p1',
        vipLevel: 1,
      } as any);
      configRepo.findOne.mockResolvedValue({
        level: 1,
        dailyRewardJson: {},
      } as any);
      cacheService.get.mockResolvedValue('claimed');

      await expect(service.claimDailyReward('p1')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('admin CRUD', () => {
    it('should create vip config', async () => {
      const result = await service.createConfig({
        level: 5,
        requiredExp: 5000,
        dailyRewardJson: { gold: 1000 },
      } as any);

      expect(result.level).toBe(5);
    });

    it('should return config list', async () => {
      configRepo.find.mockResolvedValue([{ level: 1 }, { level: 2 }] as any);

      const result = await service.getConfigList();

      expect(result).toHaveLength(2);
    });
  });
});
