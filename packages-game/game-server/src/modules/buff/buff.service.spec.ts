import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BuffService } from './buff.service';
import { BuffTemplate } from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { BuffType, BuffTarget } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('BuffService', () => {
  let service: BuffService;
  let buffRepo: jest.Mocked<Repository<BuffTemplate>>;
  let cacheService: jest.Mocked<CacheService>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuffService,
        {
          provide: getRepositoryToken(BuffTemplate),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            findAndCount: jest.fn(),
          },
        },
        {
          provide: CacheService,
          useValue: {
            hSet: jest.fn(),
            hGet: jest.fn(),
            hGetAll: jest.fn(),
            hDel: jest.fn(),
            del: jest.fn(),
            expire: jest.fn(),
            exists: jest.fn(),
          },
        },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(BuffService);
    buffRepo = module.get(getRepositoryToken(BuffTemplate));
    cacheService = module.get(CacheService);
    eventBus = module.get(EventBusService);
  });

  const makeBuff = (overrides: Partial<BuffTemplate> = {}): BuffTemplate =>
    ({
      id: '1',
      name: '攻击增益',
      buffType: BuffType.BUFF,
      target: BuffTarget.SELF,
      duration: 10,
      statModifiers: { strength: 20 },
      description: null,
      iconKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as BuffTemplate;

  describe('applyBuff', () => {
    it('should store active buff in Redis hash with TTL', async () => {
      buffRepo.findOne.mockResolvedValue(makeBuff());

      const result = await service.applyBuff('c1', '1');

      expect(result.applied).toBe(true);
      expect(cacheService.hSet).toHaveBeenCalledWith(
        'buff:character:c1',
        '1',
        expect.any(String),
      );
      expect(cacheService.expire).toHaveBeenCalledWith('buff:character:c1', 10);
    });

    it('should throw when buff template not found', async () => {
      buffRepo.findOne.mockResolvedValue(null);

      await expect(service.applyBuff('c1', '999')).rejects.toThrow();
    });
  });

  describe('removeBuff', () => {
    it('should remove buff from Redis hash', async () => {
      await service.removeBuff('c1', '1');

      expect(cacheService.hDel).toHaveBeenCalledWith('buff:character:c1', '1');
    });
  });

  describe('getActiveBuffs', () => {
    it('should return all active buffs for character', async () => {
      cacheService.hGetAll.mockResolvedValue({
        '1': JSON.stringify({
          id: '1',
          name: '攻击增益',
          statModifiers: { strength: 20 },
          expiresAt: '9999999999999',
        }),
        '2': JSON.stringify({
          id: '2',
          name: '防御减益',
          statModifiers: { defense: -10 },
          expiresAt: '9999999999999',
        }),
      });

      const result = await service.getActiveBuffs('c1');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('攻击增益');
    });

    it('should return empty array when no active buffs', async () => {
      cacheService.hGetAll.mockResolvedValue({});

      const result = await service.getActiveBuffs('c1');

      expect(result).toEqual([]);
    });
  });

  describe('calculateModifiedStats', () => {
    it('should apply buff modifiers to base stats', async () => {
      cacheService.hGetAll.mockResolvedValue({
        '1': JSON.stringify({ statModifiers: { strength: 20, defense: 5 } }),
        '2': JSON.stringify({ statModifiers: { strength: -10 } }),
      });

      const baseStats = {
        strength: 50,
        defense: 30,
        speed: 10,
        intelligence: 10,
        comprehension: 10,
        loyalty: 50,
      };
      const result = await service.calculateModifiedStats('c1', baseStats);

      expect(result.strength).toBe(60); // 50 + 20 - 10
      expect(result.defense).toBe(35); // 30 + 5
      expect(result.speed).toBe(10); // unchanged
    });

    it('should return base stats when no active buffs', async () => {
      cacheService.hGetAll.mockResolvedValue({});

      const baseStats = {
        strength: 50,
        defense: 30,
        speed: 10,
        intelligence: 10,
        comprehension: 10,
        loyalty: 50,
      };
      const result = await service.calculateModifiedStats('c1', baseStats);

      expect(result).toEqual(baseStats);
    });
  });

  describe('cleanExpiredBuffs', () => {
    it('should remove expired buffs from Redis hash', async () => {
      const now = Date.now();
      cacheService.hGetAll.mockResolvedValue({
        '1': JSON.stringify({ expiresAt: (now - 1000).toString() }),
        '2': JSON.stringify({ expiresAt: (now + 10000).toString() }),
      });

      await service.cleanExpiredBuffs('c1');

      expect(cacheService.hDel).toHaveBeenCalledWith('buff:character:c1', '1');
      expect(cacheService.hDel).not.toHaveBeenCalledWith(
        'buff:character:c1',
        '2',
      );
    });
  });

  describe('admin CRUD', () => {
    it('should create buff template', async () => {
      buffRepo.save.mockResolvedValue(makeBuff());
      const result = await service.createTemplate({
        name: '攻击增益',
        buffType: BuffType.BUFF,
        target: BuffTarget.SELF,
        duration: 10,
        statModifiers: { strength: 20 },
      });
      expect(result.name).toBe('攻击增益');
    });

    it('should return paginated templates', async () => {
      buffRepo.findAndCount.mockResolvedValue([[makeBuff()], 1]);
      const result = await service.getTemplates(1, 20);
      expect(result.items).toHaveLength(1);
    });
  });
});
