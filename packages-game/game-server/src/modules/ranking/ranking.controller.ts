import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RankingService } from './ranking.service';
import { RankingType } from '@constants/enums';
import { AdminGuard } from '@common/guards/admin.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';

@ApiTags('Ranking')
@Controller()
export class RankingController {
  constructor(private readonly rankingService: RankingService) {}

  // ===== Client =====

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/ranking/:type')
  @ApiOperation({ summary: '排行榜' })
  async getTopN(@Param('type') type: RankingType, @Query('n') n = 50) {
    return this.rankingService.getTopN(type, Number(n));
  }

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/ranking/:type/:playerId')
  @ApiOperation({ summary: '玩家排名' })
  async getPlayerRank(
    @Param('type') type: RankingType,
    @Param('playerId') playerId: string,
  ) {
    const rank = await this.rankingService.getPlayerRank(type, playerId);
    const score = await this.rankingService.getPlayerScore(type, playerId);
    return { rank, score };
  }

  // ===== Admin =====

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Post('api/admin/v1/ranking/:type/snapshot')
  @ApiOperation({ summary: '创建排行榜快照' })
  async createSnapshot(@Param('type') type: RankingType) {
    const count = await this.rankingService.createSnapshot(type);
    return { success: true, count };
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Get('api/admin/v1/ranking/snapshot/list')
  @ApiOperation({ summary: '排行榜快照列表' })
  async getSnapshotList(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.rankingService.getSnapshotList(Number(page), Number(limit));
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Post('api/admin/v1/ranking/:type/refresh')
  @ApiOperation({ summary: '从 DB 快照重建 Redis ZSet（Redis flush 后恢复）' })
  async refreshFromDB(@Param('type') type: RankingType) {
    const count = await this.rankingService.refreshFromDB(type);
    return { success: true, restored: count };
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Post('api/admin/v1/ranking/refresh')
  @ApiOperation({ summary: '从 DB 快照重建所有类型 Redis ZSet' })
  async refreshAllFromDB() {
    const count = await this.rankingService.refreshFromDB();
    return { success: true, restored: count };
  }
}
