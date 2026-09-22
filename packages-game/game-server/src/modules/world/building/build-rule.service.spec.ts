import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BuildRuleService } from './build-rule.service';
import { Scene } from '../entities/scene.entity';
import { SceneBuildRule } from '../entities/scene-build-rule.entity';
import { SceneLandPlot } from '../entities/scene-land-plot.entity';
import { BuildingInstance } from '../entities/building-instance.entity';
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

/** 断言抛出 GameException 且响应体 code 匹配（响应形状 {code,msg}） */
async function expectGameCode(
  promise: Promise<any>,
  code: number,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ response: { code } });
}

/**
 * 轻量内存假仓库：模拟「唯一索引 (scene_id,gx,gy) + ON CONFLICT DO NOTHING」语义。
 * - findOne 前先 await 一个微任务，制造并发窗口；
 * - insert().values().orIgnore().execute() 若 key 已存在则什么都不做（冲突忽略）。
 */
class FakePlotRepo {
  rows = new Map<string, SceneLandPlot>();
  insertCalls = 0;
  private idSeq = 0;

  private key(sceneId: string | number, gx: number, gy: number): string {
    return `${sceneId}|${gx}|${gy}`;
  }

  async findOne(options: {
    where: { sceneId: string; gx: number; gy: number };
  }): Promise<SceneLandPlot | null> {
    const { sceneId, gx, gy } = options.where;
    await Promise.resolve();
    const row = this.rows.get(this.key(sceneId, gx, gy));
    return row ? { ...row } : null;
  }

  createQueryBuilder(): any {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const repo = this;
    const qb: any = {
      insert: () => qb,
      into: () => qb,
      values: (v: any) => {
        qb._values = v;
        return qb;
      },
      orIgnore: () => qb,
      execute: async () => {
        repo.insertCalls += 1;
        const v = qb._values;
        const key = repo['key'](v.sceneId, v.gx, v.gy);
        // ON CONFLICT DO NOTHING：已存在则忽略
        if (!repo.rows.has(key)) {
          repo.rows.set(key, {
            id: String(++repo.idSeq),
            sceneId: v.sceneId,
            gx: v.gx,
            gy: v.gy,
            w: 1,
            h: 1,
            state: PlotState.EMPTY,
          } as any);
        }
        return { identifiers: [], raw: [] };
      },
    };
    return qb;
  }
}

describe('BuildRuleService', () => {
  let service: BuildRuleService;
  let sceneRepo: { findOne: jest.Mock };
  let ruleRepo: { findOne: jest.Mock };
  let plotRepo: FakePlotRepo;
  let buildingRepo: { count: jest.Mock };

  const makeScene = (overrides: Record<string, any> = {}): any => ({
    id: SCENE_ID,
    mapWidth: 1000,
    mapHeight: 1000,
    ...overrides,
  });

  const makeRuleRow = (overrides: Record<string, any> = {}): any => ({
    id: '9',
    sceneId: SCENE_ID,
    mode: BuildMode.SOLO,
    landGridSize: 64,
    maxBuildingsPerPlayer: 5,
    allowDemolish: true,
    coopMinContributors: 2,
    coopExpireHours: 24,
    reservedZones: [],
    ...overrides,
  });

  beforeEach(async () => {
    sceneRepo = { findOne: jest.fn().mockResolvedValue(makeScene()) };
    ruleRepo = { findOne: jest.fn().mockResolvedValue(makeRuleRow()) };
    plotRepo = new FakePlotRepo();
    buildingRepo = { count: jest.fn().mockResolvedValue(0) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuildRuleService,
        { provide: getRepositoryToken(Scene), useValue: sceneRepo },
        { provide: getRepositoryToken(SceneBuildRule), useValue: ruleRepo },
        { provide: getRepositoryToken(SceneLandPlot), useValue: plotRepo },
        {
          provide: getRepositoryToken(BuildingInstance),
          useValue: buildingRepo,
        },
      ],
    }).compile();

    service = module.get(BuildRuleService);
  });

  // ===== Step 3-1 格点换算与边界 =====
  describe('格点换算与边界', () => {
    it('toGrid/toCenter 按 gridSize 换算', () => {
      expect(service.toGrid(100, 100, 64)).toEqual({ gx: 1, gy: 1 });
      expect(service.toGrid(0, 63, 64)).toEqual({ gx: 0, gy: 0 });
      expect(service.toCenter(1, 1, 64)).toEqual({ x: 96, y: 96 });
      expect(service.toCenter(0, 0, 64)).toEqual({ x: 32, y: 32 });
    });

    it('assertCanBuild：场景外格点抛 PARAM_INVALID（15×15 网格，gx=15）', async () => {
      await expectGameCode(
        service.assertCanBuild(SCENE_ID, PLAYER_ID, 15, 3),
        ErrorCodes.PARAM_INVALID,
      );
      await expectGameCode(
        service.assertCanBuild(SCENE_ID, PLAYER_ID, 3, 15),
        ErrorCodes.PARAM_INVALID,
      );
      await expectGameCode(
        service.assertCanBuild(SCENE_ID, PLAYER_ID, -1, 3),
        ErrorCodes.PARAM_INVALID,
      );
    });

    it('assertCanBuild：场景不存在抛 PARAM_INVALID', async () => {
      sceneRepo.findOne.mockResolvedValue(null);
      await expectGameCode(
        service.assertCanBuild(SCENE_ID, PLAYER_ID, 1, 1),
        ErrorCodes.PARAM_INVALID,
      );
    });

    it('getRule：无规则行返回 forbidden 默认视图', async () => {
      ruleRepo.findOne.mockResolvedValue(null);
      const view = await service.getRule(SCENE_ID);
      expect(view).toEqual({
        id: null,
        sceneId: SCENE_ID,
        mode: BuildMode.FORBIDDEN,
        landGridSize: 64,
        maxBuildingsPerPlayer: 0,
        allowDemolish: false,
        coopMinContributors: 2,
        coopExpireHours: 24,
        reservedZones: [],
      });
    });

    it('assertCanBuild：mode=forbidden 抛 BUILD_FORBIDDEN', async () => {
      ruleRepo.findOne.mockResolvedValue(
        makeRuleRow({ mode: BuildMode.FORBIDDEN }),
      );
      await expectGameCode(
        service.assertCanBuild(SCENE_ID, PLAYER_ID, 1, 1),
        ErrorCodes.BUILD_FORBIDDEN,
      );
    });
  });

  // ===== Step 3-2 保留区拒绝（半开区间）=====
  describe('保留区', () => {
    beforeEach(() => {
      ruleRepo.findOne.mockResolvedValue(
        makeRuleRow({ reservedZones: [{ x: 0, y: 0, w: 2, h: 2 }] }),
      );
    });

    it('inReservedZone 按格点半开区间判定', () => {
      const rule = { reservedZones: [{ x: 0, y: 0, w: 2, h: 2 }] } as any;
      expect(service.inReservedZone(rule, 0, 0)).toBe(true);
      expect(service.inReservedZone(rule, 1, 1)).toBe(true);
      expect(service.inReservedZone(rule, 2, 2)).toBe(false);
      expect(service.inReservedZone(rule, 0, 2)).toBe(false);
    });

    it('命中保留区抛 BUILD_FORBIDDEN', async () => {
      await expectGameCode(
        service.assertCanBuild(SCENE_ID, PLAYER_ID, 1, 1),
        ErrorCodes.BUILD_FORBIDDEN,
      );
    });

    it('半开区间边界 (2,2) 通过', async () => {
      const view = await service.assertCanBuild(SCENE_ID, PLAYER_ID, 2, 2);
      expect(view.mode).toBe(BuildMode.SOLO);
      expect(view.id).toBe('9');
    });
  });

  // ===== Step 3-3 上限拒绝 =====
  describe('建造上限', () => {
    it('countPlayerBuildings >= max 抛 BUILD_LIMIT_REACHED', async () => {
      ruleRepo.findOne.mockResolvedValue(
        makeRuleRow({ maxBuildingsPerPlayer: 1 }),
      );
      jest.spyOn(service, 'countPlayerBuildings').mockResolvedValue(1);
      await expectGameCode(
        service.assertCanBuild(SCENE_ID, PLAYER_ID, 3, 3),
        ErrorCodes.BUILD_LIMIT_REACHED,
      );
    });

    it('未达上限时返回规则视图（复用，避免二次查询）', async () => {
      ruleRepo.findOne.mockResolvedValue(
        makeRuleRow({ maxBuildingsPerPlayer: 5 }),
      );
      jest.spyOn(service, 'countPlayerBuildings').mockResolvedValue(4);
      const view = await service.assertCanBuild(SCENE_ID, PLAYER_ID, 3, 3);
      expect(view.maxBuildingsPerPlayer).toBe(5);
      expect(ruleRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('countPlayerBuildings 只统计 building/built（不含 demolishing）', async () => {
      buildingRepo.count.mockResolvedValue(2);
      const n = await service.countPlayerBuildings(SCENE_ID, PLAYER_ID);
      expect(n).toBe(2);
      const arg = buildingRepo.count.mock.calls[0][0];
      expect(arg.where.sceneId).toBe(SCENE_ID);
      expect(arg.where.ownerType).toBe(BuildingOwnerType.PLAYER);
      expect(arg.where.ownerId).toBe(PLAYER_ID);
      // TypeORM In([...]) 的取值
      expect((arg.where.state as any)._value).toEqual([
        BuildingState.BUILDING,
        BuildingState.BUILT,
      ]);
    });
  });

  // ===== Step 3-4 并发 ensurePlot =====
  describe('ensurePlot（唯一索引互斥）', () => {
    it('两次并行 ensurePlot 只落一行，返回同一 id', async () => {
      const [p1, p2] = await Promise.all([
        service.ensurePlot(SCENE_ID, 3, 4),
        service.ensurePlot(SCENE_ID, 3, 4),
      ]);

      expect(p1.id).toBe(p2.id);
      expect(plotRepo.rows.size).toBe(1);
      expect(p1.state).toBe(PlotState.EMPTY);
      // 两个调用各自都执行了一次 insert（冲突方被 ON CONFLICT 忽略）
      expect(plotRepo.insertCalls).toBe(2);
    });

    it('已存在且 empty：直接返回，不 insert', async () => {
      plotRepo.rows.set(`${SCENE_ID}|5|6`, {
        id: '42',
        sceneId: SCENE_ID,
        gx: 5,
        gy: 6,
        w: 1,
        h: 1,
        state: PlotState.EMPTY,
      } as any);

      const plot = await service.ensurePlot(SCENE_ID, 5, 6);
      expect(plot.id).toBe('42');
      expect(plotRepo.insertCalls).toBe(0);
    });

    it('已占用地块再 ensurePlot 抛 PLOT_OCCUPIED', async () => {
      plotRepo.rows.set(`${SCENE_ID}|1|1`, {
        id: '1',
        sceneId: SCENE_ID,
        gx: 1,
        gy: 1,
        w: 1,
        h: 1,
        state: PlotState.OCCUPIED,
      } as any);

      await expectGameCode(
        service.ensurePlot(SCENE_ID, 1, 1),
        ErrorCodes.PLOT_OCCUPIED,
      );
    });

    it('locked 地块同样抛 PLOT_OCCUPIED', async () => {
      plotRepo.rows.set(`${SCENE_ID}|2|2`, {
        id: '2',
        sceneId: SCENE_ID,
        gx: 2,
        gy: 2,
        w: 1,
        h: 1,
        state: PlotState.LOCKED,
      } as any);

      await expect(service.ensurePlot(SCENE_ID, 2, 2)).rejects.toThrow(
        GameException,
      );
      await expectGameCode(
        service.ensurePlot(SCENE_ID, 2, 2),
        ErrorCodes.PLOT_OCCUPIED,
      );
    });
  });
});