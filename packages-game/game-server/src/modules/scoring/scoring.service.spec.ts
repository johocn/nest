import { Repository } from 'typeorm';
import { ScoringService } from './scoring.service';
import { PlayerScoringState } from './entities/player-scoring-state.entity';
import { historyTeachConfig } from './config/history-teach.config';
import { demoRpgConfig } from './config/demo-rpg.config';

/** Map 底座 fake repo：模拟 PG jsonb 行（仅 find/findOne/upsert/delete 四方法） */
function makeFakeRepo(): Repository<PlayerScoringState> & {
  rows: Map<string, Partial<PlayerScoringState>>;
} {
  const rows = new Map<string, Partial<PlayerScoringState>>(); // key: `${playerId}:${gameId}`
  return {
    rows,
    async find(): Promise<PlayerScoringState[]> {
      return [...rows.values()] as PlayerScoringState[];
    },
    async findOne({ where }: any): Promise<PlayerScoringState | null> {
      const row = rows.get(`${where.playerId}:${where.gameId}`);
      return row ? { ...row } as PlayerScoringState : null;
    },
    async upsert(entity: any): Promise<any> {
      rows.set(`${entity.playerId}:${entity.gameId}`, { ...entity });
    },
    async delete({ playerId, gameId }: any): Promise<any> {
      rows.delete(`${playerId}:${gameId}`);
    },
  } as unknown as Repository<PlayerScoringState> & {
    rows: Map<string, Partial<PlayerScoringState>>;
  };
}

describe('ScoringService（通用评分引擎）', () => {
  it('dispatch 累积分值，并按分支规则判定跳转', async () => {
    const s = new ScoringService(makeFakeRepo());
    s.registerGame(historyTeachConfig);

    await s.dispatch('p1', 'history-teach', {
      axes: { wisdom: 14 },
      affinity: { 孔子: 60 },
      flags: ['学完论语'],
    });

    const snap = await s.snapshot('p1', 'history-teach');
    expect(snap.axes.wisdom).toBe(14);
    expect(snap.affinity['孔子']).toBe(60);
    expect(snap.flags).toContain('学完论语');

    // 孔子好感 >= 50 → 命中 sage-route
    expect(await s.resolveBranch('p1', 'history-teach')).toBe('confucius_route');
  });

  it('未命中任何规则时回退 default', async () => {
    const s = new ScoringService(makeFakeRepo());
    s.registerGame(historyTeachConfig);
    await s.dispatch('p2', 'history-teach', { axes: { wisdom: 5 } });
    expect(await s.resolveBranch('p2', 'history-teach')).toBe('default');
  });

  it('多游戏状态隔离：不同 gameId 互不污染', async () => {
    const s = new ScoringService(makeFakeRepo());
    s.registerGame(historyTeachConfig);
    s.registerGame(demoRpgConfig);

    await s.dispatch('p1', 'history-teach', { axes: { wisdom: 50 } });
    await s.dispatch('p1', 'demo-rpg', { axes: { paragon: 80 } });

    expect((await s.snapshot('p1', 'history-teach')).axes.wisdom).toBe(50);
    expect((await s.snapshot('p1', 'history-teach')).axes.paragon).toBeUndefined();
    expect((await s.snapshot('p1', 'demo-rpg')).axes.paragon).toBe(80);
    expect(await s.resolveBranch('p1', 'demo-rpg')).toBe('hero_end');
  });

  it('use 可裁剪参与评分的策略（按需调用）', async () => {
    const s = new ScoringService(makeFakeRepo());
    s.registerGame(historyTeachConfig);
    // 只让 axis 策略生效，affinity/flag 不动
    await s.dispatch('p3', 'history-teach', { axes: { wisdom: 10 }, affinity: { 孔子: 99 } }, ['axis']);
    expect((await s.snapshot('p3', 'history-teach')).axes.wisdom).toBe(10);
    expect((await s.snapshot('p3', 'history-teach')).affinity['孔子']).toBe(0); // 未参与
  });

  it('重启恢复：同一份库数据起新 service 实例，快照与重启前一致', async () => {
    const repo = makeFakeRepo();
    const s1 = new ScoringService(repo);
    s1.registerGame(historyTeachConfig);
    await s1.dispatch('p1', 'history-teach', {
      axes: { wisdom: 120 },
      affinity: { 孔子: 80 },
      flags: ['学完论语'],
    });
    const before = await s1.snapshot('p1', 'history-teach');

    // 模拟重启：内存 Map 清零，仅靠库行恢复
    const s2 = new ScoringService(repo);
    s2.registerGame(historyTeachConfig);
    const after = await s2.snapshot('p1', 'history-teach');

    expect(after).toEqual(before);
    expect(after.axes.wisdom).toBe(120);
    expect(after.affinity['孔子']).toBe(80);
    expect(after.flags).toContain('学完论语');
    // 重启后分支判定不丢：孔子好感 >= 50 仍命中 sage-route
    expect(await s2.resolveBranch('p1', 'history-teach')).toBe('confucius_route');
  });

  it('越界钳制：持久化值越界后加载被钳制到 [min,max]', async () => {
    const repo = makeFakeRepo();
    // 直接造一行越界库数据（模拟 max 调小后的旧档）
    await repo.upsert(
      {
        playerId: 'p9',
        gameId: 'history-teach',
        state: { axes: { wisdom: 9999, wealth: -5 }, flags: [], affinity: {}, reputation: {}, ideology: {} },
      } as any,
      ['playerId', 'gameId'],
    );
    const s = new ScoringService(repo);
    s.registerGame(historyTeachConfig);
    const snap = await s.snapshot('p9', 'history-teach');
    expect(snap.axes.wisdom).toBe(300); // max 300
    expect(snap.axes.wealth).toBe(0); // min 0
  });

  it('未知 key 丢弃：库里多余的轴/好感/声望键不进状态', async () => {
    const repo = makeFakeRepo();
    await repo.upsert(
      {
        playerId: 'p8',
        gameId: 'history-teach',
        state: {
          axes: { wisdom: 10, ghost: 66 },
          flags: ['legacy'],
          affinity: { 幽灵: 99 },
          reputation: { 乱入: 5 },
          ideology: { 多维: 1 },
        },
      } as any,
      ['playerId', 'gameId'],
    );
    const s = new ScoringService(repo);
    s.registerGame(historyTeachConfig);
    const snap = await s.snapshot('p8', 'history-teach');
    expect(snap.axes.wisdom).toBe(10);
    expect(snap.axes['ghost']).toBeUndefined();
    expect(snap.affinity['幽灵']).toBeUndefined();
    expect(snap.reputation['乱入']).toBeUndefined();
    expect(snap.ideology['多维']).toBeUndefined();
    expect(snap.flags).toContain('legacy'); // flags 无配置键宇宙，全量恢复
  });
});
