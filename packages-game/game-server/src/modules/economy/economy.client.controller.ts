import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EconomyService } from './economy.service';
import { ExchangeDto } from './dto/exchange.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

@ApiTags('Economy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/client/v1/economy')
export class EconomyClientController {
  constructor(private readonly economyService: EconomyService) {}

  @Get('social/balances')
  @ApiOperation({ summary: '社交货币余额（人情值/帮贡/颜面）' })
  async getSocialBalances(@CurrentPlayer() player: CurrentPlayerData) {
    return this.economyService.getSocialBalances(player.playerId);
  }

  @Post('exchange')
  @ApiOperation({ summary: '货币兑换（仅钻石↔绑定钻）' })
  async exchange(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: ExchangeDto,
  ) {
    return this.economyService.exchange(
      player.playerId,
      dto.from,
      dto.to,
      dto.amount,
    );
  }
}
