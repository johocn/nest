import { Controller, Post, Body, UseGuards, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { AppScopeGuard } from '@modules/apps/app-scope.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { CrossGameRecordService } from './cross-game-record.service';
import { CrossGameRecord } from './cross-game-record.entity';
import { SubmitCrossGameRecordDto } from './dto/submit-cross-game-record.dto';

@ApiTags('CrossGameRecord')
@ApiBearerAuth()
@Controller()
export class CrossGameRecordController {
  constructor(private readonly svc: CrossGameRecordService) {}

  /**
   * 上报跨游戏关卡评分 → 写入目标游戏记录。
   * playerId 仅取自 JWT（@CurrentPlayer），请求体不含 playerId，杜绝伪造。
   * targetGameId 仅允许白名单值，确保数据准确关联到目标游戏。
   */
  @UseGuards(JwtAuthGuard, AppScopeGuard)
  @Post('api/client/v1/cross-game-records')
  @ApiOperation({ summary: '上报跨游戏关卡评分（写入目标游戏记录）' })
  async submit(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: SubmitCrossGameRecordDto,
  ): Promise<{ updated: boolean; best: number }> {
    const r = await this.svc.record(player.playerId, dto);
    return { updated: r.updated, best: r.best };
  }

  @UseGuards(JwtAuthGuard, AppScopeGuard)
  @Get('api/client/v1/cross-game-records')
  @ApiOperation({ summary: '查询本人跨游戏记录（可按目标游戏过滤）' })
  async list(
    @CurrentPlayer() player: CurrentPlayerData,
    @Query('targetGameId') targetGameId?: string,
  ): Promise<CrossGameRecord[]> {
    return this.svc.list(player.playerId, targetGameId);
  }
}
