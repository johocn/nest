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
import { CreateActivityDto } from './dto/create-activity.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';

@ApiTags('Activity')
@ApiBearerAuth()
@Controller()
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  // ===== Client =====

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/activity/list')
  @ApiOperation({ summary: '当前活动列表（灰度白名单玩家可见灰度活动）' })
  async getActiveActivities(@CurrentPlayer() player: CurrentPlayerData) {
    return this.activityService.getActiveActivities(player.playerId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/activity/my')
  @ApiOperation({ summary: '我的活动参与记录' })
  async getMyActivities(@CurrentPlayer() player: CurrentPlayerData) {
    return this.activityService.getPlayerActivities(player.playerId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/activity/:id/join')
  @ApiOperation({ summary: '参加活动' })
  async joinActivity(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.activityService.joinActivity(player.playerId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/activity/:id/sign-in')
  @ApiOperation({ summary: '签到' })
  async signIn(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.activityService.signIn(player.playerId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/activity/:id/claim')
  @ApiOperation({ summary: '领取活动奖励' })
  async claimReward(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.activityService.claimReward(player.playerId, id);
  }

  // ===== Admin =====

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/activity/template/list')
  @ApiOperation({ summary: '活动模板列表' })
  async listTemplates(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.activityService.getTemplates(Number(page), Number(limit));
  }

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/activity/template')
  @ApiOperation({ summary: '创建活动模板' })
  async createTemplate(@Body() dto: CreateActivityDto) {
    return this.activityService.createTemplate(dto);
  }

  @UseGuards(AdminGuard)
  @Put('api/admin/v1/activity/template/:id')
  @ApiOperation({ summary: '修改活动模板' })
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: Partial<CreateActivityDto>,
  ) {
    return this.activityService.updateTemplate(id, dto);
  }

  // ===== 运营工作台（13.6 预配置→灰度→回滚 + 看板）=====

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/activity/:id/publish')
  @ApiOperation({ summary: '发布活动（带白名单进灰度，否则直接上线）' })
  async publishActivity(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id') id: string,
    @Body() body: { grayWhitelist?: unknown },
  ) {
    return this.activityService.publishActivity(
      admin.adminId,
      id,
      body?.grayWhitelist,
    );
  }

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/activity/:id/gray-verify')
  @ApiOperation({ summary: '灰度验证（通过→上线 / 失败→回草稿）' })
  async grayVerifyActivity(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id') id: string,
    @Body() body: { passed: boolean },
  ) {
    return this.activityService.grayVerifyActivity(
      admin.adminId,
      id,
      body.passed,
    );
  }

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/activity/:id/rollback')
  @ApiOperation({ summary: '一键回滚（恢复最近一次发布前快照）' })
  async rollbackActivity(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id') id: string,
  ) {
    return this.activityService.rollbackActivity(admin.adminId, id);
  }

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/activity/:id/dashboard')
  @ApiOperation({ summary: '活动数据看板（参与/签到/领取/留存/趋势）' })
  async getActivityDashboard(
    @Param('id') id: string,
    @Query('days') days = 7,
  ) {
    return this.activityService.getActivityDashboard(id, Number(days));
  }
}
