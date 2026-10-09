import { ScoringService } from './scoring.service';
import { historyTeachConfig } from './config/history-teach.config';
import { demoRpgConfig } from './config/demo-rpg.config';

describe('ScoringService（通用评分引擎）', () => {
  it('dispatch 累积分值，并按分支规则判定跳转', () => {
    const s = new ScoringService();
    s.registerGame(historyTeachConfig);

    s.dispatch('p1', 'history-teach', {
      axes: { wisdom: 14 },
      affinity: { 孔子: 60 },
      flags: ['学完论语'],
    });

    const snap = s.snapshot('p1', 'history-teach');
    expect(snap.axes.wisdom).toBe(14);
    expect(snap.affinity['孔子']).toBe(60);
    expect(snap.flags).toContain('学完论语');

    // 孔子好感 >= 50 → 命中 sage-route
    expect(s.resolveBranch('p1', 'history-teach')).toBe('confucius_route');
  });

  it('未命中任何规则时回退 default', () => {
    const s = new ScoringService();
    s.registerGame(historyTeachConfig);
    s.dispatch('p2', 'history-teach', { axes: { wisdom: 5 } });
    expect(s.resolveBranch('p2', 'history-teach')).toBe('default');
  });

  it('多游戏状态隔离：不同 gameId 互不污染', () => {
    const s = new ScoringService();
    s.registerGame(historyTeachConfig);
    s.registerGame(demoRpgConfig);

    s.dispatch('p1', 'history-teach', { axes: { wisdom: 50 } });
    s.dispatch('p1', 'demo-rpg', { axes: { paragon: 80 } });

    expect(s.snapshot('p1', 'history-teach').axes.wisdom).toBe(50);
    expect(s.snapshot('p1', 'history-teach').axes.paragon).toBeUndefined();
    expect(s.snapshot('p1', 'demo-rpg').axes.paragon).toBe(80);
    expect(s.resolveBranch('p1', 'demo-rpg')).toBe('hero_end');
  });

  it('use 可裁剪参与评分的策略（按需调用）', () => {
    const s = new ScoringService();
    s.registerGame(historyTeachConfig);
    // 只让 axis 策略生效，affinity/flag 不动
    s.dispatch('p3', 'history-teach', { axes: { wisdom: 10 }, affinity: { 孔子: 99 } }, ['axis']);
    expect(s.snapshot('p3', 'history-teach').axes.wisdom).toBe(10);
    expect(s.snapshot('p3', 'history-teach').affinity['孔子']).toBe(0); // 未参与
  });
});
