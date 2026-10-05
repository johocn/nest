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
import { CommunityService } from './community.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import {
  AmbassadorStatus,
  FeedbackStatus,
  ReportHandleAction,
  ReportStatus,
} from '@constants/enums';

/** 社区管理端（admin-web 路由前缀 api/admin/v1/community） */
@ApiTags('Admin-Community')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/community')
export class CommunityAdminController {
  constructor(private readonly communityService: CommunityService) {}

  // ===== 建议箱 =====

  @Get('feedback/list')
  @ApiOperation({ summary: '反馈列表（管理端）' })
  async listFeedback(
    @Query('status') status?: FeedbackStatus,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.communityService.listFeedback(
      status,
      Number(page),
      Number(limit),
    );
  }

  @Post('feedback/:id/handle')
  @ApiOperation({ summary: '处理反馈（采纳/驳回/完成 + 回复）' })
  async handleFeedback(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.communityService.handleFeedback(
      admin.adminId,
      id,
      body.status as FeedbackStatus,
      body.reply,
    );
  }

  // ===== 玩家大使 =====

  @Post('ambassadors')
  @ApiOperation({ summary: '任命玩家大使（自动发放江湖大使称号）' })
  async appointAmbassador(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Body() body: any,
  ) {
    return this.communityService.appointAmbassador(
      admin.adminId,
      body.playerId,
      body.remark,
    );
  }

  @Post('ambassadors/:id/revoke')
  @ApiOperation({ summary: '撤销玩家大使' })
  async revokeAmbassador(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id') id: string,
  ) {
    return this.communityService.revokeAmbassador(admin.adminId, id);
  }

  @Get('ambassadors')
  @ApiOperation({ summary: '大使列表（管理端，可按状态过滤）' })
  async listAmbassadors(
    @Query('status') status?: AmbassadorStatus,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.communityService.listAmbassadors(
      status,
      Number(page),
      Number(limit),
    );
  }

  // ===== 举报台账 =====

  @Get('reports')
  @ApiOperation({ summary: '举报台账（管理端，可按状态过滤）' })
  async listReports(
    @Query('status') status?: ReportStatus,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.communityService.listReports(
      status,
      Number(page),
      Number(limit),
    );
  }

  @Post('reports/:id/handle')
  @ApiOperation({ summary: '处置举报（忽略/警告/禁言/封禁）' })
  async handleReport(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.communityService.handleReport(
      admin.adminId,
      admin.username,
      id,
      body.action as ReportHandleAction,
      body.remark,
      body.durationSeconds,
    );
  }

  // ===== 历史封禁补执行社交后果 =====

  @Post('players/:playerId/social-cleanup')
  @ApiOperation({ summary: '[管理] 历史封禁补执行社交后果' })
  async socialCleanup(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('playerId') playerId: string,
  ) {
    return this.communityService.socialCleanup(admin.adminId, playerId);
  }
}
