import { ScoreEffect, ScoreState, ScoreStrategy } from './scoring.types';

/**
 * 评分引擎内核（无 Nest 依赖，纯 TS，可单测）。
 * - 注册 6 种策略（单轴/双轴/好感/隐藏Flag/阵营/意识形态）；
 * - dispatch 时只让 use 指定的策略参与，其余不动 → 按需调用计算评分；
 * - 状态由调用方持有（ScoringService 按 gameId 隔离），引擎本身无状态。
 */
export class ScoreEngine {
  private strategies = new Map<string, ScoreStrategy>();

  register(s: ScoreStrategy): void {
    this.strategies.set(s.id, s);
  }

  /** 把一次对话选项的 Effect 应用到状态，仅 use 内的策略生效 */
  dispatch(effect: ScoreEffect, use: string[], state: ScoreState): void {
    for (const id of use) {
      const s = this.strategies.get(id);
      if (s) s.apply(effect, state);
    }
  }

  /** 计算派生分数，仅 use 内的策略产出 */
  compute(use: string[], state: ScoreState): Record<string, any> {
    const out: Record<string, any> = {};
    for (const id of use) {
      const s = this.strategies.get(id);
      if (s) out[id] = s.compute(state);
    }
    return out;
  }
}
