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
import { WorldService } from './world.service';
import { Scene } from './entities/scene.entity';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { AdminService } from '@modules/admin/admin.service';

interface SceneQueryDto {
  name?: string;
  sceneType?: string;
  status?: string;
  page?: number;
  limit?: number;
}

@ApiTags('Admin-World')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/world/scenes')
export class WorldSceneAdminController {
  constructor(
    private readonly worldService: WorldService,
    private readonly adminService: AdminService,
  ) {}

  @Get()
  @ApiOperation({ summary: '场景列表（支持 name / sceneType / status 过滤 + 分页）' })
  async listScenes(@Query() query: SceneQueryDto) {
    return this.worldService.getScenes({
      name: query.name,
      sceneType: query.sceneType,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '场景详情' })
  async getScene(@Param('id') id: string) {
    return this.worldService.getScene(id);
  }

  @Get(':id/spawns')
  @ApiOperation({ summary: '场景实体生成配置' })
  async getSpawns(@Param('id') id: string) {
    return this.worldService.getSceneSpawns(id);
  }

  @Get(':id/triggers')
  @ApiOperation({ summary: '场景触发器列表' })
  async getTriggers(@Param('id') id: string) {
    return this.worldService.getSceneTriggers(id);
  }

  @Post()
  @ApiOperation({ summary: '新建场景' })
  async createScene(
    @Body() dto: Partial<Scene>,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const scene = await this.worldService.createScene(dto);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'scene.create',
      changeBefore: {},
      changeAfter: {
        id: scene.id,
        name: scene.name,
        sceneType: scene.sceneType,
        status: scene.status,
      },
    });
    return scene;
  }

  @Put(':id')
  @ApiOperation({ summary: '更新场景' })
  async updateScene(
    @Param('id') id: string,
    @Body() dto: Partial<Scene>,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const before = await this.worldService.getScene(id);
    const saved = await this.worldService.updateScene(id, dto);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'scene.update',
      changeBefore: {
        name: before.name,
        sceneType: before.sceneType,
        mapResKey: before.mapResKey,
        status: before.status,
        minLevel: before.minLevel,
        maxPlayers: before.maxPlayers,
      },
      changeAfter: {
        name: saved.name,
        sceneType: saved.sceneType,
        mapResKey: saved.mapResKey,
        status: saved.status,
        minLevel: saved.minLevel,
        maxPlayers: saved.maxPlayers,
      },
    });
    return saved;
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除场景（软删）' })
  async deleteScene(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const before = await this.worldService.getScene(id);
    await this.worldService.deleteScene(id);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'scene.delete',
      changeBefore: {
        id: before.id,
        name: before.name,
        sceneType: before.sceneType,
      },
      changeAfter: { deleted: true },
    });
    return { success: true };
  }
}
