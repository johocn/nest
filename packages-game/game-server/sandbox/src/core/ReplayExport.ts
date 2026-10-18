import { GameSummary, TradeRecord, AssetType } from '../config/GameConfig';
import { depositBaseline, reviewBehavior } from '../core/BehaviorReview';

const ASSET_LABEL: Record<AssetType, string> = {
  deposit: '存款',
  cash_mgmt: '现金理财',
  closed_fund: '封闭理财',
  fund: '基金',
};

/** CSV 字段转义（含逗号/引号/换行时加引号） */
const q = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const row = (cells: unknown[]) => cells.map(q).join(',');
const money = (v: number) => v.toFixed(2);
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

/**
 * 生成复盘报告 CSV（纯函数，便于测试）。
 * 结构：成绩单摘要 → 收益归因 → 完整交易流水。
 */
export function buildReplayCsv(
  summary: GameSummary,
  records: readonly TradeRecord[],
): string {
  const lines: string[] = [];

  lines.push('# 财商沙盘复盘报告');
  lines.push(row(['难度', summary.level]));
  lines.push(row(['情景', summary.scenario.name]));
  lines.push(row(['起始日期', summary.startDate]));
  lines.push(row(['结束日期', summary.endDate]));
  lines.push(row(['经历自然日', summary.days]));
  lines.push(row(['期初本金', money(summary.principal)]));
  lines.push(row(['期末总资产', money(summary.totalAssets)]));
  lines.push(row(['总收益', money(summary.totalReturn)]));
  lines.push(row(['总收益率', pct(summary.totalReturnRate)]));
  lines.push(row(['年化收益', pct(summary.annualizedReturn)]));
  lines.push(row(['最大回撤', pct(-summary.maxDrawdown)]));
  lines.push(row(['综合评级', summary.rating]));
  lines.push(row(['评级说明', summary.ratingReason]));
  lines.push(
    row([
      '教学目标达成',
      `${summary.missions.completed}/${summary.missions.total}`,
    ]),
  );
  lines.push(row(['市场环境', summary.environment.label]));
  lines.push(row(['环境建议', summary.environment.advice]));
  lines.push(row(['操作次数', summary.tradeCount]));
  lines.push(row(['定投扣款次数', summary.dcaCount]));
  const base = depositBaseline(summary);
  lines.push(row(['全额存款基准资产', money(base.baselineAssets)]));
  lines.push(row(['全额存款基准收益率', pct(base.baselineRate)]));
  lines.push(row(['相对存款基准', pct(base.beatBy)]));

  lines.push('');
  lines.push('# 行为点评');
  for (const o of reviewBehavior(summary)) {
    lines.push(
      row([o.tone === 'good' ? '✓' : o.tone === 'warn' ? '!' : '·', o.text]),
    );
  }

  lines.push('');
  lines.push('# 收益归因（贡献 = 期末市值 + 赎回回流 − 累计投入）');
  lines.push(row(['资产', '累计投入', '累计赎回', '期末市值', '贡献']));
  for (const a of summary.attribution) {
    lines.push(
      row([
        a.name,
        money(a.invested),
        money(a.redeemed),
        money(a.currentValue),
        money(a.contribution),
      ]),
    );
  }

  lines.push('');
  lines.push('# 期末资产明细');
  lines.push(row(['资产', '投入本金', '期末市值', '收益率']));
  for (const h of summary.holdings) {
    lines.push(
      row([
        ASSET_LABEL[h.type] || h.type,
        money(h.principal),
        money(h.currentValue),
        pct(h.returnRate),
      ]),
    );
  }

  lines.push('');
  lines.push('# 交易流水');
  lines.push(
    row(['日期', '操作', '资产', '金额', '成交净值', '变动份额', '描述']),
  );
  for (const r of records) {
    lines.push(
      row([
        r.date,
        r.action,
        ASSET_LABEL[r.assetType] || r.assetType,
        money(r.amount),
        r.navAtTrade,
        r.sharesChanged,
        r.description,
      ]),
    );
  }

  return `${lines.join('\n')}\n`;
}
