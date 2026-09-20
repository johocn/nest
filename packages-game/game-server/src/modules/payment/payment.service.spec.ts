import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentService } from './payment.service';
import { RechargeOrder, RechargeProduct } from './entities';
import { EconomyService } from '@modules/economy/economy.service';
import { PlayerService } from '@modules/player/player.service';
import { VipService } from '@modules/vip/vip.service';
import { ConfigManageService } from '@modules/config/config.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { RechargeStatus, CurrencyType } from '@constants/enums';
import * as crypto from 'crypto';
import type { Repository } from 'typeorm';

describe('PaymentService', () => {
  let service: PaymentService;
  let orderRepo: jest.Mocked<Repository<RechargeOrder>>;
  let productRepo: jest.Mocked<Repository<RechargeProduct>>;
  let economyService: jest.Mocked<EconomyService>;
  let playerService: jest.Mocked<PlayerService>;
  let vipService: jest.Mocked<VipService>;
  let configService: jest.Mocked<ConfigManageService>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        {
          provide: getRepositoryToken(RechargeOrder),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            findAndCount: jest.fn(),
            query: jest.fn(),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
          },
        },
        {
          provide: getRepositoryToken(RechargeProduct),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
          },
        },
        {
          provide: EconomyService,
          useValue: {
            addCurrency: jest.fn().mockResolvedValue({ balanceAfter: '1000' }),
          },
        },
        {
          provide: PlayerService,
          useValue: { addRecharge: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: VipService,
          useValue: { addVipExp: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: ConfigManageService,
          useValue: { getConfig: jest.fn() },
        },
        {
          provide: EventBusService,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PaymentService);
    orderRepo = module.get(getRepositoryToken(RechargeOrder));
    productRepo = module.get(getRepositoryToken(RechargeProduct));
    economyService = module.get(EconomyService);
    playerService = module.get(PlayerService);
    vipService = module.get(VipService);
    configService = module.get(ConfigManageService);
    eventBus = module.get(EventBusService);
  });

  describe('createOrder', () => {
    it('should create pending order', async () => {
      productRepo.findOne.mockResolvedValue({
        id: 'prod1',
        name: '100钻石',
        amount: '600',
        rewardJson: { diamond: 100 },
      } as any);

      const result = await service.createOrder('p1', 'prod1');

      expect(result.status).toBe(RechargeStatus.PENDING);
      expect(result.playerId).toBe('p1');
      expect(result.amount).toBe('600');
    });

    it('should throw when product not found', async () => {
      productRepo.findOne.mockResolvedValue(null);

      await expect(service.createOrder('p1', 'unknown')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('simulatePay', () => {
    it('should process payment and deliver rewards', async () => {
      orderRepo.findOne.mockResolvedValue({
        id: 'o1',
        orderNo: 'ORD123',
        playerId: 'p1',
        productId: 'prod1',
        amount: '600',
        status: RechargeStatus.PENDING,
        createdAt: new Date(),
      } as any);
      productRepo.findOne.mockResolvedValue({
        id: 'prod1',
        rewardJson: { diamond: 100 },
      } as any);

      const result = await service.simulatePay('o1', 'p1');

      expect(result.status).toBe(RechargeStatus.DELIVERED);
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.DIAMOND,
        100,
        'recharge',
        expect.any(String),
        'o1',
      );
      expect(playerService.addRecharge).toHaveBeenCalledWith('p1', '600');
      expect(eventBus.emit).toHaveBeenCalled();
    });

    it('should throw when order not found', async () => {
      orderRepo.findOne.mockResolvedValue(null);

      await expect(service.simulatePay('unknown', 'p1')).rejects.toThrow(
        GameException,
      );
    });

    it('should throw when order already paid', async () => {
      orderRepo.findOne.mockResolvedValue({
        id: 'o1',
        playerId: 'p1',
        status: RechargeStatus.PAID,
        createdAt: new Date(),
      } as any);

      await expect(service.simulatePay('ORD123', 'p1')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('cancelOrder', () => {
    it('取消待支付订单置 CANCELLED', async () => {
      orderRepo.findOne.mockResolvedValue({
        orderNo: 'o1',
        playerId: '1',
        status: RechargeStatus.PENDING,
        createdAt: new Date(),
      } as any);

      const order = await service.cancelOrder('o1', '1');

      expect(order.status).toBe(RechargeStatus.CANCELLED);
    });

    it('已支付订单不可取消', async () => {
      orderRepo.findOne.mockResolvedValue({
        orderNo: 'o1',
        playerId: '1',
        status: RechargeStatus.PAID,
        createdAt: new Date(),
      } as any);

      await expect(service.cancelOrder('o1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.ORDER_CANCEL_INVALID },
      });
    });

    it('超时订单惰性置 EXPIRED 并拒绝', async () => {
      orderRepo.findOne.mockResolvedValue({
        orderNo: 'o1',
        playerId: '1',
        status: RechargeStatus.PENDING,
        createdAt: new Date(Date.now() - 40 * 60000),
      } as any);
      orderRepo.query.mockResolvedValue([{ expired: true }]);

      const err: any = await service.cancelOrder('o1', '1').catch((e) => e);

      expect(err.response.code).toBe(ErrorCodes.ORDER_EXPIRED);
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: RechargeStatus.EXPIRED }),
      );
    });

    it('非本人订单拒绝', async () => {
      orderRepo.findOne.mockResolvedValue({
        orderNo: 'o1',
        playerId: '9',
        status: RechargeStatus.PENDING,
        createdAt: new Date(),
      } as any);

      await expect(service.cancelOrder('o1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.FORBIDDEN },
      });
    });
  });

  describe('handleCallback', () => {
    it('回调成功发奖并置 DELIVERED + 加 VIP 经验', async () => {
      orderRepo.findOne.mockResolvedValue({
        id: '1',
        orderNo: 'o1',
        playerId: '9',
        productId: 'p1',
        amount: '100',
        status: RechargeStatus.PENDING,
        createdAt: new Date(),
        callbackAt: null,
      } as any);
      productRepo.findOne.mockResolvedValue({
        id: 'p1',
        rewardJson: { diamond: 100 },
      } as any);
      vipService.addVipExp.mockResolvedValue({
        vipLevel: 1,
        vipExp: 100,
        leveledUp: true,
      } as any);
      configService.getConfig.mockResolvedValue({ value: '1' } as any);
      const sign = crypto
        .createHmac('sha256', 'mock-secret')
        .update('o1100')
        .digest('hex');

      const saved = await service.handleCallback({
        orderNo: 'o1',
        amount: '100',
        sign,
      });

      expect(saved.status).toBe(RechargeStatus.DELIVERED);
      expect(vipService.addVipExp).toHaveBeenCalledWith('9', 100);
    });

    it('签名不匹配拒绝', async () => {
      orderRepo.findOne.mockResolvedValue({
        orderNo: 'o1',
        playerId: '9',
        status: RechargeStatus.PENDING,
        createdAt: new Date(),
      } as any);

      await expect(
        service.handleCallback({ orderNo: 'o1', amount: '100', sign: 'x' }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.PAYMENT_VERIFY_FAILED },
      });
    });
  });

  describe('adminDeliver', () => {
    it('补单发货：发奖 + DELIVERED + 事件', async () => {
      orderRepo.findOne.mockResolvedValue({
        id: '1',
        orderNo: 'o1',
        playerId: '9',
        productId: 'p1',
        amount: '100',
        status: RechargeStatus.PAID,
        createdAt: new Date(),
        callbackAt: null,
      } as any);
      productRepo.findOne.mockResolvedValue({
        id: 'p1',
        rewardJson: { diamond: 100 },
      } as any);
      configService.getConfig.mockResolvedValue({ value: '1' } as any);

      const saved = await service.adminDeliver('system', '1');

      expect(saved.status).toBe(RechargeStatus.DELIVERED);
      expect(saved.callbackAt).toBeInstanceOf(Date);
      expect(vipService.addVipExp).toHaveBeenCalledWith('9', 100);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'payment.recharge.success',
        expect.objectContaining({ playerId: '9', orderNo: 'o1' }),
      );
    });

    it('已发货订单拒绝重复发货', async () => {
      orderRepo.findOne.mockResolvedValue({
        id: '1',
        orderNo: 'o1',
        playerId: '9',
        status: RechargeStatus.DELIVERED,
        createdAt: new Date(),
      } as any);

      await expect(service.adminDeliver('system', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.ORDER_DELIVERED },
      });
      expect(playerService.addRecharge).not.toHaveBeenCalled();
    });
  });

  describe('getOrderList', () => {
    it('should return paginated orders', async () => {
      orderRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getOrderList('p1', 1, 20);

      expect(result.total).toBe(0);
    });
  });

  describe('getProductList', () => {
    it('should return all products', async () => {
      productRepo.find.mockResolvedValue([
        { id: 'p1', name: '100钻石' },
      ] as any);

      const result = await service.getProductList();

      expect(result).toHaveLength(1);
    });
  });

  describe('admin CRUD', () => {
    it('should create product', async () => {
      const result = await service.createProduct({
        name: '200钻石',
        amount: '1200',
        rewardJson: { diamond: 200 },
      } as any);

      expect(result.name).toBe('200钻石');
    });
  });
});
