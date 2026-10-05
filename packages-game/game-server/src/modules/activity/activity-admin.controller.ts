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
import { ActivityService } from './activity.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';

/** 活动模板管理 + 发布/灰度/回滚（admin-web 路由前缀 api/admin/v1/activity） */
@ApiTags('Admin-Activity')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/activity')
export class ActivityAdminController {
  constructor(private readonly activityService: ActivityService) {}

  @Get('template/list')
  @ApiOperation({ summary: '活动模板列表（支持 status/activityType 筛选 + 分页）' })
  async listTemplates(
    @Query('status') status?: string,
    @Query('activityType') activityType?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.activityService.listTemplatesWithFilter(
      {
        status: status as any,
        activityType: activityType as any,
      },
      Number(page),
      Number(limit),
    );
  }

  @Get(':id/dashboard')
  @ApiOperation({ summary: '活动看板（参与人数/奖励发放/完成率等统计）' })
  async getDashboard(
    @Param('id') id: string,
    @Query('days') days?: string,
  ) {
    return this.activityService.getActivityDashboard(id, days ? Number(days) : 7);
  }

  @Post('template')
  @ApiOperation({ summary: '创建活动模板' })
  async createTemplate(@Body() body: any) {
    return this.activityService.createTemplate(body);
  }

  @Put('template/:id')
  @ApiOperation({ summary: '更新活动模板' })
  async updateTemplate(@Param('id') id: string, @Body() body: any) {
    return this.activityService.updateTemplate(id, body);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: '发布活动（draft → active）' })
  async publish(
    @CurrentAdmin() admin: { adminId: string },
    @Param('id') id: string,
    @Body() body?: { grayWhitelist?: unknown },
  ) {
    return this.activityService.publishActivity(
      admin.adminId,
      id,
      body?.grayWhitelist,
    );
  }

  @Post(':id/gray-verify')
  @ApiOperation({ summary: '灰度验证通过（gray → active）' })
  async grayVerify(
    @CurrentAdmin() admin: { adminId: string },
    @Param('id') id: string,
  ) {
    return this.activityService.grayVerifyActivity(admin.adminId, id, true);
  }

  @Post(':id/rollback')
  @ApiOperation({ summary: '回滚活动至上次发布前状态' })
  async rollback(
    @CurrentAdmin() admin: { adminId: string },
    @Param('id') id: string,
  ) {
    return this.activityService.rollbackActivity(admin.adminId, id);
  }
}
