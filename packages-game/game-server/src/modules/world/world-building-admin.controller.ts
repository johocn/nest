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
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { AdminService } from '@modules/admin/admin.service';
import { BuildingAdminService } from './building/building-admin.service';
import {
  BuildingTemplateUpsertDto,
  ToggleBuildingTemplateDto,
  UpsertBuildRuleDto,
} from './dto/building.dto';
import { BuildingState } from '@constants/enums';

@ApiTags('Admin-World')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/world')
export class WorldBuildingAdminController {
  constructor(
    private readonly buildingAdminService: BuildingAdminService,
    private readonly adminService: AdminService,
  ) {}

  // ---------- BuildingTemplate ----------

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

  @Get('building-templates/:id')
  @ApiOperation({ summary: '建筑蓝图详情' })
  async getBuildingTemplate(@Param('id') id: string) {
    return this.buildingAdminService.getTemplate(id);
  }

  @Put('building-templates/:id')
  @ApiOperation({ summary: '更新建筑蓝图' })
  async updateBuildingTemplate(
    @Param('id') id: string,
    @Body() dto: BuildingTemplateUpsertDto,
  ) {
    return this.buildingAdminService.updateTemplate(id, dto);
  }

  @Delete('building-templates/:id')
  @ApiOperation({ summary: '删除建筑蓝图' })
  async deleteBuildingTemplate(
    @Param('id') id: string,
    @CurrentAdmin() admin?: AdminJwtPayload,
  ) {
    const before = await this.buildingAdminService.getTemplate(id);
    await this.buildingAdminService.deleteTemplate(id);
    await this.adminService.logOperation({
      adminId: admin?.adminId ?? 'unknown',
      operation: 'buildingTemplate.delete',
      changeBefore: {
        id: before.id,
        name: before.name,
        category: before.category,
      },
      changeAfter: { deleted: true },
    });
  }

  @Post('building-templates/:id/toggle')
  @ApiOperation({ summary: '启停建筑蓝图（未传 isActive 则取反）' })
  async toggleBuildingTemplate(
    @Param('id') id: string,
    @Body() dto: ToggleBuildingTemplateDto,
  ) {
    return this.buildingAdminService.toggleTemplate(id, dto.isActive);
  }

  // ---------- Scene BuildRule ----------

  @Put('scenes/:sceneId/build-rule')
  @ApiOperation({ summary: '场景建造规则 upsert' })
  async upsertBuildRule(
    @Param('sceneId') sceneId: string,
    @Body() dto: UpsertBuildRuleDto,
  ) {
    return this.buildingAdminService.upsertRule(sceneId, dto);
  }

  // ---------- BuildingInstance ----------

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
