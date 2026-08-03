import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeOrder, AuctionItem } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { TradeStatus, AuctionStatus } from '@constants/enums';

export interface CreateTradeParams {
  sellerId: string;
  itemTemplateId: string;
  itemName: string;
  quantity: number;
  pricePerUnit: string;
  currencyType: string;
}

export interface ListAuctionParams {
  sellerId: string;
  itemTemplateId: string;
  itemName: string;
  quantity: number;
  startPrice: string;
  expireAt: Date;
}

@Injectable()
export class TradeService {
  constructor(
    @InjectRepository(TradeOrder)
    private readonly tradeRepo: Repository<TradeOrder>,
    @InjectRepository(AuctionItem)
    private readonly auctionRepo: Repository<AuctionItem>,
    private readonly eventBus: EventBusService,
  ) {}

  // ===== Trade Order =====

  async createTradeOrder(params: CreateTradeParams): Promise<TradeOrder> {
    const order = this.tradeRepo.create({
      ...params,
      buyerId: null,
      status: TradeStatus.PENDING,
    });
    const saved = await this.tradeRepo.save(order);

    this.eventBus.emit(GameEvents.TRADE_CREATED, {
      tradeId: saved.id,
      sellerId: params.sellerId,
      itemName: params.itemName,
    });

    return saved;
  }

  async buyItem(buyerId: string, tradeId: string): Promise<TradeOrder> {
    const order = await this.tradeRepo.findOne({ where: { id: tradeId } });
    if (!order) {
      throw new GameException(ErrorCodes.TRADE_NOT_FOUND, '交易订单不存在');
    }
    if (order.status !== TradeStatus.PENDING) {
      throw new GameException(ErrorCodes.TRADE_ALREADY_COMPLETED, '交易已结束');
    }
    if (order.sellerId === buyerId) {
      throw new GameException(ErrorCodes.TRADE_NOT_OWNER, '不能购买自己的商品');
    }

    order.buyerId = buyerId;
    order.status = TradeStatus.COMPLETED;
    const saved = await this.tradeRepo.save(order);

    this.eventBus.emit(GameEvents.TRADE_COMPLETED, {
      tradeId: order.id,
      sellerId: order.sellerId,
      buyerId,
    });

    return saved;
  }

  async cancelTradeOrder(
    sellerId: string,
    tradeId: string,
  ): Promise<TradeOrder> {
    const order = await this.tradeRepo.findOne({ where: { id: tradeId } });
    if (!order) {
      throw new GameException(ErrorCodes.TRADE_NOT_FOUND, '交易订单不存在');
    }
    if (order.sellerId !== sellerId) {
      throw new GameException(ErrorCodes.TRADE_NOT_OWNER, '无权操作他人交易');
    }

    order.status = TradeStatus.CANCELLED;
    return this.tradeRepo.save(order);
  }

  async getMarketList(
    page: number,
    limit: number,
  ): Promise<{ items: TradeOrder[]; total: number }> {
    const [items, total] = await this.tradeRepo.findAndCount({
      where: { status: TradeStatus.PENDING },
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  // ===== Auction =====

  async listAuction(params: ListAuctionParams): Promise<AuctionItem> {
    const item = this.auctionRepo.create({
      ...params,
      currentPrice: params.startPrice,
      currentBidderId: null,
      status: AuctionStatus.LISTED,
    });
    const saved = await this.auctionRepo.save(item);

    this.eventBus.emit(GameEvents.AUCTION_LISTED, {
      auctionId: saved.id,
      sellerId: params.sellerId,
      itemName: params.itemName,
    });

    return saved;
  }

  async placeBid(
    bidderId: string,
    auctionId: string,
    bidPrice: string,
  ): Promise<AuctionItem> {
    const item = await this.auctionRepo.findOne({ where: { id: auctionId } });
    if (!item) {
      throw new GameException(ErrorCodes.AUCTION_NOT_FOUND, '拍卖物品不存在');
    }
    if (
      item.status !== AuctionStatus.LISTED &&
      item.status !== AuctionStatus.BID
    ) {
      throw new GameException(ErrorCodes.AUCTION_ALREADY_ENDED, '拍卖已结束');
    }
    if (new Date() > item.expireAt) {
      throw new GameException(ErrorCodes.AUCTION_ALREADY_ENDED, '拍卖已过期');
    }
    if (item.sellerId === bidderId) {
      throw new GameException(
        ErrorCodes.AUCTION_NOT_SELLER,
        '不能竞拍自己的物品',
      );
    }
    if (BigInt(bidPrice) <= BigInt(item.currentPrice)) {
      throw new GameException(
        ErrorCodes.AUCTION_BID_TOO_LOW,
        '出价需高于当前价',
      );
    }

    item.currentPrice = bidPrice;
    item.currentBidderId = bidderId;
    item.status = AuctionStatus.BID;
    const saved = await this.auctionRepo.save(item);

    this.eventBus.emit(GameEvents.AUCTION_BID, {
      auctionId: item.id,
      bidderId,
      bidPrice,
    });

    return saved;
  }

  async endAuction(auctionId: string): Promise<AuctionItem> {
    const item = await this.auctionRepo.findOne({ where: { id: auctionId } });
    if (!item) {
      throw new GameException(ErrorCodes.AUCTION_NOT_FOUND, '拍卖物品不存在');
    }

    if (item.currentBidderId) {
      item.status = AuctionStatus.SOLD;
      this.eventBus.emit(GameEvents.AUCTION_SOLD, {
        auctionId: item.id,
        sellerId: item.sellerId,
        buyerId: item.currentBidderId,
        finalPrice: item.currentPrice,
      });
    } else {
      item.status = AuctionStatus.EXPIRED;
    }

    return this.auctionRepo.save(item);
  }

  async getAuctionList(
    page: number,
    limit: number,
  ): Promise<{ items: AuctionItem[]; total: number }> {
    const [items, total] = await this.auctionRepo.findAndCount({
      where: [{ status: AuctionStatus.LISTED }, { status: AuctionStatus.BID }],
      skip: (page - 1) * limit,
      take: limit,
      order: { expireAt: 'ASC' },
    });
    return { items, total };
  }
}
