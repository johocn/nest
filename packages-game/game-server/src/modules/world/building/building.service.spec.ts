import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BuildingService } from './building.service';
import { BuildRuleService } from './build-rule.service';
import { Scene } from '../entities/scene.entity';
import { BuildingTemplate } from '../entities/building-template.entity';
import { BuildingInstance } from '../entities/building-instance.entity';
import { BuildingCoopContribution } from '../entities/building-coop-contribution.entity';
import { SceneLandPlot } from '../entities/scene-land-plot.entity';
import { InventoryService } from '@modules/inventory/inventory.service';
import { EconomyService } from '@modules/economy/economy.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import {
  BuildMode,
  BuildingOwnerType,
  BuildingState,
  PlotState,
} from '@constants/enums';
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
    softDelete: jest.Mock;
  };
  let plotRepo: { save: jest.Mock; find: jest.Mock };
  let contributionRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    remove: jest.Mock;
  };
  let inventoryService: { removeItem: jest.Mock; addItem: jest.Mock };
  let economyService: { deductCurrency: jest.Mock; addCurrency: jest.Mock };
  let eventBus: { emit: jest.Mock };
  /** 假地块表：同一 (gx,gy) 返回同一行，反映真实懒创建语义 */
  let plots: Map<string, any>;
  /** 假共建流水表：save 幂等（同一对象不重复入表），find 按 buildingInstanceId+refunded 过滤 */
  let contributions: any[];
  let loggerErrorSpy: jest.SpyInstance;

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
    contributions = [];
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
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
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    plotRepo = {
      save: jest.fn(async (entity: any) => entity),
      find: jest.fn().mockResolvedValue([]),
    };
    contributionRepo = {
      create: jest.fn((entity: any) => entity),
      save: jest.fn(async (entity: any) => {
        if (!contributions.includes(entity)) {
          if (entity.id === undefined) {
            entity.id = String(contributions.length + 1);
          }
          contributions.push(entity);
        }
        return entity;
      }),
      find: jest.fn(
        async ({ where }: any = {}) =>
          contributions.filter(
            (row) =>
              (where?.buildingInstanceId === undefined ||
                row.buildingInstanceId === where.buildingInstanceId) &&
              (where?.refunded === undefined || row.refunded === where.refunded),
          ),
      ),
      remove: jest.fn(async (rows: any[]) => {
        for (const row of rows) {
          const idx = contributions.indexOf(row);
          if (idx >= 0) contributions.splice(idx, 1);
        }
      }),
    };
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
        {
          provide: getRepositoryToken(BuildingCoopContribution),
          useValue: contributionRepo,
        },
        { provide: BuildRuleService, useValue: buildRule },
        { provide: InventoryService, useValue: inventoryService },
        { provide: EconomyService, useValue: economyService },
        { provide: EventBusService, useValue: eventBus },
      ],
    }).compile();

    service = module.get(BuildingService);
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
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

  // ===== Task 4 Step 1：共建创建 =====
  describe('createCoopBuilding', () => {
    it('solo 场景调 createCoopBuilding 抛 BUILD_FORBIDDEN（不写实例）', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

      await expectGameCode(
        service.createCoopBuilding(PLAYER_ID, SCENE_ID, {
          templateId: TEMPLATE_ID,
          gx: 1,
          gy: 1,
        }),
        ErrorCodes.BUILD_FORBIDDEN,
      );
      expect(buildingRepo.save).not.toHaveBeenCalled();
      expect(templateRepo.findOne).not.toHaveBeenCalled();
    });

    it('coop 成功：finish_at = now + coopExpireHours*3600s，payload.coop=true/reached=false', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      buildRule.assertCanBuild.mockResolvedValue(
        makeRule({ mode: BuildMode.COOP, coopExpireHours: 24 }),
      );
      templateRepo.findOne.mockResolvedValue(
        makeTemplate({ buildCost: [{ itemTemplateId: '10', amount: 5 }] }),
      );

      const view = await service.createCoopBuilding(PLAYER_ID, SCENE_ID, {
        templateId: TEMPLATE_ID,
        gx: 3,
        gy: 4,
      });

      const saved = buildingRepo.save.mock.calls[0][0];
      expect(saved.state).toBe(BuildingState.BUILDING);
      expect(saved.finishAt.getTime()).toBe(Date.now() + 24 * 3600_000);
      expect(saved.payload).toMatchObject({
        gx: 3,
        gy: 4,
        w: 1,
        h: 1,
        coop: true,
        reached: false,
      });
      expect(view.finishAt).toBe(
        new Date(Date.now() + 24 * 3600_000).toISOString(),
      );
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.emit.mock.calls[0][1]).toMatchObject({
        state: BuildingState.BUILDING,
        buildingId: '999',
      });
    });
  });

  // ===== Task 4 Step 2：共建投料 =====
  describe('contribute（共建投料）', () => {
    const makeCoopBuilding = (overrides: Record<string, any> = {}): any => ({
      id: '900',
      sceneId: SCENE_ID,
      templateId: TEMPLATE_ID,
      plotId: '1',
      ownerId: PLAYER_ID,
      ownerType: 'player',
      state: BuildingState.BUILDING,
      finishAt: new Date(Date.now() + 3600_000),
      durability: 100,
      payload: {
        gx: 1,
        gy: 1,
        w: 1,
        h: 1,
        effect: {},
        coop: true,
        reached: false,
      },
      ...overrides,
    });

    const seedContribution = (overrides: Record<string, any> = {}): any => {
      const row = {
        id: String(contributions.length + 1),
        buildingInstanceId: '900',
        playerId: PLAYER_ID,
        itemId: null,
        currencyType: null,
        amount: 1,
        refunded: false,
        ...overrides,
      };
      contributions.push(row);
      return row;
    };

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
      buildRule.getRule.mockResolvedValue(
        makeRule({ mode: BuildMode.COOP, coopMinContributors: 2 }),
      );
      templateRepo.findOne.mockResolvedValue(
        makeTemplate({
          buildSeconds: 60,
          buildCost: [
            { itemTemplateId: '10', amount: 5 },
            { currencyType: 'gold', amount: 100 },
          ],
        }),
      );
    });

    it('单实例不存在 → BUILD_NOT_FOUND', async () => {
      buildingRepo.findOne.mockResolvedValue(null);
      await expectGameCode(
        service.contribute(PLAYER_ID, '900', [
          { itemTemplateId: '10', amount: 5 },
        ]),
        ErrorCodes.BUILD_NOT_FOUND,
      );
    });

    it('实例非 building（已 built）→ BUILD_NOT_FOUND', async () => {
      buildingRepo.findOne.mockResolvedValue(
        makeCoopBuilding({ state: BuildingState.BUILT }),
      );
      await expectGameCode(
        service.contribute(PLAYER_ID, '900', [
          { itemTemplateId: '10', amount: 5 },
        ]),
        ErrorCodes.BUILD_NOT_FOUND,
      );
      expect(inventoryService.removeItem).not.toHaveBeenCalled();
    });

    it('solo 场景投料 → BUILD_FORBIDDEN', async () => {
      buildingRepo.findOne.mockResolvedValue(makeCoopBuilding());
      buildRule.getRule.mockResolvedValue(makeRule({ mode: BuildMode.SOLO }));
      await expectGameCode(
        service.contribute(PLAYER_ID, '900', [
          { itemTemplateId: '10', amount: 5 },
        ]),
        ErrorCodes.BUILD_FORBIDDEN,
      );
      expect(inventoryService.removeItem).not.toHaveBeenCalled();
    });

    it('已超时（finish_at<=now）→ COOP_EXPIRED，不扣料', async () => {
      buildingRepo.findOne.mockResolvedValue(
        makeCoopBuilding({ finishAt: new Date(Date.now() - 1000) }),
      );
      await expectGameCode(
        service.contribute(PLAYER_ID, '900', [
          { itemTemplateId: '10', amount: 5 },
        ]),
        ErrorCodes.COOP_EXPIRED,
      );
      expect(inventoryService.removeItem).not.toHaveBeenCalled();
    });

    it('已达标（payload.reached=true）再投料 → COOP_NOT_READY，不扣料', async () => {
      buildingRepo.findOne.mockResolvedValue(
        makeCoopBuilding({
          payload: { gx: 1, gy: 1, w: 1, h: 1, coop: true, reached: true },
        }),
      );
      await expectGameCode(
        service.contribute(PLAYER_ID, '900', [
          { itemTemplateId: '10', amount: 5 },
        ]),
        ErrorCodes.COOP_NOT_READY,
      );
      expect(inventoryService.removeItem).not.toHaveBeenCalled();
    });

    it('空投料列表 → PARAM_INVALID', async () => {
      buildingRepo.findOne.mockResolvedValue(makeCoopBuilding());
      await expectGameCode(
        service.contribute(PLAYER_ID, '900', []),
        ErrorCodes.PARAM_INVALID,
      );
      expect(inventoryService.removeItem).not.toHaveBeenCalled();
    });

    it('投料未达标：落流水但 state 仍 building、不改写 finish_at、不发事件', async () => {
      const building = makeCoopBuilding();
      buildingRepo.findOne.mockResolvedValue(building);
      const originalFinish = building.finishAt.getTime();

      const res = await service.contribute(PLAYER_ID, '900', [
        { itemTemplateId: '10', amount: 5 },
      ]);

      expect(res.reached).toBe(false);
      expect(res.contributors).toBe(1);
      expect(res.building.state).toBe(BuildingState.BUILDING);
      expect(building.state).toBe(BuildingState.BUILDING);
      expect(building.finishAt.getTime()).toBe(originalFinish);
      expect(buildingRepo.save).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
      // 流水落库：item 侧有值、currency 侧为 null
      expect(contributions).toHaveLength(1);
      expect(contributions[0]).toMatchObject({
        buildingInstanceId: '900',
        playerId: PLAYER_ID,
        itemId: '10',
        currencyType: null,
        amount: 5,
        refunded: false,
      });
      expect(inventoryService.removeItem).toHaveBeenCalledWith(
        PLAYER_ID,
        '10',
        5,
        expect.stringContaining(':contribute'),
      );
    });

    it('达标（去重参与者≥门槛 且 逐项合计≥成本）→ 改写 finish_at=now+build_seconds 并发事件', async () => {
      const building = makeCoopBuilding();
      buildingRepo.findOne.mockResolvedValue(building);
      // 参与者 A 已投满道具
      seedContribution({ playerId: '1001', itemId: '10', amount: 5 });

      // 参与者 B 补满货币 → 人数 2、两项均达标
      const res = await service.contribute('1002', '900', [
        { currencyType: 'gold', amount: 100 },
      ]);

      expect(res.reached).toBe(true);
      expect(res.contributors).toBe(2);
      expect(building.payload.reached).toBe(true);
      expect(typeof building.payload.coopReachedAt).toBe('string');
      expect(building.finishAt.getTime()).toBe(Date.now() + 60 * 1000);
      expect(buildingRepo.save).toHaveBeenCalledTimes(1);
      expect(buildingRepo.save.mock.calls[0][0].finishAt.getTime()).toBe(
        Date.now() + 60 * 1000,
      );
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      const [evt, payload] = eventBus.emit.mock.calls[0];
      expect(evt).toBe(GameEvents.BUILDING_STATE_CHANGED);
      expect(payload).toMatchObject({ state: BuildingState.BUILDING });
      expect(res.building.finishAt).toBe(
        new Date(Date.now() + 60 * 1000).toISOString(),
      );
    });

    it('逐项口径：人数达标但缺成本项时不达标（总额掩盖不了缺项）', async () => {
      const building = makeCoopBuilding();
      buildingRepo.findOne.mockResolvedValue(building);
      seedContribution({ playerId: '1001', currencyType: 'gold', amount: 200 });

      // 人数 2、货币远超，但道具项 0 < 5 → 不达标
      const res = await service.contribute('1002', '900', [
        { currencyType: 'gold', amount: 200 },
      ]);

      expect(res.reached).toBe(false);
      expect(building.payload.reached).toBe(false);
      expect(buildingRepo.save).not.toHaveBeenCalled();
    });

    it('第二项扣料失败 → 本次已插流水被删除、第一项逆向补偿、抛原错误', async () => {
      buildingRepo.findOne.mockResolvedValue(makeCoopBuilding());
      economyService.deductCurrency.mockRejectedValue(
        new GameException(ErrorCodes.CURRENCY_NOT_ENOUGH, '货币不足'),
      );

      await expectGameCode(
        service.contribute(PLAYER_ID, '900', [
          { itemTemplateId: '10', amount: 5 },
          { currencyType: 'gold', amount: 100 },
        ]),
        ErrorCodes.CURRENCY_NOT_ENOUGH,
      );

      // 本次流水不残留
      expect(contributions).toHaveLength(0);
      expect(contributionRepo.remove).toHaveBeenCalledTimes(1);
      expect(contributionRepo.remove.mock.calls[0][0]).toHaveLength(1);
      // 第一项（道具）被逆向补偿
      expect(inventoryService.addItem).toHaveBeenCalledWith(
        PLAYER_ID,
        '10',
        5,
        expect.stringContaining(':refund'),
      );
      expect(economyService.addCurrency).not.toHaveBeenCalled();
      expect(buildingRepo.save).not.toHaveBeenCalled();
    });
  });

  // ===== Task 4 Step 3：共建超时退款 =====
  describe('refundExpiredCoop（超时退款）', () => {
    const makeExpiredCoop = (overrides: Record<string, any> = {}): any => ({
      id: '900',
      sceneId: SCENE_ID,
      templateId: TEMPLATE_ID,
      plotId: '1',
      ownerId: PLAYER_ID,
      ownerType: 'player',
      state: BuildingState.BUILDING,
      finishAt: new Date(Date.now() - 1000),
      durability: 100,
      payload: { gx: 2, gy: 3, w: 2, h: 1, coop: true, reached: false },
      ...overrides,
    });

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
      buildRule.getRule.mockResolvedValue(makeRule({ mode: BuildMode.COOP }));
    });

    it('未超时 → 不退款', async () => {
      buildingRepo.findOne.mockResolvedValue(
        makeExpiredCoop({ finishAt: new Date(Date.now() + 3600_000) }),
      );
      await service.refundExpiredCoop('900');
      expect(inventoryService.addItem).not.toHaveBeenCalled();
      expect(buildingRepo.save).not.toHaveBeenCalled();
    });

    it('已达标（reached=true）超时也不退款（幂等 return）', async () => {
      buildingRepo.findOne.mockResolvedValue(
        makeExpiredCoop({
          payload: { gx: 2, gy: 3, w: 1, h: 1, coop: true, reached: true },
        }),
      );
      await service.refundExpiredCoop('900');
      expect(inventoryService.addItem).not.toHaveBeenCalled();
      expect(buildingRepo.save).not.toHaveBeenCalled();
    });

    it('超时退款：逐条原路退款 → refunded=true → demolishing → 释放地块 → 发事件；重复调用不重复退', async () => {
      const building = makeExpiredCoop();
      buildingRepo.findOne.mockResolvedValue(building);
      contributions.push(
        {
          id: '1',
          buildingInstanceId: '900',
          playerId: '1001',
          itemId: '10',
          currencyType: null,
          amount: 5,
          refunded: false,
        },
        {
          id: '2',
          buildingInstanceId: '900',
          playerId: '1002',
          currencyType: 'gold',
          itemId: null,
          amount: 100,
          refunded: false,
        },
      );
      const plotRows = [
        {
          id: '1',
          sceneId: SCENE_ID,
          gx: 2,
          gy: 3,
          w: 2,
          h: 1,
          state: PlotState.OCCUPIED,
        },
        {
          id: '2',
          sceneId: SCENE_ID,
          gx: 3,
          gy: 3,
          w: 1,
          h: 1,
          state: PlotState.OCCUPIED,
        },
      ];
      plotRepo.find.mockResolvedValue(plotRows);

      await service.refundExpiredCoop('900');

      expect(inventoryService.addItem).toHaveBeenCalledWith(
        '1001',
        '10',
        5,
        expect.stringContaining(':refund'),
      );
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        '1002',
        'gold',
        100,
        'building',
        expect.stringContaining(':refund'),
        TEMPLATE_ID,
      );
      expect(contributions.every((row) => row.refunded)).toBe(true);
      expect(building.state).toBe(BuildingState.DEMOLISHING);
      expect(plotRepo.save).toHaveBeenCalledTimes(1);
      expect(
        plotRows.every(
          (p) => p.state === PlotState.EMPTY && p.w === 1 && p.h === 1,
        ),
      ).toBe(true);
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      const [evt, payload] = eventBus.emit.mock.calls[0];
      expect(evt).toBe(GameEvents.BUILDING_STATE_CHANGED);
      expect(payload).toMatchObject({ state: BuildingState.DEMOLISHING });

      // 终态与 demolish 一致：实例被软删（避免 listBuildings 混入 demolishing 残行）
      expect(buildingRepo.softDelete).toHaveBeenCalledTimes(1);
      expect(buildingRepo.softDelete).toHaveBeenCalledWith('900');

      // 重复调用：state 已 demolishing → 直接 return，不重复退款
      inventoryService.addItem.mockClear();
      economyService.addCurrency.mockClear();
      eventBus.emit.mockClear();
      buildingRepo.save.mockClear();
      buildingRepo.softDelete.mockClear();
      await service.refundExpiredCoop('900');
      expect(inventoryService.addItem).not.toHaveBeenCalled();
      expect(economyService.addCurrency).not.toHaveBeenCalled();
      expect(buildingRepo.save).not.toHaveBeenCalled();
      expect(buildingRepo.softDelete).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('退款失败（背包满）：记 error、抛异常、不标 refunded、state 仍 building、不释放地块；下一 tick 重试成功', async () => {
      const building = makeExpiredCoop();
      buildingRepo.findOne.mockResolvedValue(building);
      contributions.push({
        id: '1',
        buildingInstanceId: '900',
        playerId: '1001',
        itemId: '10',
        currencyType: null,
        amount: 5,
        refunded: false,
      });
      inventoryService.addItem.mockRejectedValueOnce(new Error('背包已满'));

      await expect(service.refundExpiredCoop('900')).rejects.toThrow('背包已满');

      expect(loggerErrorSpy).toHaveBeenCalled();
      expect(contributions[0].refunded).toBe(false);
      expect(building.state).toBe(BuildingState.BUILDING);
      expect(plotRepo.save).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();

      // 重试：本次成功，退款只发生一次
      await service.refundExpiredCoop('900');
      expect(inventoryService.addItem).toHaveBeenCalledTimes(2);
      expect(contributions[0].refunded).toBe(true);
      expect(building.state).toBe(BuildingState.DEMOLISHING);
    });

    it('部分成功部分失败：已成功的流水保持 refunded=true，重试不重复退', async () => {
      const building = makeExpiredCoop();
      buildingRepo.findOne.mockResolvedValue(building);
      contributions.push(
        {
          id: '1',
          buildingInstanceId: '900',
          playerId: '1001',
          itemId: '10',
          currencyType: null,
          amount: 5,
          refunded: false,
        },
        {
          id: '2',
          buildingInstanceId: '900',
          playerId: '1002',
          itemId: '11',
          currencyType: null,
          amount: 2,
          refunded: false,
        },
      );
      inventoryService.addItem
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('背包已满'))
        .mockResolvedValueOnce({});

      await expect(service.refundExpiredCoop('900')).rejects.toThrow('背包已满');
      expect(contributions[0].refunded).toBe(true);
      expect(contributions[1].refunded).toBe(false);
      expect(building.state).toBe(BuildingState.BUILDING);

      inventoryService.addItem.mockClear();
      await service.refundExpiredCoop('900');
      // 只退第二笔（第一笔已 refunded）
      expect(inventoryService.addItem).toHaveBeenCalledTimes(1);
      expect(inventoryService.addItem).toHaveBeenCalledWith(
        '1002',
        '11',
        2,
        expect.stringContaining(':refund'),
      );
      expect(building.state).toBe(BuildingState.DEMOLISHING);
    });
  });

  // ===== Task 5 Step 3：拆除 =====
  describe('demolish（拆除）', () => {
    const makeBuiltBuilding = (overrides: Record<string, any> = {}): any => ({
      id: '900',
      sceneId: SCENE_ID,
      templateId: TEMPLATE_ID,
      plotId: '1',
      ownerId: PLAYER_ID,
      ownerType: BuildingOwnerType.PLAYER,
      state: BuildingState.BUILT,
      finishAt: null,
      durability: 100,
      payload: { gx: 2, gy: 3, w: 2, h: 1, effect: {} },
      ...overrides,
    });

    beforeEach(() => {
      buildRule.getRule.mockResolvedValue(makeRule({ allowDemolish: true }));
    });

    it('实例不存在 → BUILD_NOT_FOUND', async () => {
      buildingRepo.findOne.mockResolvedValue(null);
      await expectGameCode(
        service.demolish(PLAYER_ID, '900'),
        ErrorCodes.BUILD_NOT_FOUND,
      );
      expect(buildingRepo.save).not.toHaveBeenCalled();
    });

    it('state!=built（建造中）→ BUILD_NOT_FOUND，不查规则', async () => {
      buildingRepo.findOne.mockResolvedValue(
        makeBuiltBuilding({ state: BuildingState.BUILDING }),
      );
      await expectGameCode(
        service.demolish(PLAYER_ID, '900'),
        ErrorCodes.BUILD_NOT_FOUND,
      );
      expect(buildRule.getRule).not.toHaveBeenCalled();
      expect(buildingRepo.save).not.toHaveBeenCalled();
    });

    it('allow_demolish=false → BUILD_FORBIDDEN，不置状态', async () => {
      buildingRepo.findOne.mockResolvedValue(makeBuiltBuilding());
      buildRule.getRule.mockResolvedValue(makeRule({ allowDemolish: false }));
      await expectGameCode(
        service.demolish(PLAYER_ID, '900'),
        ErrorCodes.BUILD_FORBIDDEN,
      );
      expect(buildingRepo.save).not.toHaveBeenCalled();
      expect(plotRepo.save).not.toHaveBeenCalled();
    });

    it('非所有者（ownerId 不符）→ BUILD_FORBIDDEN', async () => {
      buildingRepo.findOne.mockResolvedValue(
        makeBuiltBuilding({ ownerId: '2002' }),
      );
      await expectGameCode(
        service.demolish(PLAYER_ID, '900'),
        ErrorCodes.BUILD_FORBIDDEN,
      );
      expect(buildingRepo.save).not.toHaveBeenCalled();
    });

    it('非玩家所有（guild）→ BUILD_FORBIDDEN', async () => {
      buildingRepo.findOne.mockResolvedValue(
        makeBuiltBuilding({ ownerType: BuildingOwnerType.GUILD }),
      );
      await expectGameCode(
        service.demolish(PLAYER_ID, '900'),
        ErrorCodes.BUILD_FORBIDDEN,
      );
      expect(buildingRepo.save).not.toHaveBeenCalled();
    });

    it('成功：置 demolishing + 清 finish_at + 释放地块 + emit + 软删 + 不退款 + refunded=false', async () => {
      const building = makeBuiltBuilding();
      buildingRepo.findOne.mockResolvedValue(building);
      const plotRows = [
        {
          id: '1',
          sceneId: SCENE_ID,
          gx: 2,
          gy: 3,
          w: 2,
          h: 1,
          state: PlotState.OCCUPIED,
        },
        {
          id: '2',
          sceneId: SCENE_ID,
          gx: 3,
          gy: 3,
          w: 1,
          h: 1,
          state: PlotState.OCCUPIED,
        },
      ];
      plotRepo.find.mockResolvedValue(plotRows);

      const res = await service.demolish(PLAYER_ID, '900');

      // 状态与 save
      expect(building.state).toBe(BuildingState.DEMOLISHING);
      expect(building.finishAt).toBeNull();
      expect(buildingRepo.save).toHaveBeenCalledTimes(1);
      expect(buildingRepo.save.mock.calls[0][0]).toBe(building);

      // 地块释放
      expect(plotRepo.save).toHaveBeenCalledTimes(1);
      expect(
        plotRows.every(
          (p) => p.state === PlotState.EMPTY && p.w === 1 && p.h === 1,
        ),
      ).toBe(true);

      // 事件
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      const [evt, payload] = eventBus.emit.mock.calls[0];
      expect(evt).toBe(GameEvents.BUILDING_STATE_CHANGED);
      expect(payload).toMatchObject({
        sceneId: SCENE_ID,
        buildingId: '900',
        templateId: TEMPLATE_ID,
        ownerId: PLAYER_ID,
        state: BuildingState.DEMOLISHING,
        rotation: 0,
      });
      expect(payload.x).toBe((2 + 0.5) * GRID_SIZE);
      expect(payload.y).toBe((3 + 0.5) * GRID_SIZE);

      // 软删
      expect(buildingRepo.softDelete).toHaveBeenCalledTimes(1);
      expect(buildingRepo.softDelete).toHaveBeenCalledWith('900');

      // 不退款（D7）：任何扣料/发料途径均未被调用
      expect(inventoryService.removeItem).not.toHaveBeenCalled();
      expect(inventoryService.addItem).not.toHaveBeenCalled();
      expect(economyService.deductCurrency).not.toHaveBeenCalled();
      expect(economyService.addCurrency).not.toHaveBeenCalled();

      // 返回体
      expect(res.refunded).toBe(false);
      expect(res.building).toMatchObject({
        id: '900',
        sceneId: SCENE_ID,
        templateId: TEMPLATE_ID,
        ownerId: PLAYER_ID,
        state: BuildingState.DEMOLISHING,
        finishAt: null,
        x: (2 + 0.5) * GRID_SIZE,
        y: (3 + 0.5) * GRID_SIZE,
        w: 2,
        h: 1,
      });
    });

    it('拆除后地块置 empty → 同一格可再次建造', async () => {
      // 先建一栋（1×1）：地块 (4,5) 被 lazy 创建并置 occupied
      plots.set('4|5', {
        id: '11',
        sceneId: SCENE_ID,
        gx: 4,
        gy: 5,
        w: 1,
        h: 1,
        state: PlotState.OCCUPIED,
      });
      const building = makeBuiltBuilding({
        payload: { gx: 4, gy: 5, w: 1, h: 1, effect: {} },
      });
      buildingRepo.findOne.mockResolvedValue(building);
      plotRepo.find.mockResolvedValue([plots.get('4|5')]);

      await service.demolish(PLAYER_ID, '900');
      expect(plots.get('4|5').state).toBe(PlotState.EMPTY);

      // 同一格再次建造成功（ensurePlot 不再抛 PLOT_OCCUPIED）
      buildingRepo.save.mockClear();
      const view = await service.createBuilding(PLAYER_ID, SCENE_ID, {
        templateId: TEMPLATE_ID,
        gx: 4,
        gy: 5,
      });
      expect(buildingRepo.save).toHaveBeenCalledTimes(1);
      expect(view.state).toBe(BuildingState.BUILDING);
      expect(plots.get('4|5').state).toBe(PlotState.OCCUPIED);
    });
  });
});