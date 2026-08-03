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
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Admin-World')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/world')
export class WorldController {
  constructor(private readonly worldService: WorldService) {}

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
}
