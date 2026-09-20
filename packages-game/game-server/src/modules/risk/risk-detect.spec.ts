import { detectWindow, scoreAccount, buildRiskThresholds, assertValidThresholdOverrides } from './risk-detect';
import { RiskCaseType, RiskLevel } from '@constants/enums';

const baseThresholds = {
  pairMinAmount: 300,
  roundtripTotalMin: 1000,
  onewayBigAmount: 3000,
  onewayBackflowRatio: 0.2,
  priceDevRatio: 2,
  priceDevFreq: 3,
  scoreCap: 100,
  watchScore: 40,
  highScore: 70,
};

describe('risk-detect 检测纯函数', () => {
  it('对敲回环信号：双向净额近抵消且总量达标', () => {
    const { signals } = detectWindow(
      [
        { fromId: 'A', toId: 'B', assetKey: 'gold', value: '600' },
        { fromId: 'B', toId: 'A', assetKey: 'gold', value: '500' },
      ],
      baseThresholds,
    );
    const rt = signals.find((s) => s.caseType === RiskCaseType.ROUND_TRIP);
    expect(rt).toBeDefined();
    expect(rt!.score).toBe(60);
    expect(rt!.detail).toMatchObject({ a2b: 600, b2a: 500 });
  });

  it('失衡信号：单向大额无回流', () => {
    const { signals } = detectWindow(
      [{ fromId: 'A', toId: 'B', assetKey: 'gold', value: '5000' }],
      baseThresholds,
    );
    const ow = signals.find((s) => s.caseType === RiskCaseType.ONE_WAY);
    expect(ow).toBeDefined();
    expect(ow!.score).toBe(40);
  });

  it('价值异动信号：同资产短时对数≥freq 且价格偏离均值>ratio', () => {
    const { signals } = detectWindow(
      [
        { fromId: 'A', toId: 'B', assetKey: 'gold', value: '10' },
        { fromId: 'C', toId: 'D', assetKey: 'gold', value: '10' },
        { fromId: 'E', toId: 'F', assetKey: 'gold', value: '100' },
      ],
      baseThresholds,
    );
    const pd = signals.find((s) => s.caseType === RiskCaseType.PRICE_DIVERGENCE);
    expect(pd).toBeDefined();
    expect(pd!.score).toBe(30);
    expect(pd!.detail.asset).toBe('gold');
  });

  it('账号评分：累计 + 封顶 + 按档位评级', () => {
    const signals = [
      { caseType: RiskCaseType.ROUND_TRIP, score: 60, fromId: 'A', toId: 'B', detail: {} },
      { caseType: RiskCaseType.ONE_WAY, score: 40, fromId: 'A', toId: 'C', detail: {} },
    ];
    const scores = scoreAccount(signals, { ...baseThresholds, scoreCap: 100 });
    const a = scores.find((s) => s.playerId === 'A')!;
    const b = scores.find((s) => s.playerId === 'B')!;
    expect(a.score).toBe(100); // 60+40 封顶 100
    expect(a.level).toBe(RiskLevel.HIGH);
    expect(b.score).toBe(60);
    expect(b.level).toBe(RiskLevel.WATCH);
  });

  it('回放阈值 override 覆盖检测键，非法键抛 92901', () => {
    const t = buildRiskThresholds({ 'risk.roundtrip_total_min': 5000 });
    expect(t.roundtripTotalMin).toBe(5000);
    expect(t.pairMinAmount).toBe(0); // 未覆盖键走默认
    expect(() => assertValidThresholdOverrides({ bogus: 1 })).toThrow();
    expect(() => assertValidThresholdOverrides({ 'risk.high_score': Number.NaN })).toThrow();
  });
});