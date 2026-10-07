import { In } from 'typeorm';
import { expectScopedFind } from './content-scope-contract.shared';

describe('expectScopedFind', () => {
  const makeMock = (firstArg: unknown) => ({ mock: { calls: [[firstArg]] } }) as jest.Mock;

  it('passes when find where carries appScope In', () => {
    const m = makeMock({ where: { id: '1', appScope: In(['common', 'gameB']) } });
    expect(() => expectScopedFind(m, ['common', 'gameB'])).not.toThrow();
  });

  it('fails when appScope filter missing', () => {
    const m = makeMock({ where: { id: '1' } });
    expect(() => expectScopedFind(m, ['common', 'gameB'])).toThrow(/appScope/);
  });

  it('supports findOne with flat where and findAndCount tuple args', () => {
    const m1 = makeMock({ where: { appScope: In(['common']) } });
    expect(() => expectScopedFind(m1, ['common'])).not.toThrow();
    const m2 = makeMock([
      { where: { appScope: In(['common']) }, skip: 0 },
    ]);
    expect(() => expectScopedFind(m2, ['common'])).not.toThrow();
  });
});
