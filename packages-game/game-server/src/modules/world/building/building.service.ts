import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
import { SceneLandPlot } from '../entities/scene-land-plot.entity';
import { CreateBuildingDto } from '../dto/building.dto';
import { BuildRuleService } from './build-rule.service';
import {
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

/**
 * 单独建造服务（S6 / Task 3）。
 *
 * 执行顺序（硬要求）：全部校验 → 逐项扣料（边扣边记，失败逆向补偿）→ 写实例 → 置地块占用 → 发事件。
 * 多格占地：footprint_w/h 为矩形格数，(gx,gy) 为左上角锚点格，锚点即 building_instances.plot_id。
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