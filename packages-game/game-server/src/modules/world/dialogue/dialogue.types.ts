import { DialogueActionType } from '@constants/enums';

/**
 * 对话树类型与结构校验（S5，纯函数，不依赖 Nest/TypeORM）
 * 节点形状：{ key, speaker?, text, condition?, options: [{ text, condition?, next?, action?, actionArgs? }] }
 * 注意：`condition` 可出现在**节点与选项两处**（计划 §1.1 缺口 #4 要求「节点与选项」都支持条件）：
 *   - 节点级 condition 不满足 → 整个节点不可进入；
 *   - 选项级 condition 不满足 → 该选项不出现在下发给客户端的 options 里（服务端过滤，客户端看不到隐藏分支）。
 * 风险 #3：每个节点必须至少有一个**不带 condition**（或 condition 为空对象）的选项，
 * 否则条件全挡时对话会卡死；该约束由 assertDialogueNodes 静态校验。
 */

/** 对话选项 */
export interface DialogueOption {
  /** 选项文本 */
  text: string;
  /** 选项级玩家条件：不满足则该选项对玩家不可见 */
  condition?: DialogueCondition;
  /** 下一节点 key；为空/undefined 表示对话结束 */
  next?: string;
  /** 评分分支：选中后按评分规则跳转——命中 → goto 节点 key，未命中 → fallback（缺省 = 结束对话）；与 next 互斥 */
  branch?: { gameId: string; fallback?: string };
  /** 选中后由服务端执行的动作 */
  action?: DialogueActionType;
  /** 动作参数 */
  actionArgs?: Record<string, any>;
}

/** 评分快照（由 scoring 模块产出，结构对齐 ScoreSnapshot） */
export interface DialogueScoreSnapshot {
  axes: Record<string, number>;
  flags: string[];
  affinity: Record<string, number>;
  reputation: Record<string, number>;
  ideology: Record<string, number>;
}

/** 评分条件（引用某游戏的评分快照，详见 scoring 模块） */
export interface DialogueScoreCondition {
  gameId: string;
  axesMin?: Record<string, number>;
  flags?: string[];
  affinityMin?: Record<string, number>;
  reputationMin?: Record<string, number>;
  ideologyMin?: Record<string, number>;
}

/** 玩家级条件（节点与选项共用，全部可选，AND 语义） */
export interface DialogueCondition {
  minLevel?: number;
  questId?: string;
  questStatus?: 'accepted' | 'completed' | 'claimed';
  notQuestId?: string;
  hasItemId?: string;
  flag?: string;
  /** 评分条件：引用某游戏的评分快照做分支门控 */
  score?: DialogueScoreCondition;
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
  assessmentCode?: string; // assess 用：测评卷 code
  category?: string; // quiz 用：抽题分类（可选）
  count?: number; // quiz 用：抽题数量（可选，服务端钳制 1-20）
  /** 评分动作参数：把 Effect 交给评分引擎（gameId 必填，effect 为增量，use 可裁剪策略） */
  score?: { gameId: string; effect?: Record<string, any>; use?: string[] };
}

/** 对话动作附带数据（choose 响应的可选 quiz 字段；payload 均已脱敏） */
export type DialogueQuizHandout =
  | { kind: 'knowledge'; questions: Array<Record<string, any>> }
  | { kind: 'assessment'; sessionId: string; question: Record<string, any> };

/** 结构校验结果 */
export type DialogueNodesAssertResult =
  | { ok: true; nodes: DialogueNode[] }
  | { ok: false; errors: string[] };

/** 动作白名单（与 DialogueActionType 取值一致） */
const ACTION_WHITELIST: readonly string[] = Object.values(DialogueActionType);

function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 是否为「无条件」：未设置、为 null，或为空对象（空对象在求值时恒为 true） */
function isUnconditional(condition: unknown): boolean {
  return (
    condition === undefined ||
    condition === null ||
    (isPlainObject(condition) && Object.keys(condition).length === 0)
  );
}

/**
 * 校验对话树结构（纯函数，不抛异常，返回结构化错误列表）
 * 规则：
 *  1. 顶层必须是非空数组；
 *  2. 每个节点必须是对象，key 为非空字符串且不重复，text 为字符串，options 为数组；
 *  3. 每个选项必须是对象且 text 为字符串；next 若存在必须指向树内已存在的 key；
 *  4. action 若存在必须在 DialogueActionType 白名单内；
 *  5. 每个节点必须至少有一个**不带 condition** 的选项（风险 #3：防止条件全挡导致对话卡死）；
 *  6. branch 若存在必须是对象：gameId 为非空字符串、fallback 为缺省（undefined/null）或非空字符串、与 next 互斥。
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

  // 第二遍：校验选项内容、next 指向、action 白名单与「至少一个无条件选项」
  nodes.forEach((raw, i) => {
    if (!isPlainObject(raw) || !Array.isArray(raw.options)) return;
    const key =
      typeof raw.key === 'string' && raw.key.trim() !== '' ? raw.key : `#${i}`;

    let hasUnconditional = false;
    raw.options.forEach((rawOpt: any, j: number) => {
      const optLabel = `节点[${key}].options[${j}]`;
      if (!isPlainObject(rawOpt)) {
        errors.push(`${optLabel}: 必须是对象`);
        return;
      }
      if (typeof rawOpt.text !== 'string') {
        errors.push(`${optLabel}: text 必须是字符串`);
      }
      if (isUnconditional(rawOpt.condition)) {
        hasUnconditional = true;
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

      // 评分分支：gameId 必填；fallback 缺省（undefined/null）或非空字符串；与 next 互斥
      const branch = rawOpt.branch;
      if (branch !== undefined && branch !== null) {
        if (!isPlainObject(branch)) {
          errors.push(`${optLabel}: branch 必须是对象`);
        } else {
          if (typeof branch.gameId !== 'string' || branch.gameId.trim() === '') {
            errors.push(`${optLabel}: branch.gameId 必须是非空字符串`);
          }
          const fallback = branch.fallback;
          if (
            fallback !== undefined &&
            fallback !== null &&
            (typeof fallback !== 'string' || fallback.trim() === '')
          ) {
            errors.push(`${optLabel}: branch.fallback 必须是非空字符串或缺省`);
          }
        }
        if (next !== undefined && next !== null && next !== '') {
          errors.push(`${optLabel}: branch 与 next 互斥，不能同时配置`);
        }
      }
    });

    // 风险 #3：条件全挡时对话会卡死，必须保留至少一个无条件选项
    if (raw.options.length > 0 && !hasUnconditional) {
      errors.push(
        `节点[${key}]: 每个节点至少需要一个不带 condition 的选项（防止条件过滤后选项全隐藏导致对话卡死）`,
      );
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, nodes: nodes as DialogueNode[] };
}
