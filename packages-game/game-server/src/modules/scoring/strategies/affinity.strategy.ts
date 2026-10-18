import { ScoreEffect, ScoreState, ScoreStrategy } from '../scoring.types';

/** 角色好感度：与 NPC 关系（如 BG3 / 龙腾） */
export const affinityStrategy: ScoreStrategy = {
  id: 'affinity',
  desc: '角色好感度（NPC 关系网）',
  apply(effect: ScoreEffect, state: ScoreState) {
    if (!effect.affinity) return;
    for (const [k, v] of Object.entries(effect.affinity)) {
      if (typeof v !== 'number') continue;
      state.affinity[k] = (state.affinity[k] ?? 0) + v;
    }
  },
  compute(state: ScoreState) {
    const unlocked = Object.entries(state.affinity)
      .filter(([, v]) => v >= 50)
      .map(([k]) => k);
    return { affinity: state.affinity, unlocked };
  },
};
