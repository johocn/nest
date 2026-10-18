import { ScoringConfig } from '../scoring.types';

/**
 * 示例游戏：历史案例教学（向智者学 → 应用当下 → 畅想未来）
 * 仅用数据声明，零评分代码；引擎与 6 策略全部复用。
 * 启用：通用数值轴(智慧/财富) + 角色好感(智者) + 隐藏Flag(学到的原则)。
 */
export const historyTeachConfig: ScoringConfig = {
  gameId: 'history-teach',
  enabled: ['axis', 'affinity', 'flag'],
  axes: {
    wisdom: { label: '智慧', min: 0, max: 300, visible: true, initial: 0 },
    wealth: { label: '财富', min: 0, max: 99999, visible: true, initial: 100 },
  },
  npcs: ['孔子', '巴菲特', '范蠡', '诸葛亮', '达芬奇', '马斯克'],
  branches: [
    {
      id: 'sage-route',
      when: [{ kind: 'affinity', id: '孔子', op: '>=', value: 50 }],
      goto: 'confucius_route',
    },
    {
      id: 'rich-end',
      when: [{ kind: 'axis', id: 'wealth', op: '>=', value: 500 }],
      goto: 'rich_end',
    },
    {
      id: 'wise-end',
      when: [{ kind: 'axis', id: 'wisdom', op: '>=', value: 100 }],
      goto: 'wise_end',
    },
  ],
};
