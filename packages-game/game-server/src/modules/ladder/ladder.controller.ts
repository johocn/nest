import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LadderService } from './ladder.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

@ApiTags('Ladder')
@ApiBearerAuth()
@Controller('api/client/v1/ladder')
export class LadderController {
  constructor(private readonly ladderService: LadderService) {}

  @Get('info')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '天梯信息（段位/积分/排名）' })
  async getInfo(@CurrentPlayer() player: CurrentPlayerData) {
    return this.ladderService.getInfo(player.playerId);
  }

  @Get('rank')
  @ApiOperation({ summary: '天梯榜单' })
  async getTopN(@Query('limit') limit: number = 50) {
    return this.ladderService.getTopN(Number(limit));
  }
}
