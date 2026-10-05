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

/**
 * admin-web ↔ entity 字段映射层
 *
 * admin-web 字段: name / activityType / priority / isActive / startTime / endTime /
 *                  rules / conditions / rewards
 * entity 字段:     name / activityType / priority / isActive / startAt / endAt /
 *                  rulesJson / conditionJson / rewardJson
 */

const isJsonObject = (v: any): boolean =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const toEntityPayload = (dto: any): any => {
  const out: any = { ...dto };

  // startTime / endTime (ISO 字符串) → startAt / endAt (Date)
  if (dto.startTime !== undefined) {
    out.startAt = dto.startTime ? new Date(dto.startTime) : undefined;
    delete out.startTime;
  }
  if (dto.endTime !== undefined) {
    out.endAt = dto.endTime ? new Date(dto.endTime) : undefined;
    delete out.endTime;
  }

  // conditions → conditionJson
  if (dto.conditions !== undefined) {
    out.conditionJson = isJsonObject(dto.conditions) ? dto.conditions : {};
    delete out.conditions;
  }

  // rewards → rewardJson
  if (dto.rewards !== undefined) {
    out.rewardJson = isJsonObject(dto.rewards) ? dto.rewards : {};
    delete out.rewards;
  }

  // rules → rulesJson
  if (dto.rules !== undefined) {
    out.rulesJson = isJsonObject(dto.rules) ? dto.rules : {};
    delete out.rules;
  }

  return out;
};

const fromEntity = (e: any): any => {
  if (!e) return e;
  return {
    ...e,
    startTime: e.startAt,
    endTime: e.endAt,
    conditions: e.conditionJson,
    rewards: e.rewardJson,
    rules: e.rulesJson,
  };
};

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
    const result = await this.activityService.listTemplatesWithFilter(
      {
        status: status as any,
        activityType: activityType as any,
      },
      Number(page),
      Number(limit),
    );
    return {
      ...result,
      items: result.items.map(fromEntity),
    };
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
    const entityPayload = toEntityPayload(body);
    const created = await this.activityService.createTemplate(entityPayload);
    return fromEntity(created);
  }

  @Put('template/:id')
  @ApiOperation({ summary: '更新活动模板' })
  async updateTemplate(@Param('id') id: string, @Body() body: any) {
    const entityPayload = toEntityPayload(body);
    const updated = await this.activityService.updateTemplate(id, entityPayload);
    return fromEntity(updated);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: '发布活动（draft → active）' })
  async publish(
    @CurrentAdmin() admin: { adminId: string },
    @Param('id') id: string,
    @Body() body?: { grayWhitelist?: unknown },
  ) {
    const result = await this.activityService.publishActivity(
      admin.adminId,
      id,
      body?.grayWhitelist,
    );
    return fromEntity(result);
  }

  @Post(':id/gray-verify')
  @ApiOperation({ summary: '灰度验证通过（gray → active）' })
  async grayVerify(
    @CurrentAdmin() admin: { adminId: string },
    @Param('id') id: string,
  ) {
    const result = await this.activityService.grayVerifyActivity(admin.adminId, id, true);
    return fromEntity(result);
  }

  @Post(':id/rollback')
  @ApiOperation({ summary: '回滚活动至上次发布前状态' })
  async rollback(
    @CurrentAdmin() admin: { adminId: string },
    @Param('id') id: string,
  ) {
    const result = await this.activityService.rollbackActivity(admin.adminId, id);
    return fromEntity(result);
  }
}
