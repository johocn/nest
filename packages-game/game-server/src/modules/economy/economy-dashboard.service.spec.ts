import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EconomyDashboardService } from './economy-dashboard.service';
import { Transaction } from './entities/transaction.entity';
import { PlayerCurrency } from '@modules/player/entities/player-currency.entity';
import { AuthAccount } from '@modules/auth/entities/auth-account.entity';
import { RiskRecoverRecord } from '@modules/risk/entities/risk-recover-record.entity';

/** 只读聚合：mock 各 repo 的 query builder 返回聚合行，断言统计结构 */
describe('EconomyDashboardService', () => {
  let service: EconomyDashboardService;

  /** 可链式调用的 query builder 桩：按调用顺序返回对应聚合行 */
  const qbStub = (raw: Record<string, any>) => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(raw),
  });

  const mockTxRepo = { createQueryBuilder: jest.fn() };
  const mockBalanceRepo = { createQueryBuilder: jest.fn() };
  const mockAccountRepo = { createQueryBuilder: jest.fn() };
  const mockRecoverRepo = { createQueryBuilder: jest.fn() };
  const notCalled = jest.fn().mockReturnThis();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        EconomyDashboardService,
        { provide: getRepositoryToken(Transaction), useValue: mockTxRepo },
        { provide: getRepositoryToken(PlayerCurrency), useValue: mockBalanceRepo },
        { provide: getRepositoryToken(AuthAccount), useValue: mockAccountRepo },
        { provide: getRepositoryToken(RiskRecoverRecord), useValue: mockRecoverRepo },
      ],
    }).compile();
    service = mod.get(EconomyDashboardService);
  });

  beforeEach(() => jest.clearAllMocks());

  it('should assemble full dashboard structure from aggregation rows', async () => {
    // 调用顺序：金总量(balance#1) → 近7日in/out(tx#1) → 分布(balance#2) → 冻结(balance#3) → 回收(recover#1)
    mockBalanceRepo.createQueryBuilder
      .mockReturnValueOnce(
        qbStub({ total: '1000000' }),
      )
      .mockReturnValueOnce(
        qbStub({ activeCount: 5, p50: '100', p90: '9000', max: '90000' }),
      )
      .mockReturnValueOnce(
        qbStub({ frozen: '777000' }),
      );
    mockTxRepo.createQueryBuilder.mockReturnValueOnce(
      qbStub({ inflow: '5000', outflow: '3000' }),
    );
    mockRecoverRepo.createQueryBuilder.mockReturnValueOnce(
      qbStub({ applied: '999000' }),
    );

    const res = await service.dashboard();

    expect(res).toEqual({
      currencyStats: { totalGold: '1000000', inflow7d: '5000', outflow7d: '3000', netChange7d: '2000' },
      assetDistribution: { p50: '100', p90: '9000', max: '90000', activeCount: 5 },
      frozenAmount: '777000',
      recoveryToDate: '999000',
    });
    // 所有聚合均为只读聚合：不应出现写操作
    expect(mockTxRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(mockBalanceRepo.createQueryBuilder).toHaveBeenCalledTimes(3);
    expect(mockAccountRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('should fall back to zero when aggregation returns no rows', async () => {
    mockBalanceRepo.createQueryBuilder
      .mockReturnValueOnce(qbStub({ total: null }))
      .mockReturnValueOnce(qbStub({ activeCount: 0, p50: null, p90: null, max: null }))
      .mockReturnValueOnce(qbStub({ frozen: null }));
    mockTxRepo.createQueryBuilder.mockReturnValueOnce(qbStub({ inflow: null, outflow: null }));
    mockRecoverRepo.createQueryBuilder.mockReturnValueOnce(qbStub({ applied: null }));

    const res = await service.dashboard();
    expect(res.currencyStats.totalGold).toBe('0');
    expect(res.currencyStats.netChange7d).toBe('0');
    expect(res.assetDistribution.activeCount).toBe(0);
    expect(res.assetDistribution.p90).toBe('0');
    expect(res.frozenAmount).toBe('0');
    expect(res.recoveryToDate).toBe('0');
  });
});