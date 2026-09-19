import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FaceService } from './face.service';
import { CombatLog } from './entities';
import { EconomyService } from '@modules/economy/economy.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { CombatResult, CurrencyType } from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import type { Repository } from 'typeorm';

describe('FaceService', () => {
  let service: FaceService;
  let combatLogRepo: jest.Mocked<Repository<CombatLog>>;
  let economyService: jest.Mocked<EconomyService>;
  let cacheService: jest.Mocked<CacheService>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FaceService,
        {
          provide: getRepositoryToken(CombatLog),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: EconomyService,
          useValue: {
            addCurrency: jest
              .fn()
              .mockResolvedValue({ balanceAfter: '100' }),
            deductCurrency: jest
              .fn()
              .mockResolvedValue({ balanceAfter: '70' }),
            getBalance: jest.fn().mockResolvedValue('100'),
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

    service = module.get(FaceService);
    combatLogRepo = module.get(getRepositoryToken(CombatLog));
    economyService = module.get(EconomyService);
    cacheService = module.get(CacheService);
    eventBus = module.get(EventBusService);
  });

  describe('adjustFace', () => {
    it('should add face for positive delta and emit FACE_CHANGED', async () => {
      const result = await service.adjustFace('1001', 10, 'battle_win');

      expect(economyService.addCurrency).toHaveBeenCalledWith(
        '1001',
        CurrencyType.FACE,
        10,
        'social_combat',
        'battle_win',
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.FACE_CHANGED,
        expect.objectContaining({ playerId: '1001' }),
      );
      expect(result.balanceAfter).toBe('100');
    });

    it('should deduct face for negative delta', async () => {
      const result = await service.adjustFace('1001', -30, 'shamed');

      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        '1001',
        CurrencyType.FACE,
        30,
        'social_combat',
        'shamed',
      );
      expect(result.balanceAfter).toBe('70');
    });

    it('should reject zero delta', async () => {
      await expect(
        service.adjustFace('1001', 0, 'none'),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.PARAM_INVALID } });
    });
  });

  describe('applyFaceRule', () => {
    it('winner level >= loser: winner +10', async () => {
      const result = await service.applyFaceRule('1001', '1002', 5, 3);

      expect(economyService.addCurrency).toHaveBeenCalledWith(
        '1001',
        CurrencyType.FACE,
        10,
        expect.any(String),
        expect.any(String),
      );
      expect(result.winnerId).toBe('1001');
      expect(result.loserId).toBe('1002');
    });

    it('winner level < loser (upset): winner +15 and loser -15', async () => {
      const result = await service.applyFaceRule('1001', '1002', 3, 5);

      expect(economyService.addCurrency).toHaveBeenCalledWith(
        '1001',
        CurrencyType.FACE,
        15,
        expect.any(String),
        expect.any(String),
      );
      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        '1002',
        CurrencyType.FACE,
        15,
        expect.any(String),
        expect.any(String),
      );
      expect(result).toMatchObject({ winnerId: '1001', loserId: '1002' });
    });

    it('forfeited loser loses 10 face', async () => {
      await service.applyFaceRule('1001', '1002', 5, 3, true);

      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        '1002',
        CurrencyType.FACE,
        10,
        expect.any(String),
        expect.any(String),
      );
    });
  });

  describe('publicShame', () => {
    it('should throw SHAME_TARGET_INVALID when targeting self', async () => {
      await expect(
        service.publicShame('1001', '1001'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.SHAME_TARGET_INVALID },
      });
    });

    it('should add face to shamer, deduct target and mark shame window', async () => {
      const result = await service.publicShame('1001', '1002');

      expect(economyService.addCurrency).toHaveBeenCalledWith(
        '1001',
        CurrencyType.FACE,
        5,
        expect.any(String),
        expect.any(String),
      );
      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        '1002',
        CurrencyType.FACE,
        30,
        expect.any(String),
        expect.any(String),
      );
      expect(cacheService.set).toHaveBeenCalledWith('shame:1002', '1', 86400);
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.GRUDGE_DECLARED,
        expect.objectContaining({ shamerId: '1001', targetId: '1002' }),
      );
      expect(result).toMatchObject({ shamerId: '1001', targetId: '1002' });
    });
  });

  describe('declareGrudge', () => {
    it('should set grudge key for 7 days and emit event', async () => {
      const result = await service.declareGrudge('1001', '1002');

      expect(cacheService.set).toHaveBeenCalledWith(
        'grudge:1001:1002',
        '1',
        604800,
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.GRUDGE_DECLARED,
        expect.objectContaining({ playerId: '1001', targetId: '1002' }),
      );
      expect(result).toMatchObject({ playerId: '1001', targetId: '1002' });
    });
  });

  describe('createBattleReport', () => {
    it('should build report with winner as attacker on win', async () => {
      combatLogRepo.findOne.mockResolvedValue({
        id: '7',
        attackerId: '1001',
        defenderId: '1002',
        result: CombatResult.WIN,
        damageJson: { finalDamage: 90 },
        rewardJson: { gold: 10 },
        createdAt: new Date(),
      } as CombatLog);

      const report = await service.createBattleReport('7');

      expect(report).toMatchObject({
        combatLogId: '7',
        winnerId: '1001',
        loserId: '1002',
        damageJson: { finalDamage: 90 },
        rewardJson: { gold: 10 },
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.BATTLE_REPORTED,
        expect.objectContaining({ combatLogId: '7' }),
      );
    });

    it('should build report with winner as defender on lose', async () => {
      combatLogRepo.findOne.mockResolvedValue({
        id: '7',
        attackerId: '1001',
        defenderId: '1002',
        result: CombatResult.LOSE,
        damageJson: {},
        rewardJson: {},
        createdAt: new Date(),
      } as CombatLog);

      const report = await service.createBattleReport('7');

      expect(report.winnerId).toBe('1002');
      expect(report.loserId).toBe('1001');
    });
  });

  describe('applyDefeatBuff / getActiveBuffs', () => {
    it('should mark recovery buff for 1 hour', async () => {
      await service.applyDefeatBuff('1001');

      expect(cacheService.set).toHaveBeenCalledWith(
        'buff:recovery:1001',
        '1',
        3600,
      );
    });

    it('should return active buff flags', async () => {
      cacheService.get.mockImplementation(async (key: string) =>
        key === 'buff:recovery:1001' ? '1' : null,
      );

      const result = await service.getActiveBuffs('1001');

      expect(result).toEqual({ recovery: true, shameWindow: false });
    });
  });
});
