import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CommunityService } from './community.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import {
  FeedbackCategory,
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

  // ===== 在任大使列表（客户端） =====

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/community/ambassadors')
  @ApiOperation({ summary: '在任大使列表（客户端）' })
  async getActiveAmbassadors() {
    return this.communityService.getActiveAmbassadors();
  }
}
