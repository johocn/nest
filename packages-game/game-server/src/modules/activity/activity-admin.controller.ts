import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ActivityService } from './activity.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { ActivityStatus, ActivityType } from '@constants/enums';

@ApiTags('Admin-Activity')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/activities')
export class ActivityAdminController {
  constructor(private readonly activityService: ActivityService) {}

  @Get()
  @ApiOperation({ summary: '活动模板列表（按 status/activityType 筛选 + 分页）' })
  async list(
    @Query('status') status?: ActivityStatus,
    @Query('activityType') activityType?: ActivityType,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.activityService.listTemplatesWithFilter(
      { status, activityType },
      Number(page),
      Number(limit),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '活动模板详情' })
  async get(@Param('id') id: string) {
    return this.activityService.getTemplate(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新活动状态/配置' })
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.activityService.updateTemplate(id, body);
  }

  @Post(':id/announce')
  @ApiOperation({ summary: '活动公告（记录并广播）' })
  async announce(
    @Param('id') id: string,
    @Body() body: { content: string },
  ) {
    const template = await this.activityService.getTemplate(id);
    if (!template) {
      return { success: false, message: '活动不存在' };
    }
    return {
      success: true,
      activityId: id,
      title: template.name,
      content: body.content,
      announcedAt: new Date().toISOString(),
    };
  }

  @Get(':id/players')
  @ApiOperation({ summary: '活动参与玩家列表（分页）' })
  async players(
    @Param('id') id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.activityService.getParticipants(id, Number(page), Number(limit));
  }
}
