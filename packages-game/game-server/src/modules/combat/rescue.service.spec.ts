import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RescueService } from './rescue.service';
import { RescueLog, CombatLog } from './entities';
import { CharacterService } from '@modules/character/character.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { RelationshipLevel } from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import type { Repository } from 'typeorm';

describe('RescueService', () => {
  let service: RescueService;
  let rescueRepo: jest.Mocked<Repository<RescueLog>>;
  let combatLogRepo: jest.Mocked<Repository<CombatLog>>;
  let characterService: jest.Mocked<CharacterService>;
  let cacheService: jest.Mocked<CacheService>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RescueService,
        {
          provide: getRepositoryToken(RescueLog),
          useValue: {
            create: jest.fn((data: any) => ({ ...data, id: '3' })),
            save: jest.fn((data: any) => ({ ...data, id: '3' })),
            find: jest.fn(),
            count: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(CombatLog),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn((data: any) => data),
          },
        },
        {
          provide: CharacterService,
          useValue: {
            getRelationshipLevel: jest.fn(),
            increaseFavorability: jest.fn().mockResolvedValue({ id: '1' }),
          },
        },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(RescueService);
    rescueRepo = module.get(getRepositoryToken(RescueLog));
    combatLogRepo = module.get(getRepositoryToken(CombatLog));
    characterService = module.get(CharacterService);
    cacheService = module.get(CacheService);
    eventBus = module.get(EventBusService);
  });

  describe('performCombo', () => {
    it('should throw TACIT_NOT_ENOUGH when relationship below friend', async () => {
      characterService.getRelationshipLevel.mockResolvedValue(
        RelationshipLevel.STRANGER,
      );

      await expect(
        service.performCombo('1001', '1002'),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.TACIT_NOT_ENOUGH } });
    });

    it('should return 20% for friend level', async () => {
      characterService.getRelationshipLevel.mockResolvedValue(
        RelationshipLevel.FRIEND,
      );

      const result = await service.performCombo('1001', '1002');

      expect(result).toEqual({ comboBonus: 0.2, level: RelationshipLevel.FRIEND });
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.COMBO_TRIGGERED,
        expect.objectContaining({ attackerId: '1001', partnerId: '1002' }),
      );
    });

    it('should return 40% for confidant and above', async () => {
      characterService.getRelationshipLevel.mockResolvedValue(
        RelationshipLevel.CONFIDANT,
      );

      const result = await service.performCombo('1001', '1002');
      expect(result.comboBonus).toBe(0.4);
    });

    it('should write combo into combat log damageJson when combatLogId given', async () => {
      characterService.getRelationshipLevel.mockResolvedValue(
        RelationshipLevel.SWORN,
      );
      combatLogRepo.findOne.mockResolvedValue({
        id: '7',
        damageJson: { skillId: '1', finalDamage: 90 },
      } as CombatLog);

      await service.performCombo('1001', '1002', '7');

      expect(combatLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          damageJson: {
            skillId: '1',
            finalDamage: 90,
            combo: { partnerId: '1002', bonus: 0.4 },
          },
        }),
      );
    });
  });

  describe('attemptRescue', () => {
    it('should throw RESCUE_TARGET_INVALID when relationship below confidant', async () => {
      characterService.getRelationshipLevel.mockResolvedValue(
        RelationshipLevel.FRIEND,
      );

      await expect(
        service.attemptRescue('1001', '1002'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.RESCUE_TARGET_INVALID },
      });
    });

    it('should throw RESCUE_DAILY_CAP when daily count exceeds 5', async () => {
      characterService.getRelationshipLevel.mockResolvedValue(
        RelationshipLevel.CONFIDANT,
      );
      cacheService.get.mockResolvedValue('6');

      await expect(
        service.attemptRescue('1001', '1002'),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.RESCUE_DAILY_CAP } });
    });

    it('should create log, add favorability both ways and emit event', async () => {
      characterService.getRelationshipLevel.mockResolvedValue(
        RelationshipLevel.CONFIDANT,
      );
      cacheService.get.mockResolvedValue(null);

      const result = await service.attemptRescue('1001', '1002');

      expect(rescueRepo.create).toHaveBeenCalledWith({
        rescuerId: '1001',
        targetId: '1002',
        combatLogId: null,
      });
      expect(characterService.increaseFavorability).toHaveBeenCalledWith(
        '1001',
        '1002',
        5,
      );
      expect(characterService.increaseFavorability).toHaveBeenCalledWith(
        '1002',
        '1001',
        5,
      );
      expect(cacheService.set).toHaveBeenCalledWith(
        'rescue:daily:1001',
        '1',
        86400,
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.RESCUE_SUCCESS,
        expect.objectContaining({ rescuerId: '1001', targetId: '1002' }),
      );
      expect(result.id).toBe('3');
    });
  });

  describe('getRescueCount', () => {
    it('should return today count and total', async () => {
      cacheService.get.mockResolvedValue('3');
      rescueRepo.count.mockResolvedValue(8);

      const result = await service.getRescueCount('1001');

      expect(result).toEqual({ today: 3, total: 8 });
    });
  });

  describe('getRescueLogs', () => {
    it('should list logs by rescuer', async () => {
      rescueRepo.find.mockResolvedValue([{ id: '3' } as RescueLog]);

      const result = await service.getRescueLogs('1001');

      expect(rescueRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { rescuerId: '1001' } }),
      );
      expect(result).toHaveLength(1);
    });
  });
});
