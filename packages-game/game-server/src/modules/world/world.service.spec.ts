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
} from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import { EconomyService } from '../economy/economy.service';
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

  beforeEach(async () => {
    const createMockRepo = () => ({
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
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
          provide: CacheService,
          useValue: {
            hSet: jest.fn(),
            hGet: jest.fn(),
            hGetAll: jest.fn(),
            sAdd: jest.fn(),
            sRem: jest.fn(),
            sMembers: jest.fn(),
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
  });

  describe('enterScene', () => {
    it('should load scene config and publish enter event', async () => {
      sceneRepo.findOne.mockResolvedValue(makeScene());
      spawnRepo.find.mockResolvedValue([]);
      cacheService.exists.mockResolvedValue(false);
      const result = await service.enterScene('p1', '1');
      expect(result.scene.name).toBe('中央城');
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
});
