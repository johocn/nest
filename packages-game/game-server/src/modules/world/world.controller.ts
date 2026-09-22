import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WorldService } from './world.service';
import { CreateSceneDto } from './dto/create-scene.dto';
import { UpdateSceneDto } from './dto/update-scene.dto';
import { AdminSceneQueryDto } from './dto/admin-scene-query.dto';
import {
  PublishSceneConfigDto,
  RollbackSceneConfigDto,
} from './dto/scene-config.dto';
import {
  BuildingTemplateUpsertDto,
  ToggleBuildingTemplateDto,
  UpsertBuildRuleDto,
} from './dto/building.dto';
import { SceneConfigService } from './config/scene-config.service';
import { BuildingAdminService } from './building/building-admin.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { BuildingState } from '@constants/enums';

@ApiTags('Admin-World')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/world')
export class WorldController {
  constructor(
    private readonly worldService: WorldService,
    private readonly sceneConfigService: SceneConfigService,
    private readonly buildingAdminService: BuildingAdminService,
  ) {}

  @Get('scene/list')
  @ApiOperation({ summary: '场景列表' })
  async listScenes(@Query() query: AdminSceneQueryDto) {
    return this.worldService.getScenes(query.page ?? 1, query.limit ?? 20);
  }

  @Get('scene/:id')
  @ApiOperation({ summary: '场景详情' })
  async getScene(@Param('id') id: string) {
    return this.worldService.getScene(id);
  }

  @Post('scene')
  @ApiOperation({ summary: '创建场景' })
  async createScene(@Body() dto: CreateSceneDto) {
    return this.worldService.createScene(dto);
  }

  @Put('scene/:id')
  @ApiOperation({ summary: '更新场景' })
  async updateScene(@Param('id') id: string, @Body() dto: UpdateSceneDto) {
    return this.worldService.updateScene(id, dto);
  }

  @Get('scene/:id/spawns')
  @ApiOperation({ summary: '场景实体生成配置' })
  async getSpawns(@Param('id') id: string) {
    return this.worldService.getSceneSpawns(id);
  }

  @Get('scene/:id/triggers')
  @ApiOperation({ summary: '场景触发器列表' })
  async getTriggers(@Param('id') id: string) {
    return this.worldService.getSceneTriggers(id);
  }

  @Get('scene-config/list')
  @ApiOperation({ summary: '场景配置列表（含当前已发布版本）' })
  async listSceneConfigs() {
    return this.sceneConfigService.listScenes();
  }

  @Get('scene-config/:sceneId/versions')
  @ApiOperation({ summary: '场景配置版本历史' })
  async listSceneConfigVersions(
    @Param('sceneId') sceneId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.sceneConfigService.listVersions(
      sceneId,
      Number(page),
      Number(limit),
    );
  }

  @Post('scene-config/:sceneId/export')
  @ApiOperation({ summary: '导出场景配置包（生成 draft 版本）' })
  async exportSceneConfig(
    @Param('sceneId') sceneId: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    return this.sceneConfigService.exportScene(sceneId, admin.adminId);
  }

  @Post('scene-config/:sceneId/publish')
  @ApiOperation({ summary: '发布场景配置版本' })
  async publishSceneConfig(
    @Param('sceneId') sceneId: string,
    @Body() dto: PublishSceneConfigDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    return this.sceneConfigService.publishScene(
      sceneId,
      dto.version,
      admin.adminId,
    );
  }

  @Post('scene-config/:sceneId/rollback')
  @ApiOperation({ summary: '回滚场景配置到更早版本' })
  async rollbackSceneConfig(
    @Param('sceneId') sceneId: string,
    @Body() dto: RollbackSceneConfigDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    return this.sceneConfigService.rollbackScene(
      sceneId,
      dto.version,
      admin.adminId,
    );
  }

  // ---------- 建造系统（S6 / Task 6） ----------

  @Get('building-templates')
  @ApiOperation({ summary: '建筑蓝图列表（可选 category/isActive 过滤）' })
  async listBuildingTemplates(
    @Query('category') category?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.buildingAdminService.listTemplates({
      category: category || undefined,
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Post('building-templates')
  @ApiOperation({ summary: '新建建筑蓝图' })
  async createBuildingTemplate(@Body() dto: BuildingTemplateUpsertDto) {
    return this.buildingAdminService.createTemplate(dto);
  }

  @Put('building-templates/:id')
  @ApiOperation({ summary: '更新建筑蓝图' })
  async updateBuildingTemplate(
    @Param('id') id: string,
    @Body() dto: BuildingTemplateUpsertDto,
  ) {
    return this.buildingAdminService.updateTemplate(id, dto);
  }

  @Post('building-templates/:id/toggle')
  @ApiOperation({ summary: '启停建筑蓝图（未传 isActive 则取反）' })
  async toggleBuildingTemplate(
    @Param('id') id: string,
    @Body() dto: ToggleBuildingTemplateDto,
  ) {
    return this.buildingAdminService.toggleTemplate(id, dto.isActive);
  }

  @Put('scenes/:sceneId/build-rule')
  @ApiOperation({ summary: '场景建造规则 upsert' })
  async upsertBuildRule(
    @Param('sceneId') sceneId: string,
    @Body() dto: UpsertBuildRuleDto,
  ) {
    return this.buildingAdminService.upsertRule(sceneId, dto);
  }

  @Get('buildings')
  @ApiOperation({ summary: '建筑实例列表（可选 sceneId/playerId/state 过滤）' })
  async listBuildings(
    @Query('sceneId') sceneId?: string,
    @Query('playerId') playerId?: string,
    @Query('state') state?: string,
  ) {
    return this.buildingAdminService.listInstances({
      sceneId: sceneId || undefined,
      playerId: playerId || undefined,
      state: state ? (state as BuildingState) : undefined,
    });
  }
}
