import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LootService } from './loot.service';
import { CombatLootLog, CombatLog } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { LootDistributionMode } from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import type { Repository } from 'typeorm';

describe('LootService', () => {
  let service: LootService;
  let lootLogRepo: jest.Mocked<Repository<CombatLootLog>>;
  let combatLogRepo: jest.Mocked<Repository<CombatLog>>;
  let eventBus: jest.Mocked<EventBusService>;
  let random: jest.Mock;

  const baseLog = {
    id: '7',
    attackerId: '1',
    defenderId: '2',
    damageJson: {},
    rewardJson: {},
  } as CombatLog;

  beforeEach(async () => {
    random = jest.fn().mockReturnValue(0.5);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LootService,
        {
          provide: getRepositoryToken(CombatLootLog),
          useValue: {
            create: jest.fn((data: any) => ({ ...data, id: '9' })),
            save: jest.fn((data: any) => ({ ...data, id: '9' })),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(CombatLog),
          useValue: {
            findOne: jest.fn().mockResolvedValue(baseLog),
          },
        },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
        { provide: Function, useValue: random },
      ],
    }).compile();

    service = module.get(LootService);
    lootLogRepo = module.get(getRepositoryToken(CombatLootLog));
    combatLogRepo = module.get(getRepositoryToken(CombatLog));
    eventBus = module.get(EventBusService);
  });

  describe('distributeLoot', () => {
    it('should throw LOOT_NOT_FOUND when combat log missing', async () => {
      combatLogRepo.findOne.mockResolvedValue(null);

      await expect(
        service.distributeLoot('1001', '7', LootDistributionMode.EQUAL, {
          items: [{ itemId: 'i1', quantity: 1 }],
        }),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.LOOT_NOT_FOUND } });
    });

    it('contribution mode splits by damageJson ratio', async () => {
      combatLogRepo.findOne.mockResolvedValue({
        ...baseLog,
        damageJson: {
          contribution: [
            { playerId: '1', ratio: 0.7 },
            { playerId: '2', ratio: 0.3 },
          ],
        },
      } as CombatLog);

      const result = await service.distributeLoot(
        '1001',
        '7',
        LootDistributionMode.CONTRIBUTION,
        {
          items: [
            { itemId: 'i1', quantity: 1 },
            { itemId: 'i2', quantity: 1 },
          ],
        },
      );

      expect(result.playersJson).toEqual([
        { playerId: '1', ratio: 0.7, amount: 1 },
        { playerId: '2', ratio: 0.3, amount: 1 },
      ]);
    });

    it('contribution mode falls back to equal without contribution detail', async () => {
      const result = await service.distributeLoot(
        '1001',
        '7',
        LootDistributionMode.CONTRIBUTION,
        {
          players: ['1', '2'],
          items: [
            { itemId: 'i1', quantity: 1 },
            { itemId: 'i2', quantity: 1 },
          ],
        },
      );

      expect(result.playersJson).toEqual([
        { playerId: '1', ratio: 0.5, amount: 1 },
        { playerId: '2', ratio: 0.5, amount: 1 },
      ]);
    });

    it('roll mode gives all items to highest roll', async () => {
      random.mockReturnValueOnce(0.9).mockReturnValueOnce(0.1);

      const result = await service.distributeLoot(
        '1001',
        '7',
        LootDistributionMode.ROLL,
        { players: ['1', '2'], items: [{ itemId: 'i1', quantity: 1 }] },
      );

      expect(result.playersJson).toEqual([
        { playerId: '1', points: 90, amount: 1 },
        { playerId: '2', points: 10, amount: 0 },
      ]);
    });

    it('captain mode gives all items to winnerId', async () => {
      const result = await service.distributeLoot(
        '1001',
        '7',
        LootDistributionMode.CAPTAIN,
        { winnerId: '2', items: [{ itemId: 'i1', quantity: 1 }] },
      );

      expect(result.playersJson).toEqual([
        { playerId: '2', ratio: 1, amount: 1 },
      ]);
    });

    it('captain mode rejects missing winnerId', async () => {
      await expect(
        service.distributeLoot('1001', '7', LootDistributionMode.CAPTAIN, {
          items: [{ itemId: 'i1', quantity: 1 }],
        }),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.PARAM_INVALID } });
    });

    it('equal mode splits items evenly among players', async () => {
      const result = await service.distributeLoot(
        '1001',
        '7',
        LootDistributionMode.EQUAL,
        {
          players: ['1', '2'],
          items: [
            { itemId: 'i1', quantity: 1 },
            { itemId: 'i2', quantity: 1 },
            { itemId: 'i3', quantity: 1 },
          ],
        },
      );

      expect(result.playersJson).toEqual([
        { playerId: '1', ratio: 0.5, amount: 1 },
        { playerId: '2', ratio: 0.5, amount: 1 },
      ]);
    });

    it('should save loot log and emit LOOT_DISTRIBUTED', async () => {
      const result = await service.distributeLoot(
        '1001',
        '7',
        LootDistributionMode.EQUAL,
        {
          players: ['1', '2'],
          items: [
            { itemId: 'i1', quantity: 1 },
            { itemId: 'i2', quantity: 1 },
          ],
        },
      );

      expect(lootLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          combatLogId: '7',
          distributorId: '1001',
          mode: LootDistributionMode.EQUAL,
        }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.LOOT_DISTRIBUTED,
        expect.objectContaining({ combatLogId: '7' }),
      );
      expect(result.id).toBe('9');
    });
  });

  describe('getLootLog', () => {
    it('should find loot log by combat log id', async () => {
      lootLogRepo.findOne.mockResolvedValue({ id: '9' } as CombatLootLog);

      const result = await service.getLootLog('7');

      expect(lootLogRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { combatLogId: '7' } }),
      );
      expect(result).toMatchObject({ id: '9' });
    });
  });
});
