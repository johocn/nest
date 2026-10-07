import { In, type FindOperator } from 'typeorm';
import { COMMON_SCOPE, visibleTo, applyContentScope } from './content-scope';

describe('visibleTo', () => {
  it('null → only common', () => {
    const w = visibleTo(null);
    expect((w.appScope as FindOperator<string>).value).toEqual([COMMON_SCOPE]);
  });

  it('appCode → common + app', () => {
    const w = visibleTo('gameB');
    expect((w.appScope as FindOperator<string>).value).toEqual([COMMON_SCOPE, 'gameB']);
  });
});

describe('applyContentScope', () => {
  it('appends app_scope condition to query builder', () => {
    const calls: Array<{ sql: string; params: unknown }> = [];
    const qb = {
      andWhere: (sql: string, params: unknown) => {
        calls.push({ sql, params });
        return qb;
      },
    } as never;
    applyContentScope(qb, 'sp', 'gameB');
    expect(calls[0].sql).toContain('sp.app_scope IN (:...scopes)');
    expect(calls[0].params).toEqual({ scopes: [COMMON_SCOPE, 'gameB'] });
  });
});
