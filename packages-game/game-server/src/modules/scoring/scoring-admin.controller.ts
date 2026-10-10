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
import { ScoringAdminService } from './scoring-admin.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

/** 评分配置管理端（admin-web 路由前缀 api/admin/v1/scoring） */
@ApiTags('Admin-Scoring')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/scoring')
export class ScoringAdminController {
  constructor(private readonly scoringAdminService: ScoringAdminService) {}

  private assertId(id: string): string {
    if (!/^\d+$/.test(id)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    return id;
  }

  @Get('list')
  @ApiOperation({ summary: '评分配置列表（含 config 全量）' })
  async list(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.scoringAdminService.list(Number(page), Number(limit));
  }

  @Get(':id')
  @ApiOperation({ summary: '评分配置详情' })
  async get(@Param('id') id: string) {
    return this.scoringAdminService.get(this.assertId(id));
  }

  @Post()
  @ApiOperation({ summary: '创建评分配置（body 即 ScoringConfig，成功即时热更新）' })
  async create(@Body() body: any) {
    return this.scoringAdminService.create(body);
  }

  @Put(':id')
  @ApiOperation({ summary: '修改评分配置（body 与既有 config 合并，成功即时热更新）' })
  async update(@Param('id') id: string, @Body() body: any) {
    return this.scoringAdminService.update(this.assertId(id), body);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除评分配置（软删并摘除内存注册，玩家状态行保留）' })
  async delete(@Param('id') id: string) {
    await this.scoringAdminService.delete(this.assertId(id));
    return { success: true };
  }
}
