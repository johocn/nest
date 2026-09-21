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
import { ConfigManageService } from '@modules/config/config.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { CurrencyType, CreditStatus } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('TradeService Credit', () => {
  let service: TradeService;
  let creditRepo: jest.Mocked<Repository<CreditDebt>>;
  let economyService: jest.Mocked<EconomyService>;
  let socialService: jest.Mocked<SocialService>;
  let characterService: jest.Mocked<CharacterService>;

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
        {
          provide: InventoryService,
          useValue: {
            removeUnboundItem: jest.fn(),
            addItem: jest.fn(),
          },
        },
        {
          provide: ConfigManageService,
          useValue: {
            getConfig: jest.fn().mockRejectedValue(
              new GameException(ErrorCodes.CONFIG_NOT_FOUND, '配置项不存在'),
            ),
          },
        },
      ],
    }).compile();

    service = module.get(TradeService);
    creditRepo = module.get(getRepositoryToken(CreditDebt));
    economyService = module.get(EconomyService);
    socialService = module.get(SocialService);
    characterService = module.get(CharacterService);
  });

  describe('createCredit', () => {
    it('should throw CREDIT_OVERDUE when borrower FAVOR < 100', async () => {
      economyService.getBalance.mockResolvedValue('99');

      await expect(service.createCredit('p1', 'p2', '500', 7)).rejects.toMatchObject({
        response: { code: ErrorCodes.CREDIT_OVERDUE },
      });
    });

    it('should throw CREDIT_NOT_FOUND when lender is not a friend', async () => {
      economyService.getBalance.mockResolvedValue('100');

      await expect(service.createCredit('p1', 'p2', '500', 7)).rejects.toMatchObject({
        response: { code: ErrorCodes.CREDIT_NOT_FOUND },
      });
    });

    it('should loan gold to borrower and create active debt', async () => {
      economyService.getBalance.mockResolvedValue('100');
      socialService.getFriendList.mockResolvedValue([
        { playerId: 'p1', friendId: 'p2', status: 'accepted' },
      ] as any);

      const result = await service.createCredit('p1', 'p2', '500', 7);

      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.GOLD,
        500,
        'credit_loan',
        expect.any(String),
      );
      expect(result.status).toBe(CreditStatus.ACTIVE);
      expect(result.collateralAmount).toBe('100');
      expect(result.lenderId).toBe('p2');
      const dueGap =
        new Date(result.dueAt).getTime() - Date.now();
      expect(dueGap).toBeGreaterThan(6 * 24 * 3600 * 1000);
      expect(dueGap).toBeLessThanOrEqual(7 * 24 * 3600 * 1000);
    });
  });

  describe('repayCredit', () => {
    it('should deduct principal, settle and boost favorability both ways', async () => {
      creditRepo.findOne.mockResolvedValue({
        id: 'c1',
        borrowerId: 'p1',
        lenderId: 'p2',
        amount: '500',
        status: CreditStatus.ACTIVE,
      } as any);

      const result = await service.repayCredit('p1', 'c1');

      expect(result.status).toBe(CreditStatus.SETTLED);
      expect(result.settledAt).toBeInstanceOf(Date);
      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.GOLD,
        500,
        'credit_repay',
        expect.any(String),
        'c1',
      );
      expect(characterService.increaseFavorability).toHaveBeenCalledWith('p1', 'p2', 5);
      expect(characterService.increaseFavorability).toHaveBeenCalledWith('p2', 'p1', 5);
    });

    it('should throw CREDIT_NOT_FOUND for wrong borrower', async () => {
      creditRepo.findOne.mockResolvedValue({
        id: 'c1',
        borrowerId: 'p1',
        amount: '500',
        status: CreditStatus.ACTIVE,
      } as any);

      await expect(service.repayCredit('p9', 'c1')).rejects.toMatchObject({
        response: { code: ErrorCodes.CREDIT_NOT_FOUND },
      });
    });
  });

  describe('settleOverdueCredits', () => {
    it('should default overdue debts and deduct min(balance, collateral) FAVOR', async () => {
      creditRepo.find.mockResolvedValue([
        {
          id: 'c1',
          borrowerId: 'p1',
          lenderId: 'p2',
          amount: '500',
          dueAt: new Date(Date.now() - 3600000),
          collateralAmount: '100',
          status: CreditStatus.ACTIVE,
        },
        {
          id: 'c2',
          borrowerId: 'p2',
          lenderId: 'p1',
          amount: '300',
          dueAt: new Date(Date.now() + 3600000),
          collateralAmount: '100',
          status: CreditStatus.ACTIVE,
        },
      ] as any);
      economyService.getBalance.mockResolvedValue('30');

      const handled = await service.settleOverdueCredits();

      expect(handled).toBe(1);
      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.FAVOR,
        30,
        'credit_default',
        expect.any(String),
        'c1',
      );
      const saved = creditRepo.save.mock.calls[0][0];
      expect(saved.id).toBe('c1');
      expect(saved.status).toBe(CreditStatus.DEFAULTED);
    });
  });

  describe('getCreditList', () => {
    it('should query debts where player is borrower or lender', async () => {
      creditRepo.find.mockResolvedValue([]);

      await service.getCreditList('p1');

      expect(creditRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [{ borrowerId: 'p1' }, { lenderId: 'p1' }],
        }),
      );
    });
  });
});
