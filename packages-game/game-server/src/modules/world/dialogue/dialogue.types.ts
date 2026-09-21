import { DialogueActionType } from '@constants/enums';

/**
 * 对话树类型与结构校验（S5，纯函数，不依赖 Nest/TypeORM）
 * 节点形状：{ key, speaker?, text, condition?, options: [{ text, next?, action?, actionArgs? }] }
 * 注意：condition 是**节点级**条件，选项本身没有 condition 字段（以计划 §1.4 结构为准）。
 */

/** 对话选项 */
export interface DialogueOption {
  /** 选项文本 */
  text: string;
  /** 下一节点 key；为空/undefined 表示对话结束 */
  next?: string;
  /** 选中后由服务端执行的动作 */
  action?: DialogueActionType;
  /** 动作参数 */
  actionArgs?: Record<string, any>;
}

/** 玩家级节点条件（全部可选，AND 语义） */
export interface DialogueCondition {
  minLevel?: number;
  questId?: string;
  questStatus?: 'accepted' | 'completed' | 'claimed';
  notQuestId?: string;
  hasItemId?: string;
  flag?: string;
}

/** 对话节点 */
export interface DialogueNode {
  key: string;
  speaker?: string;
  text: string;
  condition?: DialogueCondition;
  options: DialogueOption[];
}

/** 动作参数（各动作按需取用） */
export interface DialogueActionArgs {
  questTemplateId?: string;
  itemTemplateId?: string;
  quantity?: number;
  currencyType?: string;
  amount?: number;
  flag?: string;
}

/** 结构校验结果 */
export type DialogueNodesAssertResult =
  | { ok: true; nodes: DialogueNode[] }
  | { ok: false; errors: string[] };

/** 动作白名单（与 DialogueActionType 取值一致） */
const ACTION_WHITELIST: readonly string[] = Object.values(DialogueActionType);

function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 校验对话树结构（纯函数，不抛异常，返回结构化错误列表）
 * 规则：
 *  1. 顶层必须是非空数组；
 *  2. 每个节点必须是对象，key 为非空字符串且不重复，text 为字符串，options 为数组；
 *  3. 每个选项必须是对象且 text 为字符串；next 若存在必须指向树内已存在的 key；
 *  4. action 若存在必须在 DialogueActionType 白名单内。
 *
 * 关于风险 #3（「每个节点必须至少有一个无条件选项」）：计划 §1.4 中 condition 位于**节点**上、
 * 选项本身没有 condition 字段，因此「无条件选项」无法静态判定。本函数退化为校验
 * **每个节点 options 非空**；「条件过滤后可见选项为空」的运行时兜底见 Task 2 解析器 / Task 3 choose。
 */
export function assertDialogueNodes(nodes: unknown): DialogueNodesAssertResult {
  if (!Array.isArray(nodes)) {
    return { ok: false, errors: ['nodes 必须是数组'] };
  }
  if (nodes.length === 0) {
    return { ok: false, errors: ['nodes 不能为空数组'] };
  }

  const errors: string[] = [];
  const keys = new Set<string>();

  // 第一遍：校验节点骨架并收集全部 key（next 允许前向引用）
  nodes.forEach((raw, i) => {
    if (!isPlainObject(raw)) {
      errors.push(`节点#${i}: 必须是对象`);
      return;
    }
    const key = raw.key;
    const label =
      typeof key === 'string' && key.trim() !== '' ? `节点[${key}]` : `节点#${i}`;

    if (typeof key !== 'string' || key.trim() === '') {
      errors.push(`${label}: key 必须是非空字符串`);
    } else if (keys.has(key)) {
      errors.push(`${label}: key 重复`);
    } else {
      keys.add(key);
    }

    if (typeof raw.text !== 'string') {
      errors.push(`${label}: text 必须是字符串`);
    }

    if (!Array.isArray(raw.options)) {
      errors.push(`${label}: options 必须是数组`);
      return;
    }
    if (raw.options.length === 0) {
      errors.push(`${label}: options 不能为空（每个节点至少需要一个选项）`);
    }
  });

  // 第二遍：校验选项内容、next 指向与 action 白名单
  nodes.forEach((raw, i) => {
    if (!isPlainObject(raw) || !Array.isArray(raw.options)) return;
    const key =
      typeof raw.key === 'string' && raw.key.trim() !== '' ? raw.key : `#${i}`;

    raw.options.forEach((rawOpt: any, j: number) => {
      const optLabel = `节点[${key}].options[${j}]`;
      if (!isPlainObject(rawOpt)) {
        errors.push(`${optLabel}: 必须是对象`);
        return;
      }
      if (typeof rawOpt.text !== 'string') {
        errors.push(`${optLabel}: text 必须是字符串`);
      }

      const next = rawOpt.next;
      if (next !== undefined && next !== null && next !== '') {
        if (typeof next !== 'string') {
          errors.push(`${optLabel}: next 必须是字符串`);
        } else if (!keys.has(next)) {
          errors.push(`${optLabel}: next 指向不存在的节点 key「${next}」`);
        }
      }

      const action = rawOpt.action;
      if (action !== undefined && action !== null && action !== '') {
        if (typeof action !== 'string' || !ACTION_WHITELIST.includes(action)) {
          errors.push(
            `${optLabel}: action「${String(action)}」不在 DialogueActionType 白名单内`,
          );
        }
      }
    });
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, nodes: nodes as DialogueNode[] };
}
