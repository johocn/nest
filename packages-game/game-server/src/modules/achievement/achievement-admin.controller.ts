import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AchievementService } from './achievement.service';
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Admin-Achievement')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/achievements')
export class AchievementAdminController {
  constructor(private readonly achievementService: AchievementService) {}

  @Get()
  @ApiOperation({ summary: '玩家成就列表（支持 playerId/achievementId/状态 筛选 + 分页）' })
  async list(
    @Query('playerId') playerId?: string,
    @Query('achievementId') achievementId?: string,
    @Query('isUnlocked') isUnlocked?: string,
    @Query('isRewardClaimed') isRewardClaimed?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.achievementService.listPlayerAchievements(
      {
        playerId,
        achievementId,
        isUnlocked: isUnlocked !== undefined ? isUnlocked === 'true' : undefined,
        isRewardClaimed:
          isRewardClaimed !== undefined ? isRewardClaimed === 'true' : undefined,
      },
      Number(page),
      Number(limit),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '玩家成就详情' })
  async get(@Param('id') id: string) {
    return this.achievementService.getPlayerAchievementById(id);
  }

  @Post('grant')
  @ApiOperation({ summary: '手动授予玩家成就' })
  async grant(
    @Body() body: { playerId: string; achievementId: string },
  ) {
    return this.achievementService.grantPlayerAchievement(
      body.playerId,
      body.achievementId,
    );
  }

  @Patch(':id/revoke')
  @ApiOperation({ summary: '撤销玩家成就' })
  async revoke(@Param('id') id: string) {
    return this.achievementService.revokePlayerAchievement(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除玩家成就记录' })
  async remove(@Param('id') id: string) {
    await this.achievementService.deletePlayerAchievement(id);
    return { removed: id };
  }
}
