import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AchievementService } from './achievement.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { AchievementCategory } from '@constants/enums';

@ApiTags('Achievement')
@ApiBearerAuth()
@Controller()
export class AchievementController {
  constructor(private readonly achievementService: AchievementService) {}

  // ===== Client =====

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/achievement/list')
  @ApiOperation({ summary: '成就列表' })
  async getAchievementList(@Query('category') category?: AchievementCategory) {
    return this.achievementService.getAchievementList(category);
  }

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/achievement/my')
  @ApiOperation({ summary: '我的成就进度' })
  async getMyAchievements(@CurrentPlayer() player: CurrentPlayerData) {
    return this.achievementService.getPlayerAchievements(player.playerId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/achievement/:id/claim')
  @ApiOperation({ summary: '领取成就奖励' })
  async claimReward(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.achievementService.claimReward(player.playerId, id);
  }
}
