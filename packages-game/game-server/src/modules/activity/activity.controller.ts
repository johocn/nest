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
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

@ApiTags('Activity')
@ApiBearerAuth()
@Controller()
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  // ===== Client =====

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/activity/list')
  @ApiOperation({ summary: '当前活动列表' })
  async getActiveActivities() {
    return this.activityService.getActiveActivities();
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
}
