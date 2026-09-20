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
import {
  CreateTradeDto,
  ListAuctionDto,
  PlaceBidDto,
} from './dto/trade.dto';
import {
  StartNegotiationDto,
  ReplyNegotiationDto,
} from './dto/negotiation.dto';
import { CreateEscrowDto } from './dto/escrow.dto';
import { CreateBountyDto } from './dto/bounty.dto';
import { CreateCreditDto } from './dto/credit.dto';
import {
  CreateBarterDto,
  AcceptBarterDto,
} from './dto/barter.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

@ApiTags('Trade')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  private assertId(id: string): string {
    if (!/^\d+$/.test(id)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    return id;
  }

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
    return this.tradeService.buyItem(player.playerId, this.assertId(id));
  }

  @Post('api/client/v1/trade/order/:id/cancel')
  @ApiOperation({ summary: '取消交易' })
  async cancelOrder(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.tradeService.cancelTradeOrder(
      player.playerId,
      this.assertId(id),
    );
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
      exclusive: dto.exclusive,
    });
  }

  @Post('api/client/v1/trade/auction/:id/bid')
  @ApiOperation({ summary: '竞拍出价' })
  async placeBid(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
    @Body() dto: PlaceBidDto,
  ) {
    return this.tradeService.placeBid(
      player.playerId,
      this.assertId(id),
      dto.bidPrice,
    );
  }

  @Get('api/client/v1/trade/auction/list')
  @ApiOperation({ summary: '拍卖列表（可选 exclusive=true 只看专属拍卖室）' })
  async getAuctionList(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('exclusive') exclusive?: string,
  ) {
    return this.tradeService.getAuctionList(
      Number(page),
      Number(limit),
      exclusive === undefined ? undefined : exclusive === 'true',
    );
  }

  // ===== Negotiation =====

  @Post('api/client/v1/trade/negotiations')
  @ApiOperation({ summary: '发起议价' })
  async startNegotiation(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: StartNegotiationDto,
  ) {
    return this.tradeService.startNegotiation(
      player.playerId,
      this.assertId(dto.tradeOrderId),
      dto.askPrice,
    );
  }

  @Post('api/client/v1/trade/negotiations/:id/reply')
  @ApiOperation({ summary: '卖家还价' })
  async replyNegotiation(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
    @Body() dto: ReplyNegotiationDto,
  ) {
    return this.tradeService.replyNegotiation(
      player.playerId,
      this.assertId(id),
      dto.replyPrice,
    );
  }

  @Post('api/client/v1/trade/negotiations/:id/accept')
  @ApiOperation({ summary: '买家接受成交' })
  async acceptNegotiation(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.tradeService.acceptNegotiation(
      player.playerId,
      this.assertId(id),
    );
  }

  @Post('api/client/v1/trade/negotiations/:id/reject')
  @ApiOperation({ summary: '买家拒绝议价' })
  async rejectNegotiation(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.tradeService.rejectNegotiation(
      player.playerId,
      this.assertId(id),
    );
  }

  // ===== Escrow =====

  @Post('api/client/v1/trade/escrow')
  @ApiOperation({ summary: '发起担保交易' })
  async createEscrow(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: CreateEscrowDto,
  ) {
    return this.tradeService.createEscrow(
      player.playerId,
      this.assertId(dto.sellerId),
      this.assertId(dto.tradeOrderId),
      this.assertId(dto.guarantorId),
    );
  }

  @Post('api/client/v1/trade/escrow/:id/inspect')
  @ApiOperation({ summary: '担保人验货放款' })
  async inspectGoods(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.tradeService.inspectGoods(player.playerId, this.assertId(id));
  }

  @Post('api/client/v1/trade/escrow/:id/penalize')
  @ApiOperation({ summary: '担保违约赔付' })
  async penalizeEscrow(@Param('id') id: string) {
    return this.tradeService.penalizeEscrow(this.assertId(id));
  }

  @Get('api/client/v1/trade/escrow/:id')
  @ApiOperation({ summary: '担保记录详情' })
  async getEscrow(@Param('id') id: string) {
    return this.tradeService.getEscrow(this.assertId(id));
  }

  // ===== Bounty =====

  @Post('api/client/v1/trade/bounties')
  @ApiOperation({ summary: '发布悬赏' })
  async createBounty(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: CreateBountyDto,
  ) {
    return this.tradeService.createBounty(
      player.playerId,
      dto.type,
      dto.targetJson,
      dto.goldReward,
      dto.deadline,
      dto.maxAcceptors ?? 1,
    );
  }

  @Post('api/client/v1/trade/bounties/:id/accept')
  @ApiOperation({ summary: '接取悬赏' })
  async acceptBounty(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.tradeService.acceptBounty(player.playerId, this.assertId(id));
  }

  @Post('api/client/v1/trade/bounties/:id/complete')
  @ApiOperation({ summary: '提交悬赏结算' })
  async completeBounty(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.tradeService.completeBounty(
      player.playerId,
      this.assertId(id),
    );
  }

  @Post('api/client/v1/trade/bounties/:id/cancel')
  @ApiOperation({ summary: '取消悬赏（托管金返还）' })
  async cancelBounty(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.tradeService.cancelBounty(player.playerId, this.assertId(id));
  }

  @Get('api/client/v1/trade/bounties')
  @ApiOperation({ summary: '悬赏榜' })
  async getBountyBoard(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.tradeService.getBountyBoard(Number(page), Number(limit));
  }

  // ===== Credit =====

  @Post('api/client/v1/trade/credit')
  @ApiOperation({ summary: '发起赊账借款' })
  async createCredit(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: CreateCreditDto,
  ) {
    return this.tradeService.createCredit(
      player.playerId,
      this.assertId(dto.lenderId),
      dto.amount,
      dto.dueDays,
    );
  }

  @Post('api/client/v1/trade/credit/:id/repay')
  @ApiOperation({ summary: '还款结清' })
  async repayCredit(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.tradeService.repayCredit(player.playerId, this.assertId(id));
  }

  @Get('api/client/v1/trade/credit/mine')
  @ApiOperation({ summary: '我的赊账列表' })
  async getCreditList(@CurrentPlayer() player: CurrentPlayerData) {
    return this.tradeService.getCreditList(player.playerId);
  }

  // ===== Barter =====

  @Post('api/client/v1/trade/barter')
  @ApiOperation({ summary: '发起以物易物' })
  async createBarter(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: CreateBarterDto,
  ) {
    return this.tradeService.createBarter(
      player.playerId,
      dto.itemsAJson,
      dto.goldAmount,
    );
  }

  @Post('api/client/v1/trade/barter/:id/accept')
  @ApiOperation({ summary: '接受易物并确认' })
  async acceptBarter(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
    @Body() dto: AcceptBarterDto,
  ) {
    return this.tradeService.acceptBarter(
      player.playerId,
      this.assertId(id),
      dto.itemsBJson,
    );
  }

  @Get('api/client/v1/trade/barter/mine')
  @ApiOperation({ summary: '我的易物列表' })
  async getBarterList(@CurrentPlayer() player: CurrentPlayerData) {
    return this.tradeService.getBarterList(player.playerId);
  }
}
