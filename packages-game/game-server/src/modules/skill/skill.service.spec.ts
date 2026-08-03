import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SkillService } from './skill.service';
import { SkillTemplate } from './entities';
import { CacheService } from '@cache/cache.service';
import { BuffService } from '@modules/buff/buff.service';
import { GameException } from '@common/exceptions/game.exception';
import { SkillType, MartialArtType } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('SkillService', () => {
  let service: SkillService;
  let skillRepo: jest.Mocked<Repository<SkillTemplate>>;
  let cacheService: jest.Mocked<CacheService>;
  let buffService: jest.Mocked<BuffService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillService,
        {
          provide: getRepositoryToken(SkillTemplate),
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
            set: jest.fn(),
            get: jest.fn(),
            exists: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: BuffService,
          useValue: {
            applyBuff: jest.fn().mockResolvedValue({ applied: true }),
            calculateModifiedStats: jest.fn().mockResolvedValue({
              strength: 50,
              speed: 20,
              defense: 30,
              intelligence: 10,
              comprehension: 10,
              loyalty: 50,
            }),
          },
        },
      ],
    }).compile();

    service = module.get(SkillService);
    skillRepo = module.get(getRepositoryToken(SkillTemplate));
    cacheService = module.get(CacheService);
    buffService = module.get(BuffService);
  });

  const makeSkill = (overrides: Partial<SkillTemplate> = {}): SkillTemplate =>
    ({
      id: '1',
      name: '降龙十八掌',
      skillType: SkillType.ACTIVE,
      artType: MartialArtType.FIST,
      baseDamage: 100,
      cooldown: 5,
      mpCost: 20,
      range: 3,
      effectJson: {},
      minLevel: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as SkillTemplate;

  describe('castSkill', () => {
    it('should calculate damage and set cooldown', async () => {
      skillRepo.findOne.mockResolvedValue(makeSkill());
      cacheService.exists.mockResolvedValue(false);

      const result = await service.castSkill('c1', '1', 'c2', {
        strength: 50,
        speed: 20,
        defense: 30,
        intelligence: 10,
        comprehension: 10,
        loyalty: 50,
      });

      expect(result.damage).toBeGreaterThan(0);
      expect(cacheService.set).toHaveBeenCalledWith(
        'cd:skill:c1:1',
        expect.any(String),
        5,
      );
    });

    it('should throw when skill on cooldown', async () => {
      skillRepo.findOne.mockResolvedValue(makeSkill());
      cacheService.exists.mockResolvedValue(true);

      await expect(
        service.castSkill('c1', '1', 'c2', {
          strength: 50,
          speed: 20,
          defense: 30,
          intelligence: 10,
          comprehension: 10,
          loyalty: 50,
        }),
      ).rejects.toThrow(GameException);
    });

    it('should throw when insufficient MP', async () => {
      skillRepo.findOne.mockResolvedValue(makeSkill({ mpCost: 100 }));
      cacheService.exists.mockResolvedValue(false);

      await expect(
        service.castSkill(
          'c1',
          '1',
          'c2',
          {
            strength: 50,
            speed: 20,
            defense: 30,
            intelligence: 10,
            comprehension: 10,
            loyalty: 50,
          },
          10,
        ),
      ).rejects.toThrow(GameException);
    });

    it('should throw when skill not found', async () => {
      skillRepo.findOne.mockResolvedValue(null);

      await expect(
        service.castSkill('c1', '999', 'c2', {
          strength: 50,
          speed: 20,
          defense: 30,
          intelligence: 10,
          comprehension: 10,
          loyalty: 50,
        }),
      ).rejects.toThrow(GameException);
    });

    it('should apply buff from effectJson when present', async () => {
      skillRepo.findOne.mockResolvedValue(
        makeSkill({ effectJson: { buffId: 'buff1', buffTarget: 'self' } }),
      );
      cacheService.exists.mockResolvedValue(false);

      await service.castSkill('c1', '1', 'c2', {
        strength: 50,
        speed: 20,
        defense: 30,
        intelligence: 10,
        comprehension: 10,
        loyalty: 50,
      });

      expect(buffService.applyBuff).toHaveBeenCalledWith('c1', 'buff1');
    });

    it('should use buff-modified stats for damage calculation', async () => {
      skillRepo.findOne.mockResolvedValue(makeSkill({ baseDamage: 50 }));
      cacheService.exists.mockResolvedValue(false);
      buffService.calculateModifiedStats.mockResolvedValue({
        strength: 100,
        speed: 20,
        defense: 30,
        intelligence: 10,
        comprehension: 10,
        loyalty: 50,
      });

      const result = await service.castSkill('c1', '1', 'c2', {
        strength: 50,
        speed: 20,
        defense: 30,
        intelligence: 10,
        comprehension: 10,
        loyalty: 50,
      });

      // damage = baseDamage + strength * 0.5 = 50 + 100*0.5 = 100
      expect(result.damage).toBe(100);
    });
  });

  describe('checkCooldown', () => {
    it('should return true when skill is on cooldown', async () => {
      cacheService.exists.mockResolvedValue(true);
      const result = await service.checkCooldown('c1', '1');
      expect(result).toBe(true);
    });

    it('should return false when skill is not on cooldown', async () => {
      cacheService.exists.mockResolvedValue(false);
      const result = await service.checkCooldown('c1', '1');
      expect(result).toBe(false);
    });
  });

  describe('admin CRUD', () => {
    it('should create skill template', async () => {
      skillRepo.save.mockResolvedValue(makeSkill());
      const result = await service.createTemplate({
        name: '降龙十八掌',
        skillType: SkillType.ACTIVE,
        baseDamage: 100,
        cooldown: 5,
        mpCost: 20,
        range: 3,
      });
      expect(result.name).toBe('降龙十八掌');
    });

    it('should return paginated templates', async () => {
      skillRepo.findAndCount.mockResolvedValue([[makeSkill()], 1]);
      const result = await service.getTemplates(1, 20);
      expect(result.items).toHaveLength(1);
    });
  });
});
