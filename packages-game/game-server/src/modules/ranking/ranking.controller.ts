import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RankingService } from './ranking.service';
import { RankingType } from '@constants/enums';
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
}
