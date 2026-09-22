import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BuildingState } from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';
import { BuildingTemplate } from '../entities/building-template.entity';
import { BuildingInstance } from '../entities/building-instance.entity';
import { SceneBuildRule } from '../entities/scene-build-rule.entity';
import { BuildRuleService } from './build-rule.service';
import type { BuildRuleView } from './build-rule.service';
import type { BuildingView } from './building.service';
import {
  BuildingTemplateUpsertDto,
  UpsertBuildRuleDto,
} from '../dto/building.dto';

/** 蓝图列表筛选条件 */
export interface BuildingTemplateFilter {
  category?: string;
  isActive?: boolean;
}

/** 建筑实例列表筛选条件 */
export interface BuildingInstanceFilter {
  sceneId?: string;
  playerId?: string;
  state?: BuildingState;
}

/**
 * 建造系统 admin 侧服务（S6 / Task 6）。
 *
 * 承载蓝图 CRUD、场景建造规则 upsert、建筑实例列表（按场景/玩家/状态筛选）。
 * 实例列表用 building_instances 仓库直接查（BuildingService.listBuildings 不支持按玩家过滤），
 * x/y/w/h 换算统一走 BuildRuleService.toCenter，与 BuildingService.toBuildingView 口径一致。
 */
@Injectable()
export class BuildingAdminService {
  constructor(
    @InjectRepository(BuildingTemplate)
    private readonly templateRepo: Repository<BuildingTemplate>,
    @InjectRepository(BuildingInstance)
    private readonly buildingRepo: Repository<BuildingInstance>,
    @InjectRepository(SceneBuildRule)
    private readonly ruleRepo: Repository<SceneBuildRule>,
    private readonly buildRule: BuildRuleService,
  ) {}

  /** 蓝图列表（可按分类/启用态筛选） */
  async listTemplates(
    filter?: BuildingTemplateFilter,
  ): Promise<BuildingTemplate[]> {
    const where: Record<string, any> = {};
    if (filter?.category) where.category = filter.category;
    if (filter?.isActive !== undefined) where.isActive = filter.isActive;
    return this.templateRepo.find({ where, order: { id: 'ASC' } });
  }

  /** 新建蓝图 */
  async createTemplate(
    dto: BuildingTemplateUpsertDto,
  ): Promise<BuildingTemplate> {
    return this.templateRepo.save(
      this.templateRepo.create({
        name: dto.name,
        resKey: dto.resKey,
        category: dto.category,
        footprintW: dto.footprintW,
        footprintH: dto.footprintH,
        buildCost: dto.buildCost ?? [],
        buildSeconds: dto.buildSeconds,
        durability: dto.durability,
        effect: dto.effect ?? {},
        unlockCondition: dto.unlockCondition ?? null,
        isActive: dto.isActive ?? true,
      }),
    );
  }

  /** 更新蓝图（全量字段，id 不存在 → BUILD_NOT_FOUND） */
  async updateTemplate(
    id: string,
    dto: BuildingTemplateUpsertDto,
  ): Promise<BuildingTemplate> {
    const template = await this.findTemplate(id);
    template.name = dto.name;
    template.resKey = dto.resKey;
    template.category = dto.category;
    template.footprintW = dto.footprintW;
    template.footprintH = dto.footprintH;
    template.buildCost = dto.buildCost ?? [];
    template.buildSeconds = dto.buildSeconds;
    template.durability = dto.durability;
    if (dto.effect !== undefined) template.effect = dto.effect;
    if (dto.unlockCondition !== undefined) {
      template.unlockCondition = dto.unlockCondition;
    }
    if (dto.isActive !== undefined) template.isActive = dto.isActive;
    return this.templateRepo.save(template);
  }

  /** 启停蓝图（未传 isActive → 取反） */
  async toggleTemplate(
    id: string,
    isActive?: boolean,
  ): Promise<BuildingTemplate> {
    const template = await this.findTemplate(id);
    template.isActive = isActive ?? !template.isActive;
    return this.templateRepo.save(template);
  }

  /**
   * 场景建造规则 upsert：存在则更新（仅覆盖传入字段），不存在则插入；
   * 返回统一走 BuildRuleService.getRule 的视图，不自造结构。
   */
  async upsertRule(
    sceneId: string,
    dto: UpsertBuildRuleDto,
  ): Promise<BuildRuleView> {
    const existing = await this.ruleRepo.findOne({ where: { sceneId } });
    if (!existing) {
      await this.ruleRepo.save(
        this.ruleRepo.create({
          sceneId,
          mode: dto.mode,
          landGridSize: dto.landGridSize,
          maxBuildingsPerPlayer: dto.maxBuildingsPerPlayer,
          allowDemolish: dto.allowDemolish,
          coopMinContributors: dto.coopMinContributors,
          coopExpireHours: dto.coopExpireHours,
          reservedZones: dto.reservedZones,
        }),
      );
    } else {
      existing.mode = dto.mode;
      if (dto.landGridSize !== undefined) {
        existing.landGridSize = dto.landGridSize;
      }
      if (dto.maxBuildingsPerPlayer !== undefined) {
        existing.maxBuildingsPerPlayer = dto.maxBuildingsPerPlayer;
      }
      if (dto.allowDemolish !== undefined) {
        existing.allowDemolish = dto.allowDemolish;
      }
      if (dto.coopMinContributors !== undefined) {
        existing.coopMinContributors = dto.coopMinContributors;
      }
      if (dto.coopExpireHours !== undefined) {
        existing.coopExpireHours = dto.coopExpireHours;
      }
      if (dto.reservedZones !== undefined) {
        existing.reservedZones = dto.reservedZones;
      }
      await this.ruleRepo.save(existing);
    }
    return this.buildRule.getRule(sceneId);
  }

  /** 建筑实例列表（按场景/玩家/状态筛选，软删行由 TypeORM 默认过滤） */
  async listInstances(
    filter?: BuildingInstanceFilter,
  ): Promise<BuildingView[]> {
    const where: Record<string, any> = {};
    if (filter?.sceneId) where.sceneId = filter.sceneId;
    if (filter?.playerId) where.ownerId = filter.playerId;
    if (filter?.state) where.state = filter.state;

    const rows = await this.buildingRepo.find({ where, order: { id: 'ASC' } });
    const gridSizes = new Map<string, number>();
    const views: BuildingView[] = [];
    for (const row of rows) {
      let gridSize = gridSizes.get(row.sceneId);
      if (gridSize === undefined) {
        gridSize = (await this.buildRule.getRule(row.sceneId)).landGridSize;
        gridSizes.set(row.sceneId, gridSize);
      }
      views.push(this.toView(row, gridSize));
    }
    return views;
  }

  /** 查蓝图，不存在抛 BUILD_NOT_FOUND */
  private async findTemplate(id: string): Promise<BuildingTemplate> {
    const template = await this.templateRepo.findOne({ where: { id } });
    if (!template) {
      throw new GameException(ErrorCodes.BUILD_NOT_FOUND, '建筑蓝图不存在');
    }
    return template;
  }

  /** 实例 → 视图（x/y 由锚点格中心换算，与 BuildingService.toBuildingView 同口径） */
  private toView(instance: BuildingInstance, gridSize: number): BuildingView {
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