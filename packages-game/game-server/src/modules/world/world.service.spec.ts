import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorldService } from './world.service';
import {
  Scene,
  NpcTemplate,
  MonsterTemplate,
  ObjectTemplate,
  SceneTrigger,
  SceneEntitySpawn,
  TriggerUnlock,
  PlayerMount,
  StreetGame,
  GameSession,
  LandmarkMessage,
} from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import {
  SceneStatus,
  SceneType,
  EntityType,
  ObjectType,
  InteractType,
  TriggerType,
  GameSessionStatus,
  NpcInteractType,
} from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import { EconomyService } from '../economy/economy.service';
import { NpcPresenceService } from './npc/npc-presence.service';
import { DialogueService } from './dialogue/dialogue.service';
import type { Repository } from 'typeorm';

describe('WorldService', () => {
  let service: WorldService;
  let sceneRepo: jest.Mocked<Repository<Scene>>;
  let spawnRepo: jest.Mocked<Repository<SceneEntitySpawn>>;
  let triggerRepo: jest.Mocked<Repository<SceneTrigger>>;
  let objectRepo: jest.Mocked<Repository<ObjectTemplate>>;
  let cacheService: jest.Mocked<CacheService>;
  let economyService: jest.Mocked<EconomyService>;
  let eventBus: jest.Mocked<EventBusService>;
  let triggerUnlockRepo: jest.Mocked<Repository<TriggerUnlock>>;
  let mountRepo: jest.Mocked<Repository<PlayerMount>>;
  let gameRepo: jest.Mocked<Repository<StreetGame>>;
  let sessionRepo: jest.Mocked<Repository<GameSession>>;
  let landmarkMsgRepo: jest.Mocked<Repository<LandmarkMessage>>;
  let npcRepo: jest.Mocked<Repository<NpcTemplate>>;
  let dialogueService: {
    startById: jest.Mock;
    buildQuestMarks: jest.Mock;
    choose: jest.Mock;
  };

  beforeEach(async () => {
    const createMockRepo = () => ({
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      create: jest.fn((data: any) => ({ ...data, id: '1' })),
      findAndCount: jest.fn(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorldService,
        { provide: getRepositoryToken(Scene), useValue: createMockRepo() },
        {
          provide: getRepositoryToken(NpcTemplate),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(MonsterTemplate),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(ObjectTemplate),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(SceneTrigger),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(SceneEntitySpawn),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(TriggerUnlock),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(PlayerMount),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(StreetGame),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(GameSession),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(LandmarkMessage),
          useValue: createMockRepo(),
        },
        {
          provide: CacheService,
          useValue: {
            hSet: jest.fn(),
            hGet: jest.fn(),
            hGetAll: jest.fn(),
            sAdd: jest.fn(),
            sRem: jest.fn(),
            sMembers: jest.fn().mockResolvedValue([]),
            del: jest.fn(),
            exists: jest.fn(),
            acquireLock: jest.fn(),
            get: jest.fn(),
            set: jest.fn(),
            expire: jest.fn(),
          },
        },
        {
          provide: EconomyService,
          useValue: {
            addCurrency: jest.fn(),
            deductCurrency: jest.fn(),
          },
        },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
        {
          provide: NpcPresenceService,
          useValue: { listNpcsForPlayer: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: DialogueService,
          useValue: {
            // 默认按「对话悬空」处理：talk 走旧兜底（attr.greeting）
            startById: jest
              .fn()
              .mockRejectedValue(
                new GameException(
                  ErrorCodes.DIALOGUE_NOT_FOUND,
                  '对话不存在或已停用',
                ),
              ),
            buildQuestMarks: jest
              .fn()
              .mockResolvedValue({ available: [], submittable: [] }),
            choose: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(WorldService);
    sceneRepo = module.get(getRepositoryToken(Scene));
    spawnRepo = module.get(getRepositoryToken(SceneEntitySpawn));
    triggerRepo = module.get(getRepositoryToken(SceneTrigger));
    objectRepo = module.get(getRepositoryToken(ObjectTemplate));
    cacheService = module.get(CacheService);
    economyService = module.get(EconomyService);
    eventBus = module.get(EventBusService);
    triggerUnlockRepo = module.get(getRepositoryToken(TriggerUnlock));
    mountRepo = module.get(getRepositoryToken(PlayerMount));
    gameRepo = module.get(getRepositoryToken(StreetGame));
    sessionRepo = module.get(getRepositoryToken(GameSession));
    landmarkMsgRepo = module.get(getRepositoryToken(LandmarkMessage));
    npcRepo = module.get(getRepositoryToken(NpcTemplate));
    dialogueService = module.get(DialogueService);
  });

  const makeScene = (overrides: Partial<Scene> = {}): Scene =>
    ({
      id: '1',
      name: '中央城',
      sceneType: SceneType.TOWN,
      mapResKey: 'map_central',
      mapWidth: 1000,
      mapHeight: 1000,
      layerConfig: {},
      refreshRule: null,
      triggerGroupIds: [],
      minLevel: 1,
      maxPlayers: 100,
      status: SceneStatus.OPEN,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as Scene;

  describe('getScene', () => {
    it('should return scene when found', async () => {
      sceneRepo.findOne.mockResolvedValue(makeScene());
      const result = await service.getScene('1');
      expect(result.name).toBe('中央城');
    });

    it('should throw when scene not found', async () => {
      sceneRepo.findOne.mockResolvedValue(null);
      await expect(service.getScene('999')).rejects.toThrow(GameException);
    });
  });

  describe('getScenes', () => {
    it('should return paginated scenes', async () => {
      sceneRepo.findAndCount.mockResolvedValue([[makeScene()], 1]);
      const result = await service.getScenes(1, 20);
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('createScene', () => {
    it('should create a new scene', async () => {
      sceneRepo.save.mockResolvedValue(makeScene({ id: '2', name: '黑森林' }));
      const result = await service.createScene({
        name: '黑森林',
        sceneType: SceneType.WILD,
        mapResKey: 'map_forest',
      });
      expect(result.name).toBe('黑森林');
    });
  });

  describe('updateScene', () => {
    it('should update scene', async () => {
      const scene = makeScene();
      sceneRepo.findOne.mockResolvedValue(scene);
      sceneRepo.save.mockResolvedValue({ ...scene, name: '新名称' });
      const result = await service.updateScene('1', { name: '新名称' });
      expect(result.name).toBe('新名称');
    });
  });

  describe('getSceneSpawns', () => {
    it('should return spawn configs for scene', async () => {
      const spawns = [
        {
          id: '1',
          sceneId: '1',
          entityType: EntityType.NPC,
          templateId: '10',
          isActive: true,
        },
        {
          id: '2',
          sceneId: '1',
          entityType: EntityType.MONSTER,
          templateId: '20',
          isActive: true,
        },
      ];
      spawnRepo.find.mockResolvedValue(spawns as any);
      const result = await service.getSceneSpawns('1');
      expect(result).toHaveLength(2);
    });
  });

  describe('getSceneTriggers', () => {
    it('should return triggers for scene', async () => {
      triggerRepo.find.mockResolvedValue([{ id: '1' } as any]);
      const result = await service.getSceneTriggers('1');
      expect(result).toHaveLength(1);
    });

    it('只返回该场景的触发器（按 sceneId 过滤）', async () => {
      (triggerRepo.find as jest.Mock).mockResolvedValue([]);

      await service.getSceneTriggers('7');

      expect(triggerRepo.find).toHaveBeenCalledWith({
        where: { sceneId: '7' },
      });
    });
  });

  describe('enterScene', () => {
    it('should load scene config and publish enter event', async () => {
      sceneRepo.findOne.mockResolvedValue(makeScene());
      spawnRepo.find.mockResolvedValue([]);
      cacheService.exists.mockResolvedValue(false);
      const result = await service.enterScene('p1', '1');
      expect(result.scene.name).toBe('中央城');
      expect(result.npcs).toEqual([]);
      expect(eventBus.emit).toHaveBeenCalledWith('world.player.enter_scene', {
        playerId: 'p1',
        sceneId: '1',
      });
    });

    it('should add player to scene player set in Redis', async () => {
      sceneRepo.findOne.mockResolvedValue(makeScene());
      spawnRepo.find.mockResolvedValue([]);
      cacheService.exists.mockResolvedValue(false);
      await service.enterScene('p1', '1');
      expect(cacheService.sAdd).toHaveBeenCalledWith('scene:1:players', 'p1');
    });
  });

  describe('leaveScene', () => {
    it('should remove player from scene and publish leave event', async () => {
      await service.leaveScene('p1', '1');
      expect(cacheService.sRem).toHaveBeenCalledWith('scene:1:players', 'p1');
      expect(eventBus.emit).toHaveBeenCalledWith('world.player.leave_scene', {
        playerId: 'p1',
        sceneId: '1',
      });
    });
  });

  describe('getScenePlayers', () => {
    it('should return player IDs in scene', async () => {
      cacheService.sMembers.mockResolvedValue(['p1', 'p2']);
      const result = await service.getScenePlayers('1');
      expect(result).toEqual(['p1', 'p2']);
    });
  });

  describe('checkEnterRequirement', () => {
    it('should throw when scene is in maintenance', async () => {
      sceneRepo.findOne.mockResolvedValue(
        makeScene({ status: SceneStatus.MAINTENANCE }),
      );
      await expect(service.checkEnterRequirement('1', 10)).rejects.toThrow(
        GameException,
      );
    });

    it('should throw when player level below minimum', async () => {
      sceneRepo.findOne.mockResolvedValue(makeScene({ minLevel: 50 }));
      await expect(service.checkEnterRequirement('1', 10)).rejects.toThrow(
        GameException,
      );
    });

    it('should pass when requirements met', async () => {
      sceneRepo.findOne.mockResolvedValue(
        makeScene({ minLevel: 1, status: SceneStatus.OPEN }),
      );
      await expect(
        service.checkEnterRequirement('1', 10),
      ).resolves.toBeUndefined();
    });
  });

  describe('物件互动', () => {
    it('冷却中拒绝', async () => {
      objectRepo.findOne.mockResolvedValue({
        id: '1',
        type: ObjectType.COLLECT,
        interactCd: 60,
        isOneTime: false,
        reward: { type: 'currency', currencyType: 'gold', amount: 10 },
      } as any);
      cacheService.acquireLock.mockResolvedValue(false); // 冷却键已存在
      await expect(
        service.interactObject('1', '1', InteractType.COLLECT),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.OBJECT_COOLDOWN },
      });
    });

    it('一次性物件已开启拒绝', async () => {
      objectRepo.findOne.mockResolvedValue({
        id: '2',
        type: ObjectType.CHEST,
        interactCd: 0,
        isOneTime: true,
        reward: { type: 'currency', currencyType: 'gold', amount: 50 },
      } as any);
      cacheService.acquireLock.mockResolvedValue(false); // 已开过
      await expect(
        service.interactObject('1', '2', InteractType.COLLECT),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.OBJECT_ALREADY_OPENED },
      });
    });

    it('采集产出走资源策略折算', async () => {
      objectRepo.findOne.mockResolvedValue({
        id: '3',
        type: ObjectType.COLLECT,
        interactCd: 5,
        isOneTime: false,
        reward: { type: 'currency', currencyType: 'gold', amount: 100 },
      } as any);
      cacheService.acquireLock.mockResolvedValue(true);
      cacheService.get.mockResolvedValue('31'); // 当日第 31 次采集 + 序号 31
      economyService.addCurrency.mockResolvedValue({ balanceAfter: '70' });

      await service.interactObject('1', '3', InteractType.COLLECT);

      const amountArg = economyService.addCurrency.mock.calls[0][2];
      expect(amountArg).toBeLessThan(100); // 效率递减生效
    });

    it('非采集类物件不走资源策略', async () => {
      objectRepo.findOne.mockResolvedValue({
        id: '4',
        type: ObjectType.LANDMARK,
        interactCd: 0,
        isOneTime: false,
        reward: null,
      } as any);
      const result = await service.interactObject('1', '4', InteractType.READ);
      expect(result).toHaveProperty('ok', true);
      expect(economyService.addCurrency).not.toHaveBeenCalled();
    });
  });

  describe('机关/坐骑/街头玩法/地标', () => {
    it('机关激活：人数不足拒绝', async () => {
      triggerRepo.findOne.mockResolvedValue({
        id: '1',
        triggerType: TriggerType.PUZZLE,
        onceOnly: false,
        condition: { requiredPlayers: 3 },
      } as any);
      await expect(
        service.activateTrigger('1', '1', ['2']), // 共2人 < 3
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.TRIGGER_NOT_READY },
      });
    });

    it('街头玩法：下注计入奖池', async () => {
      gameRepo.findOne.mockResolvedValue({
        id: '1',
        name: '对弈',
        betRange: { min: 10, max: 1000 },
      } as any);
      sessionRepo.findOne.mockResolvedValue({
        id: 's1',
        gameId: '1',
        hostPlayerId: '1',
        status: GameSessionStatus.OPEN,
        betPool: '0',
      } as any);
      economyService.deductCurrency.mockResolvedValue({
        balanceAfter: '90',
      } as any);
      sessionRepo.save.mockImplementation((v: any) => Promise.resolve(v));

      const res = await service.betGame('2', 's1', 100);
      expect(res.betPool).toBe('100');
    });

    it('地标留言：长度校验', async () => {
      await expect(
        service.leaveLandmarkMessage('1', '1', 'x'.repeat(101)),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.PARAM_INVALID },
      });
    });
  });

  describe('talkNpc', () => {
    it('对话悬空/停用时回退 NPC 模板 attr.greeting（code/nodeKey 为 undefined，S1 行为不变）', async () => {
      spawnRepo.findOne.mockResolvedValue({
        id: '21',
        entityType: EntityType.NPC,
        templateId: '5',
      } as any);
      npcRepo.findOne.mockResolvedValue({
        id: '5',
        name: '村长',
        interactType: NpcInteractType.TALK,
        dialogueId: 3,
        attr: { greeting: '远来的客人，先四处看看吧。' },
      } as any);

      const result = await service.talkNpc('2', '21');

      expect(result.spawnId).toBe('21');
      expect(result.npcTemplateId).toBe('5');
      expect(result.name).toBe('村长');
      expect(result.dialogueId).toBe(3);
      expect(result.text).toBe('远来的客人，先四处看看吧。');
      expect(result.code).toBeUndefined();
      expect(result.nodeKey).toBeUndefined();
      expect(dialogueService.startById).toHaveBeenCalledWith('2', 3);
    });

    it('接入对话树：text 为节点正文，options 为过滤后可选项（next/index 分离）', async () => {
      spawnRepo.findOne.mockResolvedValue({
        id: '12',
        entityType: EntityType.NPC,
        templateId: '2',
      } as any);
      npcRepo.findOne.mockResolvedValue({
        id: '2',
        name: 'spike-铁匠',
        interactType: NpcInteractType.TALK,
        dialogueId: 1,
        attr: { greeting: '铁匠：要打铁，先得有矿。' },
      } as any);
      dialogueService.startById.mockResolvedValue({
        code: 'npc_blacksmith_main',
        nodeKey: 'root',
        finished: false,
        node: {
          key: 'root',
          speaker: '铁匠',
          text: '哟，客人来得正好。要打点什么家伙什？',
          options: [
            { index: 0, text: '我想找点事做', next: 'accepted' },
            { index: 3, text: '闲聊' },
          ],
        },
      });
      dialogueService.buildQuestMarks.mockResolvedValue({
        available: ['1'],
        submittable: [],
      });

      const result = await service.talkNpc('2', '12');

      expect(result.text).toBe('哟，客人来得正好。要打点什么家伙什？');
      expect(result.code).toBe('npc_blacksmith_main');
      expect(result.nodeKey).toBe('root');
      // options 形状保持 Array<{text,next}>（S1 契约），原始下标另放 optionIndexes
      expect(result.options).toEqual([
        { text: '我想找点事做', next: 'accepted' },
        { text: '闲聊', next: null },
      ]);
      expect(result.optionIndexes).toEqual([0, 3]);
      expect(result.questMarks).toEqual({ available: ['1'], submittable: [] });
    });

    it('对非 NPC 的 spawn 抛 PARAM_INVALID', async () => {
      spawnRepo.findOne.mockResolvedValue({
        id: '22',
        entityType: EntityType.OBJECT,
        templateId: '5',
      } as any);

      await expect(service.talkNpc('2', '22')).rejects.toMatchObject({
        response: { code: ErrorCodes.PARAM_INVALID },
      });
    });

    it('spawn 不存在时抛 PARAM_INVALID', async () => {
      spawnRepo.findOne.mockResolvedValue(null);

      await expect(service.talkNpc('2', '99')).rejects.toMatchObject({
        response: { code: ErrorCodes.PARAM_INVALID },
      });
    });
  });

  describe('triggerStory', () => {
    it('story_id 为空 → DIALOGUE_NOT_FOUND（业务码而非 500）', async () => {
      triggerRepo.findOne.mockResolvedValue({
        id: '2',
        triggerType: TriggerType.STORY,
        storyId: null,
        onceOnly: true,
      } as any);

      await expect(service.triggerStory('1', '2')).rejects.toMatchObject({
        response: { code: ErrorCodes.DIALOGUE_NOT_FOUND },
      });
      expect(cacheService.acquireLock).not.toHaveBeenCalled();
    });

    it('once_only 拿锁成功 → 返回首节点；二次触发拿锁失败 → DIALOGUE_CONDITION_NOT_MET', async () => {
      triggerRepo.findOne.mockResolvedValue({
        id: '2',
        triggerType: TriggerType.STORY,
        storyId: 1,
        onceOnly: true,
      } as any);
      dialogueService.startById.mockResolvedValue({
        code: 'npc_blacksmith_main',
        nodeKey: 'root',
        finished: false,
        node: { key: 'root', text: '剧情开场', options: [] },
      });
      cacheService.acquireLock.mockResolvedValue(true);

      const view = await service.triggerStory('1', '2');
      expect(view.nodeKey).toBe('root');
      expect(cacheService.acquireLock).toHaveBeenCalledWith(
        'world:story:once:2',
        31536000,
      );
      expect(dialogueService.startById).toHaveBeenCalledWith('1', 1);

      cacheService.acquireLock.mockResolvedValue(false);
      await expect(service.triggerStory('1', '2')).rejects.toMatchObject({
        response: { code: ErrorCodes.DIALOGUE_CONDITION_NOT_MET },
      });
    });

    it('触发器不存在 → PARAM_INVALID', async () => {
      triggerRepo.findOne.mockResolvedValue(null);

      await expect(service.triggerStory('1', '99')).rejects.toMatchObject({
        response: { code: ErrorCodes.PARAM_INVALID },
      });
    });
  });
});
