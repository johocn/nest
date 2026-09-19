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
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import {
  AmbassadorStatus,
  FeedbackCategory,
  FeedbackStatus,
} from '@constants/enums';

@ApiTags('Community')
@ApiBearerAuth()
@Controller()
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  // ===== 建议箱（Client） =====

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/community/feedback')
  @ApiOperation({ summary: '提交建议/Bug反馈' })
  async submitFeedback(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() body: { category: FeedbackCategory; content: string },
  ) {
    return this.communityService.submitFeedback(
      player.playerId,
      body.category,
      body.content,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/community/feedback/my')
  @ApiOperation({ summary: '我的反馈列表（含处理状态/回复）' })
  async getMyFeedback(@CurrentPlayer() player: CurrentPlayerData) {
    return this.communityService.getMyFeedback(player.playerId);
  }

  // ===== 建议箱（Admin） =====

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/community/feedback/list')
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

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/community/feedback/:id/handle')
  @ApiOperation({ summary: '处理反馈（采纳/驳回/完成 + 回复）' })
  async handleFeedback(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id') id: string,
    @Body() body: { status: FeedbackStatus; reply?: string },
  ) {
    return this.communityService.handleFeedback(
      admin.adminId,
      id,
      body.status,
      body.reply,
    );
  }

  // ===== 玩家大使 =====

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/community/ambassadors')
  @ApiOperation({ summary: '任命玩家大使（自动发放江湖大使称号）' })
  async appointAmbassador(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Body() body: { playerId: string; remark?: string },
  ) {
    return this.communityService.appointAmbassador(
      admin.adminId,
      body.playerId,
      body.remark,
    );
  }

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/community/ambassadors/:id/revoke')
  @ApiOperation({ summary: '撤销玩家大使' })
  async revokeAmbassador(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id') id: string,
  ) {
    return this.communityService.revokeAmbassador(admin.adminId, id);
  }

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/community/ambassadors')
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

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/community/ambassadors')
  @ApiOperation({ summary: '在任大使列表（客户端）' })
  async getActiveAmbassadors() {
    return this.communityService.getActiveAmbassadors();
  }
}
