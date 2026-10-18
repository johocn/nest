import { ScoreEffect, ScoreState, ScoreStrategy } from '../scoring.types';

/** 意识形态/技能人格：价值观投影结局（如极乐迪斯科 / Persona） */
export const ideologyStrategy: ScoreStrategy = {
  id: 'ideology',
  desc: '意识形态（价值观投影结局）',
  apply(effect: ScoreEffect, state: ScoreState) {
    if (!effect.ideology) return;
    for (const [k, v] of Object.entries(effect.ideology)) {
      if (typeof v !== 'number') continue;
      state.ideology[k] = (state.ideology[k] ?? 0) + v;
    }
  },
  compute(state: ScoreState) {
    return { ideology: state.ideology };
  },
};
