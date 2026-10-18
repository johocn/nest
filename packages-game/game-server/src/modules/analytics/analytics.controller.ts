import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { BehaviorType } from '@constants/enums';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  // ===== Client (behavior tracking) =====

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/analytics/behavior')
  @ApiOperation({ summary: '上报行为日志' })
  async logBehavior(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() body: { behaviorType: BehaviorType; detail?: Record<string, any> },
  ) {
    return this.analyticsService.logBehavior(
      player.playerId,
      body.behaviorType,
      body.detail,
    );
  }
}
