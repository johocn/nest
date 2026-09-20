import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VipService } from './vip.service';
import { VipConfig } from './entities/vip-config.entity';
import { Character, CharacterTitle } from '@modules/character/entities';
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
  let charRepo: jest.Mocked<Repository<Character>>;
  let charTitleRepo: jest.Mocked<Repository<CharacterTitle>>;

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
          provide: getRepositoryToken(Character),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(CharacterTitle),
          useValue: {
            findOne: jest.fn(),
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
    charRepo = module.get(getRepositoryToken(Character));
    charTitleRepo = module.get(getRepositoryToken(CharacterTitle));
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

  describe('getPrivilegeValue', () => {
    it('命中特权键返回配置值', async () => {
      playerService.getById.mockResolvedValue({
        id: 'p1',
        vipLevel: 3,
      } as any);
      configRepo.findOne.mockResolvedValue({
        level: 3,
        privilegeJson: { friendSlots: 80, guildBuildBoost: 0.5 },
      } as any);

      expect(await service.getPrivilegeValue('p1', 'friendSlots', 50)).toBe(80);
      expect(
        await service.getPrivilegeValue('p1', 'guildBuildBoost', 0),
      ).toBe(0.5);
    });

    it('未配置键返回 fallback', async () => {
      playerService.getById.mockResolvedValue({
        id: 'p1',
        vipLevel: 3,
      } as any);
      configRepo.findOne.mockResolvedValue({
        level: 3,
        privilegeJson: { friendSlots: 80 },
      } as any);

      expect(
        await service.getPrivilegeValue('p1', 'guildContribBonus', 0),
      ).toBe(0);
    });

    it('玩家不存在返回 fallback', async () => {
      playerService.getById.mockResolvedValue(null as any);

      expect(await service.getPrivilegeValue('p1', 'friendSlots', 50)).toBe(50);
    });
  });

  describe('grantVipTitleIfEligible', () => {
    it('达到等级且有 vipTitleId 时发放称号', async () => {
      playerService.getById.mockResolvedValue({
        id: 'p1',
        vipLevel: 3,
      } as any);
      configRepo.findOne.mockResolvedValue({
        level: 3,
        privilegeJson: { vipTitleId: 't9' },
      } as any);
      charRepo.findOne.mockResolvedValue({ id: 'c1', playerId: 'p1' } as any);
      charTitleRepo.findOne.mockResolvedValue(null);

      await service.grantVipTitleIfEligible('p1');

      expect(charTitleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ characterId: 'c1', titleId: 't9' }),
      );
    });

    it('未配置 vipTitleId 不发称号', async () => {
      playerService.getById.mockResolvedValue({
        id: 'p1',
        vipLevel: 3,
      } as any);
      configRepo.findOne.mockResolvedValue({
        level: 3,
        privilegeJson: {},
      } as any);

      await service.grantVipTitleIfEligible('p1');

      expect(charTitleRepo.save).not.toHaveBeenCalled();
    });

    it('已持有称号不重复发放', async () => {
      playerService.getById.mockResolvedValue({
        id: 'p1',
        vipLevel: 3,
      } as any);
      configRepo.findOne.mockResolvedValue({
        level: 3,
        privilegeJson: { vipTitleId: 't9' },
      } as any);
      charRepo.findOne.mockResolvedValue({ id: 'c1', playerId: 'p1' } as any);
      charTitleRepo.findOne.mockResolvedValue({ id: 'ct1' } as any);

      await service.grantVipTitleIfEligible('p1');

      expect(charTitleRepo.save).not.toHaveBeenCalled();
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
