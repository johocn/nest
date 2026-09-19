import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FormationService } from './formation.service';
import { Formation, FormationBinding } from './entities';
import { CharacterService } from '@modules/character/character.service';
import { SocialService } from '@modules/social/social.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import {
  FormationType,
  RelationshipLevel,
  KinshipType,
} from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';
import type { Repository } from 'typeorm';

describe('FormationService', () => {
  let service: FormationService;
  let formationRepo: jest.Mocked<Repository<Formation>>;
  let bindingRepo: jest.Mocked<Repository<FormationBinding>>;
  let characterService: jest.Mocked<CharacterService>;
  let socialService: jest.Mocked<SocialService>;
  let cacheService: jest.Mocked<CacheService>;
  let eventBus: jest.Mocked<EventBusService>;

  const beidouTemplate: Partial<Formation> = {
    id: '1',
    name: '北斗七星阵',
    type: FormationType.BEIDOU,
    maxMembers: 7,
    baseBonus: { attack: 20, defense: 20, heal: 20 },
    counterType: FormationType.FIVE_ELEMENTS,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormationService,
        {
          provide: getRepositoryToken(Formation),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn((data: any) => data),
            save: jest.fn((data: any) => ({ ...data, id: '1' })),
            count: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(FormationBinding),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn((data: any) => data),
            save: jest.fn((data: any) => ({ ...data, id: '9' })),
            delete: jest.fn(),
            count: jest.fn(),
          },
        },
        {
          provide: CharacterService,
          useValue: {
            getRelationshipLevel: jest.fn(),
          },
        },
        {
          provide: SocialService,
          useValue: {
            getKinships: jest.fn().mockResolvedValue([]),
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
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(FormationService);
    formationRepo = module.get(getRepositoryToken(Formation));
    bindingRepo = module.get(getRepositoryToken(FormationBinding));
    characterService = module.get(CharacterService);
    socialService = module.get(SocialService);
    cacheService = module.get(CacheService);
    eventBus = module.get(EventBusService);
  });

  describe('seedFormations', () => {
    it('should seed 3 templates when table is empty', async () => {
      formationRepo.findOne.mockResolvedValue(null);

      await service.seedFormations();

      expect(formationRepo.save).toHaveBeenCalledTimes(3);
    });

    it('should be idempotent when templates already exist', async () => {
      formationRepo.findOne.mockResolvedValue(beidouTemplate as Formation);

      await service.seedFormations();

      expect(formationRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('createFormation', () => {
    it('should create formation with leader at position 0', async () => {
      formationRepo.findOne.mockResolvedValue(beidouTemplate as Formation);
      bindingRepo.findOne.mockResolvedValue(null);

      const result = await service.createFormation('1001', 'beidou');

      expect(bindingRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          formationId: '1',
          leaderId: '1001',
          playerId: '1001',
          position: 0,
        }),
      );
      expect(result.formationId).toBe('1');
    });

    it('should throw FORMATION_NOT_FOUND when template missing', async () => {
      formationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createFormation('1001', '999'),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.FORMATION_NOT_FOUND } });
    });

    it('should throw PARAM_INVALID for illegal formationId', async () => {
      await expect(
        service.createFormation('1001', 'bad!!'),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.PARAM_INVALID } });
    });

    it('should throw FORMATION_ACTIVE when leader already in another formation', async () => {
      formationRepo.findOne.mockResolvedValue(beidouTemplate as Formation);
      bindingRepo.findOne.mockResolvedValue({
        id: '5',
        formationId: '2',
        leaderId: '1001',
        playerId: '1001',
        position: 0,
        joinedAt: new Date(),
      } as FormationBinding);

      await expect(
        service.createFormation('1001', 'beidou'),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.FORMATION_ACTIVE } });
    });
  });

  describe('joinFormation', () => {
    it('should throw FORMATION_MEMBER_LIMIT when full', async () => {
      formationRepo.findOne.mockResolvedValue(beidouTemplate as Formation);
      bindingRepo.findOne.mockResolvedValue(null);
      bindingRepo.count.mockResolvedValue(7);

      await expect(
        service.joinFormation('1002', '1', 1),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.FORMATION_MEMBER_LIMIT } });
    });

    it('should throw FORMATION_POSITION_TAKEN when position occupied', async () => {
      formationRepo.findOne.mockResolvedValue(beidouTemplate as Formation);
      bindingRepo.findOne.mockResolvedValueOnce(null); // player not elsewhere
      bindingRepo.findOne.mockResolvedValueOnce({
        id: '6',
        formationId: '1',
        leaderId: '1001',
        playerId: '1003',
        position: 1,
        joinedAt: new Date(),
      } as FormationBinding);
      bindingRepo.count.mockResolvedValue(2);

      await expect(
        service.joinFormation('1002', '1', 1),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.FORMATION_POSITION_TAKEN } });
    });

    it('should throw FORMATION_ACTIVE when player already in another formation', async () => {
      formationRepo.findOne.mockResolvedValue(beidouTemplate as Formation);
      bindingRepo.findOne.mockResolvedValue({
        id: '5',
        formationId: '2',
        leaderId: '1004',
        playerId: '1002',
        position: 1,
        joinedAt: new Date(),
      } as FormationBinding);

      await expect(
        service.joinFormation('1002', '1', 1),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.FORMATION_ACTIVE } });
    });

    it('should bind player when valid', async () => {
      formationRepo.findOne.mockResolvedValue(beidouTemplate as Formation);
      bindingRepo.findOne
        .mockResolvedValueOnce(null) // player elsewhere
        .mockResolvedValueOnce(null) // position taken
        .mockResolvedValueOnce({
          id: '5',
          formationId: '1',
          leaderId: '1001',
          playerId: '1001',
          position: 0,
          joinedAt: new Date(),
        } as FormationBinding); // leader binding
      bindingRepo.count.mockResolvedValue(1);

      const result = await service.joinFormation('1002', '1', 2);

      expect(bindingRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          formationId: '1',
          leaderId: '1001',
          playerId: '1002',
          position: 2,
        }),
      );
      expect(result.playerId).toBe('1002');
    });
  });

  describe('leaveFormation', () => {
    it('should remove binding for player', async () => {
      await service.leaveFormation('1002', '1');

      expect(bindingRepo.delete).toHaveBeenCalledWith({
        formationId: '1',
        playerId: '1002',
      });
    });
  });

  describe('activateFormation', () => {
    it('should reject non-leader', async () => {
      bindingRepo.findOne.mockResolvedValue({
        id: '5',
        formationId: '1',
        leaderId: '1001',
        playerId: '1002',
        position: 1,
        joinedAt: new Date(),
      } as FormationBinding);

      await expect(
        service.activateFormation('1002', '1'),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.PARAM_INVALID } });
    });

    it('should reject when not full', async () => {
      bindingRepo.findOne.mockResolvedValue({
        id: '5',
        formationId: '1',
        leaderId: '1001',
        playerId: '1001',
        position: 0,
        joinedAt: new Date(),
      } as FormationBinding);
      bindingRepo.count.mockResolvedValue(3);
      formationRepo.findOne.mockResolvedValue(beidouTemplate as Formation);

      await expect(
        service.activateFormation('1001', '1'),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.FORMATION_MEMBER_LIMIT } });
    });

    it('should mark active and emit event when full', async () => {
      bindingRepo.findOne.mockResolvedValue({
        id: '5',
        formationId: '1',
        leaderId: '1001',
        playerId: '1001',
        position: 0,
        joinedAt: new Date(),
      } as FormationBinding);
      bindingRepo.count.mockResolvedValue(7);
      formationRepo.findOne.mockResolvedValue(beidouTemplate as Formation);

      await service.activateFormation('1001', '1');

      expect(cacheService.set).toHaveBeenCalledWith(
        'formation:active:1',
        '1',
        86400,
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.FORMATION_ACTIVATED,
        expect.objectContaining({ formationId: '1', leaderId: '1001' }),
      );
    });
  });

  describe('getFormationBonus', () => {
    it('should apply highest tacit level from relationship level', async () => {
      formationRepo.findOne.mockResolvedValue({
        id: '1',
        name: '三才阵',
        type: FormationType.THREE_TALENTS,
        maxMembers: 3,
        baseBonus: { attack: 10, defense: 10, heal: 10 },
        counterType: FormationType.BEIDOU,
      } as Formation);
      bindingRepo.findOne.mockResolvedValue({
        id: '5',
        formationId: '1',
        leaderId: '1001',
        playerId: '1001',
        position: 0,
        joinedAt: new Date(),
      } as FormationBinding);
      bindingRepo.find.mockResolvedValue([
        {
          id: '6',
          formationId: '1',
          leaderId: '1001',
          playerId: '1002',
          position: 1,
          joinedAt: new Date(),
        },
        {
          id: '7',
          formationId: '1',
          leaderId: '1001',
          playerId: '1003',
          position: 2,
          joinedAt: new Date(),
        },
      ] as FormationBinding[]);
      characterService.getRelationshipLevel
        .mockResolvedValueOnce(RelationshipLevel.FRIEND) // 1001->1002
        .mockResolvedValueOnce(RelationshipLevel.SWORN); // 1001->1003
      socialService.getKinships.mockResolvedValue([]);

      const bonus = await service.getFormationBonus('1');

      expect(bonus).toEqual({ attack: 12, defense: 12, heal: 12 }); // 10 * (1 + 20/100)
    });

    it('should add extra 5% when member shares sworn/couple kinship', async () => {
      formationRepo.findOne.mockResolvedValue({
        id: '1',
        name: '三才阵',
        type: FormationType.THREE_TALENTS,
        maxMembers: 3,
        baseBonus: { attack: 10, defense: 10, heal: 10 },
        counterType: FormationType.BEIDOU,
      } as Formation);
      bindingRepo.findOne.mockResolvedValue({
        id: '5',
        formationId: '1',
        leaderId: '1001',
        playerId: '1001',
        position: 0,
        joinedAt: new Date(),
      } as FormationBinding);
      bindingRepo.find.mockResolvedValue([
        {
          id: '6',
          formationId: '1',
          leaderId: '1001',
          playerId: '1002',
          position: 1,
          joinedAt: new Date(),
        },
      ] as FormationBinding[]);
      characterService.getRelationshipLevel.mockResolvedValue(
        RelationshipLevel.SWORN,
      );
      socialService.getKinships.mockResolvedValue([
        {
          id: '11',
          type: KinshipType.SWORN,
          members: ['1001', '1002'],
          status: 'active',
          createdAt: new Date(),
        },
      ] as any);

      const bonus = await service.getFormationBonus('1');

      expect(bonus).toEqual({ attack: 13, defense: 13, heal: 13 }); // 10 * (1 + (20+5)/100) rounded
    });
  });

  describe('checkCounter', () => {
    it('should return countered bonus when attacker formation counters defender', async () => {
      bindingRepo.findOne
        .mockResolvedValueOnce({
          id: '5',
          formationId: '1',
          leaderId: '1001',
          playerId: '1001',
          position: 0,
          joinedAt: new Date(),
        } as FormationBinding)
        .mockResolvedValueOnce({
          id: '6',
          formationId: '2',
          leaderId: '2001',
          playerId: '2001',
          position: 0,
          joinedAt: new Date(),
        } as FormationBinding);
      formationRepo.findOne
        .mockResolvedValueOnce(beidouTemplate as Formation)
        .mockResolvedValueOnce({
          id: '2',
          name: '五行阵',
          type: FormationType.FIVE_ELEMENTS,
          maxMembers: 5,
          baseBonus: { attack: 15, defense: 15, heal: 15 },
          counterType: FormationType.THREE_TALENTS,
        } as Formation);

      const result = await service.checkCounter('1001', '2001');

      expect(result).toEqual({ countered: true, bonus: 10 });
    });

    it('should return no bonus when no counter relation', async () => {
      bindingRepo.findOne
        .mockResolvedValueOnce({
          id: '5',
          formationId: '1',
          leaderId: '1001',
          playerId: '1001',
          position: 0,
          joinedAt: new Date(),
        } as FormationBinding)
        .mockResolvedValueOnce(null);
      formationRepo.findOne.mockResolvedValueOnce(
        beidouTemplate as Formation,
      );

      const result = await service.checkCounter('1001', '2001');

      expect(result).toEqual({ countered: false, bonus: 0 });
    });
  });

  describe('getFormation', () => {
    it('should return members and template info', async () => {
      formationRepo.findOne.mockResolvedValue(beidouTemplate as Formation);
      bindingRepo.find.mockResolvedValue([
        {
          id: '5',
          formationId: '1',
          leaderId: '1001',
          playerId: '1001',
          position: 0,
          joinedAt: new Date(),
        },
      ] as FormationBinding[]);

      const result = await service.getFormation('1');

      expect(result.members).toHaveLength(1);
      expect(result.template.maxMembers).toBe(7);
    });
  });
});
