import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TradeStatus } from '@constants/enums';
import { RiskWashService } from './risk-wash.service';
import { RiskWashFlow, RiskCase, RiskAccountScore, RiskWhitelist } from './entities';
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
  };
  const scoreRepo = { findOne: jest.fn(), save: jest.fn((s: any) => s) };
  const whitelistRepo = { find: jest.fn().mockResolvedValue([]) };
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
});