import { ScoreEffect, ScoreState, ScoreStrategy } from '../scoring.types';

/** 隐藏 Flag：延迟兑现的关键选择（如巫师3 / Undertale） */
export const hiddenFlagStrategy: ScoreStrategy = {
  id: 'flag',
  desc: '隐藏 Flag（关键选择延迟兑现）',
  apply(effect: ScoreEffect, state: ScoreState) {
    for (const f of effect.flags ?? []) {
      if (typeof f === 'string' && f.trim() !== '') state.flags.add(f);
    }
  },
  compute(state: ScoreState) {
    return { flags: [...state.flags] };
  },
};
