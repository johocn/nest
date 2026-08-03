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
import { TradeService } from './trade.service';
import { CreateTradeDto, ListAuctionDto, PlaceBidDto } from './dto/trade.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

@ApiTags('Trade')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  // ===== Trade Order =====

  @Post('api/client/v1/trade/order')
  @ApiOperation({ summary: '上架交易' })
  async createOrder(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: CreateTradeDto,
  ) {
    return this.tradeService.createTradeOrder({
      sellerId: player.playerId,
      itemTemplateId: dto.itemTemplateId,
      itemName: dto.itemName,
      quantity: dto.quantity,
      pricePerUnit: dto.pricePerUnit,
      currencyType: dto.currencyType ?? 'gold',
    });
  }

  @Post('api/client/v1/trade/order/:id/buy')
  @ApiOperation({ summary: '购买商品' })
  async buyItem(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.tradeService.buyItem(player.playerId, id);
  }

  @Post('api/client/v1/trade/order/:id/cancel')
  @ApiOperation({ summary: '取消交易' })
  async cancelOrder(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.tradeService.cancelTradeOrder(player.playerId, id);
  }

  @Get('api/client/v1/trade/market')
  @ApiOperation({ summary: '交易市场列表' })
  async getMarket(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.tradeService.getMarketList(Number(page), Number(limit));
  }

  // ===== Auction =====

  @Post('api/client/v1/trade/auction')
  @ApiOperation({ summary: '上架拍卖' })
  async listAuction(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: ListAuctionDto,
  ) {
    return this.tradeService.listAuction({
      sellerId: player.playerId,
      itemTemplateId: dto.itemTemplateId,
      itemName: dto.itemName,
      quantity: dto.quantity,
      startPrice: dto.startPrice,
      expireAt: new Date(dto.expireAt),
    });
  }

  @Post('api/client/v1/trade/auction/:id/bid')
  @ApiOperation({ summary: '竞拍出价' })
  async placeBid(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
    @Body() dto: PlaceBidDto,
  ) {
    return this.tradeService.placeBid(player.playerId, id, dto.bidPrice);
  }

  @Get('api/client/v1/trade/auction/list')
  @ApiOperation({ summary: '拍卖列表' })
  async getAuctionList(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.tradeService.getAuctionList(Number(page), Number(limit));
  }
}
