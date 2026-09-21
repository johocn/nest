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
import { RiskGateService } from '@modules/risk/risk-gate.service';
import { ConfigManageService } from '@modules/config/config.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { CurrencyType, BountyStatus, CombatResult } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('TradeService Bounty', () => {
  let service: TradeService;
  let bountyRepo: jest.Mocked<Repository<Bounty>>;
  let economyService: jest.Mocked<EconomyService>;
  let socialService: jest.Mocked<SocialService>;
  let combatService: jest.Mocked<CombatService>;
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
    bountyRepo = module.get(getRepositoryToken(Bounty));
    economyService = module.get(EconomyService);
    socialService = module.get(SocialService);
    combatService = module.get(CombatService);
    eventBus = module.get(EventBusService);
  });

  const activeBounty = (overrides: any = {}): any => ({
    id: 'b1',
    publisherId: 'p1',
    type: 'kill',
    targetJson: { targetId: 'target1' },
    goldReward: '1000',
    deadline: null,
    maxAcceptors: 1,
    acceptorId: null,
    status: BountyStatus.ACTIVE,
    ...overrides,
  });

  describe('createBounty', () => {
    it('should hold gold reward and create active bounty', async () => {
      const result = await service.createBounty(
        'p1',
        'intel',
        { grade: 'B' },
        '1000',
        '2026-12-31T00:00:00.000Z',
        2,
      );

      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.GOLD,
        1000,
        'bounty_hold',
        expect.any(String),
      );
      expect(result.status).toBe(BountyStatus.ACTIVE);
      expect(result.type).toBe('intel');
      expect(result.maxAcceptors).toBe(2);
      expect(result.deadline).toBeInstanceOf(Date);
    });

    it('should create bounty without deadline', async () => {
      const result = await service.createBounty('p1', 'collect', {}, '1000');

      expect(result.deadline).toBeNull();
    });
  });

  describe('acceptBounty', () => {
    it('should throw BOUNTY_FULL when already accepted', async () => {
      bountyRepo.findOne.mockResolvedValue(
        activeBounty({ acceptorId: 'p3', status: BountyStatus.ACCEPTED }),
      );

      await expect(service.acceptBounty('p2', 'b1')).rejects.toMatchObject({
        response: { code: ErrorCodes.BOUNTY_FULL },
      });
    });

    it('should throw BOUNTY_FULL when publisher accepts own bounty', async () => {
      bountyRepo.findOne.mockResolvedValue(activeBounty());

      await expect(service.acceptBounty('p1', 'b1')).rejects.toMatchObject({
        response: { code: ErrorCodes.BOUNTY_FULL },
      });
    });

    it('should mark accepted and record acceptor', async () => {
      bountyRepo.findOne.mockResolvedValue(activeBounty());

      const result = await service.acceptBounty('p2', 'b1');

      expect(result.status).toBe(BountyStatus.ACCEPTED);
      expect(result.acceptorId).toBe('p2');
    });
  });

  describe('completeBounty', () => {
    it('should reward acceptor when kill log matches target', async () => {
      bountyRepo.findOne.mockResolvedValue(
        activeBounty({ acceptorId: 'p2', status: BountyStatus.ACCEPTED }),
      );
      combatService.getCombatLogs.mockResolvedValue({
        items: [
          { attackerId: 'p2', defenderId: 'target1', result: CombatResult.WIN },
        ] as any,
        total: 1,
      });

      const result = await service.completeBounty('p2', 'b1');

      expect(result.status).toBe(BountyStatus.COMPLETED);
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p2',
        CurrencyType.GOLD,
        1000,
        'bounty_reward',
        expect.any(String),
        'b1',
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.TRADE_COMPLETED,
        expect.objectContaining({ kind: 'bounty' }),
      );
    });

    it('should reject when kill log does not match', async () => {
      bountyRepo.findOne.mockResolvedValue(
        activeBounty({ acceptorId: 'p2', status: BountyStatus.ACCEPTED }),
      );
      combatService.getCombatLogs.mockResolvedValue({
        items: [
          { attackerId: 'p2', defenderId: 'other', result: CombatResult.WIN },
        ] as any,
        total: 1,
      });

      await expect(service.completeBounty('p2', 'b1')).rejects.toMatchObject({
        response: { code: ErrorCodes.BOUNTY_NOT_FOUND },
      });
    });

    it('should reward when intel grade matches', async () => {
      bountyRepo.findOne.mockResolvedValue(
        activeBounty({
          type: 'intel',
          targetJson: { grade: 'B' },
          acceptorId: 'p2',
          status: BountyStatus.ACCEPTED,
        }),
      );
      socialService.getIntelligences.mockResolvedValue([
        { grade: 'B', title: '机密', content: '详情' },
      ] as any);

      const result = await service.completeBounty('p2', 'b1');

      expect(result.status).toBe(BountyStatus.COMPLETED);
    });

    it('should reward when intel keyword appears in title or content', async () => {
      bountyRepo.findOne.mockResolvedValue(
        activeBounty({
          type: 'intel',
          targetJson: { keyword: '机密' },
          acceptorId: 'p2',
          status: BountyStatus.ACCEPTED,
        }),
      );
      socialService.getIntelligences.mockResolvedValue([
        { grade: 'D', title: '传闻', content: '关于机密的线索' },
      ] as any);

      const result = await service.completeBounty('p2', 'b1');

      expect(result.status).toBe(BountyStatus.COMPLETED);
    });

    it('should pass collect type directly', async () => {
      bountyRepo.findOne.mockResolvedValue(
        activeBounty({
          type: 'collect',
          targetJson: {},
          acceptorId: 'p2',
          status: BountyStatus.ACCEPTED,
        }),
      );

      const result = await service.completeBounty('p2', 'b1');

      expect(result.status).toBe(BountyStatus.COMPLETED);
    });

    it('should fail with BOUNTY_DEADLINE when deadline passed', async () => {
      bountyRepo.findOne.mockResolvedValue(
        activeBounty({
          acceptorId: 'p2',
          status: BountyStatus.ACCEPTED,
          deadline: new Date(Date.now() - 3600000),
        }),
      );

      await expect(service.completeBounty('p2', 'b1')).rejects.toMatchObject({
        response: { code: ErrorCodes.BOUNTY_DEADLINE },
      });
      const saved = bountyRepo.save.mock.calls[0][0];
      expect(saved.status).toBe(BountyStatus.FAILED);
    });

    it('should throw BOUNTY_NOT_FOUND when acceptor mismatches', async () => {
      bountyRepo.findOne.mockResolvedValue(
        activeBounty({ acceptorId: 'p3', status: BountyStatus.ACCEPTED }),
      );

      await expect(service.completeBounty('p2', 'b1')).rejects.toMatchObject({
        response: { code: ErrorCodes.BOUNTY_NOT_FOUND },
      });
    });
  });

  describe('cancelBounty', () => {
    it('should refund held gold and cancel', async () => {
      bountyRepo.findOne.mockResolvedValue(
        activeBounty({ status: BountyStatus.ACCEPTED, acceptorId: 'p2' }),
      );

      const result = await service.cancelBounty('p1', 'b1');

      expect(result.status).toBe(BountyStatus.CANCELLED);
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.GOLD,
        1000,
        'bounty_refund',
        expect.any(String),
        'b1',
      );
    });

    it('should throw BOUNTY_NOT_FOUND for non-publisher', async () => {
      bountyRepo.findOne.mockResolvedValue(activeBounty());

      await expect(service.cancelBounty('p9', 'b1')).rejects.toMatchObject({
        response: { code: ErrorCodes.BOUNTY_NOT_FOUND },
      });
    });
  });

  describe('getBountyBoard', () => {
    it('should return paginated active and accepted bounties', async () => {
      bountyRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getBountyBoard(1, 20);

      expect(result.total).toBe(0);
      expect(bountyRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [{ status: BountyStatus.ACTIVE }, { status: BountyStatus.ACCEPTED }],
        }),
      );
    });
  });
});
