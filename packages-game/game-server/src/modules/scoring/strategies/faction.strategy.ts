import { ScoreEffect, ScoreState, ScoreStrategy } from '../scoring.types';

/** 阵营/声望：门控内容解锁（如赛博朋克 / 上古卷轴） */
export const factionStrategy: ScoreStrategy = {
  id: 'faction',
  desc: '阵营声望（声望门控解锁）',
  apply(effect: ScoreEffect, state: ScoreState) {
    if (!effect.reputation) return;
    for (const [k, v] of Object.entries(effect.reputation)) {
      if (typeof v !== 'number') continue;
      state.reputation[k] = (state.reputation[k] ?? 0) + v;
    }
  },
  compute(state: ScoreState) {
    const accessible = Object.entries(state.reputation)
      .filter(([, v]) => v >= 20)
      .map(([k]) => k);
    return { reputation: state.reputation, accessible };
  },
};
