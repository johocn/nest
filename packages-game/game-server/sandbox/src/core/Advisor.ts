import type { MissionContext } from './MissionSystem';
import type { MarketSnapshot } from '../config/GameConfig';

/** 建议等级：info=知识点提示，warn=风控警示 */
export type AdviceLevel = 'info' | 'warn';

export interface Advice {
  id: string;
  level: AdviceLevel;
  /** 提示正文（现象） */
  text: string;
  /** 财商教学点（怎么办） */
  lesson: string;
}

/**
 * 实时财商干预：对高风险/偏离目标的配置给出教学提示。
 * 每条建议一局只触发一次（去重），避免刷屏。
 */
export class Advisor {
  private _fired = new Set<string>();
  private _list: Advice[] = [];

  /** 已触发过的建议（按触发顺序） */
  getTriggered(): Advice[] {
    return this._list.slice();
  }

  reset(): void {
    this._fired.clear();
    this._list = [];
  }

  /** 评估一次：返回本次新触发的建议 */
  evaluate(ctx: MissionContext, snap: MarketSnapshot | null = null): Advice[] {
    const out: Advice[] = [];
    const emit = (a: Advice) => {
      if (this._fired.has(a.id)) return;
      this._fired.add(a.id);
      this._list.push(a);
      out.push(a);
    };

    const total = ctx.totalAssets;
    if (total <= 0) return out;

    const p = ctx.portfolio;
    const equity = p.fund.currentValue / total;
    const liquidity = (ctx.cash + p.cashMgmt.currentValue) / total;
    const parts = [
      p.deposit.principal,
      p.cashMgmt.currentValue,
      p.closedFund.currentValue,
      p.fund.currentValue,
    ];
    const concentration = Math.max(...parts) / total;

    if (equity >= 0.6) {
      emit({
        id: 'equity-heavy',
        level: 'warn',
        text: `权益仓位已达 ${(equity * 100).toFixed(0)}%，波动会被明显放大。`,
        lesson: '考虑减仓或再平衡，别让单一市场决定你的全部收益。',
      });
    }
    if (liquidity <= 0.1) {
      emit({
        id: 'liquidity-thin',
        level: 'warn',
        text: '可随时动用的资金不足一成，应急垫太薄。',
        lesson: '随时能取的钱是安全垫，别把钱全押进封闭与权益。',
      });
    }
    if (concentration >= 0.7) {
      emit({
        id: 'concentration',
        level: 'warn',
        text: `单一资产占比过高（${(concentration * 100).toFixed(0)}%）。`,
        lesson: '鸡蛋不放一个篮子，分散是对抗不确定性的最好办法。',
      });
    }
    if (snap && snap.fundNavChange <= -0.03) {
      emit({
        id: 'dip-opportunity',
        level: 'info',
        text: `基金今日下跌 ${Math.abs(snap.fundNavChange * 100).toFixed(2)}%。`,
        lesson: '低买高卖难在“低”时敢买——回调往往是再平衡的好时机。',
      });
    }
    if (
      equity > 0 &&
      equity < 0.6 &&
      liquidity >= 0.25 &&
      concentration < 0.7
    ) {
      emit({
        id: 'balanced',
        level: 'info',
        text: '当前配置较为均衡。',
        lesson: '保持纪律：定期再平衡，比追逐热点更能守住收益。',
      });
    }
    return out;
  }
}
