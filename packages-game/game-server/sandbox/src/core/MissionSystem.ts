import { PlayerPortfolio } from '../entities/PortfolioEntities';
import { LEVELS } from '../config/GameConfig';
import type { LevelCaps } from '../config/GameConfig';

/** 任务评估上下文（由 SandboxGame 提供快照） */
export interface MissionContext {
  portfolio: PlayerPortfolio;
  /** 现金 */
  cash: number;
  /** 总资产 */
  totalAssets: number;
  /** 累计操作次数 */
  tradeCount: number;
  /** 封闭理财到期兑付次数 */
  maturedCount: number;
  /** 经历临时停牌的次数 */
  suspendedSeen: number;
  /** 已回放交易日数 */
  days: number;
  /** 历史最大回撤（0.08 = 8%） */
  maxDrawdown: number;
}

export interface MissionDef {
  id: string;
  /** 任务名 */
  title: string;
  /** 达成条件（人话） */
  desc: string;
  /** 教学点 */
  lesson: string;
  /** 评估：返回是否达成与进度 0~1 */
  evaluate: (ctx: MissionContext) => { done: boolean; progress: number };
}

export interface MissionStatus {
  def: MissionDef;
  done: boolean;
  progress: number;
  /** 达成时的交易日序号（0 起，未达成为 -1） */
  doneAtDay: number;
}

export type MissionListener = (mission: MissionDef) => void;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const ratioOf = (ctx: MissionContext, pick: (p: PlayerPortfolio) => number) =>
  ctx.totalAssets > 0 ? pick(ctx.portfolio) / ctx.totalAssets : 0;

/** 教学目标任务卡（财商教育导向，不追求“赚最多”）。阈值随难度档位变化。 */
export function createMissions(caps: LevelCaps): MissionDef[] {
  const eqPct = Math.round(caps.equityCap * 100);
  const liqPct = Math.round(caps.liquidityFloor * 100);
  const profPct = Math.round(caps.profitTarget * 100);
  const ddPct = Math.round(caps.drawdownCap * 100);
  return [
    {
      id: 'diversify',
      title: '分散配置',
      desc: '四类资产每类市值占比 ≥ 10%',
      lesson: '鸡蛋不放在一个篮子里：任一资产占比过低，说明配置失衡。',
      evaluate: (ctx) => {
        const parts = [
          ratioOf(ctx, (p) => p.deposit.principal),
          ratioOf(ctx, (p) => p.cashMgmt.currentValue),
          ratioOf(ctx, (p) => p.closedFund.currentValue),
          ratioOf(ctx, (p) => p.fund.currentValue),
        ];
        const progress = clamp01(Math.min(...parts.map((r) => r / 0.1)));
        return { done: parts.every((r) => r >= 0.1), progress };
      },
    },
    {
      id: 'equity-cap',
      title: '控制权益仓位',
      desc: `基金市值占比 ≤ ${eqPct}%`,
      lesson: '权益类收益高但波动大，仓位过重会放大回撤。',
      evaluate: (ctx) => {
        const r = ratioOf(ctx, (p) => p.fund.currentValue);
        const progress = clamp01((caps.equityCap + 0.2 - r) / 0.2);
        return { done: r <= caps.equityCap, progress };
      },
    },
    {
      id: 'liquidity',
      title: '留足流动性',
      desc: `现金 + 现金理财 ≥ ${liqPct}%`,
      lesson: '随时可取的资金是应急垫，别把钱全锁进封闭期产品。',
      evaluate: (ctx) => {
        const r =
          ctx.totalAssets > 0
            ? (ctx.cash + ctx.portfolio.cashMgmt.currentValue) / ctx.totalAssets
            : 0;
        return {
          done: r >= caps.liquidityFloor,
          progress: clamp01(r / caps.liquidityFloor),
        };
      },
    },
    {
      id: 'closed-cycle',
      title: '走完封闭期',
      desc: '完成 1 次封闭理财到期兑付',
      lesson: '封闭期换来的高收益，代价是流动性——中途无法赎回。',
      evaluate: (ctx) => ({
        done: ctx.maturedCount >= 1,
        progress: clamp01(ctx.maturedCount),
      }),
    },
    {
      id: 'drawdown-guard',
      title: '守住回撤',
      desc: `交易满 5 天后，最大回撤 ≤ ${ddPct}%`,
      lesson: '回撤比收益更考验心态：能扛住波动才拿得到长期收益。',
      evaluate: (ctx) => {
        const progress = clamp01(
          (caps.drawdownCap + 0.12 - ctx.maxDrawdown) / 0.12,
        );
        return {
          done: ctx.days >= 5 && ctx.maxDrawdown <= caps.drawdownCap,
          progress,
        };
      },
    },
    {
      id: 'suspended',
      title: '认识停牌',
      desc: '经历 1 次盘中临时停牌',
      lesson: '停牌时段无法交易，真实市场里这叫“流动性风险”。',
      evaluate: (ctx) => ({
        done: ctx.suspendedSeen >= 1,
        progress: clamp01(ctx.suspendedSeen),
      }),
    },
    {
      id: 'steady-profit',
      title: '稳健增值',
      desc: `总收益率 ≥ ${profPct}%`,
      lesson: '别追求暴利：跑赢存款利率、控制波动，才算会理财。',
      evaluate: (ctx) => {
        const rate = ctx.portfolio.totalReturnRate;
        return {
          done: rate >= caps.profitTarget,
          progress: clamp01(rate / caps.profitTarget),
        };
      },
    },
  ];
}

/** 默认任务卡（稳健型） */
export const MISSIONS = createMissions(LEVELS.balanced.caps);

/** 任务系统：评估进度、记录达成、广播达成事件 */
export class MissionSystem {
  private _defs: MissionDef[];
  private _status = new Map<string, MissionStatus>();
  private _listeners: MissionListener[] = [];
  private _newlyDone: MissionDef[] = [];

  constructor(defs: MissionDef[] = MISSIONS) {
    this._defs = defs;
    for (const d of defs) {
      this._status.set(d.id, {
        def: d,
        done: false,
        progress: 0,
        doneAtDay: -1,
      });
    }
  }

  /** 当前任务状态快照 */
  getStatuses(): MissionStatus[] {
    return this._defs.map((d) => this._status.get(d.id)!);
  }

  /** 已达成数量 */
  get completed(): number {
    return this.getStatuses().filter((s) => s.done).length;
  }

  get total(): number {
    return this._defs.length;
  }

  /** 订阅“新达成”事件 */
  onComplete(cb: MissionListener): void {
    this._listeners.push(cb);
  }

  /** 评估一次：返回本次新达成的任务（供 UI 弹提示） */
  evaluate(ctx: MissionContext): MissionDef[] {
    this._newlyDone = [];
    for (const d of this._defs) {
      const st = this._status.get(d.id)!;
      const { done, progress } = d.evaluate(ctx);
      st.progress = progress;
      if (done && !st.done) {
        st.done = true;
        st.doneAtDay = ctx.days;
        this._newlyDone.push(d);
        for (const l of this._listeners) {
          try {
            l(d);
          } catch (e) {
            console.error('[MissionSystem] listener error:', e);
          }
        }
      }
      // 条件回退时撤销达成（如收益率跌回 3% 以下）
      if (!done && st.done && d.id === 'steady-profit') {
        st.done = false;
        st.doneAtDay = -1;
      }
    }
    return this._newlyDone.slice();
  }

  /** 取出并清空本次新达成（避免重复弹窗） */
  takeNewlyDone(): MissionDef[] {
    const list = this._newlyDone;
    this._newlyDone = [];
    return list;
  }

  /** 重置 */
  reset(): void {
    for (const d of this._defs) {
      this._status.set(d.id, {
        def: d,
        done: false,
        progress: 0,
        doneAtDay: -1,
      });
    }
    this._newlyDone = [];
  }
}
