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
import { ErrorCodes } from '@constants/error-codes';
import {
  TradeStatus,
  EscrowStatus,
  CurrencyType,
  GuildRole,
} from '@constants/enums';
import type { Repository } from 'typeorm';

describe('TradeService Escrow', () => {
  let service: TradeService;
  let tradeRepo: jest.Mocked<Repository<TradeOrder>>;
  let escrowRepo: jest.Mocked<Repository<EscrowAgreement>>;
  let economyService: jest.Mocked<EconomyService>;
  let socialService: jest.Mocked<SocialService>;

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
    tradeRepo = module.get(getRepositoryToken(TradeOrder));
    escrowRepo = module.get(getRepositoryToken(EscrowAgreement));
    economyService = module.get(EconomyService);
    socialService = module.get(SocialService);
  });

  const makeTradeOrder = (): any => ({
    id: 't1',
    sellerId: 'p2',
    buyerId: null,
    pricePerUnit: '5000',
    quantity: 2,
    status: TradeStatus.PENDING,
  });

  const makePendingEscrow = (overrides: any = {}): any => ({
    id: 'e1',
    buyerId: 'p1',
    sellerId: 'p2',
    guarantorId: 'g1',
    tradeOrderId: 't1',
    amount: '10000',
    feePercent: 2,
    status: EscrowStatus.PENDING,
    releasedAt: null,
    ...overrides,
  });

  describe('createEscrow', () => {
    it('should throw GUARANTOR_NOT_QUALIFIED when no condition met', async () => {
      tradeRepo.findOne.mockResolvedValue(makeTradeOrder());

      await expect(
        service.createEscrow('p1', 'p2', 't1', 'g1'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.GUARANTOR_NOT_QUALIFIED },
      });
    });

    it('should pass when guarantor is guild leader', async () => {
      tradeRepo.findOne.mockResolvedValue(makeTradeOrder());
      socialService.getMyGuildRole.mockResolvedValue({
        guildId: 'g1',
        role: GuildRole.LEADER,
      });

      await expect(service.createEscrow('p1', 'p2', 't1', 'g1')).resolves.toMatchObject({
        status: EscrowStatus.PENDING,
      });
    });

    it('should pass when guarantor shares kinship with a party', async () => {
      tradeRepo.findOne.mockResolvedValue(makeTradeOrder());
      socialService.getKinships.mockResolvedValue([
        { members: ['g1', 'p2'] },
      ] as any);

      await expect(service.createEscrow('p1', 'p2', 't1', 'g1')).resolves.toMatchObject({
        status: EscrowStatus.PENDING,
      });
    });

    it('should pass when guarantor FACE >= 60', async () => {
      tradeRepo.findOne.mockResolvedValue(makeTradeOrder());
      economyService.getBalance.mockResolvedValue('60');

      await expect(service.createEscrow('p1', 'p2', 't1', 'g1')).resolves.toMatchObject({
        status: EscrowStatus.PENDING,
      });
    });

    it('should hold amount = pricePerUnit * quantity from buyer', async () => {
      tradeRepo.findOne.mockResolvedValue(makeTradeOrder());
      economyService.getBalance.mockResolvedValue('60');

      await service.createEscrow('p1', 'p2', 't1', 'g1');

      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.GOLD,
        10000,
        'escrow_hold',
        expect.any(String),
        't1',
      );
      const saved = escrowRepo.save.mock.calls[0][0];
      expect(saved.amount).toBe('10000');
      expect(saved.guarantorId).toBe('g1');
    });
  });

  describe('inspectGoods', () => {
    it('should throw ESCROW_NOT_FOUND when missing', async () => {
      escrowRepo.findOne.mockResolvedValue(null);

      await expect(service.inspectGoods('g1', 'e999')).rejects.toMatchObject({
        response: { code: ErrorCodes.ESCROW_NOT_FOUND },
      });
    });

    it('should throw ESCROW_NOT_READY when not pending', async () => {
      escrowRepo.findOne.mockResolvedValue(makePendingEscrow({
        status: EscrowStatus.RELEASED,
      }));

      await expect(service.inspectGoods('g1', 'e1')).rejects.toMatchObject({
        response: { code: ErrorCodes.ESCROW_NOT_READY },
      });
    });

    it('should release amount minus 2% fee to seller and fee to guarantor', async () => {
      escrowRepo.findOne.mockResolvedValue(makePendingEscrow());

      const result = await service.inspectGoods('g1', 'e1');

      expect(result.status).toBe(EscrowStatus.RELEASED);
      expect(result.releasedAt).toBeInstanceOf(Date);
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p2',
        CurrencyType.GOLD,
        9800,
        'escrow_release',
        expect.any(String),
        'e1',
      );
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'g1',
        CurrencyType.GOLD,
        200,
        'escrow_fee',
        expect.any(String),
        'e1',
      );
    });
  });

  describe('penalizeEscrow', () => {
    it('should penalize guarantor double and compensate buyer', async () => {
      escrowRepo.findOne.mockResolvedValue(makePendingEscrow());

      const result = await service.penalizeEscrow('e1');

      expect(result.status).toBe(EscrowStatus.PENALIZED);
      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        'g1',
        CurrencyType.GOLD,
        20000,
        'escrow_penalty',
        expect.any(String),
        'e1',
      );
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.GOLD,
        20000,
        'escrow_penalty',
        expect.any(String),
        'e1',
      );
    });

    it('should throw ESCROW_NOT_READY when already released', async () => {
      escrowRepo.findOne.mockResolvedValue(makePendingEscrow({
        status: EscrowStatus.RELEASED,
      }));

      await expect(service.penalizeEscrow('e1')).rejects.toMatchObject({
        response: { code: ErrorCodes.ESCROW_NOT_READY },
      });
    });
  });

  describe('getEscrow', () => {
    it('should return escrow when exists', async () => {
      escrowRepo.findOne.mockResolvedValue(makePendingEscrow());

      const result = await service.getEscrow('e1');

      expect(result.id).toBe('e1');
    });

    it('should throw ESCROW_NOT_FOUND when missing', async () => {
      escrowRepo.findOne.mockResolvedValue(null);

      await expect(service.getEscrow('e999')).rejects.toMatchObject({
        response: { code: ErrorCodes.ESCROW_NOT_FOUND },
      });
    });
  });
});

