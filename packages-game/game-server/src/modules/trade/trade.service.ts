import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TradeOrder,
  AuctionItem,
  Negotiation,
  EscrowAgreement,
  Bounty,
  CreditDebt,
  BarterDeal,
} from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  TradeStatus,
  AuctionStatus,
  NegotiationStatus,
  EscrowStatus,
  BountyStatus,
  CreditStatus,
  BarterStatus,
  CurrencyType,
  GuildRole,
  CombatResult,
} from '@constants/enums';
import { EconomyService } from '@modules/economy/economy.service';
import { SocialService } from '@modules/social/social.service';
import { CharacterService } from '@modules/character/character.service';
import { CombatService } from '@modules/combat/combat.service';

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
    @InjectRepository(Negotiation)
    private readonly negotiationRepo: Repository<Negotiation>,
    @InjectRepository(EscrowAgreement)
    private readonly escrowRepo: Repository<EscrowAgreement>,
    @InjectRepository(Bounty)
    private readonly bountyRepo: Repository<Bounty>,
    @InjectRepository(CreditDebt)
    private readonly creditRepo: Repository<CreditDebt>,
    @InjectRepository(BarterDeal)
    private readonly barterRepo: Repository<BarterDeal>,
    private readonly eventBus: EventBusService,
    private readonly economyService: EconomyService,
    private readonly socialService: SocialService,
    private readonly characterService: CharacterService,
    private readonly combatService: CombatService,
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

  // ===== Negotiation =====

  async startNegotiation(
    buyerId: string,
    tradeOrderId: string,
    askPrice: string,
  ): Promise<Negotiation> {
    const order = await this.tradeRepo.findOne({
      where: { id: tradeOrderId },
    });
    if (!order) {
      throw new GameException(ErrorCodes.TRADE_NOT_FOUND, '交易订单不存在');
    }
    if (order.status !== TradeStatus.PENDING) {
      throw new GameException(ErrorCodes.TRADE_ALREADY_COMPLETED, '交易已结束');
    }
    if (order.sellerId === buyerId) {
      throw new GameException(ErrorCodes.TRADE_NOT_OWNER, '不能与自己的挂单议价');
    }

    const negotiation = this.negotiationRepo.create({
      buyerId,
      sellerId: order.sellerId,
      tradeOrderId,
      askPrice,
      replyPrice: null,
      step: 1,
      maxSteps: 3,
      status: NegotiationStatus.PENDING,
      discountPercent: 0,
      message: null,
    });
    return this.negotiationRepo.save(negotiation);
  }

  async replyNegotiation(
    sellerId: string,
    negotiationId: string,
    replyPrice: string,
  ): Promise<Negotiation> {
    const negotiation = await this.negotiationRepo.findOne({
      where: { id: negotiationId },
    });
    if (!negotiation || negotiation.sellerId !== sellerId) {
      throw new GameException(ErrorCodes.NEGOTIATION_NOT_FOUND, '议价记录不存在');
    }
    if (negotiation.status !== NegotiationStatus.PENDING) {
      throw new GameException(ErrorCodes.NEGOTIATION_STEP_LIMIT, '议价已结束');
    }

    negotiation.step += 1;
    negotiation.replyPrice = replyPrice;
    if (negotiation.step > negotiation.maxSteps) {
      negotiation.status = NegotiationStatus.LOCKED;
      await this.negotiationRepo.save(negotiation);
      throw new GameException(
        ErrorCodes.NEGOTIATION_STEP_LIMIT,
        '议价次数已达上限，交易流单',
      );
    }
    return this.negotiationRepo.save(negotiation);
  }

  async acceptNegotiation(
    buyerId: string,
    negotiationId: string,
  ): Promise<Negotiation> {
    const negotiation = await this.negotiationRepo.findOne({
      where: { id: negotiationId },
    });
    if (!negotiation || negotiation.buyerId !== buyerId) {
      throw new GameException(ErrorCodes.NEGOTIATION_NOT_FOUND, '议价记录不存在');
    }
    if (negotiation.status !== NegotiationStatus.PENDING) {
      throw new GameException(ErrorCodes.NEGOTIATION_STEP_LIMIT, '议价已结束');
    }

    const discount = await this.calcNegotiationDiscount(
      buyerId,
      negotiation.sellerId,
    );
    const ask = BigInt(negotiation.askPrice);
    const reply =
      negotiation.replyPrice !== null
        ? BigInt(negotiation.replyPrice)
        : ask;
    const basePrice = reply < ask ? reply : ask;
    const finalPrice =
      (basePrice * BigInt(100 - discount) + BigInt(50)) / BigInt(100);

    await this.buyItem(buyerId, negotiation.tradeOrderId);

    negotiation.status = NegotiationStatus.COMPLETED;
    negotiation.discountPercent = discount;
    negotiation.message = `成交价${finalPrice.toString()}`;
    return this.negotiationRepo.save(negotiation);
  }

  async rejectNegotiation(
    buyerId: string,
    negotiationId: string,
  ): Promise<Negotiation> {
    const negotiation = await this.negotiationRepo.findOne({
      where: { id: negotiationId },
    });
    if (!negotiation || negotiation.buyerId !== buyerId) {
      throw new GameException(ErrorCodes.NEGOTIATION_NOT_FOUND, '议价记录不存在');
    }
    negotiation.status = NegotiationStatus.EXPIRED;
    return this.negotiationRepo.save(negotiation);
  }

  private async calcNegotiationDiscount(
    buyerId: string,
    sellerId: string,
  ): Promise<number> {
    let discount = 0;
    const [buyerFriends, sellerFriends, buyerGuild, sellerGuild] =
      await Promise.all([
        this.socialService.getFriendList(buyerId),
        this.socialService.getFriendList(sellerId),
        this.socialService.getMyGuildRole(buyerId),
        this.socialService.getMyGuildRole(sellerId),
      ]);
    const isFriend =
      buyerFriends.some((f) => f.friendId === sellerId) ||
      sellerFriends.some((f) => f.friendId === buyerId);
    const sameGuild =
      buyerGuild !== null &&
      sellerGuild !== null &&
      buyerGuild.guildId === sellerGuild.guildId;
    if (isFriend || sameGuild) {
      discount += 5;
    }
    const face = BigInt(
      await this.economyService.getBalance(buyerId, CurrencyType.FACE),
    );
    if (face >= BigInt(80)) {
      discount += 3;
    }
    return discount;
  }

  // ===== Escrow =====

  async createEscrow(
    buyerId: string,
    sellerId: string,
    tradeOrderId: string,
    guarantorId: string,
  ): Promise<EscrowAgreement> {
    const order = await this.tradeRepo.findOne({
      where: { id: tradeOrderId },
    });
    if (!order) {
      throw new GameException(ErrorCodes.TRADE_NOT_FOUND, '交易订单不存在');
    }
    if (order.status !== TradeStatus.PENDING) {
      throw new GameException(ErrorCodes.TRADE_ALREADY_COMPLETED, '交易已结束');
    }
    const qualified = await this.isGuarantorQualified(
      guarantorId,
      buyerId,
      sellerId,
    );
    if (!qualified) {
      throw new GameException(
        ErrorCodes.GUARANTOR_NOT_QUALIFIED,
        '担保人资格不符（需帮主/亲缘/颜面≥60）',
      );
    }

    const amount = (
      BigInt(order.pricePerUnit) * BigInt(order.quantity)
    ).toString();
    await this.economyService.deductCurrency(
      buyerId,
      CurrencyType.GOLD,
      Number(amount),
      'escrow_hold',
      'trade.createEscrow',
      order.id,
    );

    const escrow = this.escrowRepo.create({
      buyerId,
      sellerId,
      guarantorId,
      tradeOrderId,
      amount,
      feePercent: 2,
      status: EscrowStatus.PENDING,
      releasedAt: null,
    });
    return this.escrowRepo.save(escrow);
  }

  async inspectGoods(
    guarantorId: string,
    escrowId: string,
  ): Promise<EscrowAgreement> {
    const escrow = await this.escrowRepo.findOne({
      where: { id: escrowId },
    });
    if (!escrow || escrow.guarantorId !== guarantorId) {
      throw new GameException(ErrorCodes.ESCROW_NOT_FOUND, '担保记录不存在');
    }
    if (escrow.status !== EscrowStatus.PENDING) {
      throw new GameException(ErrorCodes.ESCROW_NOT_READY, '担保交易未处于托管状态');
    }

    const amount = BigInt(escrow.amount);
    const fee = (amount * BigInt(escrow.feePercent)) / BigInt(100);
    const toSeller = amount - fee;
    await this.economyService.addCurrency(
      escrow.sellerId,
      CurrencyType.GOLD,
      Number(toSeller),
      'escrow_release',
      'trade.inspectGoods',
      escrow.id,
    );
    if (fee > BigInt(0)) {
      await this.economyService.addCurrency(
        escrow.guarantorId,
        CurrencyType.GOLD,
        Number(fee),
        'escrow_fee',
        'trade.inspectGoods',
        escrow.id,
      );
    }

    escrow.status = EscrowStatus.RELEASED;
    escrow.releasedAt = new Date();
    return this.escrowRepo.save(escrow);
  }

  async penalizeEscrow(escrowId: string): Promise<EscrowAgreement> {
    const escrow = await this.escrowRepo.findOne({
      where: { id: escrowId },
    });
    if (!escrow) {
      throw new GameException(ErrorCodes.ESCROW_NOT_FOUND, '担保记录不存在');
    }
    if (escrow.status !== EscrowStatus.PENDING) {
      throw new GameException(ErrorCodes.ESCROW_NOT_READY, '担保交易未处于托管状态');
    }

    const penalty = (BigInt(escrow.amount) * BigInt(2)).toString();
    await this.economyService.deductCurrency(
      escrow.guarantorId,
      CurrencyType.GOLD,
      Number(penalty),
      'escrow_penalty',
      'trade.penalizeEscrow',
      escrow.id,
    );
    await this.economyService.addCurrency(
      escrow.buyerId,
      CurrencyType.GOLD,
      Number(penalty),
      'escrow_penalty',
      'trade.penalizeEscrow',
      escrow.id,
    );

    escrow.status = EscrowStatus.PENALIZED;
    return this.escrowRepo.save(escrow);
  }

  async getEscrow(escrowId: string): Promise<EscrowAgreement> {
    const escrow = await this.escrowRepo.findOne({
      where: { id: escrowId },
    });
    if (!escrow) {
      throw new GameException(ErrorCodes.ESCROW_NOT_FOUND, '担保记录不存在');
    }
    return escrow;
  }

  private async isGuarantorQualified(
    guarantorId: string,
    buyerId: string,
    sellerId: string,
  ): Promise<boolean> {
    const [guildRole, kinships, face] = await Promise.all([
      this.socialService.getMyGuildRole(guarantorId),
      this.socialService.getKinships(guarantorId),
      this.economyService.getBalance(guarantorId, CurrencyType.FACE),
    ]);
    if (guildRole !== null && guildRole.role === GuildRole.LEADER) {
      return true;
    }
    const kinshipQualified = kinships.some(
      (k) =>
        k.members.includes(guarantorId) &&
        (k.members.includes(buyerId) || k.members.includes(sellerId)),
    );
    if (kinshipQualified) {
      return true;
    }
    if (BigInt(face) >= BigInt(60)) {
      return true;
    }
    return false;
  }

  // ===== Credit =====

  async createCredit(
    borrowerId: string,
    lenderId: string,
    amount: string,
    dueDays: number,
  ): Promise<CreditDebt> {
    const favor = BigInt(
      await this.economyService.getBalance(borrowerId, CurrencyType.FAVOR),
    );
    if (favor < BigInt(100)) {
      throw new GameException(ErrorCodes.CREDIT_OVERDUE, '人情值不足，需≥100');
    }
    const [myFriends, theirFriends] = await Promise.all([
      this.socialService.getFriendList(borrowerId),
      this.socialService.getFriendList(lenderId),
    ]);
    const isFriend =
      myFriends.some((f) => f.friendId === lenderId) ||
      theirFriends.some((f) => f.friendId === borrowerId);
    if (!isFriend) {
      throw new GameException(ErrorCodes.CREDIT_NOT_FOUND, '非好友不可赊账');
    }

    await this.economyService.addCurrency(
      borrowerId,
      CurrencyType.GOLD,
      Number(amount),
      'credit_loan',
      'trade.createCredit',
    );

    const debt = this.creditRepo.create({
      borrowerId,
      lenderId,
      amount,
      dueAt: new Date(Date.now() + dueDays * 24 * 3600 * 1000),
      collateralAmount: '100',
      status: CreditStatus.ACTIVE,
      settledAt: null,
    });
    return this.creditRepo.save(debt);
  }

  async repayCredit(
    borrowerId: string,
    creditId: string,
  ): Promise<CreditDebt> {
    const debt = await this.creditRepo.findOne({ where: { id: creditId } });
    if (!debt || debt.borrowerId !== borrowerId) {
      throw new GameException(ErrorCodes.CREDIT_NOT_FOUND, '赊账记录不存在');
    }
    if (debt.status !== CreditStatus.ACTIVE) {
      throw new GameException(ErrorCodes.CREDIT_OVERDUE, '赊账已结清或已违约');
    }

    await this.economyService.deductCurrency(
      borrowerId,
      CurrencyType.GOLD,
      Number(debt.amount),
      'credit_repay',
      'trade.repayCredit',
      creditId,
    );
    debt.status = CreditStatus.SETTLED;
    debt.settledAt = new Date();
    const saved = await this.creditRepo.save(debt);

    await this.characterService.increaseFavorability(
      borrowerId,
      debt.lenderId,
      5,
    );
    await this.characterService.increaseFavorability(
      debt.lenderId,
      borrowerId,
      5,
    );
    return saved;
  }

  async settleOverdueCredits(): Promise<number> {
    const debts = await this.creditRepo.find({
      where: { status: CreditStatus.ACTIVE },
    });
    const now = new Date();
    let handled = 0;
    for (const debt of debts) {
      if (debt.dueAt >= now) {
        continue;
      }
      const balance = BigInt(
        await this.economyService.getBalance(
          debt.borrowerId,
          CurrencyType.FAVOR,
        ),
      );
      const collateral = BigInt(debt.collateralAmount);
      const deduct = balance < collateral ? balance : collateral;
      if (deduct > BigInt(0)) {
        await this.economyService.deductCurrency(
          debt.borrowerId,
          CurrencyType.FAVOR,
          Number(deduct),
          'credit_default',
          'trade.settleOverdueCredits',
          debt.id,
        );
      }
      debt.status = CreditStatus.DEFAULTED;
      await this.creditRepo.save(debt);
      handled += 1;
    }
    return handled;
  }

  async getCreditList(playerId: string): Promise<CreditDebt[]> {
    return this.creditRepo.find({
      where: [{ borrowerId: playerId }, { lenderId: playerId }],
      order: { createdAt: 'DESC' },
    });
  }

  // ===== Barter =====

  async createBarter(
    partyAId: string,
    itemsAJson: Record<string, any>,
    goldAmount: string,
  ): Promise<BarterDeal> {
    const deal = this.barterRepo.create({
      partyAId,
      partyBId: null,
      itemsAJson,
      itemsBJson: {},
      goldAmount,
      aConfirm: true,
      bConfirm: false,
      status: BarterStatus.PENDING,
    });
    return this.barterRepo.save(deal);
  }

  async acceptBarter(
    partyBId: string,
    barterId: string,
    itemsBJson: Record<string, any>,
  ): Promise<BarterDeal> {
    const deal = await this.barterRepo.findOne({ where: { id: barterId } });
    if (!deal || deal.status !== BarterStatus.PENDING) {
      throw new GameException(ErrorCodes.BARTER_NOT_FOUND, '易物记录不存在或已结束');
    }
    if (deal.partyAId === partyBId || deal.bConfirm) {
      throw new GameException(ErrorCodes.BARTER_CONFIRM_MISMATCH, '易物确认不匹配');
    }

    deal.partyBId = partyBId;
    deal.itemsBJson = itemsBJson;
    deal.bConfirm = true;
    if (deal.aConfirm && deal.bConfirm) {
      deal.status = BarterStatus.COMPLETED;
      this.eventBus.emit(GameEvents.TRADE_COMPLETED, {
        barterId: deal.id,
        partyAId: deal.partyAId,
        partyBId,
        kind: 'barter',
      });
    }
    return this.barterRepo.save(deal);
  }

  async getBarterList(playerId: string): Promise<BarterDeal[]> {
    return this.barterRepo.find({
      where: [{ partyAId: playerId }, { partyBId: playerId }],
      order: { createdAt: 'DESC' },
    });
  }

  // ===== Bounty =====

  async createBounty(
    publisherId: string,
    type: string,
    targetJson: Record<string, any>,
    goldReward: string,
    deadline?: string,
    maxAcceptors = 1,
  ): Promise<Bounty> {
    await this.economyService.deductCurrency(
      publisherId,
      CurrencyType.GOLD,
      Number(goldReward),
      'bounty_hold',
      'trade.createBounty',
    );

    const bounty = this.bountyRepo.create({
      publisherId,
      type,
      targetJson,
      goldReward,
      deadline: deadline ? new Date(deadline) : null,
      maxAcceptors,
      acceptorId: null,
      status: BountyStatus.ACTIVE,
    });
    return this.bountyRepo.save(bounty);
  }

  async acceptBounty(
    acceptorId: string,
    bountyId: string,
  ): Promise<Bounty> {
    const bounty = await this.bountyRepo.findOne({ where: { id: bountyId } });
    if (!bounty) {
      throw new GameException(ErrorCodes.BOUNTY_NOT_FOUND, '悬赏不存在');
    }
    if (bounty.acceptorId !== null || acceptorId === bounty.publisherId) {
      throw new GameException(ErrorCodes.BOUNTY_FULL, '悬赏已满员或不可接取');
    }
    if (bounty.status !== BountyStatus.ACTIVE) {
      throw new GameException(ErrorCodes.BOUNTY_NOT_FOUND, '悬赏不可接取');
    }

    bounty.acceptorId = acceptorId;
    bounty.status = BountyStatus.ACCEPTED;
    return this.bountyRepo.save(bounty);
  }

  async completeBounty(
    acceptorId: string,
    bountyId: string,
  ): Promise<Bounty> {
    const bounty = await this.bountyRepo.findOne({ where: { id: bountyId } });
    if (!bounty) {
      throw new GameException(ErrorCodes.BOUNTY_NOT_FOUND, '悬赏不存在');
    }
    if (bounty.acceptorId !== acceptorId) {
      throw new GameException(ErrorCodes.BOUNTY_NOT_FOUND, '无权提交该悬赏');
    }
    if (bounty.deadline !== null && new Date() > bounty.deadline) {
      bounty.status = BountyStatus.FAILED;
      await this.bountyRepo.save(bounty);
      throw new GameException(ErrorCodes.BOUNTY_DEADLINE, '悬赏已超期');
    }

    const passed = await this.verifyBountyTarget(bounty);
    if (!passed) {
      throw new GameException(ErrorCodes.BOUNTY_NOT_FOUND, '悬赏目标未达成');
    }

    await this.economyService.addCurrency(
      acceptorId,
      CurrencyType.GOLD,
      Number(bounty.goldReward),
      'bounty_reward',
      'trade.completeBounty',
      bounty.id,
    );
    bounty.status = BountyStatus.COMPLETED;
    const saved = await this.bountyRepo.save(bounty);
    this.eventBus.emit(GameEvents.TRADE_COMPLETED, {
      bountyId: bounty.id,
      acceptorId,
      publisherId: bounty.publisherId,
      kind: 'bounty',
    });
    return saved;
  }

  async cancelBounty(
    publisherId: string,
    bountyId: string,
  ): Promise<Bounty> {
    const bounty = await this.bountyRepo.findOne({ where: { id: bountyId } });
    if (!bounty || bounty.publisherId !== publisherId) {
      throw new GameException(ErrorCodes.BOUNTY_NOT_FOUND, '悬赏不存在或无权操作');
    }
    if (
      bounty.status !== BountyStatus.ACTIVE &&
      bounty.status !== BountyStatus.ACCEPTED
    ) {
      throw new GameException(ErrorCodes.BOUNTY_NOT_FOUND, '悬赏已结束不可取消');
    }

    await this.economyService.addCurrency(
      publisherId,
      CurrencyType.GOLD,
      Number(bounty.goldReward),
      'bounty_refund',
      'trade.cancelBounty',
      bounty.id,
    );
    bounty.status = BountyStatus.CANCELLED;
    return this.bountyRepo.save(bounty);
  }

  async getBountyBoard(
    page: number,
    limit: number,
  ): Promise<{ items: Bounty[]; total: number }> {
    const [items, total] = await this.bountyRepo.findAndCount({
      where: [{ status: BountyStatus.ACTIVE }, { status: BountyStatus.ACCEPTED }],
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  private async verifyBountyTarget(bounty: Bounty): Promise<boolean> {
    if (bounty.type === 'kill') {
      const targetId = (bounty.targetJson as { targetId?: string }).targetId;
      if (!targetId) {
        return false;
      }
      const { items } = await this.combatService.getCombatLogs(
        bounty.acceptorId!,
        1,
        50,
      );
      return items.some(
        (l) => l.result === CombatResult.WIN && l.defenderId === targetId,
      );
    }
    if (bounty.type === 'intel') {
      const target = bounty.targetJson as { grade?: string; keyword?: string };
      const intels = await this.socialService.getIntelligences(
        bounty.acceptorId!,
      );
      if (target.grade) {
        return intels.some((i) => i.grade === target.grade);
      }
      if (target.keyword) {
        const keyword = target.keyword;
        return intels.some(
          (i) =>
            (i.title?.includes(keyword) ?? false) ||
            (i.content?.includes(keyword) ?? false),
        );
      }
      return false;
    }
    if (bounty.type === 'collect') {
      return true;
    }
    return false;
  }
}
