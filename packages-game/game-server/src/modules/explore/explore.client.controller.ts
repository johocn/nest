import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ExploreService } from './explore.service';
import { ResolveEncounterDto } from './dto/resolve-encounter.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

@ApiTags('Explore')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/client/v1/explore')
export class ExploreController {
  constructor(private readonly exploreService: ExploreService) {}

  @Get('state')
  @ApiOperation({ summary: '当前昼夜 / 天气（SQL now() 时区安全）' })
  async state() {
    return this.exploreService.worldState();
  }

  @Post('scene/:sceneId/discover')
  @ApiOperation({ summary: '探索足迹：点亮场景（首探发里程碑奖，幂等 times 递加）' })
  async discover(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('sceneId') sceneId: string,
  ) {
    return this.exploreService.discover(player.playerId, sceneId);
  }

  @Post('scene/:sceneId/encounter')
  @ApiOperation({ summary: '奇遇触发：按触发率/CD/一次性判定，命中返回选项' })
  async triggerEncounter(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('sceneId') sceneId: string,
  ) {
    return this.exploreService.triggerEncounter(player.playerId, sceneId);
  }

  @Post('encounter/:id/resolve')
  @ApiOperation({ summary: '奇遇结算：选择 → effects 发奖（幂等防重复）' })
  async resolve(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') encounterId: string,
    @Body() dto: ResolveEncounterDto,
  ) {
    return this.exploreService.resolveEncounter(
      player.playerId,
      encounterId,
      dto.choice,
    );
  }
}