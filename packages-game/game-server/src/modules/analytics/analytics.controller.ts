import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { BehaviorType, StatPeriod } from '@constants/enums';

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

  // ===== Admin =====

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/analytics/dashboard')
  @ApiOperation({ summary: '运营面板' })
  async getDashboard() {
    return this.analyticsService.getDashboard();
  }

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/analytics/behavior/stats')
  @ApiOperation({ summary: '行为统计' })
  async getBehaviorStats(
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    return this.analyticsService.getBehaviorStats(
      new Date(start),
      new Date(end),
    );
  }

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/analytics/dau')
  @ApiOperation({ summary: 'DAU' })
  async getDau(@Query('date') date: string) {
    const dau = await this.analyticsService.getDailyActiveUsers(date);
    return { date, dau };
  }

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/analytics/retention')
  @ApiOperation({ summary: '计算留存' })
  async calculateRetention(
    @Body() body: { cohortDate: string; statDate: string; period: StatPeriod },
  ) {
    return this.analyticsService.calculateRetention(
      body.cohortDate,
      body.statDate,
      body.period,
    );
  }

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/analytics/retention/:cohortDate')
  @ApiOperation({ summary: '留存统计列表' })
  async getRetentionStats(@Query('cohortDate') cohortDate: string) {
    return this.analyticsService.getRetentionStats(cohortDate);
  }

  // ===== 社交数据分析（13.8） =====

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/analytics/social/graph')
  @ApiOperation({ summary: '社交关系图谱（近30天活跃玩家 + 好友/亲缘边）' })
  async getSocialGraph(@Query('limit') limit = 50) {
    return this.analyticsService.getSocialGraph(Number(limit));
  }

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/analytics/social/hubs')
  @ApiOperation({ summary: '社交枢纽玩家（大使候选/挽回锚点）' })
  async getSocialHubs(@Query('limit') limit = 10) {
    return this.analyticsService.getSocialHubs(Number(limit));
  }

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/analytics/social/churn-risk')
  @ApiOperation({ summary: '流失预警（社交动作降幅≥50%且近7天有登录）' })
  async getChurnRisks(@Query('days') days = 7) {
    return this.analyticsService.getChurnRisks(Number(days));
  }

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/analytics/social/funnel')
  @ApiOperation({ summary: '社交漏斗（新玩家7日关系建立率，阈值60%）' })
  async getSocialFunnel(@Query('days') days = 7) {
    return this.analyticsService.getSocialFunnel(Number(days));
  }
}
