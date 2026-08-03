import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QuestService } from './quest.service';
import { QuestTemplate, PlayerQuest } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { QuestType, QuestStatus } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('QuestService', () => {
  let service: QuestService;
  let questTemplateRepo: jest.Mocked<Repository<QuestTemplate>>;
  let playerQuestRepo: jest.Mocked<Repository<PlayerQuest>>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
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
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(QuestService);
    questTemplateRepo = module.get(getRepositoryToken(QuestTemplate));
    playerQuestRepo = module.get(getRepositoryToken(PlayerQuest));
    eventBus = module.get(EventBusService);
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
