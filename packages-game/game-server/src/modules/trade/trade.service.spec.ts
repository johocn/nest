import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TradeService } from './trade.service';
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
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { TradeStatus, AuctionStatus, NegotiationStatus, EscrowStatus, BountyStatus, CreditStatus, BarterStatus } from '@constants/enums';
import { EconomyService } from '@modules/economy/economy.service';
import { SocialService } from '@modules/social/social.service';
import { CharacterService } from '@modules/character/character.service';
import { CombatService } from '@modules/combat/combat.service';
import { VipService } from '@modules/vip/vip.service';
import { GameEvents } from '@event-bus/game-events';
import type { Repository } from 'typeorm';

describe('TradeService', () => {
  let service: TradeService;
  let tradeRepo: jest.Mocked<Repository<TradeOrder>>;
  let auctionRepo: jest.Mocked<Repository<AuctionItem>>;
  let negotiationRepo: jest.Mocked<Repository<Negotiation>>;
  let escrowRepo: jest.Mocked<Repository<EscrowAgreement>>;
  let bountyRepo: jest.Mocked<Repository<Bounty>>;
  let creditRepo: jest.Mocked<Repository<CreditDebt>>;
  let barterRepo: jest.Mocked<Repository<BarterDeal>>;
  let economyService: jest.Mocked<EconomyService>;
  let socialService: jest.Mocked<SocialService>;
  let characterService: jest.Mocked<CharacterService>;
  let combatService: jest.Mocked<CombatService>;
  let vipService: jest.Mocked<VipService>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    economyService = {
      addCurrency: jest.fn().mockResolvedValue({ balanceAfter: '0' }),
      deductCurrency: jest.fn().mockResolvedValue({ balanceAfter: '0' }),
      getBalance: jest.fn().mockResolvedValue('0'),
    } as unknown as jest.Mocked<EconomyService>;
    socialService = {
      getFriendList: jest.fn().mockResolvedValue([]),
      getMyGuildRole: jest.fn().mockResolvedValue(null),
      getKinships: jest.fn().mockResolvedValue([]),
      getIntelligences: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SocialService>;
    characterService = {
      getRelationshipLevel: jest.fn(),
      increaseFavorability: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<CharacterService>;
    combatService = {
      getCombatLogs: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    } as unknown as jest.Mocked<CombatService>;
    vipService = {
      getPrivilegeValue: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<VipService>;
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
          provide: getRepositoryToken(Negotiation),
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
          provide: getRepositoryToken(EscrowAgreement),
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
          provide: getRepositoryToken(Bounty),
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
          provide: getRepositoryToken(CreditDebt),
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
          provide: getRepositoryToken(BarterDeal),
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
        { provide: EconomyService, useValue: economyService },
        { provide: SocialService, useValue: socialService },
        { provide: CharacterService, useValue: characterService },
        { provide: CombatService, useValue: combatService },
        { provide: VipService, useValue: vipService },
      ],
    }).compile();

    service = module.get(TradeService);
    tradeRepo = module.get(getRepositoryToken(TradeOrder));
    auctionRepo = module.get(getRepositoryToken(AuctionItem));
    negotiationRepo = module.get(getRepositoryToken(Negotiation));
    escrowRepo = module.get(getRepositoryToken(EscrowAgreement));
    bountyRepo = module.get(getRepositoryToken(Bounty));
    creditRepo = module.get(getRepositoryToken(CreditDebt));
    barterRepo = module.get(getRepositoryToken(BarterDeal));
    economyService = module.get(EconomyService);
    socialService = module.get(SocialService);
    characterService = module.get(CharacterService);
    combatService = module.get(CombatService);
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
      expect(result.isExclusive).toBe(false);
      expect(eventBus.emit).toHaveBeenCalled();
    });

    it('should reject exclusive auction when VIP privilege absent', async () => {
      vipService.getPrivilegeValue.mockResolvedValue(0);

      await expect(
        service.listAuction({
          sellerId: 'p1',
          itemTemplateId: 'i1',
          itemName: '神兵',
          quantity: 1,
          startPrice: '500',
          expireAt: new Date(Date.now() + 86400000),
          exclusive: true,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.VIP_AUCTION_ROOM_FORBIDDEN },
      });
      expect(auctionRepo.create).not.toHaveBeenCalled();
    });

    it('should allow exclusive auction when VIP privilege granted', async () => {
      vipService.getPrivilegeValue.mockResolvedValue(1);

      const result = await service.listAuction({
        sellerId: 'p1',
        itemTemplateId: 'i1',
        itemName: '神兵',
        quantity: 1,
        startPrice: '500',
        expireAt: new Date(Date.now() + 86400000),
        exclusive: true,
      });

      expect(vipService.getPrivilegeValue).toHaveBeenCalledWith(
        'p1',
        'exclusiveAuctionRoom',
        0,
      );
      expect(result.isExclusive).toBe(true);
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
      expect(auctionRepo.findAndCount).toHaveBeenCalledWith(
        expect.not.objectContaining({
          where: [expect.objectContaining({ isExclusive: true })],
        }),
      );
    });

    it('should filter exclusive auctions when exclusive=true', async () => {
      auctionRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getAuctionList(1, 20, true);

      const arg = (auctionRepo.findAndCount as jest.Mock).mock.calls[0][0];
      expect(arg.where).toEqual([
        { status: AuctionStatus.LISTED, isExclusive: true },
        { status: AuctionStatus.BID, isExclusive: true },
      ]);
    });
  });

  // ===== Social Economy Event Emissions =====

  describe('acceptNegotiation', () => {
    it('should emit NEGOTIATION_COMPLETED for buyer on accepted deal', async () => {
      negotiationRepo.findOne.mockResolvedValue({
        id: 'n1',
        buyerId: 'buyer',
        sellerId: 'seller',
        tradeOrderId: 't1',
        askPrice: '100',
        replyPrice: '90',
        step: 1,
        maxSteps: 3,
        status: NegotiationStatus.PENDING,
      } as any);
      tradeRepo.findOne.mockResolvedValue({
        id: 't1',
        sellerId: 'seller',
        buyerId: null,
        status: TradeStatus.PENDING,
      } as any);
      economyService.getBalance.mockResolvedValue('0');

      const result = await service.acceptNegotiation('buyer', 'n1');

      expect(result.status).toBe(NegotiationStatus.COMPLETED);
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.NEGOTIATION_COMPLETED,
        { playerId: 'buyer' },
      );
    });
  });

  describe('inspectGoods', () => {
    it('should emit ESCROW_RELEASED for guarantor on release', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'e1',
        buyerId: 'buyer',
        sellerId: 'seller',
        guarantorId: 'guarantor',
        amount: '100',
        feePercent: 2,
        status: EscrowStatus.PENDING,
      } as any);

      const result = await service.inspectGoods('guarantor', 'e1');

      expect(result.status).toBe(EscrowStatus.RELEASED);
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.ESCROW_RELEASED,
        { playerId: 'guarantor' },
      );
    });
  });

  describe('createBounty', () => {
    it('should emit BOUNTY_PUBLISHED for publisher on creation', async () => {
      const result = await service.createBounty(
        'publisher',
        'kill',
        { targetId: 'm1' },
        '100',
      );

      expect(result.status).toBe(BountyStatus.ACTIVE);
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.BOUNTY_PUBLISHED,
        { playerId: 'publisher' },
      );
    });
  });

  describe('completeBounty', () => {
    it('should emit BOUNTY_COMPLETED for acceptor on verified completion', async () => {
      bountyRepo.findOne.mockResolvedValue({
        id: 'b1',
        publisherId: 'publisher',
        acceptorId: 'acceptor',
        type: 'collect',
        targetJson: {},
        goldReward: '100',
        deadline: null,
        status: BountyStatus.ACCEPTED,
      } as any);

      const result = await service.completeBounty('acceptor', 'b1');

      expect(result.status).toBe(BountyStatus.COMPLETED);
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.BOUNTY_COMPLETED,
        { playerId: 'acceptor' },
      );
    });
  });

  describe('repayCredit', () => {
    it('should emit CREDIT_SETTLED for borrower on repayment', async () => {
      creditRepo.findOne.mockResolvedValue({
        id: 'c1',
        borrowerId: 'borrower',
        lenderId: 'lender',
        amount: '100',
        status: CreditStatus.ACTIVE,
      } as any);

      const result = await service.repayCredit('borrower', 'c1');

      expect(result.status).toBe(CreditStatus.SETTLED);
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.CREDIT_SETTLED,
        { playerId: 'borrower' },
      );
    });
  });

  describe('acceptBarter', () => {
    it('should emit BARTER_COMPLETED for party B on dual confirm', async () => {
      barterRepo.findOne.mockResolvedValue({
        id: 'd1',
        partyAId: 'pA',
        partyBId: null,
        itemsAJson: {},
        itemsBJson: {},
        goldAmount: '0',
        aConfirm: true,
        bConfirm: false,
        status: BarterStatus.PENDING,
      } as any);

      const result = await service.acceptBarter('pB', 'd1', {
        itemX: 1,
      });

      expect(result.status).toBe(BarterStatus.COMPLETED);
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.BARTER_COMPLETED,
        { playerId: 'pB' },
      );
    });
  });
});
