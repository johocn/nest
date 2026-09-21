import { DialogueActionType, QuestStatus } from '@constants/enums';
import { DialogueCondition, DialogueNode } from './dialogue.types';

/**
 * 对话条件求值与节点解析（S5，**纯函数，零 IO**）
 *
 * 设计要点（计划 §1.3 D2/D4）：
 *  - D2：`index` 必须是**原始 options 数组下标**，客户端只回 `optionIndex`，服务端不信任客户端给的 next；
 *  - D4：被条件挡掉的选项**不出现在结果里**（客户端看不到隐藏分支）；
 *  - 节点级 condition 不满足 → resolveNode 返回 null，调用方据此拒绝（DIALOGUE_CONDITION_NOT_MET）。
 *
 * 纯函数约束：不读 redis / 数据库，同输入必同输出。
 */

/** 玩家上下文（由 dialogue.service.buildContext 组装，解析器只消费） */
export interface DialogueContext {
  /** 玩家等级 */
  level: number;
  /** questTemplateId -> 任务状态 */
  questStatus: Map<string, QuestStatus>;
  /** itemTemplateId -> 持有数量 */
  itemCount: Map<string, number>;
  /** 已存在的旗标集合（键为旗标名，不含前缀） */
  flags: Set<string>;
}

/** 过滤后的选项视图（index = 原始 options 下标） */
export interface ResolvedOption {
  index: number;
  text: string;
  action?: DialogueActionType;
  next?: string;
}

/** 过滤后的节点视图 */
export interface ResolvedNode {
  key: string;
  speaker?: string;
  text: string;
  options: ResolvedOption[];
}

/** questStatus 条件字符串 → QuestStatus 精确映射 */
const QUEST_STATUS_ALIAS: Record<string, QuestStatus> = {
  accepted: QuestStatus.IN_PROGRESS,
  completed: QuestStatus.COMPLETED,
  claimed: QuestStatus.CLAIMED,
};

/**
 * 求值单个玩家级条件（节点与选项共用；全部可选，AND 语义）。
 * - minLevel：ctx.level >= minLevel
 * - questId：该任务有记录且状态 !== NOT_STARTED
 * - questStatus：配合 questId，精确等于映射后的状态（缺 questId 无法判定，忽略）
 * - notQuestId：该任务无记录或状态为 NOT_STARTED
 * - hasItemId：持有数量 > 0
 * - flag：ctx.flags 含该旗标
 * - 未识别的键：忽略（与 S4 的 condition 处理一致）
 * - undefined / {} → true
 */
export function matchCondition(
  cond: DialogueCondition | undefined,
  ctx: DialogueContext,
): boolean {
  if (!cond) return true;

  for (const [key, value] of Object.entries(cond)) {
    if (key === 'minLevel') {
      const minLevel = Number(value);
      if (!Number.isFinite(minLevel)) continue; // 非法值忽略
      if (ctx.level < minLevel) return false;
    } else if (key === 'questId') {
      const status = ctx.questStatus.get(String(value));
      if (!status || status === QuestStatus.NOT_STARTED) return false;
    } else if (key === 'questStatus') {
      const expected = QUEST_STATUS_ALIAS[String(value)];
      if (!expected) continue; // 未识别的状态值忽略
      const questId = cond.questId;
      if (questId === undefined || questId === null || questId === '') {
        continue; // 缺 questId 无法判定，忽略
      }
      if (ctx.questStatus.get(String(questId)) !== expected) return false;
    } else if (key === 'notQuestId') {
      const status = ctx.questStatus.get(String(value));
      if (status && status !== QuestStatus.NOT_STARTED) return false;
    } else if (key === 'hasItemId') {
      if (!((ctx.itemCount.get(String(value)) ?? 0) > 0)) return false;
    } else if (key === 'flag') {
      if (!ctx.flags.has(String(value))) return false;
    }
    // 其余键：忽略
  }
  return true;
}

/**
 * 解析某节点为「客户端可见视图」。
 * - 节点不存在 → null；
 * - 节点级条件不满足 → null；
 * - 选项级条件不满足 → 该选项被剔除（index 保持原始下标）。
 */
export function resolveNode(
  nodes: DialogueNode[],
  nodeKey: string,
  ctx: DialogueContext,
): ResolvedNode | null {
  const node = nodes.find((n) => n.key === nodeKey);
  if (!node) return null;
  if (!matchCondition(node.condition, ctx)) return null;

  const options: ResolvedOption[] = [];
  node.options.forEach((opt, index) => {
    if (!matchCondition(opt.condition, ctx)) return; // D4：隐藏被条件挡掉的选项
    const resolved: ResolvedOption = { index, text: opt.text };
    if (opt.action !== undefined) resolved.action = opt.action;
    if (opt.next !== undefined) resolved.next = opt.next;
    options.push(resolved);
  });

  const result: ResolvedNode = { key: node.key, text: node.text, options };
  if (node.speaker !== undefined) result.speaker = node.speaker;
  return result;
}

/**
 * 收集整棵对话树内所有 `condition.flag`（节点级 + 选项级，去重）。
 * 用途：buildContext 需要知道要探测哪些 redis 旗标（无旗标索引，无法枚举）。
 */
export function collectFlagKeys(nodes: DialogueNode[]): string[] {
  const flags = new Set<string>();
  for (const node of nodes) {
    const nodeFlag = node.condition?.flag;
    if (typeof nodeFlag === 'string' && nodeFlag !== '') flags.add(nodeFlag);
    for (const opt of node.options ?? []) {
      const optFlag = opt.condition?.flag;
      if (typeof optFlag === 'string' && optFlag !== '') flags.add(optFlag);
    }
  }
  return Array.from(flags);
}
