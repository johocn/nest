import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReconcileService } from './reconcile.service';
import { ReconcileResult } from './entities/reconcile-result.entity';
import { ReconcileType, AuctionStatus, TradeStatus as TradeSt } from '@constants/enums';
import { Transaction } from '@modules/economy/entities/transaction.entity';
import { TradeOrder } from '@modules/trade/entities/trade-order.entity';
import { AuctionItem } from '@modules/trade/entities/auction-item.entity';
import { EscrowAgreement } from '@modules/trade/entities/escrow-agreement.entity';
import { Bounty } from '@modules/trade/entities/bounty.entity';

describe('ReconcileService', () => {
  let service: ReconcileService;
  const resultRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((r: any) => ({ ...r })),
    save: jest.fn((r: any) => Promise.resolve({ ...r, id: r.id ?? '9' })),
  };
  const tradeRepo = { find: jest.fn().mockResolvedValue([]) };
  const auctionRepo = { find: jest.fn().mockResolvedValue([]) };
  const escrowRepo = { find: jest.fn().mockResolvedValue([]) };
  const bountyRepo = { find: jest.fn().mockResolvedValue([]) };
  const txRepo = { find: jest.fn().mockResolvedValue([]) };

  beforeEach(async () => {
    jest.clearAllMocks();
    tradeRepo.find.mockResolvedValue([]);
    auctionRepo.find.mockResolvedValue([]);
    escrowRepo.find.mockResolvedValue([]);
    bountyRepo.find.mockResolvedValue([]);
    txRepo.find.mockResolvedValue([]);
    resultRepo.findOne.mockResolvedValue(null);
    resultRepo.create.mockImplementation((r: any) => ({ ...r }));
    resultRepo.save.mockImplementation((r: any) => Promise.resolve({ ...r, id: r.id ?? '9' }));

    const mod = await Test.createTestingModule({
      providers: [
        ReconcileService,
        { provide: getRepositoryToken(ReconcileResult), useValue: resultRepo },
        { provide: getRepositoryToken(Transaction), useValue: txRepo },
        { provide: getRepositoryToken(TradeOrder), useValue: tradeRepo },
        { provide: getRepositoryToken(AuctionItem), useValue: auctionRepo },
        { provide: getRepositoryToken(EscrowAgreement), useValue: escrowRepo },
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
      ],
    }).compile();
    service = mod.get(ReconcileService);
  });

  it('TRADE 结算缺流水被检出 MISSING_FLOW', async () => {
    tradeRepo.find.mockResolvedValue([
      { id: '1', sellerId: 's1', buyerId: 'b1', quantity: 2, pricePerUnit: '100', currencyType: 'gold', status: TradeSt.COMPLETED },
    ]);
    txRepo.find.mockResolvedValue([]); // 无 escrow_deal 流水

    const results = await service.reconcileDaily('2026-09-19');
    const trade = results.find((r) => r.reconcileType === ReconcileType.TRADE)!;
    expect(trade.checked).toBe('1');
    expect(trade.mismatch).toBe('1');
    expect(trade.detailJson.some((d) => d.type === 'MISSING_FLOW')).toBe(true);
  });

  it('ESCROW 结算流水金额不一致被检出 AMOUNT_MISMATCH', async () => {
    escrowRepo.find.mockResolvedValue([
      {
        id: '2',
        sellerId: 's2',
        guarantorId: 'g2',
        amount: '100',
        feePercent: 2,
        releasedAt: new Date('2026-09-19T10:00:00Z'),
      },
    ]);
    txRepo.find.mockResolvedValue([
      { playerId: 's2', txType: 'earn', currencyType: 'gold', amount: '50', source: 'escrow_release', relatedId: '2' },
    ]);

    const results = await service.reconcileDaily('2026-09-19');
    const escrow = results.find((r) => r.reconcileType === ReconcileType.ESCROW)!;
    expect(escrow.mismatch).toBe('1');
    expect(escrow.detailJson.some((d) => d.type === 'AMOUNT_MISMATCH')).toBe(true);
  });

  it('AUCTION 结算同 refId 重复放款被检出 DUPLICATE_REF', async () => {
    auctionRepo.find.mockResolvedValue([
      { id: '3', sellerId: 's3', currentPrice: '200', status: AuctionStatus.SOLD },
    ]);
    txRepo.find.mockResolvedValue([
      { playerId: 's3', txType: 'earn', currencyType: 'gold', amount: '200', source: 'auction', relatedId: '3' },
      { playerId: 's3', txType: 'earn', currencyType: 'gold', amount: '200', source: 'auction', relatedId: '3' },
    ]);

    const results = await service.reconcileDaily('2026-09-19');
    const auction = results.find((r) => r.reconcileType === ReconcileType.AUCTION)!;
    expect(auction.mismatch).toBe('1');
    expect(auction.detailJson.some((d) => d.type === 'DUPLICATE_REF')).toBe(true);
  });

  it('BOUNTY 结算正常时 matched 且不新增异常', async () => {
    bountyRepo.find.mockResolvedValue([
      { id: '4', publisherId: 'p4', acceptorId: 'a4', goldReward: '300' },
    ]);
    txRepo.find.mockResolvedValue([
      { playerId: 'a4', txType: 'earn', currencyType: 'gold', amount: '300', source: 'bounty_reward', relatedId: '4' },
    ]);

    const results = await service.reconcileDaily('2026-09-19');
    const bounty = results.find((r) => r.reconcileType === ReconcileType.BOUNTY)!;
    expect(bounty.checked).toBe('1');
    expect(bounty.mismatch).toBe('0');
    expect(bounty.detailJson).toHaveLength(0);
  });

  it('按 stat_date+reconcile_type 幂等覆盖已存在结果', async () => {
    tradeRepo.find.mockResolvedValue([
      { id: '1', sellerId: 's1', buyerId: 'b1', quantity: 2, pricePerUnit: '100', currencyType: 'gold', status: TradeSt.COMPLETED },
    ]);
    txRepo.find.mockResolvedValue([]);
    resultRepo.findOne.mockImplementation((opts: any) =>
      Promise.resolve(opts.where.reconcileType === ReconcileType.TRADE
        ? { id: 'old', statDate: '2026-09-19', reconcileType: ReconcileType.TRADE, checked: '0', mismatch: '0', detailJson: [] }
        : null),
    );

    const results = await service.reconcileDaily('2026-09-19');
    const trade = results.find((r) => r.reconcileType === ReconcileType.TRADE)!;
    expect(trade.id).toBe('old'); // 复用既有行
    expect(trade.checked).toBe('1');
    expect(trade.mismatch).toBe('1');
  });
});