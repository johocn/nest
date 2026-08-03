import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RechargeOrder, RechargeProduct } from './entities';
import { EconomyService } from '@modules/economy/economy.service';
import { PlayerService } from '@modules/player/player.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { RechargeStatus, CurrencyType } from '@constants/enums';
import { generateOrderNo } from '@utils/id.util';
import * as crypto from 'crypto';

@Injectable()
export class PaymentService {
  private readonly callbackSecret =
    process.env.PAYMENT_CALLBACK_SECRET || 'mock-secret';

  constructor(
    @InjectRepository(RechargeOrder)
    private readonly orderRepo: Repository<RechargeOrder>,
    @InjectRepository(RechargeProduct)
    private readonly productRepo: Repository<RechargeProduct>,
    private readonly economyService: EconomyService,
    private readonly eventBus: EventBusService,
    private readonly playerService: PlayerService,
  ) {}

  async createOrder(
    playerId: string,
    productId: string,
  ): Promise<RechargeOrder> {
    const product = await this.productRepo.findOne({
      where: { id: productId },
    });
    if (!product) {
      throw new GameException(ErrorCodes.PRODUCT_NOT_FOUND, '充值商品不存在');
    }

    const order = this.orderRepo.create({
      orderNo: generateOrderNo(),
      playerId,
      productId,
      amount: product.amount,
      currency: 'CNY',
      status: RechargeStatus.PENDING,
      platform: 'mock',
    });
    return this.orderRepo.save(order);
  }

  async simulatePay(orderNo: string, playerId: string): Promise<RechargeOrder> {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('模拟支付仅限测试环境');
    }

    const order = await this.orderRepo.findOne({ where: { orderNo } });
    if (!order) {
      throw new GameException(ErrorCodes.ORDER_NOT_FOUND, '订单不存在');
    }
    if (order.playerId !== playerId) {
      throw new GameException(ErrorCodes.FORBIDDEN, '无权操作此订单');
    }
    if (order.status === RechargeStatus.PAID) {
      throw new GameException(ErrorCodes.ORDER_ALREADY_PAID, '订单已支付');
    }

    const sign = this.generateSignature(order.orderNo, order.amount);

    return this.handleCallback({
      orderNo: order.orderNo,
      amount: order.amount,
      sign,
    });
  }

  async handleCallback(params: {
    orderNo: string;
    amount: string;
    sign: string;
  }): Promise<RechargeOrder> {
    const order = await this.orderRepo.findOne({
      where: { orderNo: params.orderNo },
    });
    if (!order) {
      throw new GameException(ErrorCodes.ORDER_NOT_FOUND, '订单不存在');
    }

    const expectedSign = this.generateSignature(order.orderNo, order.amount);
    if (params.sign !== expectedSign) {
      throw new GameException(ErrorCodes.PAYMENT_VERIFY_FAILED, '签名验证失败');
    }

    if (order.status === RechargeStatus.PAID) {
      throw new GameException(ErrorCodes.ORDER_ALREADY_PAID, '订单已支付');
    }

    // Deliver rewards
    const product = await this.productRepo.findOne({
      where: { id: order.productId },
    });
    if (product?.rewardJson?.diamond) {
      await this.economyService.addCurrency(
        order.playerId,
        CurrencyType.DIAMOND,
        product.rewardJson.diamond,
        'recharge',
        `recharge:${order.orderNo}`,
        order.id,
      );
    }
    if (product?.rewardJson?.gold) {
      await this.economyService.addCurrency(
        order.playerId,
        CurrencyType.GOLD,
        product.rewardJson.gold,
        'recharge',
        `recharge:${order.orderNo}`,
        order.id,
      );
    }

    await this.playerService.addRecharge(order.playerId, order.amount);

    order.status = RechargeStatus.PAID;
    order.callbackAt = new Date();
    const saved = await this.orderRepo.save(order);

    this.eventBus.emit(GameEvents.RECHARGE_SUCCESS, {
      playerId: order.playerId,
      orderNo: order.orderNo,
      amount: order.amount,
      reward: product?.rewardJson,
    });

    return saved;
  }

  private generateSignature(orderNo: string, amount: string): string {
    return crypto
      .createHmac('sha256', this.callbackSecret)
      .update(`${orderNo}${amount}`)
      .digest('hex');
  }

  async getOrderList(
    playerId: string,
    page: number,
    limit: number,
  ): Promise<{ items: RechargeOrder[]; total: number }> {
    const [items, total] = await this.orderRepo.findAndCount({
      where: { playerId },
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async getProductList(): Promise<RechargeProduct[]> {
    return this.productRepo.find({ order: { sortOrder: 'ASC' } });
  }

  // ===== Admin CRUD =====

  async createProduct(
    data: Partial<RechargeProduct>,
  ): Promise<RechargeProduct> {
    const product = this.productRepo.create(data);
    return this.productRepo.save(product);
  }

  async getAdminOrderList(
    page: number,
    limit: number,
  ): Promise<{ items: RechargeOrder[]; total: number }> {
    const [items, total] = await this.orderRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async getAdminOrderDetail(orderId: string): Promise<RechargeOrder> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new GameException(ErrorCodes.ORDER_NOT_FOUND, '订单不存在');
    }
    return order;
  }

  async updateProduct(
    id: string,
    data: Partial<RechargeProduct>,
  ): Promise<RechargeProduct> {
    const product = await this.productRepo.findOne({ where: { id } });
    if (!product) {
      throw new GameException(ErrorCodes.PRODUCT_NOT_FOUND, '充值商品不存在');
    }
    Object.assign(product, data);
    return this.productRepo.save(product);
  }

  async deleteProduct(id: string): Promise<{ deleted: boolean }> {
    const result = await this.productRepo.delete(id);
    return { deleted: (result.affected ?? 0) > 0 };
  }
}
