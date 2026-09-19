import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CombatService } from './combat.service';
import { CombatLog } from './entities';
import { SkillService } from '@modules/skill/skill.service';
import { BuffService } from '@modules/buff/buff.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { CombatType, CombatResult } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('CombatService', () => {
  let service: CombatService;
  let combatLogRepo: jest.Mocked<Repository<CombatLog>>;
  let skillService: jest.Mocked<SkillService>;
  let buffService: jest.Mocked<BuffService>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CombatService,
        {
          provide: getRepositoryToken(CombatLog),
          useValue: {
            save: jest.fn().mockResolvedValue({ id: '1' }),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            findAndCount: jest.fn(),
          },
        },
        {
          provide: SkillService,
          useValue: {
            castSkill: jest.fn().mockResolvedValue({
              skillId: '1',
              skillName: '降龙十八掌',
              damage: 100,
              mpCost: 20,
              buffApplied: false,
            }),
          },
        },
        {
          provide: BuffService,
          useValue: {
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
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(CombatService);
    combatLogRepo = module.get(getRepositoryToken(CombatLog));
    skillService = module.get(SkillService);
    buffService = module.get(BuffService);
    eventBus = module.get(EventBusService);
  });

  describe('resolvePveCombat', () => {
    it('should return win when defender HP reaches 0', async () => {
      const result = await service.resolvePveCombat({
        attackerId: 'c1',
        defenderId: 'c2',
        attackerStats: {
          strength: 50,
          speed: 20,
          defense: 30,
          intelligence: 10,
          comprehension: 10,
          loyalty: 50,
        },
        defenderHp: 90,
        defenderDefense: 10,
        skillId: '1',
        attackerMp: 100,
        sceneId: '1',
      });

      expect(result.result).toBe(CombatResult.WIN);
      expect(result.damageDealt).toBe(90); // 100 damage - 10 defense
      expect(combatLogRepo.save).toHaveBeenCalled();
    });

    it('should return lose when defender survives', async () => {
      skillService.castSkill.mockResolvedValue({
        skillId: '1',
        skillName: '降龙十八掌',
        damage: 50,
        mpCost: 20,
        buffApplied: false,
      });

      const result = await service.resolvePveCombat({
        attackerId: 'c1',
        defenderId: 'c2',
        attackerStats: {
          strength: 50,
          speed: 20,
          defense: 30,
          intelligence: 10,
          comprehension: 10,
          loyalty: 50,
        },
        defenderHp: 100,
        defenderDefense: 10,
        skillId: '1',
        attackerMp: 100,
        sceneId: '1',
      });

      expect(result.result).toBe(CombatResult.LOSE);
      expect(result.damageDealt).toBe(40); // 50 damage - 10 defense
    });

    it('should emit monster killed event on win', async () => {
      const result = await service.resolvePveCombat({
        attackerId: 'c1',
        defenderId: 'monster1',
        attackerStats: {
          strength: 50,
          speed: 20,
          defense: 30,
          intelligence: 10,
          comprehension: 10,
          loyalty: 50,
        },
        defenderHp: 50,
        defenderDefense: 5,
        skillId: '1',
        attackerMp: 100,
        sceneId: '1',
      });

      expect(result.result).toBe(CombatResult.WIN);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'combat.monster.killed',
        expect.objectContaining({ defenderId: 'monster1' }),
      );
    });

    it('should record combat log with damage details', async () => {
      await service.resolvePveCombat({
        attackerId: 'c1',
        defenderId: 'c2',
        attackerStats: {
          strength: 50,
          speed: 20,
          defense: 30,
          intelligence: 10,
          comprehension: 10,
          loyalty: 50,
        },
        defenderHp: 100,
        defenderDefense: 10,
        skillId: '1',
        attackerMp: 100,
        sceneId: '1',
      });

      expect(combatLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          attackerId: 'c1',
          defenderId: 'c2',
          combatType: CombatType.PVE,
        }),
      );
    });

    it('should boost damage by attack bonus percentage', async () => {
      const result = await service.resolvePveCombat({
        attackerId: 'c1',
        defenderId: 'c2',
        attackerStats: {
          strength: 50,
          speed: 20,
          defense: 30,
          intelligence: 10,
          comprehension: 10,
          loyalty: 50,
        },
        defenderHp: 100,
        defenderDefense: 10,
        skillId: '1',
        attackerMp: 100,
        sceneId: '1',
        formationBonus: { attack: 20, defense: 0 },
      });

      // 100 * 1.2 - 10 = 110
      expect(result.damageDealt).toBe(110);
      expect(combatLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          damageJson: expect.objectContaining({
            formationBonus: { attack: 20, defense: 0 },
          }),
        }),
      );
    });

    it('should reduce defender defense by defense bonus percentage', async () => {
      const result = await service.resolvePveCombat({
        attackerId: 'c1',
        defenderId: 'c2',
        attackerStats: {
          strength: 50,
          speed: 20,
          defense: 30,
          intelligence: 10,
          comprehension: 10,
          loyalty: 50,
        },
        defenderHp: 100,
        defenderDefense: 10,
        skillId: '1',
        attackerMp: 100,
        sceneId: '1',
        formationBonus: { attack: 0, defense: 10 },
      });

      // 100 - 10 * (1 - 10/100) = 91
      expect(result.damageDealt).toBe(91);
    });
  });

  describe('getCombatLogs', () => {
    it('should return paginated combat logs for attacker', async () => {
      combatLogRepo.findAndCount.mockResolvedValue([[{ id: '1' } as any], 1]);

      const result = await service.getCombatLogs('c1', 1, 20);

      expect(result.items).toHaveLength(1);
    });
  });
});
