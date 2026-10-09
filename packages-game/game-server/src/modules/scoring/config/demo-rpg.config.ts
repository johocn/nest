import { ScoringConfig } from '../scoring.types';

/**
 * 示例游戏 2：演示「同一套评分引擎服务另一个游戏」。
 * 启用：双轴价值(楷模/叛逆) + 阵营声望 —— 与 history-teach 完全不同的策略组合，证明多游戏复用。
 */
export const demoRpgConfig: ScoringConfig = {
  gameId: 'demo-rpg',
  enabled: ['dual', 'faction'],
  axes: {
    paragon: { label: '楷模', min: -100, max: 100, visible: true, initial: 0 },
    renegade: { label: '叛逆', min: -100, max: 100, visible: true, initial: 0 },
  },
  factions: ['联邦', '叛军'],
  branches: [
    {
      id: 'hero-end',
      when: [{ kind: 'axis', id: 'paragon', op: '>=', value: 60 }],
      goto: 'hero_end',
    },
    {
      id: 'villain-end',
      when: [{ kind: 'axis', id: 'renegade', op: '>=', value: 60 }],
      goto: 'villain_end',
    },
    {
      id: 'fed-route',
      when: [{ kind: 'reputation', id: '联邦', op: '>=', value: 20 }],
      goto: 'fed_route',
    },
  ],
};
