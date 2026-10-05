import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ActivityService } from './activity.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

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
}
