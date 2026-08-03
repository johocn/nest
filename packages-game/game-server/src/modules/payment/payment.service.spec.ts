import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentService } from './payment.service';
import { RechargeOrder, RechargeProduct } from './entities';
import { EconomyService } from '@modules/economy/economy.service';
import { PlayerService } from '@modules/player/player.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { RechargeStatus, CurrencyType } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('PaymentService', () => {
  let service: PaymentService;
  let orderRepo: jest.Mocked<Repository<RechargeOrder>>;
  let productRepo: jest.Mocked<Repository<RechargeProduct>>;
  let economyService: jest.Mocked<EconomyService>;
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
          provide: EventBusService,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PaymentService);
    orderRepo = module.get(getRepositoryToken(RechargeOrder));
    productRepo = module.get(getRepositoryToken(RechargeProduct));
    economyService = module.get(EconomyService);
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
      } as any);
      productRepo.findOne.mockResolvedValue({
        id: 'prod1',
        rewardJson: { diamond: 100 },
      } as any);

      const result = await service.simulatePay('o1', 'p1');

      expect(result.status).toBe(RechargeStatus.PAID);
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.DIAMOND,
        100,
        'recharge',
        expect.any(String),
        'o1',
      );
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
      } as any);

      await expect(service.simulatePay('ORD123', 'p1')).rejects.toThrow(
        GameException,
      );
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
