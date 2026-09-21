import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NpcSpawnRule } from './entities/npc-spawn-rule.entity';
import { NpcPatrolRoute } from './entities/npc-patrol-route.entity';
import {
  CreateNpcRouteDto,
  CreateNpcRuleDto,
  NpcRuleQueryDto,
  UpdateNpcRouteDto,
  UpdateNpcRuleDto,
} from './dto/npc-rule.dto';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { AdminService } from '@modules/admin/admin.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

/** 空字符串视作未关联，避免写入非法 bigint */
function normalizeId(id?: string | null): string | null {
  return id && id.trim() !== '' ? id : null;
}

@ApiTags('Admin-World')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/world')
export class NpcAdminController {
  constructor(
    @InjectRepository(NpcSpawnRule)
    private readonly ruleRepo: Repository<NpcSpawnRule>,
    @InjectRepository(NpcPatrolRoute)
    private readonly routeRepo: Repository<NpcPatrolRoute>,
    private readonly adminService: AdminService,
  ) {}

  // ---------- NPC 出现规则 ----------

  @Get('npc-rules/list')
  @ApiOperation({ summary: 'NPC 出现规则列表' })
  async listRules(@Query() query: NpcRuleQueryDto) {
    const list = await this.ruleRepo.find({
      where: query.sceneId ? { sceneId: query.sceneId } : {},
      order: { id: 'ASC' },
    });
    return { list };
  }

  @Post('npc-rules')
  @ApiOperation({ summary: '新建 NPC 出现规则' })
  async createRule(
    @Body() dto: CreateNpcRuleDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const rule = await this.ruleRepo.save(
      this.ruleRepo.create({
        sceneId: dto.sceneId,
        npcTemplateId: dto.npcTemplateId,
        ruleType: dto.ruleType,
        spawnX: dto.spawnX ?? 0,
        spawnY: dto.spawnY ?? 0,
        spawnRadius: dto.spawnRadius ?? 0,
        spawnCount: dto.spawnCount ?? 1,
        condition: dto.condition ?? null,
        patrolRouteId: normalizeId(dto.patrolRouteId),
        name: dto.name,
        isActive: dto.isActive ?? true,
      }),
    );
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'npc-rule.create',
      changeBefore: {},
      changeAfter: {
        id: rule.id,
        sceneId: rule.sceneId,
        ruleType: rule.ruleType,
        name: rule.name,
      },
    });
    return rule;
  }

  @Put('npc-rules/:id')
  @ApiOperation({ summary: '更新 NPC 出现规则' })
  async updateRule(
    @Param('id') id: string,
    @Body() dto: UpdateNpcRuleDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const rule = await this.ruleRepo.findOne({ where: { id } });
    if (!rule) {
      throw new GameException(ErrorCodes.PARAM_INVALID, 'NPC 规则不存在');
    }
    const before = {
      ruleType: rule.ruleType,
      name: rule.name,
      spawnX: rule.spawnX,
      spawnY: rule.spawnY,
      spawnRadius: rule.spawnRadius,
      spawnCount: rule.spawnCount,
      condition: rule.condition,
      patrolRouteId: rule.patrolRouteId,
      isActive: rule.isActive,
    };
    if (dto.npcTemplateId !== undefined) rule.npcTemplateId = dto.npcTemplateId;
    if (dto.ruleType !== undefined) rule.ruleType = dto.ruleType;
    if (dto.spawnX !== undefined) rule.spawnX = dto.spawnX;
    if (dto.spawnY !== undefined) rule.spawnY = dto.spawnY;
    if (dto.spawnRadius !== undefined) rule.spawnRadius = dto.spawnRadius;
    if (dto.spawnCount !== undefined) rule.spawnCount = dto.spawnCount;
    if (dto.condition !== undefined) rule.condition = dto.condition ?? null;
    if (dto.patrolRouteId !== undefined)
      rule.patrolRouteId = normalizeId(dto.patrolRouteId);
    if (dto.name !== undefined) rule.name = dto.name;
    if (dto.isActive !== undefined) rule.isActive = dto.isActive;

    const saved = await this.ruleRepo.save(rule);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'npc-rule.update',
      changeBefore: before,
      changeAfter: {
        ruleType: saved.ruleType,
        name: saved.name,
        spawnX: saved.spawnX,
        spawnY: saved.spawnY,
        spawnRadius: saved.spawnRadius,
        spawnCount: saved.spawnCount,
        condition: saved.condition,
        patrolRouteId: saved.patrolRouteId,
        isActive: saved.isActive,
      },
    });
    return saved;
  }

  @Delete('npc-rules/:id')
  @ApiOperation({ summary: '删除 NPC 出现规则（软删）' })
  async removeRule(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const rule = await this.ruleRepo.findOne({ where: { id } });
    if (!rule) {
      throw new GameException(ErrorCodes.PARAM_INVALID, 'NPC 规则不存在');
    }
    await this.ruleRepo.softRemove(rule);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'npc-rule.delete',
      changeBefore: {
        id: rule.id,
        sceneId: rule.sceneId,
        ruleType: rule.ruleType,
        name: rule.name,
      },
      changeAfter: { deleted: true },
    });
    return { success: true };
  }

  // ---------- NPC 巡逻路径 ----------

  @Get('npc-routes/list')
  @ApiOperation({ summary: 'NPC 巡逻路径列表' })
  async listRoutes(@Query() query: NpcRuleQueryDto) {
    const list = await this.routeRepo.find({
      where: query.sceneId ? { sceneId: query.sceneId } : {},
      order: { id: 'ASC' },
    });
    return { list };
  }

  @Post('npc-routes')
  @ApiOperation({ summary: '新建 NPC 巡逻路径' })
  async createRoute(
    @Body() dto: CreateNpcRouteDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const route = await this.routeRepo.save(
      this.routeRepo.create({
        sceneId: dto.sceneId,
        npcTemplateId: dto.npcTemplateId,
        name: dto.name,
        loopMode: dto.loopMode ?? undefined,
        speed: dto.speed ?? undefined,
        points: dto.points ?? [],
        isActive: dto.isActive ?? true,
      }),
    );
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'npc-route.create',
      changeBefore: {},
      changeAfter: {
        id: route.id,
        sceneId: route.sceneId,
        name: route.name,
        points: route.points.length,
      },
    });
    return route;
  }

  @Put('npc-routes/:id')
  @ApiOperation({ summary: '更新 NPC 巡逻路径' })
  async updateRoute(
    @Param('id') id: string,
    @Body() dto: UpdateNpcRouteDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const route = await this.routeRepo.findOne({ where: { id } });
    if (!route) {
      throw new GameException(ErrorCodes.PARAM_INVALID, 'NPC 巡逻路径不存在');
    }
    const before = {
      npcTemplateId: route.npcTemplateId,
      name: route.name,
      loopMode: route.loopMode,
      speed: route.speed,
      points: route.points,
      isActive: route.isActive,
    };
    if (dto.npcTemplateId !== undefined) route.npcTemplateId = dto.npcTemplateId;
    if (dto.name !== undefined) route.name = dto.name;
    if (dto.loopMode !== undefined) route.loopMode = dto.loopMode;
    if (dto.speed !== undefined) route.speed = dto.speed;
    if (dto.points !== undefined) route.points = dto.points;
    if (dto.isActive !== undefined) route.isActive = dto.isActive;

    const saved = await this.routeRepo.save(route);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'npc-route.update',
      changeBefore: before,
      changeAfter: {
        npcTemplateId: saved.npcTemplateId,
        name: saved.name,
        loopMode: saved.loopMode,
        speed: saved.speed,
        points: saved.points,
        isActive: saved.isActive,
      },
    });
    return saved;
  }

  @Delete('npc-routes/:id')
  @ApiOperation({ summary: '删除 NPC 巡逻路径（软删）' })
  async removeRoute(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const route = await this.routeRepo.findOne({ where: { id } });
    if (!route) {
      throw new GameException(ErrorCodes.PARAM_INVALID, 'NPC 巡逻路径不存在');
    }
    await this.routeRepo.softRemove(route);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'npc-route.delete',
      changeBefore: { id: route.id, sceneId: route.sceneId, name: route.name },
      changeAfter: { deleted: true },
    });
    return { success: true };
  }
}
