import { GameSummary, GameConfig } from '../config/GameConfig';

export interface Observation {
  tone: 'good' | 'warn' | 'info';
  text: string;
}

export interface DepositBaseline {
  /** 若本金全额存到期末的资产 */
  baselineAssets: number;
  /** 存款基准收益率 */
  baselineRate: number;
  /** 本局收益率 − 基准收益率（正=跑赢） */
  beatBy: number;
}

/** “全额存存款”基准（按日复利），用于衡量主动操作是否划算 */
export function depositBaseline(summary: GameSummary): DepositBaseline {
  const years = Math.max(0, summary.days) / 365;
  const baselineAssets =
    summary.principal * Math.pow(1 + GameConfig.DEPOSIT_RATE, years);
  const baselineRate =
    summary.principal > 0 ? baselineAssets / summary.principal - 1 : 0;
  return {
    baselineAssets,
    baselineRate,
    beatBy: summary.totalReturnRate - baselineRate,
  };
}

/** 结算行为点评：基于成绩单给出财商反馈（纯函数） */
export function reviewBehavior(summary: GameSummary): Observation[] {
  const obs: Observation[] = [];
  const days = Math.max(1, summary.days);
  const tradesPerDay = summary.tradeCount / days;

  if (tradesPerDay > 1.5) {
    obs.push({
      tone: 'warn',
      text: `平均每天 ${tradesPerDay.toFixed(1)} 次操作，交易偏频繁——手续费和情绪成本容易侵蚀收益。`,
    });
  } else if (summary.tradeCount <= 2) {
    obs.push({
      tone: 'info',
      text: '本局操作很少，长期持有的复利思路值得肯定。',
    });
  }

  const total = summary.totalAssets;
  if (total > 0) {
    const maxShare =
      Math.max(...summary.holdings.map((h) => h.currentValue)) / total;
    if (maxShare >= 0.7) {
      obs.push({
        tone: 'warn',
        text: `期末单一资产占比 ${(maxShare * 100).toFixed(0)}%，过度集中会放大波动。`,
      });
    }
  }

  if (summary.dcaCount > 0) {
    obs.push({
      tone: 'good',
      text: `定投扣款 ${summary.dcaCount} 次，分批入场能平滑成本，值得保持。`,
    });
  }

  if (summary.maxDrawdown > 0.12) {
    obs.push({
      tone: 'warn',
      text: `最大回撤 ${(summary.maxDrawdown * 100).toFixed(1)}%，波动偏大，注意权益仓位。`,
    });
  }

  const base = depositBaseline(summary);
  obs.push(
    base.beatBy >= 0
      ? {
          tone: 'good',
          text: `跑赢“全额存款”基准 ${(base.beatBy * 100).toFixed(2)} 个百分点。`,
        }
      : {
          tone: 'info',
          text: `未跑赢“全额存款”基准 ${(Math.abs(base.beatBy) * 100).toFixed(2)} 个百分点——激进不一定更优。`,
        },
  );

  const m = summary.missions;
  if (m.total > 0 && m.completed >= m.total - 1) {
    obs.push({
      tone: 'good',
      text: `教学目标达成 ${m.completed}/${m.total}，财商要点掌握得很稳。`,
    });
  }

  return obs.slice(0, 5);
}
