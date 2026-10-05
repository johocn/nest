import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { StatPeriod } from '@constants/enums';

/** 数据分析管理端（admin-web 路由前缀 api/admin/v1/analytics） */
@ApiTags('Admin-Analytics')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/analytics')
export class AnalyticsAdminController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: '运营面板' })
  async getDashboard() {
    return this.analyticsService.getDashboard();
  }

  @Get('behavior/stats')
  @ApiOperation({ summary: '行为统计' })
  async getBehaviorStats(
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const endDate = end ? new Date(end) : new Date();
    const startDate = start
      ? new Date(start)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    return this.analyticsService.getBehaviorStats(startDate, endDate);
  }

  @Get('dau')
  @ApiOperation({ summary: 'DAU' })
  async getDau(@Query('date') date?: string) {
    const d = date ?? new Date().toISOString().slice(0, 10);
    const dau = await this.analyticsService.getDailyActiveUsers(d);
    return { date: d, dau };
  }

  @Post('retention')
  @ApiOperation({ summary: '计算留存' })
  async calculateRetention(@Body() body: any) {
    return this.analyticsService.calculateRetention(
      body.cohortDate,
      body.statDate,
      body.period as StatPeriod,
    );
  }

  @Get('retention/:cohortDate')
  @ApiOperation({ summary: '留存统计列表' })
  async getRetentionStats(@Query('cohortDate') cohortDate: string) {
    return this.analyticsService.getRetentionStats(cohortDate);
  }

  @Get('social/graph')
  @ApiOperation({ summary: '社交关系图谱（近30天活跃玩家 + 好友/亲缘边）' })
  async getSocialGraph(@Query('limit') limit = 50) {
    return this.analyticsService.getSocialGraph(Number(limit));
  }

  @Get('social/hubs')
  @ApiOperation({ summary: '社交枢纽玩家（大使候选/挽回锚点）' })
  async getSocialHubs(@Query('limit') limit = 10) {
    return this.analyticsService.getSocialHubs(Number(limit));
  }

  @Get('social/churn-risk')
  @ApiOperation({ summary: '流失预警（社交动作降幅≥50%且近7天有登录）' })
  async getChurnRisks(@Query('days') days = 7) {
    return this.analyticsService.getChurnRisks(Number(days));
  }

  @Get('social/funnel')
  @ApiOperation({ summary: '社交漏斗（新玩家7日关系建立率，阈值60%）' })
  async getSocialFunnel(@Query('days') days = 7) {
    return this.analyticsService.getSocialFunnel(Number(days));
  }
}
