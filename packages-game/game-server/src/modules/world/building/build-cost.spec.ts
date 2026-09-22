import { ErrorCodes } from '@constants/error-codes';
import {
  BuildCostEntry,
  DeductionPlanItem,
  assertCurrencyType,
  parseBuildCost,
  planCompensations,
  planDeductions,
} from './build-cost';

async function expectGameCode(
  fn: () => unknown,
  code: number,
): Promise<void> {
  expect(fn).toThrow(
    expect.objectContaining({ response: expect.objectContaining({ code }) }),
  );
}

describe('build-cost（纯函数）', () => {
  describe('parseBuildCost', () => {
    it('合法：道具项与货币项混合解析', () => {
      expect(
        parseBuildCost([
          { itemTemplateId: '10', amount: 3 },
          { currencyType: 'gold', amount: 100 },
        ]),
      ).toEqual([
        { itemTemplateId: '10', amount: 3 },
        { currencyType: 'gold', amount: 100 },
      ]);
    });

    it('空/未配置返回空数组', () => {
      expect(parseBuildCost([])).toEqual([]);
      expect(parseBuildCost(null)).toEqual([]);
      expect(parseBuildCost(undefined)).toEqual([]);
    });

    it('非数组抛 PARAM_INVALID', () => {
      expectGameCode(() => parseBuildCost({ itemTemplateId: '1' }), ErrorCodes.PARAM_INVALID);
    });

    it('缺 amount 抛 PARAM_INVALID', () => {
      expectGameCode(
        () => parseBuildCost([{ itemTemplateId: '10' }]),
        ErrorCodes.PARAM_INVALID,
      );
    });

    it('amount<=0 或非整数抛 PARAM_INVALID', () => {
      expectGameCode(
        () => parseBuildCost([{ itemTemplateId: '10', amount: 0 }]),
        ErrorCodes.PARAM_INVALID,
      );
      expectGameCode(
        () => parseBuildCost([{ currencyType: 'gold', amount: -5 }]),
        ErrorCodes.PARAM_INVALID,
      );
      expectGameCode(
        () => parseBuildCost([{ currencyType: 'gold', amount: 1.5 }]),
        ErrorCodes.PARAM_INVALID,
      );
    });

    it('同时给 itemTemplateId 与 currencyType 抛 PARAM_INVALID', () => {
      expectGameCode(
        () =>
          parseBuildCost([
            { itemTemplateId: '10', currencyType: 'gold', amount: 1 },
          ]),
        ErrorCodes.PARAM_INVALID,
      );
    });

    it('两者都不给抛 PARAM_INVALID', () => {
      expectGameCode(
        () => parseBuildCost([{ amount: 1 }]),
        ErrorCodes.PARAM_INVALID,
      );
    });

    it('currencyType 不在枚举内抛 PARAM_INVALID（不硬转绕过）', () => {
      expectGameCode(
        () => parseBuildCost([{ currencyType: 'bitcoin', amount: 1 }]),
        ErrorCodes.PARAM_INVALID,
      );
    });
  });

  describe('assertCurrencyType', () => {
    it('枚举值通过', () => {
      expect(assertCurrencyType('gold')).toBe('gold');
      expect(assertCurrencyType('bound_diamond')).toBe('bound_diamond');
    });

    it('非法值抛 PARAM_INVALID', () => {
      expectGameCode(() => assertCurrencyType('bitcoin'), ErrorCodes.PARAM_INVALID);
    });
  });

  describe('planDeductions', () => {
    it('保持数组原顺序', () => {
      const cost: BuildCostEntry[] = [
        { itemTemplateId: '10', amount: 3 },
        { currencyType: 'gold', amount: 100 },
        { itemTemplateId: '11', amount: 1 },
      ];
      expect(planDeductions(cost)).toEqual([
        { kind: 'item', id: '10', amount: 3 },
        { kind: 'currency', id: 'gold', amount: 100 },
        { kind: 'item', id: '11', amount: 1 },
      ]);
    });

    it('同输入同输出（确定性）', () => {
      const cost: BuildCostEntry[] = [
        { itemTemplateId: '10', amount: 3 },
        { currencyType: 'gold', amount: 100 },
      ];
      expect(planDeductions(cost)).toEqual(planDeductions(cost));
      expect(planDeductions(parseBuildCost(cost))).toEqual(
        planDeductions(parseBuildCost(cost)),
      );
    });
  });

  describe('planCompensations', () => {
    it('逆序返回补偿计划且不改动入参', () => {
      const done: DeductionPlanItem[] = [
        { kind: 'item', id: '10', amount: 3 },
        { kind: 'currency', id: 'gold', amount: 100 },
        { kind: 'item', id: '11', amount: 1 },
      ];
      expect(planCompensations(done)).toEqual([
        { kind: 'item', id: '11', amount: 1 },
        { kind: 'currency', id: 'gold', amount: 100 },
        { kind: 'item', id: '10', amount: 3 },
      ]);
      // 原数组顺序不变
      expect(done.map((d) => d.id)).toEqual(['10', 'gold', '11']);
    });
  });
});