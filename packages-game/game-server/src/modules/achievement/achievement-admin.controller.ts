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
import { AchievementService } from './achievement.service';
import { AdminGuard } from '@common/guards/admin.guard';

/** 成就模板管理（admin-web 路由前缀 api/admin/v1/achievement） */
@ApiTags('Admin-Achievement')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/achievement')
export class AchievementAdminController {
  constructor(private readonly achievementService: AchievementService) {}

  @Get('template/list')
  @ApiOperation({ summary: '成就模板列表（支持 category/isActive 筛选 + 分页）' })
  async listTemplates(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.achievementService.listTemplates(Number(page), Number(limit));
  }

  @Post('template')
  @ApiOperation({ summary: '创建成就模板' })
  async createTemplate(@Body() body: any) {
    return this.achievementService.createTemplate(body);
  }

  @Put('template/:id')
  @ApiOperation({ summary: '更新成就模板' })
  async updateTemplate(@Param('id') id: string, @Body() body: any) {
    return this.achievementService.updateTemplate(id, body);
  }
}
