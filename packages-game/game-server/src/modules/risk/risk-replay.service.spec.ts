import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RiskReplayService, RiskReplayOptions } from './risk-replay.service';
import { RiskWashFlow } from './entities';

describe('RiskReplayService 只读回放', () => {
  let service: RiskReplayService;
  const washRepo = {
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((w: any) => w),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        RiskReplayService,
        { provide: getRepositoryToken(RiskWashFlow), useValue: washRepo },
      ],
    }).compile();
    service = mod.get(RiskReplayService);
  });

  it('按 override 阈值跑回放，命中对敲账号并给出分数档位，只读不落库', async () => {
    washRepo.find.mockResolvedValue([
      { id: '1', fromId: 'A', toId: 'B', assetKey: 'gold', value: '600', flowClass: 'transfer', bizType: 'trade_order', refId: 't1', createdAt: new Date('2026-01-01T01:00:00Z') },
      { id: '2', fromId: 'B', toId: 'A', assetKey: 'gold', value: '500', flowClass: 'transfer', bizType: 'trade_order', refId: 't2', createdAt: new Date('2026-01-01T01:01:00Z') },
    ]);
    const opts: RiskReplayOptions = {
      since: new Date('2026-01-01T00:00:00Z'),
      until: new Date('2026-01-01T02:00:00Z'),
      configOverrides: { 'risk.pair_min_amount': 300, 'risk.roundtrip_total_min': 1000 },
    };
    const r = await service.replay(opts);
    expect(washRepo.save).not.toHaveBeenCalled();
    expect(washRepo.create).not.toHaveBeenCalled();
    expect(r.iterated).toBe(2);
    expect(r.hitCount).toBe(2);
    expect(r.hitAccounts.map((a) => a.playerId).sort()).toEqual(['A', 'B']);
    expect(r.hitAccounts[0].score).toBeGreaterThanOrEqual(40);
    expect(r.hitAccounts[0]).toHaveProperty('signals');
    expect(r.scoreBuckets.watch).toBeGreaterThanOrEqual(2);
  });

  it('空窗口 return hitAccounts=[] 不命中', async () => {
    washRepo.find.mockResolvedValue([]);
    const r = await service.replay({
      since: new Date('2020-01-01T00:00:00Z'),
      until: new Date('2020-01-01T00:01:00Z'),
      configOverrides: {},
    });
    expect(r.iterated).toBe(0);
    expect(r.hitCount).toBe(0);
    expect(r.hitAccounts).toEqual([]);
    expect(r.scoreBuckets).toMatchObject({ normal: 0, watch: 0, high: 0 });
    expect(washRepo.save).not.toHaveBeenCalled();
  });

  it('非法 override 键抛 92901', async () => {
    await expect(
      service.replay({
        since: new Date('2020-01-01T00:00:00Z'),
        until: new Date('2020-01-01T00:01:00Z'),
        configOverrides: { bogus: 1 } as any,
      }),
    ).rejects.toMatchObject({ response: { code: 92901 } });
    expect(washRepo.find).not.toHaveBeenCalled();
  });
});