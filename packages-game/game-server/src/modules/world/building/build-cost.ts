import { CurrencyType } from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';

/** building_templates.build_cost 元素形状（契约见 S6） */
export interface BuildCostEntry {
  itemTemplateId?: string;
  currencyType?: string;
  amount: number;
}

/** 归一化后的扣减/补偿计划项 */
export interface DeductionPlanItem {
  kind: 'item' | 'currency';
  id: string;
  amount: number;
}

const CURRENCY_TYPES: ReadonlySet<string> = new Set(
  Object.values(CurrencyType) as string[],
);

/** 校验货币类型字符串属于 CurrencyType 枚举（运行时后收窄，非硬转绕过） */
export function assertCurrencyType(value: string): CurrencyType {
  if (!CURRENCY_TYPES.has(value)) {
    throw new GameException(ErrorCodes.PARAM_INVALID, '货币类型非法');
  }
  return value as CurrencyType;
}

/**
 * 解析并校验蓝图建造消耗。
 * 规则：每个元素必须恰有 itemTemplateId / currencyType 之一，amount 为正整数，
 * currencyType 必须是 CurrencyType 枚举值；任一非法抛 PARAM_INVALID。
 * 纯函数：零 IO、零 Nest 依赖。
 */
export function parseBuildCost(raw: unknown): BuildCostEntry[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new GameException(ErrorCodes.PARAM_INVALID, '建造消耗配置格式非法');
  }
  return raw.map((entry, idx) => {
    const at = `第 ${idx + 1} 项`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new GameException(
        ErrorCodes.PARAM_INVALID,
        `建造消耗${at}格式非法`,
      );
    }
    const e = entry as Record<string, unknown>;
    const itemId = typeof e.itemTemplateId === 'string' ? e.itemTemplateId : '';
    const currency =
      typeof e.currencyType === 'string' ? e.currencyType : '';
    const hasItem = itemId.length > 0;
    const hasCurrency = currency.length > 0;
    if (hasItem === hasCurrency) {
      throw new GameException(
        ErrorCodes.PARAM_INVALID,
        `建造消耗${at}必须且只能指定 itemTemplateId 或 currencyType`,
      );
    }
    const amount = e.amount;
    if (
      typeof amount !== 'number' ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      throw new GameException(
        ErrorCodes.PARAM_INVALID,
        `建造消耗${at}的 amount 必须为正整数`,
      );
    }
    if (hasCurrency) {
      assertCurrencyType(currency);
      return { currencyType: currency, amount };
    }
    return { itemTemplateId: itemId, amount };
  });
}

/** 生成扣减计划：保持原数组顺序（同输入同输出） */
export function planDeductions(cost: BuildCostEntry[]): DeductionPlanItem[] {
  return cost.map((entry) =>
    entry.itemTemplateId !== undefined
      ? { kind: 'item' as const, id: entry.itemTemplateId, amount: entry.amount }
      : {
          kind: 'currency' as const,
          id: entry.currencyType as string,
          amount: entry.amount,
        },
  );
}

/** 生成补偿计划：严格逆序（后扣的先退） */
export function planCompensations(
  done: DeductionPlanItem[],
): DeductionPlanItem[] {
  return [...done].reverse();
}