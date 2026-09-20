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
import { GameEvents } from '@event-bus/game-events';
import { EconomyService } from '@modules/economy/economy.service';
import { SocialService } from '@modules/social/social.service';
import { CharacterService } from '@modules/character/character.service';
import { CombatService } from '@modules/combat/combat.service';
import { VipService } from '@modules/vip/vip.service';
import { ErrorCodes } from '@constants/error-codes';
import { BarterStatus } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('TradeService Barter', () => {
  let service: TradeService;
  let barterRepo: jest.Mocked<Repository<BarterDeal>>;
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
      ],
    }).compile();

    service = module.get(TradeService);
    barterRepo = module.get(getRepositoryToken(BarterDeal));
    eventBus = module.get(EventBusService);
  });

  const pendingDeal = (overrides: any = {}): any => ({
    id: 'b1',
    partyAId: 'p1',
    partyBId: null,
    itemsAJson: { iron: 5 },
    itemsBJson: {},
    goldAmount: '100',
    aConfirm: true,
    bConfirm: false,
    status: BarterStatus.PENDING,
    ...overrides,
  });

  describe('createBarter', () => {
    it('should create pending deal with aConfirm true', async () => {
      const result = await service.createBarter('p1', { iron: 5 }, '100');

      expect(result.status).toBe(BarterStatus.PENDING);
      expect(result.aConfirm).toBe(true);
      expect(result.bConfirm).toBe(false);
      expect(result.partyAId).toBe('p1');
    });
  });

  describe('acceptBarter', () => {
    it('should throw BARTER_NOT_FOUND when deal missing', async () => {
      barterRepo.findOne.mockResolvedValue(null);

      await expect(service.acceptBarter('p2', 'b999', { wood: 3 })).rejects.toMatchObject({
        response: { code: ErrorCodes.BARTER_NOT_FOUND },
      });
    });

    it('should throw BARTER_CONFIRM_MISMATCH when partyB is partyA', async () => {
      barterRepo.findOne.mockResolvedValue(pendingDeal());

      await expect(service.acceptBarter('p1', 'b1', { wood: 3 })).rejects.toMatchObject({
        response: { code: ErrorCodes.BARTER_CONFIRM_MISMATCH },
      });
    });

    it('should throw BARTER_CONFIRM_MISMATCH on double confirm', async () => {
      barterRepo.findOne.mockResolvedValue(
        pendingDeal({ partyBId: 'p2', bConfirm: true }),
      );

      await expect(service.acceptBarter('p3', 'b1', { wood: 3 })).rejects.toMatchObject({
        response: { code: ErrorCodes.BARTER_CONFIRM_MISMATCH },
      });
    });

    it('should stay pending when only party B confirms', async () => {
      barterRepo.findOne.mockResolvedValue(pendingDeal({ aConfirm: false }));

      const result = await service.acceptBarter('p2', 'b1', { wood: 3 });

      expect(result.status).toBe(BarterStatus.PENDING);
      expect(result.bConfirm).toBe(true);
      expect(result.partyBId).toBe('p2');
      expect(result.itemsBJson).toEqual({ wood: 3 });
    });

    it('should complete when both parties confirm and emit event', async () => {
      barterRepo.findOne.mockResolvedValue(pendingDeal());

      const result = await service.acceptBarter('p2', 'b1', { wood: 3 });

      expect(result.status).toBe(BarterStatus.COMPLETED);
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.TRADE_COMPLETED,
        expect.objectContaining({ kind: 'barter' }),
      );
    });
  });

  describe('getBarterList', () => {
    it('should query deals where player is either party', async () => {
      barterRepo.find.mockResolvedValue([]);

      await service.getBarterList('p1');

      expect(barterRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [{ partyAId: 'p1' }, { partyBId: 'p1' }],
        }),
      );
    });
  });
});
