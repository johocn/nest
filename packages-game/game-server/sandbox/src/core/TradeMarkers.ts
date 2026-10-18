import { TradeRecord, EquityPoint } from '../config/GameConfig';

export interface TradeMarker {
  /** 在净值曲线上的索引 */
  index: number;
  kind: 'buy' | 'sell';
  amount: number;
}

const BUY_ACTIONS = new Set(['买入', '存入', '申购']);
const SELL_ACTIONS = new Set(['卖出', '取出', '赎回', '到期兑付']);

/**
 * 把交易流水映射到净值曲线的索引上（用于在曲线上标注买卖点）。
 * 同一日期有多笔时归到当日曲线点；日期早于曲线起点归到 0，晚于末点归到末点。
 */
export function mapTradesToCurve(
  trades: readonly TradeRecord[],
  curve: readonly EquityPoint[],
): TradeMarker[] {
  if (curve.length === 0) return [];
  const dateIndex = new Map<string, number>();
  curve.forEach((p, i) => {
    if (!dateIndex.has(p.date)) dateIndex.set(p.date, i);
  });
  const markers: TradeMarker[] = [];
  for (const t of trades) {
    const kind = BUY_ACTIONS.has(t.action)
      ? 'buy'
      : SELL_ACTIONS.has(t.action)
        ? 'sell'
        : null;
    if (!kind) continue;
    let idx = dateIndex.get(t.date);
    if (idx === undefined) {
      idx = curve.findIndex((p) => p.date >= t.date);
      if (idx < 0) idx = curve.length - 1;
    }
    markers.push({ index: idx, kind, amount: t.amount });
  }
  return markers;
}
