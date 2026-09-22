import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  BuildMode,
  BuildingOwnerType,
  BuildingState,
  PlotState,
} from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';
import { Scene } from '../entities/scene.entity';
import { SceneBuildRule } from '../entities/scene-build-rule.entity';
import { SceneLandPlot } from '../entities/scene-land-plot.entity';
import { BuildingInstance } from '../entities/building-instance.entity';

/** 无规则行（或未配置）时的默认格边长（像素） */
const DEFAULT_GRID_SIZE = 64;
/** 无规则行时的默认共建人数门槛 */
const DEFAULT_COOP_MIN_CONTRIBUTORS = 2;
/** 无规则行时的默认共建超时（小时） */
const DEFAULT_COOP_EXPIRE_HOURS = 24;

/** 保留区矩形：按**格点**坐标理解（半开区间 [x, x+w) × [y, y+h)） */
export interface BuildReservedZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 场景建造规则视图（Task 3/4/5/6 直接复用，字段名勿改）。
 * 无规则行时返回 forbidden 默认视图：id=null / mode=FORBIDDEN /
 * maxBuildingsPerPlayer=0 / allowDemolish=false，其余取默认值。
 */
export interface BuildRuleView {
  id: string | null;
  sceneId: string;
  mode: BuildMode;
  landGridSize: number;
  maxBuildingsPerPlayer: number;
  allowDemolish: boolean;
  coopMinContributors: number;
  coopExpireHours: number;
  reservedZones: BuildReservedZone[];
}

/**
 * 场景建造规则与地块服务（S6 / Task 2）。
 *
 * 职责：
 *  1. getRule：读取 scene_build_rules（**不加内存缓存**，运营期可改，走实时接口）；
 *  2. 格点换算：land_grid_size = 每格边长（像素），默认 64；
 *  3. assertCanBuild：建造前置校验（模式 → 边界 → 保留区 → 上限，顺序固定）；
 *  4. ensurePlot：地块懒创建，并发互斥交由唯一索引 (scene_id,gx,gy) + ON CONFLICT DO NOTHING。
 *
 * 错误语义（计划 §1.2）：
 *  - 无规则 / mode=forbidden / 命中保留区 → BUILD_FORBIDDEN；
 *  - 场景不存在 / 格点越界 → PARAM_INVALID；
 *  - 玩家建造数达上限 → BUILD_LIMIT_REACHED；
 *  - 目标地块非 empty → PLOT_OCCUPIED。
 */
@Injectable()
export class BuildRuleService {
  private readonly logger = new Logger(BuildRuleService.name);

  constructor(
    @InjectRepository(Scene)
    private readonly sceneRepo: Repository<Scene>,
    @InjectRepository(SceneBuildRule)
    private readonly ruleRepo: Repository<SceneBuildRule>,
    @InjectRepository(SceneLandPlot)
    private readonly plotRepo: Repository<SceneLandPlot>,
    @InjectRepository(BuildingInstance)
    private readonly buildingRepo: Repository<BuildingInstance>,
  ) {}

  /**
   * 读取场景建造规则。无规则行 → forbidden 默认视图（等价「该场景不允许建造」）。
   * 不加内存缓存：规则可能运营期临时调整，走实时接口（计划 D5）。
   */
  async getRule(sceneId: string): Promise<BuildRuleView> {
    const rule = await this.ruleRepo.findOne({ where: { sceneId } });
    if (!rule) {
      return {
        id: null,
        sceneId,
        mode: BuildMode.FORBIDDEN,
        landGridSize: DEFAULT_GRID_SIZE,
        maxBuildingsPerPlayer: 0,
        allowDemolish: false,
        coopMinContributors: DEFAULT_COOP_MIN_CONTRIBUTORS,
        coopExpireHours: DEFAULT_COOP_EXPIRE_HOURS,
        reservedZones: [],
      };
    }
    return {
      id: rule.id,
      sceneId: rule.sceneId,
      mode: rule.mode,
      landGridSize: rule.landGridSize,
      maxBuildingsPerPlayer: rule.maxBuildingsPerPlayer,
      allowDemolish: rule.allowDemolish,
      coopMinContributors: rule.coopMinContributors,
      coopExpireHours: rule.coopExpireHours,
      reservedZones: (rule.reservedZones ?? []) as BuildReservedZone[],
    };
  }

  /**
   * 像素坐标 → 格点坐标（纯数学换算，不做场景边界判定）。
   * gridSize = 每格边长（像素）。
   */
  toGrid(
    x: number,
    y: number,
    gridSize: number,
  ): { gx: number; gy: number } {
    return { gx: Math.floor(x / gridSize), gy: Math.floor(y / gridSize) };
  }

  /** 格点坐标 → 格中心像素坐标（纯数学换算） */
  toCenter(
    gx: number,
    gy: number,
    gridSize: number,
  ): { x: number; y: number } {
    return { x: (gx + 0.5) * gridSize, y: (gy + 0.5) * gridSize };
  }

  /**
   * 命中任一保留区返回 true。
   * 约定：gx/gy 传入**格点**坐标（与 toGrid 配合）；保留区元素按格点理解，
   * 覆盖 gx ∈ [x, x+w)、gy ∈ [y, y+h) 的半开矩形。
   */
  inReservedZone(rule: BuildRuleView, gx: number, gy: number): boolean {
    return (rule.reservedZones ?? []).some(
      (z) => gx >= z.x && gx < z.x + z.w && gy >= z.y && gy < z.y + z.h,
    );
  }

  /**
   * 玩家在场景内的有效建筑数：ownerType=player + ownerId + state ∈ (building, built)。
   * **不含 demolishing**（拆除中已释放地块，不占上限）；软删行由 TypeORM 默认过滤。
   */
  async countPlayerBuildings(
    sceneId: string,
    playerId: string,
  ): Promise<number> {
    return this.buildingRepo.count({
      where: {
        sceneId,
        ownerType: BuildingOwnerType.PLAYER,
        ownerId: playerId,
        state: In([BuildingState.BUILDING, BuildingState.BUILT]),
      },
    });
  }

  /**
   * 建造前置校验：模式 / 场景边界 / 保留区 / 玩家上限。
   * 任一不通过抛 GameException；通过则返回 BuildRuleView 供调用方复用（避免二次查询）。
   * 校验顺序固定（测试断言错误码）。
   */
  async assertCanBuild(
    sceneId: string,
    playerId: string,
    gx: number,
    gy: number,
  ): Promise<BuildRuleView> {
    // 1. 模式
    const rule = await this.getRule(sceneId);
    if (rule.mode === BuildMode.FORBIDDEN) {
      throw new GameException(ErrorCodes.BUILD_FORBIDDEN, '该场景不允许建造');
    }

    // 2. 场景边界（格数 = floor(mapWidth / 每格边长)）
    const scene = await this.sceneRepo.findOne({ where: { id: sceneId } });
    if (!scene) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '场景不存在');
    }
    const maxGx = Math.floor(scene.mapWidth / rule.landGridSize);
    const maxGy = Math.floor(scene.mapHeight / rule.landGridSize);
    if (gx < 0 || gy < 0 || gx >= maxGx || gy >= maxGy) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '格点超出场景范围');
    }

    // 3. 保留区
    if (this.inReservedZone(rule, gx, gy)) {
      throw new GameException(ErrorCodes.BUILD_FORBIDDEN, '该区域为保留区，不允许建造');
    }

    // 4. 玩家上限
    const count = await this.countPlayerBuildings(sceneId, playerId);
    if (count >= rule.maxBuildingsPerPlayer) {
      throw new GameException(ErrorCodes.BUILD_LIMIT_REACHED, '建造数量已达上限');
    }

    return rule;
  }

  /**
   * 地块懒创建。
   * 并发互斥交由唯一索引 (scene_id,gx,gy) + ON CONFLICT DO NOTHING（orIgnore），
   * **不用 withLock**（withLock 留给 Task 3/4 的结算/退款幂等）。
   */
  async ensurePlot(
    sceneId: string,
    gx: number,
    gy: number,
  ): Promise<SceneLandPlot> {
    const existing = await this.plotRepo.findOne({
      where: { sceneId, gx, gy },
    });
    if (existing) {
      if (existing.state !== PlotState.EMPTY) {
        throw new GameException(ErrorCodes.PLOT_OCCUPIED, '该地块已被占用');
      }
      return existing;
    }

    await this.plotRepo
      .createQueryBuilder()
      .insert()
      .into(SceneLandPlot)
      .values({ sceneId, gx, gy })
      .orIgnore()
      .execute();

    // 回查：或本次插入成功，或被并发方抢先插入
    const plot = await this.plotRepo.findOne({
      where: { sceneId, gx, gy },
    });
    if (!plot) {
      // 理论上不可能（插入或已存在）；不吞异常，防御性报错
      this.logger.error(
        `ensurePlot 回查失败: sceneId=${sceneId} gx=${gx} gy=${gy}`,
      );
      throw new GameException(ErrorCodes.PLOT_OCCUPIED, '该地块已被占用');
    }
    if (plot.state !== PlotState.EMPTY) {
      throw new GameException(ErrorCodes.PLOT_OCCUPIED, '该地块已被占用');
    }
    return plot;
  }
}