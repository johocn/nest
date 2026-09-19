import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ArbitrationService } from './arbitration.service';
import { CombatArbitration } from './entities';
import { CharacterService } from '@modules/character/character.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import {
  ArbitrationStatus,
  RelationshipLevel,
} from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import type { Repository } from 'typeorm';

describe('ArbitrationService', () => {
  let service: ArbitrationService;
  let arbitrationRepo: jest.Mocked<Repository<CombatArbitration>>;
  let characterService: jest.Mocked<CharacterService>;
  let cacheService: jest.Mocked<CacheService>;
  let eventBus: jest.Mocked<EventBusService>;

  const pendingRecord = {
    id: '5',
    combatLogId: '7',
    arbitratorId: '1003',
    partiesJson: { partyA: '1001', partyB: '1002' },
    claimsJson: { reason: 'damage' },
    status: ArbitrationStatus.PENDING,
    successRate: 0,
    result: null,
  } as CombatArbitration;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArbitrationService,
        {
          provide: getRepositoryToken(CombatArbitration),
          useValue: {
            create: jest.fn((data: any) => ({ ...data, id: '5' })),
            save: jest.fn((data: any) => ({ ...data, id: '5' })),
            findOne: jest.fn(),
          },
        },
        {
          provide: CharacterService,
          useValue: {
            getRelationshipLevel: jest
              .fn()
              .mockResolvedValue(RelationshipLevel.CONFIDANT),
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

    service = module.get(ArbitrationService);
    arbitrationRepo = module.get(getRepositoryToken(CombatArbitration));
    characterService = module.get(CharacterService);
    cacheService = module.get(CacheService);
    eventBus = module.get(EventBusService);
  });

  describe('startArbitration', () => {
    it('should reject arbitrator who is a party', async () => {
      await expect(
        service.startArbitration('1001', '7', {
          partyA: '1001',
          partyB: '1002',
        }, { reason: 'damage' }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.ARBITRATION_NOT_READY },
      });
    });

    it('should reject duplicate pending arbitration for same combat log', async () => {
      arbitrationRepo.findOne.mockResolvedValue(pendingRecord);

      await expect(
        service.startArbitration('1003', '7', {
          partyA: '1001',
          partyB: '1002',
        }, { reason: 'damage' }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.ARBITRATION_EXISTS },
      });
    });

    it('should create pending arbitration when valid', async () => {
      arbitrationRepo.findOne.mockResolvedValue(null);

      const result = await service.startArbitration('1003', '7', {
        partyA: '1001',
        partyB: '1002',
      }, { reason: 'damage' });

      expect(arbitrationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          combatLogId: '7',
          arbitratorId: '1003',
          status: ArbitrationStatus.PENDING,
        }),
      );
      expect(result.status).toBe(ArbitrationStatus.PENDING);
    });
  });

  describe('resolveArbitration', () => {
    it('should succeed and boost favorability when successRate >= 50', async () => {
      arbitrationRepo.findOne.mockResolvedValue({ ...pendingRecord });
      characterService.getRelationshipLevel.mockResolvedValue(
        RelationshipLevel.SWORN,
      ); // avg level 3 -> rate 80

      const result = await service.resolveArbitration('5', '和解');

      expect(result.status).toBe(ArbitrationStatus.SUCCESS);
      expect(result.successRate).toBe(80);
      expect(result.result).toBe('和解');
      expect(characterService.increaseFavorability).toHaveBeenCalledWith(
        '1001',
        '1002',
        10,
      );
      expect(characterService.increaseFavorability).toHaveBeenCalledWith(
        '1002',
        '1001',
        10,
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.ARBITRATION_SETTLED,
        expect.objectContaining({ arbitrationId: '5', status: 'success' }),
      );
    });

    it('should fail and grant grudges when successRate < 50', async () => {
      arbitrationRepo.findOne.mockResolvedValue({ ...pendingRecord });
      characterService.getRelationshipLevel.mockResolvedValue(
        RelationshipLevel.HOSTILE,
      ); // avg -2 -> rate 30

      const result = await service.resolveArbitration('5', '拒绝');

      expect(result.status).toBe(ArbitrationStatus.FAIL);
      expect(cacheService.set).toHaveBeenCalledWith(
        'grudge:1001:1002',
        '1',
        604800,
      );
      expect(cacheService.set).toHaveBeenCalledWith(
        'grudge:1002:1001',
        '1',
        604800,
      );
    });

    it('should throw ARBITRATION_NOT_READY when record missing', async () => {
      arbitrationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.resolveArbitration('99', 'x'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.ARBITRATION_NOT_READY },
      });
    });
  });

  describe('getArbitration', () => {
    it('should return arbitration record', async () => {
      arbitrationRepo.findOne.mockResolvedValue(pendingRecord);

      const result = await service.getArbitration('5');

      expect(result).toMatchObject({ id: '5' });
    });
  });
});
