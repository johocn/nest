import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SceneConfigService } from './config/scene-config.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';

@ApiTags('Admin-World')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/world')
export class WorldController {
  constructor(
    private readonly sceneConfigService: SceneConfigService,
  ) {}

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
    @Body() dto: { version: number },
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
    @Body() dto: { version: number },
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    return this.sceneConfigService.rollbackScene(
      sceneId,
      dto.version,
      admin.adminId,
    );
  }
}
