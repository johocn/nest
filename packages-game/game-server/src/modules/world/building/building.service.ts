import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import {
  BuildMode,
  BuildingOwnerType,
  BuildingState,
  PlotState,
} from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { InventoryService } from '@modules/inventory/inventory.service';
import { EconomyService } from '@modules/economy/economy.service';
import { Scene } from '../entities/scene.entity';
import { BuildingTemplate } from '../entities/building-template.entity';
import { BuildingInstance } from '../entities/building-instance.entity';
import { BuildingCoopContribution } from '../entities/building-coop-contribution.entity';
import { SceneLandPlot } from '../entities/scene-land-plot.entity';
import { ContributeCostEntryDto, CreateBuildingDto } from '../dto/building.dto';
import { BuildRuleService } from './build-rule.service';
import {
  BuildCostEntry,
  DeductionPlanItem,
  assertCurrencyType,
  parseBuildCost,
  planCompensations,
  planDeductions,
} from './build-cost';

/** 建造相关资源流水来源标识 */
const BUILDING_SOURCE = 'building';

/** 建造状态变更广播载荷（gateway 据此向 scene:<id> 房间广播） */
export interface BuildingStateChangedPayload {
  sceneId: string;
  buildingId: string;
  templateId: string;
  ownerId: string;
  state: BuildingState;
  /** 建筑锚点格中心像素坐标 */
  x: number;
  y: number;
  rotation: number;
}

/** 建筑视图（HTTP 响应体，Task 6 复用） */
export interface BuildingView {
  id: string;
  sceneId: string;
  templateId: string;
  ownerId: string;
  state: BuildingState;
  finishAt: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 共建投料结果（Task 6 的 contribute 接口直接复用） */
export interface ContributeResult {
  /** 投料后的建筑视图（达标时 finishAt 已改写为落成时刻） */
  building: BuildingView;
  /** 本次投料后是否已达标 */
  reached: boolean;
  /** 该实例当前去重参与者数 */
  contributors: number;
}

/** 建筑拆除结果（Task 6 的 demolish 接口直接复用） */
export interface DemolishResult {
  /** 拆除后（state=demolishing）的建筑视图 */
  building: BuildingView;
  /**
   * 恒为 false：拆除不退料/不退币（计划 D7）。
   * 若允许退款，「建 → 拆 → 再建」即可无损刷建造次数/进度，故明确不退款。
   */
  refunded: boolean;
}

/**
 * 单独建造与共同建造服务（S6 / Task 3、Task 4、Task 5）。
 *
 * 单独建造执行顺序（硬要求）：全部校验 → 逐项扣料（边扣边记，失败逆向补偿）→ 写实例 → 置地块占用 → 发事件。
 * 共建执行顺序（硬要求）：查实例/规则/超时/达标校验 → 逐项扣料并逐条落流水（失败先删本次流水再逆向补偿）→ 统计达标 → 改写 finishAt。
 * 多格占地：footprint_w/h 为矩形格数，(gx,gy) 为左上角锚点格，锚点即 building_instances.plot_id。
 *
 * 共建 finish_at 采用【超时时刻】语义：
 *  - 创建时 `finish_at = now + coop_expire_hours * 3600_000`；
 *  - 达标时改写为 `now + build_seconds * 1000`（此后由 scheduler 正常落成）；
 *  - 未达标且已过超时 → scheduler 逐条原路全额退款（不扣税），实例置 demolishing 并释放地块。
 */
@Injectable()
export class BuildingService {
  private readonly logger = new Logger(BuildingService.name);

  constructor(
    @InjectRepository(Scene)
    private readonly sceneRepo: Repository<Scene>,
    @InjectRepository(BuildingTemplate)
    private readonly templateRepo: Repository<BuildingTemplate>,
    @InjectRepository(BuildingInstance)
    private readonly buildingRepo: Repository<BuildingInstance>,
    @InjectRepository(BuildingCoopContribution)
    private readonly contributionRepo: Repository<BuildingCoopContribution>,
    @InjectRepository(SceneLandPlot)
    private readonly plotRepo: Repository<SceneLandPlot>,
    private readonly buildRule: BuildRuleService,
    private readonly inventoryService: InventoryService,
    private readonly economyService: EconomyService,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * 单独建造：校验 → 扣料 → 写实例与地块 → 发事件。
   * 任一扣料失败立刻中止并逆向补偿已扣项（补偿失败仅记日志，不掩盖原业务异常）。
   */
  async createBuilding(
    playerId: string,
    sceneId: string,
    dto: CreateBuildingDto,
  ): Promise<BuildingView> {
    const { templateId, gx, gy } = dto;

    // 1. 前置校验（模式/边界/保留区/上限）—— forbidden 已由 assertCanBuild 拦截
    const rule = await this.buildRule.assertCanBuild(sceneId, playerId, gx, gy);
    if (rule.mode !== BuildMode.SOLO) {
      throw new GameException(ErrorCodes.BUILD_FORBIDDEN, '该场景不适用单独建造');
    }

    // 2. 蓝图校验（不校验 unlock_condition，本批不做）
    const template = await this.templateRepo.findOne({
      where: { id: templateId },
    });
    if (!template || template.isActive !== true) {
      throw new GameException(
        ErrorCodes.PARAM_INVALID,
        '建筑蓝图不存在或已停用',
      );
    }

    const w = template.footprintW ?? 1;
    const h = template.footprintH ?? 1;

    // 3. 矩形越界校验（assertCanBuild 只校验锚点）
    const scene = await this.sceneRepo.findOne({ where: { id: sceneId } });
    if (!scene) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '场景不存在');
    }
    const maxGx = Math.floor(scene.mapWidth / rule.landGridSize);
    const maxGy = Math.floor(scene.mapHeight / rule.landGridSize);
    if (gx + w > maxGx || gy + h > maxGy) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '建筑占地超出场景范围');
    }

    // 4. 解析并校验建造消耗
    const cost = parseBuildCost(template.buildCost);

    // 5. 逐格创建/校验地块（任一格被占即抛 PLOT_OCCUPIED）
    const cells: Array<{ i: number; j: number; plot: SceneLandPlot }> = [];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const plot = await this.buildRule.ensurePlot(sceneId, gx + i, gy + j);
        cells.push({ i, j, plot });
      }
    }
    const anchor = cells[0].plot;

    // 6. 逐项扣料（失败立即逆向补偿并抛出原异常）
    const plan = planDeductions(cost);
    const opTrace = `${BUILDING_SOURCE}:${template.id}:build`;
    const refundTrace = `${BUILDING_SOURCE}:${template.id}:refund`;
    const done: DeductionPlanItem[] = [];
    for (const item of plan) {
      try {
        await this.applyDeduction(playerId, item, opTrace, template.id);
      } catch (err) {
        await this.compensate(playerId, done, refundTrace, template.id);
        throw err;
      }
      done.push(item);
    }

    // 7. 写建筑实例
    const saved = await this.buildingRepo.save(
      this.buildingRepo.create({
        sceneId,
        plotId: anchor.id,
        templateId: template.id,
        ownerType: BuildingOwnerType.PLAYER,
        ownerId: playerId,
        state: BuildingState.BUILDING,
        finishAt: new Date(Date.now() + template.buildSeconds * 1000),
        durability: template.durability,
        payload: { gx, gy, w, h, effect: template.effect },
      }),
    );

    // 8. 置矩形内所有地块为 occupied（锚点格记录 footprint 尺寸，其余保持 1×1）
    for (const cell of cells) {
      cell.plot.state = PlotState.OCCUPIED;
      if (cell.i === 0 && cell.j === 0) {
        cell.plot.w = w;
        cell.plot.h = h;
      }
    }
    await this.plotRepo.save(cells.map((cell) => cell.plot));

    // 9. 广播状态变更
    const { x, y } = this.buildRule.toCenter(gx, gy, rule.landGridSize);
    this.eventBus.emit(GameEvents.BUILDING_STATE_CHANGED, {
      sceneId,
      buildingId: saved.id,
      templateId: saved.templateId,
      ownerId: saved.ownerId,
      state: BuildingState.BUILDING,
      x,
      y,
      rotation: 0,
    } satisfies BuildingStateChangedPayload);

    // 10. 返回视图
    return this.toBuildingView(saved, rule.landGridSize);
  }

  /**
   * 共同建造（coop）：与单独建造同流程，差异仅在模式校验与计时语义。
   * `finish_at = now + coop_expire_hours * 3600_000`（超时时刻，非落成时刻）；
   * `payload.coop=true`、`payload.reached=false`：scheduler 据此跳过「到期即落成」，改走超时退款。
   */
  async createCoopBuilding(
    playerId: string,
    sceneId: string,
    dto: CreateBuildingDto,
  ): Promise<BuildingView> {
    const { templateId, gx, gy } = dto;

    // 1. 前置校验（模式/边界/保留区/上限）
    const rule = await this.buildRule.assertCanBuild(sceneId, playerId, gx, gy);
    if (rule.mode !== BuildMode.COOP) {
      throw new GameException(ErrorCodes.BUILD_FORBIDDEN, '该场景不适用共同建造');
    }

    // 2. 蓝图校验
    const template = await this.templateRepo.findOne({
      where: { id: templateId },
    });
    if (!template || template.isActive !== true) {
      throw new GameException(
        ErrorCodes.PARAM_INVALID,
        '建筑蓝图不存在或已停用',
      );
    }

    const w = template.footprintW ?? 1;
    const h = template.footprintH ?? 1;

    // 3. 矩形越界校验（assertCanBuild 只校验锚点）
    const scene = await this.sceneRepo.findOne({ where: { id: sceneId } });
    if (!scene) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '场景不存在');
    }
    const maxGx = Math.floor(scene.mapWidth / rule.landGridSize);
    const maxGy = Math.floor(scene.mapHeight / rule.landGridSize);
    if (gx + w > maxGx || gy + h > maxGy) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '建筑占地超出场景范围');
    }

    // 4. 解析并校验建造消耗
    const cost = parseBuildCost(template.buildCost);

    // 5. 逐格创建/校验地块
    const cells: Array<{ i: number; j: number; plot: SceneLandPlot }> = [];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const plot = await this.buildRule.ensurePlot(sceneId, gx + i, gy + j);
        cells.push({ i, j, plot });
      }
    }
    const anchor = cells[0].plot;

    // 6. 逐项扣料（失败立即逆向补偿并抛出原异常）
    const plan = planDeductions(cost);
    const opTrace = `${BUILDING_SOURCE}:${template.id}:build`;
    const refundTrace = `${BUILDING_SOURCE}:${template.id}:refund`;
    const done: DeductionPlanItem[] = [];
    for (const item of plan) {
      try {
        await this.applyDeduction(playerId, item, opTrace, template.id);
      } catch (err) {
        await this.compensate(playerId, done, refundTrace, template.id);
        throw err;
      }
      done.push(item);
    }

    // 7. 写建筑实例（finish_at = 超时时刻）
    const saved = await this.buildingRepo.save(
      this.buildingRepo.create({
        sceneId,
        plotId: anchor.id,
        templateId: template.id,
        ownerType: BuildingOwnerType.PLAYER,
        ownerId: playerId,
        state: BuildingState.BUILDING,
        finishAt: new Date(
          Date.now() + rule.coopExpireHours * 3600_000,
        ),
        durability: template.durability,
        payload: {
          gx,
          gy,
          w,
          h,
          effect: template.effect,
          coop: true,
          reached: false,
        },
      }),
    );

    // 8. 置矩形内所有地块为 occupied
    for (const cell of cells) {
      cell.plot.state = PlotState.OCCUPIED;
      if (cell.i === 0 && cell.j === 0) {
        cell.plot.w = w;
        cell.plot.h = h;
      }
    }
    await this.plotRepo.save(cells.map((cell) => cell.plot));

    // 9. 广播状态变更
    const { x, y } = this.buildRule.toCenter(gx, gy, rule.landGridSize);
    this.eventBus.emit(GameEvents.BUILDING_STATE_CHANGED, {
      sceneId,
      buildingId: saved.id,
      templateId: saved.templateId,
      ownerId: saved.ownerId,
      state: BuildingState.BUILDING,
      x,
      y,
      rotation: 0,
    } satisfies BuildingStateChangedPayload);

    // 10. 返回视图
    return this.toBuildingView(saved, rule.landGridSize);
  }

  /**
   * 共同建造投料：逐项扣料 + 逐条落流水，全部成本项同类合计达标**且**去重参与者数达标时改写 finish_at。
   * opTrace = `building:<templateId>:contribute`；流水行按 kind 写 itemId / currencyType（另一端为 null）。
   * 任一扣料/流水写入失败：先删本次已插流水，再逆向补偿已扣项，最后抛原异常（不残留半成品流水）。
   */
  async contribute(
    playerId: string,
    buildingId: string,
    items: ContributeCostEntryDto[],
  ): Promise<ContributeResult> {
    // 1. 查实例
    const building = await this.buildingRepo.findOne({
      where: { id: buildingId },
    });
    if (!building || building.state !== BuildingState.BUILDING) {
      throw new GameException(ErrorCodes.BUILD_NOT_FOUND, '建筑不存在或不可投料');
    }

    // 2. 规则校验（仅 coop 场景可投料）
    const rule = await this.buildRule.getRule(building.sceneId);
    if (rule.mode !== BuildMode.COOP) {
      throw new GameException(ErrorCodes.BUILD_FORBIDDEN, '该场景不适用共同建造');
    }

    // 3. 已超时
    if (
      building.finishAt &&
      new Date(building.finishAt).getTime() <= Date.now()
    ) {
      throw new GameException(ErrorCodes.COOP_EXPIRED, '共建已超时');
    }

    // 4. 已达标的行不再受理投料
    const currentPayload = building.payload ?? {};
    if (currentPayload.reached === true) {
      throw new GameException(ErrorCodes.COOP_NOT_READY, '共建已达标，不再受理投料');
    }

    // 5. 解析并校验投料内容（空数组视为非法）
    const cost = parseBuildCost(items);
    if (cost.length === 0) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '投料内容不能为空');
    }

    // 6. 蓝图（达标后改写 finish_at 需要 build_seconds；达标目标需要 build_cost）
    const template = await this.templateRepo.findOne({
      where: { id: building.templateId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '建筑蓝图不存在');
    }

    // 7. 逐项扣料 + 逐条落流水（失败先删本次流水，再逆向补偿）
    const plan = planDeductions(cost);
    const opTrace = `${BUILDING_SOURCE}:${building.templateId}:contribute`;
    const refundTrace = `${BUILDING_SOURCE}:${building.templateId}:refund`;
    const inserted: BuildingCoopContribution[] = [];
    const done: DeductionPlanItem[] = [];
    for (const item of plan) {
      try {
        await this.applyDeduction(
          playerId,
          item,
          opTrace,
          building.templateId,
        );
        done.push(item);
        const row = await this.contributionRepo.save(
          this.contributionRepo.create({
            buildingInstanceId: building.id,
            playerId,
            itemId: item.kind === 'item' ? item.id : null,
            currencyType: item.kind === 'currency' ? item.id : null,
            amount: item.amount,
            refunded: false,
          }),
        );
        inserted.push(row);
      } catch (err) {
        await this.removeContributions(inserted);
        await this.compensate(
          playerId,
          done,
          refundTrace,
          building.templateId,
        );
        throw err;
      }
    }

    // 8. 统计未退款流水 → 达标判定
    const rows = await this.contributionRepo.find({
      where: { buildingInstanceId: building.id, refunded: false },
    });
    const contributors = new Set(rows.map((row) => row.playerId)).size;
    const reached =
      contributors >= rule.coopMinContributors &&
      this.costSatisfied(parseBuildCost(template.buildCost), rows);

    // 9. 达标 → 标记 reached 并改写 finish_at 为落成时刻
    if (reached) {
      const payload = building.payload ?? {};
      payload.reached = true;
      payload.coopReachedAt = new Date().toISOString();
      building.payload = payload;
      building.finishAt = new Date(Date.now() + (template.buildSeconds ?? 0) * 1000);
      await this.buildingRepo.save(building);

      const { x, y } = this.buildRule.toCenter(
        Number(payload.gx ?? 0),
        Number(payload.gy ?? 0),
        rule.landGridSize,
      );
      this.eventBus.emit(GameEvents.BUILDING_STATE_CHANGED, {
        sceneId: building.sceneId,
        buildingId: building.id,
        templateId: building.templateId,
        ownerId: building.ownerId,
        state: BuildingState.BUILDING,
        x,
        y,
        rotation: 0,
      } satisfies BuildingStateChangedPayload);
    }

    return {
      building: this.toBuildingView(building, rule.landGridSize),
      reached,
      contributors,
    };
  }

  /**
   * 共建超时退款（由 scheduler 在 withLock 内调用，逻辑放 service 便于单测）。
   * 幂等：锁内重读后，实例不存在 / 非 building / 已达标 / 未超时 → 直接返回。
   * 逐条退未退款流水，**每条成功立刻 refunded=true 落库**；某条失败记 error 后 throw
   * （不吞异常、不继续后续实例状态变更与地块释放），下一 tick 重试且已退成功的不重复退。
   * 全部退完才置 demolishing、释放矩形内地块、发事件。
   */
  async refundExpiredCoop(buildingId: string): Promise<void> {
    const building = await this.buildingRepo.findOne({
      where: { id: buildingId },
    });
    if (!building) return;
    if (building.state !== BuildingState.BUILDING) return;

    const payload = building.payload ?? {};
    if (payload.reached === true) return;
    if (
      !building.finishAt ||
      new Date(building.finishAt).getTime() > Date.now()
    ) {
      return;
    }

    const rows = await this.contributionRepo.find({
      where: { buildingInstanceId: building.id, refunded: false },
      order: { id: 'ASC' },
    });
    const refundTrace = `${BUILDING_SOURCE}:${building.templateId}:refund`;
    for (const row of rows) {
      try {
        if (row.itemId) {
          await this.inventoryService.addItem(
            row.playerId,
            row.itemId,
            row.amount,
            refundTrace,
          );
        } else if (row.currencyType) {
          await this.economyService.addCurrency(
            row.playerId,
            assertCurrencyType(row.currencyType),
            row.amount,
            BUILDING_SOURCE,
            refundTrace,
            building.templateId,
          );
        }
        row.refunded = true;
        await this.contributionRepo.save(row);
      } catch (err) {
        this.logger.error(
          `共建超时退款失败: building=${building.id} contribution=${row.id} player=${row.playerId}`,
          (err as Error).message,
        );
        throw err;
      }
    }

    // 全部退完 → 置 demolishing
    building.state = BuildingState.DEMOLISHING;
    await this.buildingRepo.save(building);

    // 释放矩形内地块（gx/gy 为左上角锚点，半开区间 [gx, gx+w) × [gy, gy+h)）
    const gx = Number(payload.gx ?? 0);
    const gy = Number(payload.gy ?? 0);
    const w = Number(payload.w ?? 1);
    const h = Number(payload.h ?? 1);
    const plots = await this.plotRepo.find({
      where: {
        sceneId: building.sceneId,
        gx: Between(gx, gx + w - 1),
        gy: Between(gy, gy + h - 1),
      },
    });
    if (plots.length > 0) {
      for (const plot of plots) {
        plot.state = PlotState.EMPTY;
        plot.w = 1;
        plot.h = 1;
      }
      await this.plotRepo.save(plots);
    }

    // 广播状态变更
    const rule = await this.buildRule.getRule(building.sceneId);
    const { x, y } = this.buildRule.toCenter(gx, gy, rule.landGridSize);
    this.eventBus.emit(GameEvents.BUILDING_STATE_CHANGED, {
      sceneId: building.sceneId,
      buildingId: building.id,
      templateId: building.templateId,
      ownerId: building.ownerId,
      state: BuildingState.DEMOLISHING,
      x,
      y,
      rotation: 0,
    } satisfies BuildingStateChangedPayload);

    // 终态与 demolish 保持一致：软删实例（TypeORM 默认过滤软删行 → listBuildings 不再返回该残行）
    await this.buildingRepo.softDelete(building.id);
  }

  /**
   * 拆除建筑（S6 / Task 5）。
   *
   * 校验顺序固定（测试断言错误码）：
   *  1. 实例不存在 / 已被软删 → BUILD_NOT_FOUND；
   *  2. `state !== built` → BUILD_NOT_FOUND（建造中/拆除中不可拆）；
   *  3. `allow_demolish !== true` → BUILD_FORBIDDEN；
   *  4. 非 player 所有者 / ownerId 不符 → BUILD_FORBIDDEN。
   *
   * 终态：置 `demolishing` + `finish_at=null` → emit（让在线客户端淡出）→ 释放矩形内地块 → 软删实例。
   * **不退款**（计划 D7）：不调用任何扣料/发料途径，避免「建 → 拆 → 再建」无损刷料。
   */
  async demolish(playerId: string, buildingId: string): Promise<DemolishResult> {
    // 1. 查实例（软删行由 TypeORM 默认过滤 → 视同不存在）
    const building = await this.buildingRepo.findOne({
      where: { id: buildingId },
    });
    if (!building || building.state !== BuildingState.BUILT) {
      throw new GameException(ErrorCodes.BUILD_NOT_FOUND, '建筑不存在或不可拆除');
    }

    // 2. 规则：该场景是否允许拆除
    const rule = await this.buildRule.getRule(building.sceneId);
    if (rule.allowDemolish !== true) {
      throw new GameException(ErrorCodes.BUILD_FORBIDDEN, '该场景不允许拆除');
    }

    // 3. 所有者校验（仅 player 类型且 owner_id 一致）
    if (
      building.ownerType !== BuildingOwnerType.PLAYER ||
      building.ownerId !== playerId
    ) {
      throw new GameException(ErrorCodes.BUILD_FORBIDDEN, '只有建筑所有者可拆除');
    }

    // 4. 置拆除中（清 finish_at）
    building.state = BuildingState.DEMOLISHING;
    building.finishAt = null;
    await this.buildingRepo.save(building);

    // 5. 广播：让在线客户端淡出
    const payload = building.payload ?? {};
    const gx = Number(payload.gx ?? 0);
    const gy = Number(payload.gy ?? 0);
    const w = Number(payload.w ?? 1);
    const h = Number(payload.h ?? 1);
    const { x, y } = this.buildRule.toCenter(gx, gy, rule.landGridSize);
    this.eventBus.emit(GameEvents.BUILDING_STATE_CHANGED, {
      sceneId: building.sceneId,
      buildingId: building.id,
      templateId: building.templateId,
      ownerId: building.ownerId,
      state: BuildingState.DEMOLISHING,
      x,
      y,
      rotation: 0,
    } satisfies BuildingStateChangedPayload);

    // 6. 释放矩形内地块（半开区间 [gx, gx+w) × [gy, gy+h)）
    const plots = await this.plotRepo.find({
      where: {
        sceneId: building.sceneId,
        gx: Between(gx, gx + w - 1),
        gy: Between(gy, gy + h - 1),
      },
    });
    if (plots.length > 0) {
      for (const plot of plots) {
        plot.state = PlotState.EMPTY;
        plot.w = 1;
        plot.h = 1;
      }
      await this.plotRepo.save(plots);
    }

    // 7. 软删实例（后续 listBuildings / 地块复用天然不受影响）
    await this.buildingRepo.softDelete(building.id);

    this.logger.log(
      `建筑拆除: building=${building.id} scene=${building.sceneId} owner=${building.ownerId} refunded=false（D7 不退款）`,
    );

    return {
      building: this.toBuildingView(building, rule.landGridSize),
      refunded: false,
    };
  }

  /** 场景内建筑列表（Task 6 的 GET 接口复用） */
  async listBuildings(
    sceneId: string,
    opts?: { ownerId?: string },
  ): Promise<BuildingView[]> {
    const rows = await this.buildingRepo.find({
      where: opts?.ownerId
        ? { sceneId, ownerId: opts.ownerId }
        : { sceneId },
      order: { id: 'ASC' },
    });
    const rule = await this.buildRule.getRule(sceneId);
    return rows.map((row) => this.toBuildingView(row, rule.landGridSize));
  }

  /** 删除本次投料已落库的流水（失败仅记日志，不掩盖原始业务异常） */
  private async removeContributions(
    rows: BuildingCoopContribution[],
  ): Promise<void> {
    if (rows.length === 0) return;
    try {
      await this.contributionRepo.remove(rows);
    } catch (err) {
      this.logger.error('投料失败回滚流水异常', (err as Error).message);
    }
  }

  /**
   * 成本项逐项比对：对 build_cost 每个 entry，其在未退款流水中的同类合计 ≥ entry.amount。
   * 用逐项口径而非总额，避免「多投低成本项掩盖缺高成本项」。
   */
  private costSatisfied(
    cost: BuildCostEntry[],
    rows: BuildingCoopContribution[],
  ): boolean {
    return cost.every((entry) => {
      const target =
        entry.itemTemplateId !== undefined
          ? entry.itemTemplateId
          : (entry.currencyType as string);
      const isItem = entry.itemTemplateId !== undefined;
      const sum = rows.reduce((acc, row) => {
        const matched = isItem
          ? row.itemId === target
          : row.currencyType === target;
        return matched ? acc + Number(row.amount) : acc;
      }, 0);
      return sum >= entry.amount;
    });
  }

  /** 单次扣减：道具走 removeItem，货币走 deductCurrency */
  private async applyDeduction(
    playerId: string,
    item: DeductionPlanItem,
    opTrace: string,
    relatedId: string,
  ): Promise<void> {
    if (item.kind === 'item') {
      await this.inventoryService.removeItem(
        playerId,
        item.id,
        item.amount,
        opTrace,
      );
      return;
    }
    await this.economyService.deductCurrency(
      playerId,
      assertCurrencyType(item.id),
      item.amount,
      BUILDING_SOURCE,
      opTrace,
      relatedId,
    );
  }

  /** 逆向补偿已扣项；单条补偿失败仅记日志，绝不吞掉原始业务异常 */
  private async compensate(
    playerId: string,
    done: DeductionPlanItem[],
    refundTrace: string,
    relatedId: string,
  ): Promise<void> {
    for (const item of planCompensations(done)) {
      try {
        if (item.kind === 'item') {
          await this.inventoryService.addItem(
            playerId,
            item.id,
            item.amount,
            refundTrace,
          );
        } else {
          await this.economyService.addCurrency(
            playerId,
            assertCurrencyType(item.id),
            item.amount,
            BUILDING_SOURCE,
            refundTrace,
            relatedId,
          );
        }
      } catch (err) {
        this.logger.error(
          `建造扣料补偿失败: player=${playerId} kind=${item.kind} id=${item.id}`,
          (err as Error).message,
        );
      }
    }
  }

  /** 实体 → 视图（x/y 由锚点格中心像素换算） */
  private toBuildingView(
    instance: BuildingInstance,
    gridSize: number,
  ): BuildingView {
    const payload = instance.payload ?? {};
    const gx = Number(payload.gx ?? 0);
    const gy = Number(payload.gy ?? 0);
    const { x, y } = this.buildRule.toCenter(gx, gy, gridSize);
    return {
      id: instance.id,
      sceneId: instance.sceneId,
      templateId: instance.templateId,
      ownerId: instance.ownerId,
      state: instance.state,
      finishAt: instance.finishAt
        ? new Date(instance.finishAt).toISOString()
        : null,
      x,
      y,
      w: Number(payload.w ?? 1),
      h: Number(payload.h ?? 1),
    };
  }
}