import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExploreService } from './explore.service';
import { EncounterTemplate, PlayerExploration } from './entities';
import { Scene } from '@modules/world/entities';
import { CharacterService } from '@modules/character/character.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { EconomyService } from '@modules/economy/economy.service';
import { BuffService } from '@modules/buff/buff.service';
import { ConfigManageService } from '@modules/config/config.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

describe('ExploreService', () => {
  let service: ExploreService;

  const encRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((r: any) => ({ ...r })),
    save: jest.fn((r: any) => Promise.resolve({ ...r, id: r.id ?? '9' })),
    delete: jest.fn(),
    manager: { query: jest.fn() },
  };
  const explRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((r: any) => ({ ...r })),
    save: jest.fn((r: any) => Promise.resolve({ ...r })),
  };
  const sceneRepo = {
    findOne: jest.fn(),
    manager: { query: jest.fn() },
  };
  const characterService = { getByPlayerId: jest.fn() };
  const inventoryService = { addItem: jest.fn(), removeItem: jest.fn() };
  const economyService = { addCurrency: jest.fn(), deductCurrency: jest.fn() };
  const buffService = { applyBuff: jest.fn() };
  const cacheService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    acquireLock: jest.fn(),
  };
  const configService = { getTypedValue: jest.fn() };
  const eventBus = { emit: jest.fn() };

  const templates: EncounterTemplate[] = [
    {
      id: '1',
      sceneId: 's1',
      title: '山中秘道',
      descText: '一条被落叶掩盖的秘道',
      triggerRate: 0.5,
      cdSeconds: 300,
      choicesJson: [
        {
          id: 'a',
          label: '小心踏步',
          effects: [{ type: 'currency', currencyType: 'gold', amount: 100 }],
        },
        { id: 'b', label: '大胆前进', effects: [] },
      ],
      isOneTime: false,
      rewardJson: {},
      isActive: true,
    },
    {
      id: '2',
      sceneId: 's1',
      title: '一次性的奇遇',
      descText: '',
      triggerRate: 1,
      cdSeconds: 60,
      choicesJson: [
        {
          id: 'a',
          label: '接受馈赠',
          effects: [{ type: 'buff', buffTemplateId: 'b1' }],
        },
      ],
      isOneTime: true,
      rewardJson: {},
      isActive: true,
    },
  ] as unknown as EncounterTemplate[];

  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    encRepo.manager.query.mockResolvedValue([{ now: new Date(), hour: '10', day: '2026-09-20' }]);
    const mod = await Test.createTestingModule({
      providers: [
        ExploreService,
        { provide: getRepositoryToken(EncounterTemplate), useValue: encRepo },
        { provide: getRepositoryToken(PlayerExploration), useValue: explRepo },
        { provide: getRepositoryToken(Scene), useValue: sceneRepo },
        { provide: CharacterService, useValue: characterService },
        { provide: InventoryService, useValue: inventoryService },
        { provide: EconomyService, useValue: economyService },
        { provide: BuffService, useValue: buffService },
        { provide: ConfigManageService, useValue: configService },
        { provide: CacheService, useValue: cacheService },
        { provide: EventBusService, useValue: eventBus },
      ],
    }).compile();
    service = mod.get(ExploreService);
  });

  describe('worldState 昼夜/天气', () => {
    it('按 SQL now() 小时返回 day/night，及固定种子天气', async () => {
      const s = await service.worldState();
      expect(s.timeOfDay).toBe('day'); // hour=10
      expect(['sunny', 'rainy']).toContain(s.weather);
      expect(s.hour).toBe('10');
    });
    it('夜晚时段返回 night', async () => {
      encRepo.manager.query.mockResolvedValue([
        { now: new Date('2026-09-20T22:00:00Z'), hour: '22', day: '2026-09-20' },
      ]);
      const s = await service.worldState();
      expect(s.timeOfDay).toBe('night');
    });
  });

  describe('discover 探索足迹', () => {
    it('首探发里程碑奖并回写 times=1', async () => {
      sceneRepo.findOne.mockResolvedValue({ id: 's1' });
      explRepo.findOne.mockResolvedValue(null);
      configService.getTypedValue.mockResolvedValue({
        reward: { currency: [{ currencyType: 'gold', amount: 100 }] },
      });
      const res = await service.discover('p1', 's1');
      expect(res.first).toBe(true);
      expect(res.times).toBe(1);
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p1',
        'gold',
        100,
        expect.any(String),
        expect.any(String),
        undefined,
      );
      expect(explRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ playerId: 'p1', sceneId: 's1', times: 1 }),
      );
    });

    it('重复 discover 幂等：times 递增且不重复发奖', async () => {
      sceneRepo.findOne.mockResolvedValue({ id: 's1' });
      explRepo.findOne.mockResolvedValue({
        id: 'x1',
        playerId: 'p1',
        sceneId: 's1',
        times: 1,
      });
      const res = await service.discover('p1', 's1');
      expect(res.first).toBe(false);
      expect(res.times).toBe(2);
      expect(economyService.addCurrency).not.toHaveBeenCalled();
      expect(explRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ times: 2 }),
      );
    });

    it('场景不存在抛 PARAM_INVALID', async () => {
      sceneRepo.findOne.mockResolvedValue(null);
      try {
        await service.discover('p1', 'nx');
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(GameException);
        expect((err as GameException).getResponse().code).toBe(
          ErrorCodes.PARAM_INVALID,
        );
      }
    });
  });

  describe('triggerEncounter 奇遇触发', () => {
    it('触发率命中返回当前选项', async () => {
      encRepo.find.mockResolvedValue(templates);
      jest.spyOn(Math, 'random').mockReturnValue(0.1); // <0.5
      cacheService.acquireLock.mockResolvedValue(true);
      const res = await service.triggerEncounter('p1', 's1');
      expect(res.hit).toBe(true);
      expect(res.encounterId).toBeTruthy();
      expect(res.options).toHaveLength(2);
    });

    it('未命中返回 hit=false', async () => {
      encRepo.find.mockResolvedValue(templates);
      jest.spyOn(Math, 'random').mockReturnValue(0.9);
      const res = await service.triggerEncounter('p1', 's1');
      expect(res.hit).toBe(false);
      expect(res.options).toBeUndefined();
    });

    it('CD 拦截时不触发', async () => {
      encRepo.find.mockResolvedValue(templates);
      jest.spyOn(Math, 'random').mockReturnValue(0.1);
      cacheService.acquireLock.mockResolvedValue(false); // CD
      const res = await service.triggerEncounter('p1', 's1');
      expect(res.hit).toBe(false);
      expect(res.reason).toBe('cooldown');
    });
  });

  describe('resolveEncounter 奇遇结算', () => {
    it('按选择结算 effects（经既有 economy 通道）', async () => {
      cacheService.acquireLock.mockResolvedValue(true);
      cacheService.get.mockResolvedValue(
        JSON.stringify({
          encounterId: 'e1',
          playerId: 'p1',
          templateId: '1',
          sceneId: 's1',
          title: '山中秘道',
          choices: templates[0].choicesJson,
          resolved: false,
        }),
      );
      const res = await service.resolveEncounter('p1', 'e1', 'a');
      expect(res.choiceId).toBe('a');
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p1',
        'gold',
        100,
        expect.any(String),
        expect.any(String),
        undefined,
      );
      expect(res.delivered).toContain('currency:gold:100');
    });

    it('重复结算被幂等拦截', async () => {
      cacheService.acquireLock.mockResolvedValue(false);
      try {
        await service.resolveEncounter('p1', 'e1', 'a');
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(GameException);
        expect((err as GameException).getResponse().code).toBe(
          ErrorCodes.ENCOUNTER_ALREADY_RESOLVED,
        );
      }
    });

    it('非法选项抛 ENCOUNTER_CHOICE_INVALID', async () => {
      cacheService.acquireLock.mockResolvedValue(true);
      cacheService.get.mockResolvedValue(
        JSON.stringify({
          encounterId: 'e1',
          playerId: 'p1',
          templateId: '1',
          sceneId: 's1',
          title: '山中秘道',
          choices: templates[0].choicesJson,
          resolved: false,
        }),
      );
      try {
        await service.resolveEncounter('p1', 'e1', 'zz');
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(GameException);
        expect((err as GameException).getResponse().code).toBe(
          ErrorCodes.ENCOUNTER_CHOICE_INVALID,
        );
      }
    });
  });
});