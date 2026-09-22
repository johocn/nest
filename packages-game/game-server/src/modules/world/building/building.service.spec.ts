import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BuildingService } from './building.service';
import { BuildRuleService } from './build-rule.service';
import { Scene } from '../entities/scene.entity';
import { BuildingTemplate } from '../entities/building-template.entity';
import { BuildingInstance } from '../entities/building-instance.entity';
import { SceneLandPlot } from '../entities/scene-land-plot.entity';
import { InventoryService } from '@modules/inventory/inventory.service';
import { EconomyService } from '@modules/economy/economy.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { BuildMode, BuildingState, PlotState } from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';

const SCENE_ID = '7';
const PLAYER_ID = '1001';
const TEMPLATE_ID = '55';
const GRID_SIZE = 64;

async function expectGameCode(
  promise: Promise<any>,
  code: number,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ response: { code } });
}

describe('BuildingService', () => {
  let service: BuildingService;
  let buildRule: {
    assertCanBuild: jest.Mock;
    ensurePlot: jest.Mock;
    toCenter: jest.Mock;
    getRule: jest.Mock;
  };
  let sceneRepo: { findOne: jest.Mock };
  let templateRepo: { findOne: jest.Mock };
  let buildingRepo: {
    save: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let plotRepo: { save: jest.Mock };
  let inventoryService: { removeItem: jest.Mock; addItem: jest.Mock };
  let economyService: { deductCurrency: jest.Mock; addCurrency: jest.Mock };
  let eventBus: { emit: jest.Mock };
  /** 假地块表：同一 (gx,gy) 返回同一行，反映真实懒创建语义 */
  let plots: Map<string, any>;

  const makeRule = (overrides: Record<string, any> = {}): any => ({
    id: '9',
    sceneId: SCENE_ID,
    mode: BuildMode.SOLO,
    landGridSize: GRID_SIZE,
    maxBuildingsPerPlayer: 5,
    allowDemolish: true,
    coopMinContributors: 2,
    coopExpireHours: 24,
    reservedZones: [],
    ...overrides,
  });

  const makeTemplate = (overrides: Record<string, any> = {}): any => ({
    id: TEMPLATE_ID,
    name: '小屋',
    resKey: 'house',
    category: 'house',
    footprintW: 1,
    footprintH: 1,
    buildCost: [],
    buildSeconds: 60,
    durability: 100,
    effect: { foo: 'bar' },
    unlockCondition: null,
    isActive: true,
    ...overrides,
  });

  beforeEach(async () => {
    plots = new Map();
    buildRule = {
      assertCanBuild: jest.fn().mockResolvedValue(makeRule()),
      ensurePlot: jest.fn(async (sceneId: string, gx: number, gy: number) => {
        const key = `${gx}|${gy}`;
        if (!plots.has(key)) {
          plots.set(key, {
            id: String(plots.size + 1),
            sceneId,
            gx,
            gy,
            w: 1,
            h: 1,
            state: PlotState.EMPTY,
          });
        }
        const plot = plots.get(key);
        if (plot.state !== PlotState.EMPTY) {
          throw new GameException(ErrorCodes.PLOT_OCCUPIED, '该地块已被占用');
        }
        return plot;
      }),
      toCenter: jest.fn((gx: number, gy: number, gridSize: number) => ({
        x: (gx + 0.5) * gridSize,
        y: (gy + 0.5) * gridSize,
      })),
      getRule: jest.fn().mockResolvedValue(makeRule()),
    };
    sceneRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: SCENE_ID, mapWidth: 1000, mapHeight: 1000 }),
    };
    templateRepo = { findOne: jest.fn().mockResolvedValue(makeTemplate()) };
    buildingRepo = {
      create: jest.fn((entity: any) => entity),
      save: jest.fn(async (entity: any) => ({ ...entity, id: '999' })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    plotRepo = { save: jest.fn(async (entity: any) => entity) };
    inventoryService = {
      removeItem: jest.fn().mockResolvedValue({}),
      addItem: jest.fn().mockResolvedValue({}),
    };
    economyService = {
      deductCurrency: jest.fn().mockResolvedValue({ balanceAfter: '0' }),
      addCurrency: jest.fn().mockResolvedValue({ balanceAfter: '0' }),
    };
    eventBus = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuildingService,
        { provide: getRepositoryToken(Scene), useValue: sceneRepo },
        {
          provide: getRepositoryToken(BuildingTemplate),
          useValue: templateRepo,
        },
        {
          provide: getRepositoryToken(BuildingInstance),
          useValue: buildingRepo,
        },
        { provide: getRepositoryToken(SceneLandPlot), useValue: plotRepo },
        { provide: BuildRuleService, useValue: buildRule },
        { provide: InventoryService, useValue: inventoryService },
        { provide: EconomyService, useValue: economyService },
        { provide: EventBusService, useValue: eventBus },
      ],
    }).compile();

    service = module.get(BuildingService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ===== Step 3-1 模式与蓝图校验 =====
  describe('前置校验', () => {
    it('mode=coop 抛 BUILD_FORBIDDEN 且不查蓝图', async () => {
      buildRule.assertCanBuild.mockResolvedValue(
        makeRule({ mode: BuildMode.COOP }),
      );
      await expectGameCode(
        service.createBuilding(PLAYER_ID, SCENE_ID, {
          templateId: TEMPLATE_ID,
          gx: 1,
          gy: 1,
        }),
        ErrorCodes.BUILD_FORBIDDEN,
      );
      expect(templateRepo.findOne).not.toHaveBeenCalled();
    });

    it('蓝图不存在抛 PARAM_INVALID', async () => {
      templateRepo.findOne.mockResolvedValue(null);
      await expectGameCode(
        service.createBuilding(PLAYER_ID, SCENE_ID, {
          templateId: TEMPLATE_ID,
          gx: 1,
          gy: 1,
        }),
        ErrorCodes.PARAM_INVALID,
      );
    });

    it('蓝图已停用抛 PARAM_INVALID', async () => {
      templateRepo.findOne.mockResolvedValue(makeTemplate({ isActive: false }));
      await expectGameCode(
        service.createBuilding(PLAYER_ID, SCENE_ID, {
          templateId: TEMPLATE_ID,
          gx: 1,
          gy: 1,
        }),
        ErrorCodes.PARAM_INVALID,
      );
    });

    it('矩形右/下越界抛 PARAM_INVALID（15×15 网格，锚点 14,14 占 2×2）', async () => {
      templateRepo.findOne.mockResolvedValue(
        makeTemplate({ footprintW: 2, footprintH: 2 }),
      );
      await expectGameCode(
        service.createBuilding(PLAYER_ID, SCENE_ID, {
          templateId: TEMPLATE_ID,
          gx: 14,
          gy: 14,
        }),
        ErrorCodes.PARAM_INVALID,
      );
      expect(buildRule.ensurePlot).not.toHaveBeenCalled();
    });
  });

  // ===== Step 3-2 成本不足：无实例、地块仍 empty =====
  describe('成本不足', () => {
    it('removeItem 抛 ITEM_NOT_ENOUGH → 不写实例、地块仍 empty、抛原错误', async () => {
      templateRepo.findOne.mockResolvedValue(
        makeTemplate({ buildCost: [{ itemTemplateId: '10', amount: 5 }] }),
      );
      inventoryService.removeItem.mockRejectedValue(
        new GameException(ErrorCodes.ITEM_NOT_ENOUGH, '道具数量不足'),
      );

      await expectGameCode(
        service.createBuilding(PLAYER_ID, SCENE_ID, {
          templateId: TEMPLATE_ID,
          gx: 2,
          gy: 2,
        }),
        ErrorCodes.ITEM_NOT_ENOUGH,
      );

      expect(buildingRepo.save).not.toHaveBeenCalled();
      expect(plotRepo.save).not.toHaveBeenCalled();
      expect([...plots.values()].every((p) => p.state === PlotState.EMPTY)).toBe(
        true,
      );
      expect(eventBus.emit).not.toHaveBeenCalled();
      // 失败项未进入 done，故无需补偿
      expect(inventoryService.addItem).not.toHaveBeenCalled();
    });
  });

  // ===== Step 3-3 第二项失败：第一项被逆向补偿 =====
  describe('扣料失败补偿', () => {
    it('第二项（货币）失败 → 第一项（道具）被逆向补偿并抛原错误', async () => {
      templateRepo.findOne.mockResolvedValue(
        makeTemplate({
          buildCost: [
            { itemTemplateId: '10', amount: 5 },
            { currencyType: 'gold', amount: 100 },
          ],
        }),
      );
      economyService.deductCurrency.mockRejectedValue(
        new GameException(ErrorCodes.CURRENCY_NOT_ENOUGH, '货币不足'),
      );

      await expectGameCode(
        service.createBuilding(PLAYER_ID, SCENE_ID, {
          templateId: TEMPLATE_ID,
          gx: 3,
          gy: 3,
        }),
        ErrorCodes.CURRENCY_NOT_ENOUGH,
      );

      // 第一项正常扣减
      expect(inventoryService.removeItem).toHaveBeenCalledTimes(1);
      expect(inventoryService.removeItem).toHaveBeenCalledWith(
        PLAYER_ID,
        '10',
        5,
        expect.any(String),
      );
      // 补偿：仅回退已完成的第一项，参数一致
      expect(inventoryService.addItem).toHaveBeenCalledTimes(1);
      expect(inventoryService.addItem).toHaveBeenCalledWith(
        PLAYER_ID,
        '10',
        5,
        expect.any(String),
      );
      expect(economyService.addCurrency).not.toHaveBeenCalled();
      // 未产生实例与占用
      expect(buildingRepo.save).not.toHaveBeenCalled();
      expect(plotRepo.save).not.toHaveBeenCalled();
    });
  });

  // ===== Step 3-4 成功路径 =====
  describe('成功路径', () => {
    it('1×1：写实例(anchor plot_id) + 地块 occupied + emit + 返回视图', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      templateRepo.findOne.mockResolvedValue(
        makeTemplate({ buildCost: [{ itemTemplateId: '10', amount: 5 }] }),
      );

      const view = await service.createBuilding(PLAYER_ID, SCENE_ID, {
        templateId: TEMPLATE_ID,
        gx: 3,
        gy: 4,
      });

      // 实例
      expect(buildingRepo.save).toHaveBeenCalledTimes(1);
      const saved = buildingRepo.save.mock.calls[0][0];
      expect(saved.state).toBe(BuildingState.BUILDING);
      expect(saved.plotId).toBe('1'); // 锚点格 id
      expect(saved.ownerId).toBe(PLAYER_ID);
      expect(saved.finishAt.getTime()).toBe(
        Date.now() + 60 * 1000,
      );
      expect(saved.payload).toEqual({
        gx: 3,
        gy: 4,
        w: 1,
        h: 1,
        effect: { foo: 'bar' },
      });

      // 地块
      expect(plotRepo.save).toHaveBeenCalledTimes(1);
      const savedPlots = plotRepo.save.mock.calls[0][0];
      expect(savedPlots).toHaveLength(1);
      expect(savedPlots[0].state).toBe(PlotState.OCCUPIED);

      // 事件
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      const [event, payload] = eventBus.emit.mock.calls[0];
      expect(event).toBe(GameEvents.BUILDING_STATE_CHANGED);
      expect(payload).toMatchObject({
        sceneId: SCENE_ID,
        buildingId: '999',
        templateId: TEMPLATE_ID,
        ownerId: PLAYER_ID,
        state: BuildingState.BUILDING,
        rotation: 0,
      });
      expect(payload.x).toBe((3 + 0.5) * GRID_SIZE);
      expect(payload.y).toBe((4 + 0.5) * GRID_SIZE);

      // 视图
      expect(view).toEqual({
        id: '999',
        sceneId: SCENE_ID,
        templateId: TEMPLATE_ID,
        ownerId: PLAYER_ID,
        state: BuildingState.BUILDING,
        finishAt: new Date(Date.now() + 60 * 1000).toISOString(),
        x: (3 + 0.5) * GRID_SIZE,
        y: (4 + 0.5) * GRID_SIZE,
        w: 1,
        h: 1,
      });
    });

    it('2×2 footprint 占用 4 格，锚点格记录 2×2', async () => {
      templateRepo.findOne.mockResolvedValue(
        makeTemplate({ footprintW: 2, footprintH: 2 }),
      );

      await service.createBuilding(PLAYER_ID, SCENE_ID, {
        templateId: TEMPLATE_ID,
        gx: 5,
        gy: 6,
      });

      expect(buildRule.ensurePlot).toHaveBeenCalledTimes(4);
      expect(
        (buildRule.ensurePlot.mock.calls as any[]).map((c) => [c[1], c[2]]),
      ).toEqual([
        [5, 6],
        [6, 6],
        [5, 7],
        [6, 7],
      ]);

      const savedPlots = plotRepo.save.mock.calls[0][0];
      expect(savedPlots).toHaveLength(4);
      expect(savedPlots.every((p: any) => p.state === PlotState.OCCUPIED)).toBe(
        true,
      );
      // 锚点格
      expect(savedPlots[0]).toMatchObject({ gx: 5, gy: 6, w: 2, h: 2 });
      expect(savedPlots.slice(1)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ w: 1, h: 1 }),
        ]),
      );

      const saved = buildingRepo.save.mock.calls[0][0];
      expect(saved.plotId).toBe(savedPlots[0].id);
      expect(saved.payload).toMatchObject({ gx: 5, gy: 6, w: 2, h: 2 });
    });

    it('已占用地块（第二格）→ 抛 PLOT_OCCUPIED，不扣料不写实例', async () => {
      templateRepo.findOne.mockResolvedValue(
        makeTemplate({
          footprintW: 2,
          footprintH: 1,
          buildCost: [{ itemTemplateId: '10', amount: 5 }],
        }),
      );
      plots.set('6|6', {
        id: '77',
        sceneId: SCENE_ID,
        gx: 6,
        gy: 6,
        w: 1,
        h: 1,
        state: PlotState.OCCUPIED,
      });

      await expectGameCode(
        service.createBuilding(PLAYER_ID, SCENE_ID, {
          templateId: TEMPLATE_ID,
          gx: 5,
          gy: 6,
        }),
        ErrorCodes.PLOT_OCCUPIED,
      );
      expect(inventoryService.removeItem).not.toHaveBeenCalled();
      expect(buildingRepo.save).not.toHaveBeenCalled();
    });
  });
});