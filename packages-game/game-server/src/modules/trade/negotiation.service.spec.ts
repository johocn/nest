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
import { EconomyService } from '@modules/economy/economy.service';
import { SocialService } from '@modules/social/social.service';
import { CharacterService } from '@modules/character/character.service';
import { CombatService } from '@modules/combat/combat.service';
import { VipService } from '@modules/vip/vip.service';
import { RiskGateService } from '@modules/risk/risk-gate.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  TradeStatus,
  NegotiationStatus,
  CurrencyType,
  GuildRole,
} from '@constants/enums';
import type { Repository } from 'typeorm';

describe('TradeService Negotiation', () => {
  let service: TradeService;
  let tradeRepo: jest.Mocked<Repository<TradeOrder>>;
  let negotiationRepo: jest.Mocked<Repository<Negotiation>>;
  let economyService: jest.Mocked<EconomyService>;
  let socialService: jest.Mocked<SocialService>;
  let eventBus: jest.Mocked<EventBusService>;

  const repoMock = () => ({
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn().mockImplementation((data: any) => Promise.resolve(data)),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeService,
        { provide: getRepositoryToken(TradeOrder), useValue: repoMock() },
        { provide: getRepositoryToken(AuctionItem), useValue: repoMock() },
        { provide: getRepositoryToken(Negotiation), useValue: repoMock() },
        { provide: getRepositoryToken(EscrowAgreement), useValue: repoMock() },
        { provide: getRepositoryToken(Bounty), useValue: repoMock() },
        { provide: getRepositoryToken(CreditDebt), useValue: repoMock() },
        { provide: getRepositoryToken(BarterDeal), useValue: repoMock() },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
        {
          provide: EconomyService,
          useValue: {
            addCurrency: jest.fn().mockResolvedValue({ balanceAfter: '0' }),
            deductCurrency: jest.fn().mockResolvedValue({ balanceAfter: '0' }),
            getBalance: jest.fn().mockResolvedValue('0'),
          },
        },
        {
          provide: SocialService,
          useValue: {
            getFriendList: jest.fn().mockResolvedValue([]),
            getMyGuildRole: jest.fn().mockResolvedValue(null),
            getKinships: jest.fn().mockResolvedValue([]),
            getIntelligences: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: CharacterService,
          useValue: { getRelationshipLevel: jest.fn(), increaseFavorability: jest.fn() },
        },
        {
          provide: CombatService,
          useValue: { getCombatLogs: jest.fn().mockResolvedValue({ items: [], total: 0 }) },
        },
        {
          provide: VipService,
          useValue: { getPrivilegeValue: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: RiskGateService,
          useValue: { assertAuction: jest.fn().mockResolvedValue(undefined), assertTransfer: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(TradeService);
    tradeRepo = module.get(getRepositoryToken(TradeOrder));
    negotiationRepo = module.get(getRepositoryToken(Negotiation));
    economyService = module.get(EconomyService);
    socialService = module.get(SocialService);
    eventBus = module.get(EventBusService);
  });

  const makePendingOrder = (): any => ({
    id: 't1',
    sellerId: 'p2',
    buyerId: null,
    itemTemplateId: 'i1',
    itemName: '铁剑',
    quantity: 1,
    pricePerUnit: '100',
    status: TradeStatus.PENDING,
  });

  const pendingNegotiation = (overrides: any = {}): any => ({
    id: 'n1',
    buyerId: 'p1',
    sellerId: 'p2',
    tradeOrderId: 't1',
    askPrice: '100',
    replyPrice: '90',
    step: 1,
    maxSteps: 3,
    status: NegotiationStatus.PENDING,
    discountPercent: 0,
    message: null,
    ...overrides,
  });

  describe('startNegotiation', () => {
    it('should create pending negotiation with step=1', async () => {
      tradeRepo.findOne.mockResolvedValue(makePendingOrder());

      const result = await service.startNegotiation('p1', 't1', '100');

      expect(result.status).toBe(NegotiationStatus.PENDING);
      expect(result.step).toBe(1);
      expect(result.buyerId).toBe('p1');
      expect(result.sellerId).toBe('p2');
      expect(result.askPrice).toBe('100');
    });

    it('should throw TRADE_NOT_FOUND when order missing', async () => {
      tradeRepo.findOne.mockResolvedValue(null);

      await expect(service.startNegotiation('p1', 't999', '100')).rejects.toMatchObject({
        response: { code: ErrorCodes.TRADE_NOT_FOUND },
      });
    });

    it('should throw TRADE_NOT_OWNER when buyer is seller', async () => {
      tradeRepo.findOne.mockResolvedValue(makePendingOrder());

      await expect(service.startNegotiation('p2', 't1', '100')).rejects.toMatchObject({
        response: { code: ErrorCodes.TRADE_NOT_OWNER },
      });
    });
  });

  describe('replyNegotiation', () => {
    it('should increment step and record reply price', async () => {
      negotiationRepo.findOne.mockResolvedValue(pendingNegotiation());

      const result = await service.replyNegotiation('p2', 'n1', '90');

      expect(result.step).toBe(2);
      expect(result.replyPrice).toBe('90');
      expect(result.status).toBe(NegotiationStatus.PENDING);
    });

    it('should lock and throw NEGOTIATION_STEP_LIMIT when step exceeds max', async () => {
      negotiationRepo.findOne.mockResolvedValue(
        pendingNegotiation({ step: 3 }),
      );

      await expect(service.replyNegotiation('p2', 'n1', '90')).rejects.toMatchObject({
        response: { code: ErrorCodes.NEGOTIATION_STEP_LIMIT },
      });
      const saved = negotiationRepo.save.mock.calls[0][0];
      expect(saved.status).toBe(NegotiationStatus.LOCKED);
      expect(saved.step).toBe(4);
    });

    it('should throw NEGOTIATION_NOT_FOUND for wrong seller', async () => {
      negotiationRepo.findOne.mockResolvedValue(pendingNegotiation());

      await expect(service.replyNegotiation('p9', 'n1', '90')).rejects.toMatchObject({
        response: { code: ErrorCodes.NEGOTIATION_NOT_FOUND },
      });
    });
  });

  describe('acceptNegotiation', () => {
    it('should settle at min(ask, reply) with no discount', async () => {
      negotiationRepo.findOne.mockResolvedValue(pendingNegotiation());
      tradeRepo.findOne.mockResolvedValue(makePendingOrder());

      const result = await service.acceptNegotiation('p1', 'n1');

      expect(result.status).toBe(NegotiationStatus.COMPLETED);
      expect(result.discountPercent).toBe(0);
      expect(result.message).toContain('90');
    });

    it('should apply 5% friend discount', async () => {
      negotiationRepo.findOne.mockResolvedValue(pendingNegotiation());
      tradeRepo.findOne.mockResolvedValue(makePendingOrder());
      socialService.getFriendList.mockResolvedValue([
        { playerId: 'p1', friendId: 'p2', status: 'accepted' },
      ] as any);

      const result = await service.acceptNegotiation('p1', 'n1');

      expect(result.discountPercent).toBe(5);
      expect(result.message).toContain('86');
    });

    it('should apply 5% same-guild discount', async () => {
      negotiationRepo.findOne.mockResolvedValue(pendingNegotiation());
      tradeRepo.findOne.mockResolvedValue(makePendingOrder());
      socialService.getMyGuildRole.mockResolvedValue({
        guildId: 'g1',
        role: GuildRole.MEMBER,
      });

      const result = await service.acceptNegotiation('p1', 'n1');

      expect(result.discountPercent).toBe(5);
    });

    it('should stack 8% when friend and FACE >= 80', async () => {
      negotiationRepo.findOne.mockResolvedValue(pendingNegotiation());
      tradeRepo.findOne.mockResolvedValue(makePendingOrder());
      socialService.getFriendList.mockResolvedValue([
        { playerId: 'p1', friendId: 'p2', status: 'accepted' },
      ] as any);
      economyService.getBalance.mockResolvedValue('80');

      const result = await service.acceptNegotiation('p1', 'n1');

      expect(result.discountPercent).toBe(8);
      expect(result.message).toContain('83');
    });

    it('should complete the underlying trade order', async () => {
      negotiationRepo.findOne.mockResolvedValue(pendingNegotiation());
      tradeRepo.findOne.mockResolvedValue(makePendingOrder());

      await service.acceptNegotiation('p1', 'n1');

      const savedOrder = tradeRepo.save.mock.calls[0][0];
      expect(savedOrder.buyerId).toBe('p1');
      expect(savedOrder.status).toBe(TradeStatus.COMPLETED);
      expect(eventBus.emit).toHaveBeenCalled();
    });

    it('should throw NEGOTIATION_NOT_FOUND for wrong buyer', async () => {
      negotiationRepo.findOne.mockResolvedValue(pendingNegotiation());

      await expect(service.acceptNegotiation('p9', 'n1')).rejects.toMatchObject({
        response: { code: ErrorCodes.NEGOTIATION_NOT_FOUND },
      });
    });
  });

  describe('rejectNegotiation', () => {
    it('should mark negotiation expired', async () => {
      negotiationRepo.findOne.mockResolvedValue(pendingNegotiation());

      const result = await service.rejectNegotiation('p1', 'n1');

      expect(result.status).toBe(NegotiationStatus.EXPIRED);
    });

    it('should throw NEGOTIATION_NOT_FOUND for wrong buyer', async () => {
      negotiationRepo.findOne.mockResolvedValue(pendingNegotiation());

      await expect(service.rejectNegotiation('p9', 'n1')).rejects.toMatchObject({
        response: { code: ErrorCodes.NEGOTIATION_NOT_FOUND },
      });
    });
  });
});

