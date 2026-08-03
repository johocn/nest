import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TradeService } from './trade.service';
import { TradeOrder, AuctionItem } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { TradeStatus, AuctionStatus } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('TradeService', () => {
  let service: TradeService;
  let tradeRepo: jest.Mocked<Repository<TradeOrder>>;
  let auctionRepo: jest.Mocked<Repository<AuctionItem>>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeService,
        {
          provide: getRepositoryToken(TradeOrder),
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
          provide: getRepositoryToken(AuctionItem),
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
          provide: EventBusService,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(TradeService);
    tradeRepo = module.get(getRepositoryToken(TradeOrder));
    auctionRepo = module.get(getRepositoryToken(AuctionItem));
    eventBus = module.get(EventBusService);
  });

  // ===== Trade Order =====

  describe('createTradeOrder', () => {
    it('should create a pending trade order', async () => {
      const result = await service.createTradeOrder({
        sellerId: 'p1',
        itemTemplateId: 'i1',
        itemName: '铁剑',
        quantity: 1,
        pricePerUnit: '100',
        currencyType: 'gold',
      });

      expect(result.sellerId).toBe('p1');
      expect(result.status).toBe(TradeStatus.PENDING);
      expect(eventBus.emit).toHaveBeenCalled();
    });
  });

  describe('buyItem', () => {
    it('should complete trade order when buyer purchases', async () => {
      tradeRepo.findOne.mockResolvedValue({
        id: 't1',
        sellerId: 'p1',
        buyerId: null,
        status: TradeStatus.PENDING,
        itemTemplateId: 'i1',
        itemName: '铁剑',
        quantity: 1,
        pricePerUnit: '100',
      } as any);

      const result = await service.buyItem('p2', 't1');

      expect(result.status).toBe(TradeStatus.COMPLETED);
      expect(result.buyerId).toBe('p2');
    });

    it('should throw when trade not found', async () => {
      tradeRepo.findOne.mockResolvedValue(null);

      await expect(service.buyItem('p2', 't999')).rejects.toThrow(
        GameException,
      );
    });

    it('should throw when trade already completed', async () => {
      tradeRepo.findOne.mockResolvedValue({
        id: 't1',
        status: TradeStatus.COMPLETED,
        sellerId: 'p1',
      } as any);

      await expect(service.buyItem('p2', 't1')).rejects.toThrow(GameException);
    });

    it('should throw when buying own item', async () => {
      tradeRepo.findOne.mockResolvedValue({
        id: 't1',
        status: TradeStatus.PENDING,
        sellerId: 'p1',
      } as any);

      await expect(service.buyItem('p1', 't1')).rejects.toThrow(GameException);
    });
  });

  describe('cancelTradeOrder', () => {
    it('should cancel order when seller requests', async () => {
      tradeRepo.findOne.mockResolvedValue({
        id: 't1',
        sellerId: 'p1',
        status: TradeStatus.PENDING,
      } as any);

      const result = await service.cancelTradeOrder('p1', 't1');

      expect(result.status).toBe(TradeStatus.CANCELLED);
    });

    it('should throw when not the seller', async () => {
      tradeRepo.findOne.mockResolvedValue({
        id: 't1',
        sellerId: 'p1',
        status: TradeStatus.PENDING,
      } as any);

      await expect(service.cancelTradeOrder('p2', 't1')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('getMarketList', () => {
    it('should return paginated pending orders', async () => {
      tradeRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getMarketList(1, 20);

      expect(result.total).toBe(0);
    });
  });

  // ===== Auction =====

  describe('listAuction', () => {
    it('should create auction listing', async () => {
      const result = await service.listAuction({
        sellerId: 'p1',
        itemTemplateId: 'i1',
        itemName: '神兵',
        quantity: 1,
        startPrice: '500',
        expireAt: new Date(Date.now() + 86400000),
      });

      expect(result.sellerId).toBe('p1');
      expect(result.status).toBe(AuctionStatus.LISTED);
      expect(result.currentPrice).toBe('500');
      expect(eventBus.emit).toHaveBeenCalled();
    });
  });

  describe('placeBid', () => {
    it('should update current bid when bid is higher', async () => {
      auctionRepo.findOne.mockResolvedValue({
        id: 'a1',
        sellerId: 'p1',
        currentPrice: '500',
        currentBidderId: null,
        status: AuctionStatus.LISTED,
        startPrice: '500',
        expireAt: new Date(Date.now() + 3600000),
      } as any);

      const result = await service.placeBid('p2', 'a1', '600');

      expect(result.currentPrice).toBe('600');
      expect(result.currentBidderId).toBe('p2');
      expect(result.status).toBe(AuctionStatus.BID);
    });

    it('should throw when bid is too low', async () => {
      auctionRepo.findOne.mockResolvedValue({
        id: 'a1',
        sellerId: 'p1',
        currentPrice: '500',
        status: AuctionStatus.LISTED,
        expireAt: new Date(Date.now() + 3600000),
      } as any);

      await expect(service.placeBid('p2', 'a1', '400')).rejects.toThrow(
        GameException,
      );
    });

    it('should throw when auction expired', async () => {
      auctionRepo.findOne.mockResolvedValue({
        id: 'a1',
        sellerId: 'p1',
        currentPrice: '500',
        status: AuctionStatus.LISTED,
        expireAt: new Date(Date.now() - 3600000),
      } as any);

      await expect(service.placeBid('p2', 'a1', '600')).rejects.toThrow(
        GameException,
      );
    });

    it('should throw when bidding on own auction', async () => {
      auctionRepo.findOne.mockResolvedValue({
        id: 'a1',
        sellerId: 'p1',
        currentPrice: '500',
        status: AuctionStatus.LISTED,
        expireAt: new Date(Date.now() + 3600000),
      } as any);

      await expect(service.placeBid('p1', 'a1', '600')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('endAuction', () => {
    it('should mark as sold when there is a bidder', async () => {
      auctionRepo.findOne.mockResolvedValue({
        id: 'a1',
        sellerId: 'p1',
        currentPrice: '600',
        currentBidderId: 'p2',
        status: AuctionStatus.BID,
        expireAt: new Date(Date.now() - 1000),
      } as any);

      const result = await service.endAuction('a1');

      expect(result.status).toBe(AuctionStatus.SOLD);
      expect(eventBus.emit).toHaveBeenCalled();
    });

    it('should mark as expired when no bidder', async () => {
      auctionRepo.findOne.mockResolvedValue({
        id: 'a1',
        sellerId: 'p1',
        currentPrice: '500',
        currentBidderId: null,
        status: AuctionStatus.LISTED,
        expireAt: new Date(Date.now() - 1000),
      } as any);

      const result = await service.endAuction('a1');

      expect(result.status).toBe(AuctionStatus.EXPIRED);
    });
  });

  describe('getAuctionList', () => {
    it('should return paginated active auctions', async () => {
      auctionRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getAuctionList(1, 20);

      expect(result.total).toBe(0);
    });
  });
});
