import { ScoreEffect, ScoreState, ScoreStrategy } from '../scoring.types';

/** 通用数值轴：道德/智慧/财富/楷模-叛逆 等都用同一策略，靠配置声明不同轴 */
export const axisStrategy: ScoreStrategy = {
  id: 'axis',
  desc: '通用数值轴（单轴道德 / 智慧 / 财富 等）',
  apply(effect: ScoreEffect, state: ScoreState) {
    if (!effect.axes) return;
    for (const [id, delta] of Object.entries(effect.axes)) {
      if (typeof delta !== 'number') continue;
      let ax = state.axes.get(id);
      if (!ax) {
        ax = { id, label: id, min: -1000, max: 1000, visible: true, value: 0 };
        state.axes.set(id, ax);
      }
      ax.value += delta;
      if (ax.value < ax.min) ax.value = ax.min;
      if (ax.value > ax.max) ax.value = ax.max;
    }
  },
  compute(state: ScoreState) {
    const axes: Record<string, number> = {};
    for (const [id, ax] of state.axes) axes[id] = ax.value;
    return { axes };
  },
};
