import { EquityPoint, GameConfig } from '../config/GameConfig';

export interface BenchmarkSeries {
  /** 全额存存款的每日总资产 */
  allDeposit: number[];
  /** 全额买基金的每日总资产（按净值涨幅，从起点持有至今） */
  allFund: number[];
}

/**
 * 由实际净值曲线反推两条“简单策略”基准（与曲线等长），
 * 用于回答“我这套配置，跑赢全程躺平存存款 / 全买基金了吗”。
 */
export function buildBenchmarks(
  curve: readonly EquityPoint[],
  principal: number,
): BenchmarkSeries {
  const nav0 = curve.length > 0 ? curve[0].fundNav : 1;
  const allDeposit: number[] = [];
  const allFund: number[] = [];
  curve.forEach((p, i) => {
    const years = i / 365;
    allDeposit.push(principal * Math.pow(1 + GameConfig.DEPOSIT_RATE, years));
    allFund.push(nav0 > 0 ? principal * (p.fundNav / nav0) : principal);
  });
  return { allDeposit, allFund };
}
