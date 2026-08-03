import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  Patch,
  Delete,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VipService } from './vip.service';
import { CreateVipConfigDto } from './dto/create-vip-config.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

@ApiTags('VIP')
@ApiBearerAuth()
@Controller()
export class VipController {
  constructor(private readonly vipService: VipService) {}

  // ===== Client =====

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/vip/info')
  @ApiOperation({ summary: '获取VIP信息' })
  async getVipInfo(@CurrentPlayer() player: CurrentPlayerData) {
    return this.vipService.getVipInfo(player.playerId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/vip/daily-reward')
  @ApiOperation({ summary: '领取VIP每日奖励' })
  async claimDailyReward(@CurrentPlayer() player: CurrentPlayerData) {
    return this.vipService.claimDailyReward(player.playerId);
  }

  // ===== Admin =====

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/vip/config/list')
  @ApiOperation({ summary: '[管理] VIP配置列表' })
  async getConfigList() {
    return this.vipService.getConfigList();
  }

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/vip/config')
  @ApiOperation({ summary: '[管理] 创建VIP配置' })
  async createConfig(@Body() dto: CreateVipConfigDto) {
    return this.vipService.createConfig(dto);
  }

  @UseGuards(AdminGuard)
  @Patch('api/admin/v1/vip/config/:level')
  @ApiOperation({ summary: '[管理] 更新VIP配置' })
  async updateConfig(@Param('level') level: string, @Body() dto: any) {
    return this.vipService.updateConfig(Number(level), dto);
  }

  @UseGuards(AdminGuard)
  @Delete('api/admin/v1/vip/config/:level')
  @ApiOperation({ summary: '[管理] 删除VIP配置' })
  async deleteConfig(@Param('level') level: string) {
    return this.vipService.deleteConfig(Number(level));
  }
}
