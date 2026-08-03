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
import { AchievementService } from './achievement.service';
import { CreateAchievementDto } from './dto/create-achievement.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { AdminGuard } from '@common/guards/admin.guard';
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

  // ===== Admin =====

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/achievement/template/list')
  @ApiOperation({ summary: '成就模板列表' })
  async listTemplates(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.achievementService.getTemplates(Number(page), Number(limit));
  }

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/achievement/template')
  @ApiOperation({ summary: '创建成就模板' })
  async createTemplate(@Body() dto: CreateAchievementDto) {
    return this.achievementService.createTemplate(dto);
  }

  @UseGuards(AdminGuard)
  @Put('api/admin/v1/achievement/template/:id')
  @ApiOperation({ summary: '修改成就模板' })
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: Partial<CreateAchievementDto>,
  ) {
    return this.achievementService.updateTemplate(id, dto);
  }
}
