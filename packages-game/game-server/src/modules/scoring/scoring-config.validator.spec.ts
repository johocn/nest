import { validateScoringConfig } from './scoring-config.validator';
import { historyTeachConfig } from './config/history-teach.config';
import { demoRpgConfig } from './config/demo-rpg.config';
import { ScoringConfig } from './scoring.types';

describe('validateScoringConfig', () => {
  it('内置示例配置（history-teach / demo-rpg）全通过', () => {
    expect(validateScoringConfig(historyTeachConfig)).toEqual([]);
    expect(validateScoringConfig(demoRpgConfig)).toEqual([]);
  });

  it('非对象输入返回错误', () => {
    expect(validateScoringConfig(null)).toHaveLength(1);
    expect(validateScoringConfig('x')).toHaveLength(1);
    expect(validateScoringConfig([1])).toHaveLength(1);
  });

  it('gameId 缺失 / 空串报错', () => {
    const errors = validateScoringConfig({ enabled: ['axis'] });
    expect(errors.some((e) => e.includes('gameId'))).toBe(true);

    const errors2 = validateScoringConfig({ gameId: '  ', enabled: ['axis'] });
    expect(errors2.some((e) => e.includes('gameId'))).toBe(true);
  });

  it('enabled 缺失 / 空数组 / 含未知策略 id 报错（六策略 id 拼写逐一正例）', () => {
    expect(validateScoringConfig({ gameId: 'g' }).some((e) => e.includes('enabled'))).toBe(true);
    expect(
      validateScoringConfig({ gameId: 'g', enabled: [] }).some((e) => e.includes('enabled')),
    ).toBe(true);
    expect(
      validateScoringConfig({ gameId: 'g', enabled: ['axisx'] }).some((e) =>
        e.includes('未知策略 id'),
      ),
    ).toBe(true);

    // 真实拼写：axis / dual / affinity / flag / faction / ideology 全部合法
    const errors = validateScoringConfig({
      gameId: 'g',
      enabled: ['axis', 'dual', 'affinity', 'flag', 'faction', 'ideology'],
    });
    expect(errors).toEqual([]);
  });

  it('axes：min >= max 报错；initial 越界报错；边界值与缺省 initial 通过', () => {
    const base = { gameId: 'g', enabled: ['axis'] };

    const badRange = validateScoringConfig({
      ...base,
      axes: { a: { label: 'A', min: 10, max: 10, visible: true } },
    });
    expect(badRange.some((e) => e.includes('轴 a') && e.includes('min < max'))).toBe(true);

    const badInitial = validateScoringConfig({
      ...base,
      axes: { a: { label: 'A', min: 0, max: 100, visible: true, initial: 101 } },
    });
    expect(badInitial.some((e) => e.includes('轴 a') && e.includes('initial'))).toBe(true);

    const ok = validateScoringConfig({
      ...base,
      axes: {
        a: { label: 'A', min: 0, max: 100, visible: true, initial: 0 },
        b: { label: 'B', min: -100, max: 100, visible: true, initial: 100 },
        c: { label: 'C', min: 0, max: 100, visible: true },
      },
    });
    expect(ok).toEqual([]);
  });

  it('npcs / factions / ideologies：非数组或含非字符串报错，缺省通过', () => {
    const base = { gameId: 'g', enabled: ['axis'] };
    expect(
      validateScoringConfig({ ...base, npcs: '孔子' }).some((e) => e.includes('npcs')),
    ).toBe(true);
    expect(
      validateScoringConfig({ ...base, factions: ['联邦', 1] }).some((e) => e.includes('factions')),
    ).toBe(true);
    expect(
      validateScoringConfig({ ...base, ideologies: [null] }).some((e) =>
        e.includes('ideologies'),
      ),
    ).toBe(true);
    expect(validateScoringConfig({ ...base, npcs: ['孔子'], factions: [], ideologies: [] })).toEqual(
      [],
    );
  });

  it('branches：when 为空报错、op 非法报错、goto 为空报错、flag 条件无 op 通过', () => {
    const base: ScoringConfig = { gameId: 'g', enabled: ['axis'] };

    const emptyWhen = validateScoringConfig({
      ...base,
      branches: [{ id: 'r1', when: [], goto: 'x' }],
    });
    expect(emptyWhen.some((e) => e.includes('branches[0].when'))).toBe(true);

    const badOp = validateScoringConfig({
      ...base,
      branches: [
        { id: 'r1', when: [{ kind: 'axis', id: 'a', op: '===', value: 1 }], goto: 'x' },
      ],
    });
    expect(badOp.some((e) => e.includes('op') && e.includes('==='))).toBe(true);

    const emptyGoto = validateScoringConfig({
      ...base,
      branches: [{ id: 'r1', when: [{ kind: 'flag', id: 'f' }], goto: '' }],
    });
    expect(emptyGoto.some((e) => e.includes('goto'))).toBe(true);

    // 五种 op 全合法 + flag 条件（无 op 字段）不误报
    const ok = validateScoringConfig({
      ...base,
      branches: [
        { id: 'r1', when: [{ kind: 'flag', id: 'f' }], goto: 'end_a' },
        { id: 'r2', when: [{ kind: 'axis', id: 'a', op: '>=', value: 1 }], goto: 'end_b' },
        { id: 'r3', when: [{ kind: 'axis', id: 'a', op: '<=', value: 2 }], goto: 'end_b' },
        { id: 'r4', when: [{ kind: 'axis', id: 'a', op: '>', value: 3 }], goto: 'end_b' },
        { id: 'r5', when: [{ kind: 'axis', id: 'a', op: '<', value: 4 }], goto: 'end_b' },
        { id: 'r6', when: [{ kind: 'axis', id: 'a', op: '==', value: 5 }], goto: 'end_b' },
      ],
    });
    expect(ok).toEqual([]);
  });

  it('多条错误逐条返回（消息数组，非首错即停）', () => {
    const errors = validateScoringConfig({
      gameId: '',
      enabled: ['nope'],
      branches: [{ id: 'r1', when: [], goto: ' ' }],
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors.some((e) => e.includes('gameId'))).toBe(true);
    expect(errors.some((e) => e.includes('未知策略 id'))).toBe(true);
    expect(errors.some((e) => e.includes('goto'))).toBe(true);
  });
});
