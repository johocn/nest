import { Repository } from 'typeorm';
import { ScoringAdminService } from './scoring-admin.service';
import { ScoringService } from './scoring.service';
import { ScoringConfigEntity } from './entities/scoring-config.entity';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

/** Map 底座 fake repo：模拟 scoring_configs 行（含软删语义：deletedAt 过滤 + withDeleted 透查） */
function makeFakeConfigRepo(): Repository<ScoringConfigEntity> & {
  rows: Map<string, any>;
} {
  const rows = new Map<string, any>();
  let seq = 0;
  return {
    rows,
    async findAndCount({ skip, take }: any): Promise<[any[], number]> {
      const all = [...rows.values()];
      return [all.slice(skip, skip + take), all.length];
    },
    async findOne({ where, withDeleted }: any): Promise<any> {
      for (const row of rows.values()) {
        if (where.id != null && row.id !== where.id) continue;
        if (where.gameId != null && row.gameId !== where.gameId) continue;
        if (!withDeleted && row.deletedAt) continue;
        return { ...row };
      }
      return null;
    },
    create(data: any): any {
      return { ...data };
    },
    async save(entity: any): Promise<any> {
      if (!entity.id) entity.id = String(++seq);
      rows.set(entity.id, { ...entity });
      return { ...entity };
    },
    async softRemove(entity: any): Promise<any> {
      const row = rows.get(entity.id);
      if (row) row.deletedAt = new Date();
      return { ...row };
    },
  } as unknown as Repository<ScoringConfigEntity> & { rows: Map<string, any> };
}

/** fake 状态 repo：仅满足构造签名（热更新断言走 resolveBranch 未注册短路/无档 freshState） */
function makeFakeStateRepo(): Repository<any> {
  return { async findOne(): Promise<any> { return null; } } as unknown as Repository<any>;
}

function validBody(): any {
  return {
    gameId: 'g1',
    enabled: ['axis'],
    axes: { a: { label: 'A', min: 0, max: 100, visible: true, initial: 0 } },
    branches: [{ id: 'r1', when: [{ kind: 'axis', id: 'a', op: '>=', value: 0 }], goto: 'end_a' }],
  };
}

async function expectCode(p: Promise<any>, code: number): Promise<void> {
  let err: any;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(GameException);
  expect((err as GameException).getResponse().code).toBe(code);
}

describe('ScoringAdminService', () => {
  function makeSvc(): {
    svc: ScoringAdminService;
    scoring: ScoringService;
    repo: ReturnType<typeof makeFakeConfigRepo>;
  } {
    const repo = makeFakeConfigRepo();
    const scoring = new ScoringService(makeFakeStateRepo());
    return { svc: new ScoringAdminService(repo, scoring), scoring, repo };
  }

  it('create 成功：落库（game_id/config 同步）并 registerGame 热更新', async () => {
    const { svc, scoring, repo } = makeSvc();

    const saved = await svc.create(validBody());

    expect(saved.id).toBeDefined();
    expect(repo.rows.get(saved.id).gameId).toBe('g1');
    expect(repo.rows.get(saved.id).config.gameId).toBe('g1');
    expect((scoring as any).configs.has('g1')).toBe(true);
  });

  it('热更新行为：注册前 resolveBranch=default，create 后命中 goto，delete 后回退 default', async () => {
    const { svc, scoring } = makeSvc();
    expect(await scoring.resolveBranch('p1', 'g1')).toBe('default'); // 未注册短路

    const saved = await svc.create(validBody());
    expect(await scoring.resolveBranch('p1', 'g1')).toBe('end_a'); // 0 >= 0 命中

    await svc.delete(saved.id);
    expect(await scoring.resolveBranch('p1', 'g1')).toBe('default'); // unregister 生效
  });

  it('create 非法配置 → 47002，消息携带 validator 明细', async () => {
    const { svc } = makeSvc();

    let err: any;
    try {
      await svc.create({ gameId: '', enabled: ['axis'] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GameException);
    const resp = (err as GameException).getResponse() as any;
    expect(resp.code).toBe(ErrorCodes.SCORING_CONFIG_INVALID);
    expect(resp.msg).toContain('gameId');
  });

  it('create 冲突：活跃行与软删行占用 game_id 均 47003', async () => {
    const { svc } = makeSvc();

    await svc.create(validBody());
    await expectCode(svc.create(validBody()), ErrorCodes.SCORING_GAME_EXISTS);

    // 软删第一行后再建同 game_id：软删行仍占唯一索引 → 仍冲突
    const { items } = await svc.list(1, 20);
    await svc.delete(items[0].id);
    await expectCode(svc.create(validBody()), ErrorCodes.SCORING_GAME_EXISTS);
  });

  it('update 成功：body 与既有 config 合并，热更新 configs Map', async () => {
    const { svc, scoring } = makeSvc();
    const saved = await svc.create(validBody());

    const updated = await svc.update(saved.id, {
      branches: [{ id: 'r2', when: [{ kind: 'axis', id: 'a', op: '>=', value: 50 }], goto: 'end_b' }],
    });

    expect(updated.config.enabled).toEqual(['axis']); // 既有字段保留
    expect(updated.config.branches[0].goto).toBe('end_b'); // 新 branches 覆盖
    expect(updated.gameId).toBe('g1'); // gameId 缺省沿用原值
    expect((scoring as any).configs.get('g1').branches[0].goto).toBe('end_b'); // 热更新生效
  });

  it('update 改 game_id 撞他行（含软删）→ 47003；不撞自身', async () => {
    const { svc } = makeSvc();
    const g1 = await svc.create(validBody());
    await svc.create({ ...validBody(), gameId: 'g2' });

    // 改成已存在的 g2 → 冲突
    await expectCode(
      svc.update(g1.id, { gameId: 'g2' }),
      ErrorCodes.SCORING_GAME_EXISTS,
    );
    // 仅更新 branches（gameId 沿用自身）→ 排除自身后不冲突
    const updated = await svc.update(g1.id, { enabled: ['dual'] });
    expect(updated.gameId).toBe('g1');
    expect(updated.config.enabled).toEqual(['dual']);
  });

  it('update/delete/get 目标不存在（含软删视为不存在）→ 47001', async () => {
    const { svc } = makeSvc();

    await expectCode(svc.get('999'), ErrorCodes.SCORING_GAME_NOT_FOUND);
    await expectCode(svc.update('999', { enabled: ['axis'] }), ErrorCodes.SCORING_GAME_NOT_FOUND);
    await expectCode(svc.delete('999'), ErrorCodes.SCORING_GAME_NOT_FOUND);

    // 软删行不可再 get/update/delete
    const saved = await svc.create(validBody());
    await svc.delete(saved.id);
    await expectCode(svc.get(saved.id), ErrorCodes.SCORING_GAME_NOT_FOUND);
    await expectCode(svc.update(saved.id, { enabled: ['axis'] }), ErrorCodes.SCORING_GAME_NOT_FOUND);
    await expectCode(svc.delete(saved.id), ErrorCodes.SCORING_GAME_NOT_FOUND);
  });

  it('delete：软删落库（deletedAt 置位）+ configs Map 摘除', async () => {
    const { svc, scoring, repo } = makeSvc();
    const saved = await svc.create(validBody());

    await svc.delete(saved.id);

    expect(repo.rows.get(saved.id).deletedAt).toBeDefined();
    expect((scoring as any).configs.has('g1')).toBe(false);
  });

  it('list：分页返回 items + total', async () => {
    const { svc } = makeSvc();
    await svc.create(validBody());
    await svc.create({ ...validBody(), gameId: 'g2' });

    const page1 = await svc.list(1, 1);
    expect(page1.total).toBe(2);
    expect(page1.items).toHaveLength(1);
    const page2 = await svc.list(2, 1);
    expect(page2.items).toHaveLength(1);
  });
});
