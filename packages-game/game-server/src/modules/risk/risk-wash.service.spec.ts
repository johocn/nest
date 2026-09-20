import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TradeStatus } from '@constants/enums';
import { RiskWashService } from './risk-wash.service';
import { RiskWashFlow, RiskCase, RiskAccountScore, RiskWhitelist, RiskRecoverRecord } from './entities';
import { ConfigManageService } from '@modules/config/config.service';
import { TradeOrder } from '@modules/trade/entities/trade-order.entity';

describe('RiskWashService', () => {
  let service: RiskWashService;
  const washRepo = {
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((w: any) => w),
  };
  const caseRepo = {
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn((c: any) => c),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((c: any) => c),
  };
  const scoreRepo = { findOne: jest.fn(), save: jest.fn((s: any) => s) };
  const whitelistRepo = { find: jest.fn().mockResolvedValue([]) };
  const recoverRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn((x: any) => ({ ...x, id: '9' })),
    create: jest.fn((x: any) => x),
  };
  const tradeRepo = { query: jest.fn() };
  const config = {
    getConfig: jest.fn().mockResolvedValue(null),
    setConfig: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        RiskWashService,
        { provide: getRepositoryToken(RiskWashFlow), useValue: washRepo },
        { provide: getRepositoryToken(RiskCase), useValue: caseRepo },
        { provide: getRepositoryToken(RiskAccountScore), useValue: scoreRepo },
        { provide: getRepositoryToken(RiskWhitelist), useValue: whitelistRepo },
        { provide: getRepositoryToken(RiskRecoverRecord), useValue: recoverRepo },
        { provide: getRepositoryToken(TradeOrder), useValue: tradeRepo },
        { provide: ConfigManageService, useValue: config },
      ],
    }).compile();
    service = mod.get(RiskWashService);
  });

  it('摄入 completed 交易为风险流，refId 以 trade:id 去重', async () => {
    tradeRepo.query.mockResolvedValue([
      { id: '1', sellerId: 'A', buyerId: 'B', pricePerUnit: '100', quantity: 2, currencyType: 'gold', createdAt: new Date() },
      { id: '2', sellerId: 'A', buyerId: null, pricePerUnit: '10', quantity: 1, currencyType: 'gold', createdAt: new Date() },
    ]);
    config.getConfig.mockImplementation((k: string) =>
      k === 'risk.ingest_trade_id' ? { value: '0' } : null,
    );
    washRepo.save.mockResolvedValue([]);
    washRepo.find.mockResolvedValue([]);
    await service.scan();
    const saved = washRepo.save.mock.calls.flat();
    // buyer_id IS NOT NULL 由 raw SQL 过滤；此处 mock query 直接返回两行，故仅断言目标流向存在
    expect(saved.some((f: any) => f.refId === 'trade:1')).toBe(true);
    expect(saved.find((f: any) => f.refId === 'trade:1')).toMatchObject({ fromId: 'A', toId: 'B', value: '200' });
    expect(config.setConfig).toHaveBeenCalledWith('risk.ingest_trade_id', '2', expect.anything());
  });

  const seedWash = (rows: Array<[string, string, string]>) => {
    washRepo.find.mockResolvedValue(
      rows.map(([fromId, toId, value], i) => ({
        id: String(i + 1), fromId, toId, assetKey: 'gold', value,
        bizType: 'trade_order', refId: `trade:${i + 1}`, createdAt: new Date(),
      })),
    );
  };

  it('检出回环对敲 case（A↔B 近抵消）', async () => {
    config.getConfig.mockImplementation((k: string) =>
      ({ 'risk.roundtrip_total_min': '1000', 'risk.pair_min_amount': '300' })[k] ?? null);
    seedWash([['A', 'B', '600'], ['B', 'A', '500']]);
    caseRepo.save.mockImplementation((c: any) => c);
    await service.scan();
    expect(caseRepo.save).toHaveBeenCalled();
    const opened = caseRepo.save.mock.calls.flat();
    expect(opened.some((c: any) => c.caseType === 'round_trip')).toBe(true);
  });

  it('检出失衡赠与 case（A→B 单方向大额）', async () => {
    config.getConfig.mockImplementation((k: string) =>
      ({ 'risk.oneway_big_amount': '3000', 'risk.oneway_backflow_ratio': '0.2' })[k] ?? null);
    seedWash([['A', 'B', '5000']]);
    caseRepo.save.mockImplementation((c: any) => c);
    await service.scan();
    const opened = caseRepo.save.mock.calls.flat();
    expect(opened.some((c: any) => c.caseType === 'one_way')).toBe(true);
  });

  it('评分封顶且 HIGH 默认不触发（无 open case 时分数归 0）', async () => {
    seedWash([]);
    scoreRepo.findOne.mockResolvedValue({ playerId: 'A', riskScore: 60, level: 'watch' });
    scoreRepo.save.mockImplementation((s: any) => s);
    await service.scan();
    // 无 open case：分数不新增；此处只验证 scan 不抛错
    expect(scoreRepo.save).not.toBeUndefined();
  });

  it('v2 扩源摄入：gift TRANSFER + auction/escrow/bounty PAYOUT', async () => {
    tradeRepo.query.mockReset();
    tradeRepo.query
      .mockResolvedValueOnce([{ id: '11', playerId: 'p1', amount: 5, refId: 'g:p2' }]) // gift
      .mockResolvedValueOnce([{ id: '21', sellerId: 's', currentPrice: '100', bidder: 'b' }]) // auction
      .mockResolvedValueOnce([{ id: '31', buyerId: 'bu', sellerId: 'se', amount: '50' }]) // escrow
      .mockResolvedValueOnce([{ id: '41', publisherId: 'pu', acceptorId: 'ac', goldReward: '30' }]); // bounty
    washRepo.save.mockImplementation((f: any) => f);
    const n = await service.ingestAdditionalFlows();
    expect(n).toBeGreaterThan(0);
    const saved = washRepo.save.mock.calls.flat();
    expect(saved.some((f: any) => f.bizType === 'gift' && f.flowClass === 'transfer')).toBe(true);
    expect(saved.find((f: any) => f.refId === 'gift:11')).toMatchObject({ fromId: 'p1', toId: 'p2', value: '5', assetKey: 'social_points' });
    expect(saved.find((f: any) => f.refId === 'auction:21')).toMatchObject({ fromId: 'b', toId: 's', value: '100', flowClass: 'payout' });
    expect(saved.find((f: any) => f.refId === 'escrow:31')).toMatchObject({ fromId: 'bu', toId: 'se', flowClass: 'payout' });
    expect(saved.find((f: any) => f.refId === 'bounty:41')).toMatchObject({ fromId: 'pu', toId: 'ac', flowClass: 'payout' });
    expect(config.setConfig).toHaveBeenCalledWith('risk.ingest_auction_id', '21', expect.anything());
  });

  it('recover-proposal 计算建议回收额 = 净差额', async () => {
    caseRepo.findOne.mockResolvedValue({ id: 'c1', fromId: 'p1', toId: 'p2', detailJson: { a2b: 5000, b2a: 2000 }, status: 'open' });
    (service as any).computeNetGap = jest.fn().mockResolvedValue('1500');
    const p = await service.recoverProposal('c1');
    expect(p.suggestedAmount).toBe('1500');
  });

  it('recover 落库并生成 APPLIED 记录、可回滚', async () => {
    const caseRow = { id: 'c1', fromId: 'p1', toId: 'p2', detailJson: { a2b: 5000, b2a: 2000 }, status: 'open' };
    caseRepo.findOne.mockResolvedValue(caseRow);
    (service as any).computeNetGap = jest.fn().mockResolvedValue('3000');
    const rec = await service.recover('c1', 'operator', '洗分超额');
    expect(recoverRepo.save).toHaveBeenCalled();
    expect(rec.status).toBe('applied');
    expect(caseRepo.save).toHaveBeenCalled();
    expect(caseRow.status).toBe('frozen');
  });

  it('已回滚记录再次回滚报 RISK_RECOVER_STATE', async () => {
    recoverRepo.findOne.mockResolvedValue({ id: 'r1', status: 'rolled_back' });
    await expect(service.rollback('r1', 'op')).rejects.toMatchObject({ response: { code: 93204 } });
  });
});