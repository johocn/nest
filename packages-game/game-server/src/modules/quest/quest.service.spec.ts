import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QuestService } from './quest.service';
import {
  QuestTemplate,
  PlayerQuest,
  QuestHelpRequest,
} from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  QuestType,
  QuestStatus,
  QuestHelpStatus,
  CurrencyType,
  IntelligenceGrade,
  RelationshipLevel,
  GuildRole,
} from '@constants/enums';
import { CharacterService } from '@modules/character/character.service';
import { SocialService } from '@modules/social/social.service';
import { EconomyService } from '@modules/economy/economy.service';
import { CacheService } from '@cache/cache.service';
import type { Repository } from 'typeorm';

describe('QuestService', () => {
  let service: QuestService;
  let questTemplateRepo: jest.Mocked<Repository<QuestTemplate>>;
  let playerQuestRepo: jest.Mocked<Repository<PlayerQuest>>;
  let questHelpRepo: jest.Mocked<Repository<QuestHelpRequest>>;
  let eventBus: jest.Mocked<EventBusService>;
  let characterService: jest.Mocked<CharacterService>;
  let socialService: jest.Mocked<SocialService>;
  let economyService: jest.Mocked<EconomyService>;
  let cacheService: jest.Mocked<CacheService>;

  beforeEach(async () => {
    characterService = {
      getRelationships: jest.fn().mockResolvedValue([]),
      getRelationshipLevel: jest.fn(),
    } as unknown as jest.Mocked<CharacterService>;
    socialService = {
      getIntelligences: jest.fn().mockResolvedValue([]),
      getFriendList: jest.fn().mockResolvedValue([]),
      getMyGuildRole: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<SocialService>;
    economyService = {
      addCurrency: jest
        .fn()
        .mockResolvedValue({ balanceAfter: '100' }),
    } as unknown as jest.Mocked<EconomyService>;
    cacheService = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<CacheService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestService,
        {
          provide: getRepositoryToken(QuestTemplate),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            findAndCount: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(PlayerQuest),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            findAndCount: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(QuestHelpRequest),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
          },
        },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
        { provide: CharacterService, useValue: characterService },
        { provide: SocialService, useValue: socialService },
        { provide: EconomyService, useValue: economyService },
        { provide: CacheService, useValue: cacheService },
      ],
    }).compile();

    service = module.get(QuestService);
    questTemplateRepo = module.get(getRepositoryToken(QuestTemplate));
    playerQuestRepo = module.get(getRepositoryToken(PlayerQuest));
    questHelpRepo = module.get(getRepositoryToken(QuestHelpRequest));
    eventBus = module.get(EventBusService);
    cacheService = module.get(CacheService);
  });

  const makeTemplate = (
    overrides: Partial<QuestTemplate> = {},
  ): QuestTemplate =>
    ({
      id: '1',
      name: '初入江湖',
      questType: QuestType.MAIN,
      minLevel: 1,
      acceptLimit: 1,
      autoReward: false,
      targetJson: { kill_count: 10 },
      rewardJson: { exp: 100, gold: 50 },
      prerequisiteIds: [],
      targetType: null,
      prerequisiteSocial: null,
      rewardSocial: null,
      repeatable: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as QuestTemplate;

  const makePlayerQuest = (overrides: Partial<PlayerQuest> = {}): PlayerQuest =>
    ({
      id: '1',
      playerId: 'p1',
      questTemplateId: '1',
      progress: 10,
      status: QuestStatus.IN_PROGRESS,
      completeTimes: 0,
      acceptedAt: new Date(),
      completedAt: null,
      createdAt: new Date(),
      ...overrides,
    }) as PlayerQuest;

  const makeHelpRequest = (
    overrides: Partial<QuestHelpRequest> = {},
  ): QuestHelpRequest =>
    ({
      id: '1',
      playerId: 'p1',
      questTemplateId: '1',
      helperId: null,
      status: QuestHelpStatus.OPEN,
      helpedAt: null,
      createdAt: new Date(),
      ...overrides,
    }) as QuestHelpRequest;

  describe('acceptQuest', () => {
    it('should create PlayerQuest when requirements met', async () => {
      questTemplateRepo.findOne.mockResolvedValue(makeTemplate());
      playerQuestRepo.findOne.mockResolvedValue(null);

      const result = await service.acceptQuest('p1', '1', 5);

      expect(result.status).toBe(QuestStatus.IN_PROGRESS);
      expect(playerQuestRepo.save).toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        'quest.accepted',
        expect.any(Object),
      );
    });

    it('should throw when quest template not found', async () => {
      questTemplateRepo.findOne.mockResolvedValue(null);

      await expect(service.acceptQuest('p1', '999', 5)).rejects.toThrow(
        GameException,
      );
    });

    it('should throw when player level too low', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ minLevel: 10 }),
      );

      await expect(service.acceptQuest('p1', '1', 5)).rejects.toThrow(
        GameException,
      );
    });

    it('should throw when quest already accepted and not repeatable', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ repeatable: false }),
      );
      playerQuestRepo.findOne.mockResolvedValue(makePlayerQuest());

      await expect(service.acceptQuest('p1', '1', 5)).rejects.toThrow(
        GameException,
      );
    });

    it('should reject when intelGrade prerequisite not met', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ prerequisiteSocial: { intelGrade: 'A' } }),
      );
      socialService.getIntelligences.mockResolvedValue([
        { grade: IntelligenceGrade.C } as any,
      ]);

      await expect(service.acceptQuest('p1', '1', 5)).rejects.toMatchObject({
        response: { code: ErrorCodes.QUEST_SOCIAL_PRE_REQ },
      });
    });

    it('should accept when intelGrade prerequisite met', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ prerequisiteSocial: { intelGrade: 'B' } }),
      );
      socialService.getIntelligences.mockResolvedValue([
        { grade: IntelligenceGrade.C } as any,
        { grade: IntelligenceGrade.A } as any,
      ]);
      playerQuestRepo.findOne.mockResolvedValue(null);

      const result = await service.acceptQuest('p1', '1', 5);
      expect(result.status).toBe(QuestStatus.IN_PROGRESS);
    });

    it('should reject when intelCount prerequisite not met', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ prerequisiteSocial: { intelCount: 3 } }),
      );
      socialService.getIntelligences.mockResolvedValue([
        { grade: IntelligenceGrade.D } as any,
      ]);

      await expect(service.acceptQuest('p1', '1', 5)).rejects.toMatchObject({
        response: { code: ErrorCodes.QUEST_SOCIAL_PRE_REQ },
      });
    });

    it('should accept when intelCount prerequisite met', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ prerequisiteSocial: { intelCount: 2 } }),
      );
      socialService.getIntelligences.mockResolvedValue([
        { grade: IntelligenceGrade.D } as any,
        { grade: IntelligenceGrade.C } as any,
      ]);
      playerQuestRepo.findOne.mockResolvedValue(null);

      const result = await service.acceptQuest('p1', '1', 5);
      expect(result.status).toBe(QuestStatus.IN_PROGRESS);
    });

    it('should reject when favorLevel prerequisite not met', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ prerequisiteSocial: { favorLevel: 'confidant' } }),
      );
      characterService.getRelationships.mockResolvedValue([
        { level: RelationshipLevel.ACQUAINTANCE, favorability: 80 } as any,
      ]);

      await expect(service.acceptQuest('p1', '1', 5)).rejects.toMatchObject({
        response: { code: ErrorCodes.QUEST_SOCIAL_PRE_REQ },
      });
    });

    it('should accept when favorLevel met via level field', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ prerequisiteSocial: { favorLevel: 'friend' } }),
      );
      characterService.getRelationships.mockResolvedValue([
        { level: RelationshipLevel.SWORN, favorability: 600 } as any,
      ]);
      playerQuestRepo.findOne.mockResolvedValue(null);

      const result = await service.acceptQuest('p1', '1', 5);
      expect(result.status).toBe(QuestStatus.IN_PROGRESS);
    });

    it('should estimate favorLevel from favorability when level is null', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ prerequisiteSocial: { favorLevel: 'friend' } }),
      );
      characterService.getRelationships.mockResolvedValue([
        { level: null, favorability: 400 } as any,
      ]);
      playerQuestRepo.findOne.mockResolvedValue(null);

      const result = await service.acceptQuest('p1', '1', 5);
      expect(result.status).toBe(QuestStatus.IN_PROGRESS);
    });

    it('should reject when guildRole prerequisite not met', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ prerequisiteSocial: { guildRole: 'leader' } }),
      );
      socialService.getMyGuildRole.mockResolvedValue({
        guildId: 'g1',
        role: GuildRole.MEMBER,
      });

      await expect(service.acceptQuest('p1', '1', 5)).rejects.toMatchObject({
        response: { code: ErrorCodes.QUEST_SOCIAL_PRE_REQ },
      });
    });

    it('should accept when guildRole prerequisite met', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ prerequisiteSocial: { guildRole: 'vice_leader' } }),
      );
      socialService.getMyGuildRole.mockResolvedValue({
        guildId: 'g1',
        role: GuildRole.LEADER,
      });
      playerQuestRepo.findOne.mockResolvedValue(null);

      const result = await service.acceptQuest('p1', '1', 5);
      expect(result.status).toBe(QuestStatus.IN_PROGRESS);
    });

    it('should reject when friendCount prerequisite not met', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ prerequisiteSocial: { friendCount: 3 } }),
      );
      socialService.getFriendList.mockResolvedValue([{}, {}] as any[]);

      await expect(service.acceptQuest('p1', '1', 5)).rejects.toMatchObject({
        response: { code: ErrorCodes.QUEST_SOCIAL_PRE_REQ },
      });
    });

    it('should accept when friendCount prerequisite met', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ prerequisiteSocial: { friendCount: 2 } }),
      );
      socialService.getFriendList.mockResolvedValue([{}, {}] as any[]);
      playerQuestRepo.findOne.mockResolvedValue(null);

      const result = await service.acceptQuest('p1', '1', 5);
      expect(result.status).toBe(QuestStatus.IN_PROGRESS);
    });
  });

  describe('submitQuest', () => {
    it('should complete quest and return rewards', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ autoReward: true }),
      );
      playerQuestRepo.findOne.mockResolvedValue(
        makePlayerQuest({ progress: 10, status: QuestStatus.IN_PROGRESS }),
      );

      const result = await service.submitQuest('p1', '1');

      expect(result.reward).toEqual({ exp: 100, gold: 50 });
      expect(playerQuestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: QuestStatus.CLAIMED,
          completeTimes: 1,
        }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'quest.completed',
        expect.any(Object),
      );
    });

    it('should throw when quest not in progress', async () => {
      playerQuestRepo.findOne.mockResolvedValue(
        makePlayerQuest({ status: QuestStatus.CLAIMED }),
      );

      await expect(service.submitQuest('p1', '1')).rejects.toThrow(
        GameException,
      );
    });

    it('should grant social currency when rewardSocial present', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({
          rewardSocial: { currencyType: 'favor', amount: 10 },
        }),
      );
      playerQuestRepo.findOne.mockResolvedValue(
        makePlayerQuest({ progress: 10, status: QuestStatus.IN_PROGRESS }),
      );

      const result = await service.submitQuest('p1', '1');

      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.FAVOR,
        10,
        'quest_reward',
        'quest.submitQuest',
      );
      expect(result.socialReward).toBeDefined();
      expect(result.socialReward['favor']).toEqual({
        amount: 10,
        balanceAfter: '100',
      });
    });

    it('should not grant social currency when rewardSocial absent', async () => {
      questTemplateRepo.findOne.mockResolvedValue(makeTemplate());
      playerQuestRepo.findOne.mockResolvedValue(
        makePlayerQuest({ progress: 10, status: QuestStatus.IN_PROGRESS }),
      );

      await service.submitQuest('p1', '1');

      expect(economyService.addCurrency).not.toHaveBeenCalled();
    });
  });

  describe('listPlayerQuests', () => {
    it('should return player quests with template info', async () => {
      playerQuestRepo.find.mockResolvedValue([makePlayerQuest()]);
      questTemplateRepo.findOne.mockResolvedValue(makeTemplate());

      const result = await service.listPlayerQuests('p1');

      expect(result).toHaveLength(1);
      expect(result[0].template.name).toBe('初入江湖');
    });

    it('should return empty array when no quests', async () => {
      playerQuestRepo.find.mockResolvedValue([]);

      const result = await service.listPlayerQuests('p1');

      expect(result).toEqual([]);
    });
  });

  describe('updateProgress', () => {
    it('should update progress and mark completed when target reached', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ targetJson: { kill_count: 10 } }),
      );
      playerQuestRepo.findOne.mockResolvedValue(
        makePlayerQuest({ progress: 5, status: QuestStatus.IN_PROGRESS }),
      );

      const result = await service.updateProgress('p1', '1', 10);

      expect(result.progress).toBe(10);
      expect(result.status).toBe(QuestStatus.COMPLETED);
    });
  });

  describe('updateProgressByKill', () => {
    it('should increment progress for quests matching monster', async () => {
      playerQuestRepo.find.mockResolvedValue([
        makePlayerQuest({ id: 'pq1', questTemplateId: 'q1', progress: 2 }),
      ]);
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({
          id: 'q1',
          targetJson: { monsterId: 'm1', kill_count: 5 },
        }),
      );

      await service.updateProgressByKill('p1', 'm1');

      expect(playerQuestRepo.save).toHaveBeenCalled();
      const saved = (playerQuestRepo.save as jest.Mock).mock.calls[0][0];
      expect(saved.progress).toBe(3);
    });

    it('should do nothing when no matching quests', async () => {
      playerQuestRepo.find.mockResolvedValue([
        makePlayerQuest({ id: 'pq1', questTemplateId: 'q1', progress: 0 }),
      ]);
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({
          id: 'q1',
          targetJson: { monsterId: 'm2', kill_count: 5 },
        }),
      );

      await service.updateProgressByKill('p1', 'm1');

      expect(playerQuestRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('advanceSocialTarget', () => {
    it('should increment progress and complete quest when target reached', async () => {
      playerQuestRepo.find.mockResolvedValue([
        makePlayerQuest({
          id: 'pq1',
          questTemplateId: 'q1',
          progress: 1,
          status: QuestStatus.IN_PROGRESS,
        }),
      ]);
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({
          id: 'q1',
          targetType: 'send_gift',
          targetJson: { count: 2 },
        }),
      );

      await service.advanceSocialTarget('p1', 'send_gift' as any);

      const saved = (playerQuestRepo.save as jest.Mock).mock.calls[0][0];
      expect(saved.progress).toBe(2);
      expect(saved.status).toBe(QuestStatus.COMPLETED);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'quest.completed',
        expect.any(Object),
      );
    });

    it('should do nothing silently when no matching quests', async () => {
      playerQuestRepo.find.mockResolvedValue([
        makePlayerQuest({
          id: 'pq1',
          questTemplateId: 'q1',
          progress: 0,
          status: QuestStatus.IN_PROGRESS,
        }),
      ]);
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ id: 'q1', targetType: 'inquire' }),
      );

      await expect(
        service.advanceSocialTarget('p1', 'spy' as any),
      ).resolves.toBeUndefined();
      expect(playerQuestRepo.save).not.toHaveBeenCalled();
    });

    it('should count eco browse actions via redis and advance within daily limit', async () => {
      cacheService.incr.mockResolvedValue(3);
      playerQuestRepo.find.mockResolvedValue([
        makePlayerQuest({
          id: 'pq1',
          questTemplateId: 'q1',
          progress: 0,
          status: QuestStatus.IN_PROGRESS,
        }),
      ]);
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ id: 'q1', targetType: 'view_article' }),
      );

      await service.advanceSocialTarget('p1', 'view_article' as any);

      expect(cacheService.incr).toHaveBeenCalledWith(
        'eco:daily:p1:view_article',
      );
      expect(cacheService.expire).toHaveBeenCalledWith(
        'eco:daily:p1:view_article',
        86400,
      );
      expect(playerQuestRepo.save).toHaveBeenCalled();
    });

    it('should skip eco browse target when daily count exceeds 10', async () => {
      cacheService.incr.mockResolvedValue(11);
      playerQuestRepo.find.mockResolvedValue([
        makePlayerQuest({
          id: 'pq1',
          questTemplateId: 'q1',
          progress: 0,
          status: QuestStatus.IN_PROGRESS,
        }),
      ]);
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ id: 'q1', targetType: 'view_article' }),
      );

      await service.advanceSocialTarget('p1', 'view_article' as any);

      expect(cacheService.incr).toHaveBeenCalledWith(
        'eco:daily:p1:view_article',
      );
      expect(playerQuestRepo.save).not.toHaveBeenCalled();
    });

    it('should not apply daily limit to purchase/join_activity targets', async () => {
      playerQuestRepo.find.mockResolvedValue([
        makePlayerQuest({
          id: 'pq1',
          questTemplateId: 'q1',
          progress: 0,
          status: QuestStatus.IN_PROGRESS,
        }),
      ]);
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ id: 'q1', targetType: 'purchase' }),
      );

      await service.advanceSocialTarget('p1', 'purchase' as any);

      expect(cacheService.incr).not.toHaveBeenCalled();
      expect(playerQuestRepo.save).toHaveBeenCalled();
    });
  });

  describe('quest help', () => {
    it('should create open help request', async () => {
      questHelpRepo.findOne.mockResolvedValue(null);

      const result = await service.requestHelp('p1', '1');

      expect(result.status).toBe(QuestHelpStatus.OPEN);
      expect(questHelpRepo.save).toHaveBeenCalled();
    });

    it('should reject duplicate open help request', async () => {
      questHelpRepo.findOne.mockResolvedValue(makeHelpRequest());

      await expect(service.requestHelp('p1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.QUEST_HELP_EXISTS },
      });
    });

    it('should allow new request when previous is closed', async () => {
      questHelpRepo.findOne.mockResolvedValue(
        makeHelpRequest({ status: QuestHelpStatus.CLOSED }),
      );

      const result = await service.requestHelp('p1', '1');
      expect(result.status).toBe(QuestHelpStatus.OPEN);
    });

    it('should list my requests and open requests excluding mine', async () => {
      questHelpRepo.find
        .mockResolvedValueOnce([
          makeHelpRequest({ id: 'h1', playerId: 'p1' }),
        ])
        .mockResolvedValueOnce([
          makeHelpRequest({ id: 'h2', playerId: 'p2' }),
          makeHelpRequest({ id: 'h3', playerId: 'p1' }),
        ]);

      const result = await service.listHelpRequests('p1');

      expect(result.mine).toHaveLength(1);
      expect(result.open).toHaveLength(1);
      expect(result.open[0].id).toBe('h2');
    });

    it('should reject respond when request not found or closed', async () => {
      questHelpRepo.findOne.mockResolvedValue(null);

      await expect(service.respondHelp('p2', '999')).rejects.toMatchObject({
        response: { code: ErrorCodes.QUEST_HELP_NOT_FOUND },
      });
    });

    it('should reject responding to own request', async () => {
      questHelpRepo.findOne.mockResolvedValue(
        makeHelpRequest({ playerId: 'p1' }),
      );

      await expect(service.respondHelp('p1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.QUEST_HELP_NOT_FOUND },
      });
    });

    it('should mark helped and advance requester quest progress', async () => {
      questHelpRepo.findOne.mockResolvedValue(
        makeHelpRequest({ playerId: 'p1', questTemplateId: '1' }),
      );
      playerQuestRepo.findOne.mockResolvedValue(
        makePlayerQuest({ progress: 1, status: QuestStatus.IN_PROGRESS }),
      );
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ targetJson: { count: 2 } }),
      );

      const result = await service.respondHelp('p2', '1');

      expect(result.status).toBe(QuestHelpStatus.HELPED);
      expect(result.helperId).toBe('p2');
      expect(result.helpedAt).toBeInstanceOf(Date);
      const saved = (playerQuestRepo.save as jest.Mock).mock.calls[0][0];
      expect(saved.progress).toBe(2);
      expect(saved.status).toBe(QuestStatus.COMPLETED);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'quest.completed',
        expect.any(Object),
      );
    });

    it('should grant helper guild contrib on respond', async () => {
      questHelpRepo.findOne.mockResolvedValue(
        makeHelpRequest({ playerId: 'p1', questTemplateId: '1' }),
      );
      playerQuestRepo.findOne.mockResolvedValue(null);
      questTemplateRepo.findOne.mockResolvedValue(makeTemplate());

      await service.respondHelp('p2', '1');

      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p2',
        CurrencyType.GUILD_CONTRIB,
        10,
        'quest_help',
        'quest.respondHelp',
      );
    });
  });

  describe('admin CRUD', () => {
    it('should create quest template', async () => {
      questTemplateRepo.save.mockResolvedValue(makeTemplate());
      const result = await service.createTemplate({
        name: '初入江湖',
        questType: QuestType.MAIN,
        minLevel: 1,
      });
      expect(result.name).toBe('初入江湖');
    });

    it('should return paginated templates', async () => {
      questTemplateRepo.findAndCount.mockResolvedValue([[makeTemplate()], 1]);
      const result = await service.getTemplates(1, 20);
      expect(result.items).toHaveLength(1);
    });
  });
});
