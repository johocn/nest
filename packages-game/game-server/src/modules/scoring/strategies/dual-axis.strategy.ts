import { ScoreEffect, ScoreState, ScoreStrategy } from '../scoring.types';

function bump(state: ScoreState, id: string, main: number, cross: number): void {
  let ax = state.axes.get(id);
  if (!ax) {
    ax = { id, label: id, min: -100, max: 100, visible: true, value: 0 };
    state.axes.set(id, ax);
  }
  ax.value = Math.max(-100, Math.min(100, ax.value + main + cross));
}

/** 双轴价值：楷模 paragon / 叛逆 renegade，互斥此消彼长（如质量效应） */
export const dualAxisStrategy: ScoreStrategy = {
  id: 'dual',
  desc: '双轴价值（楷模 / 叛逆，互斥此消彼长）',
  apply(effect: ScoreEffect, state: ScoreState) {
    if (!effect.axes) return;
    const p = effect.axes.paragon ?? 0;
    const r = effect.axes.renegade ?? 0;
    if (p) bump(state, 'paragon', p, -r * 0.3);
    if (r) bump(state, 'renegade', r, -p * 0.3);
  },
  compute(state: ScoreState) {
    const p = state.axes.get('paragon')?.value ?? 0;
    const r = state.axes.get('renegade')?.value ?? 0;
    return {
      paragon: p,
      renegade: r,
      alignment: p > r ? '楷模' : r > p ? '叛逆' : '中立',
    };
  },
};
