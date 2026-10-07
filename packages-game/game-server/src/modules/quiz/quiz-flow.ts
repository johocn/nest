import { COMMON_SCOPE } from '@shared/content-scope';

export interface FlowItemInput {
  questionId: string;
  sortOrder: number;
  nextQuestionId: string | null;
  dimension: string | null;
  question: {
    id: string;
    code: string;
    kind: string;
    appScope: string;
    options: Array<{ goto?: string }>;
  };
}

export interface ScoringRuleInput {
  mode: 'total' | 'dimension';
  results?: Array<{ min: number; max: number; result: string }>;
  dims?: Array<{
    name: string;
    results: Array<{ min: number; max: number; result: string }>;
  }>;
}

export interface FlowValidationInput {
  items: FlowItemInput[];
  startQuestionId: string | null;
  scoringRule: ScoringRuleInput;
  assessmentScope: string;
  knownResultCodes: Set<string>;
}

/**
 * 测评卷流程连通性校验（纯函数，无 Nest 依赖）。
 * 规则：每选项一条出边（goto > nextQuestionId > sortOrder 下一题，末题出度 0 = 终点）；
 * 从起点可达子图内不允许环、每个可达节点必须存在到达出度 0 终点的路径；
 * 卷内仅 assessment 题、question scope 须为 common 或与卷一致、
 * scoring_rule 引用的 result code 必须存在于 knownResultCodes。
 * 返回错误列表；空数组 = 通过。
 */
export function validateAssessmentFlow(input: FlowValidationInput): string[] {
  const errors: string[] = [];
  const pushUnique = (msg: string): void => {
    if (!errors.includes(msg)) errors.push(msg);
  };

  const { items, startQuestionId, scoringRule, assessmentScope } = input;
  const knownResultCodes = input.knownResultCodes;

  if (items.length === 0) {
    return ['测评卷不能没有题目'];
  }

  // 结构唯一性：questionId / sortOrder
  const byId = new Map<string, FlowItemInput>();
  for (const item of items) {
    if (byId.has(item.questionId)) {
      pushUnique(`题目在卷内重复: ${item.questionId}`);
    } else {
      byId.set(item.questionId, item);
    }
  }
  const sortOrders = new Set<number>();
  for (const item of items) {
    if (sortOrders.has(item.sortOrder)) {
      pushUnique(`sortOrder 重复: ${item.sortOrder}`);
    }
    sortOrders.add(item.sortOrder);
  }

  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const byCode = new Map<string, FlowItemInput>();
  for (const item of sorted) {
    byCode.set(item.question.code, item);
  }

  // 题目 kind / scope
  for (const item of sorted) {
    if (item.question.kind !== 'assessment') {
      pushUnique(`题目 ${item.question.code} 不是测评题（kind=assessment）`);
    }
    if (
      item.question.appScope !== COMMON_SCOPE &&
      item.question.appScope !== assessmentScope
    ) {
      pushUnique(`题目 ${item.question.code} 的 appScope 与测评卷不匹配`);
    }
  }

  // 出边解析：每选项一条出边（goto > nextQuestionId > sortOrder 下一题）
  const nextByOrder = new Map<string, string | null>();
  for (let i = 0; i < sorted.length; i++) {
    nextByOrder.set(
      sorted[i].questionId,
      i + 1 < sorted.length ? sorted[i + 1].questionId : null,
    );
  }
  const edges = new Map<string, string[]>();
  for (const item of sorted) {
    const targets: string[] = [];
    const options = item.question.options ?? [];
    for (const option of options) {
      const goto = option?.goto;
      if (goto) {
        const target = byCode.get(goto);
        if (!target) {
          pushUnique(`选项跳转目标不存在: ${goto}`);
        } else {
          targets.push(target.questionId);
        }
      } else if (item.nextQuestionId != null) {
        const target = byId.get(item.nextQuestionId);
        if (!target) {
          pushUnique(
            `next_question_id 指向的题目不在卷内: ${item.nextQuestionId}`,
          );
        } else {
          targets.push(target.questionId);
        }
      } else {
        const fallback = nextByOrder.get(item.questionId);
        if (fallback) targets.push(fallback);
      }
    }
    edges.set(item.questionId, targets);
  }

  // 起点：显式 start_question_id，否则 sortOrder 最小题
  let startId: string | null = null;
  if (startQuestionId != null) {
    if (!byId.has(startQuestionId)) {
      pushUnique(`start_question_id 不在卷内: ${startQuestionId}`);
    } else {
      startId = startQuestionId;
    }
  } else {
    startId = sorted[0].questionId;
  }

  if (startId) {
    // 环检测（仅起点可达子图）
    const visited = new Set<string>();
    const onStack = new Set<string>();
    const codeOf = (id: string): string => byId.get(id)?.question.code ?? id;
    const dfs = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);
      onStack.add(id);
      for (const target of edges.get(id) ?? []) {
        if (onStack.has(target)) {
          pushUnique(`题目存在循环跳转: ${codeOf(target)}`);
        } else {
          dfs(target);
        }
      }
      onStack.delete(id);
    };
    dfs(startId);

    // 每个可达节点必须存在到达出度 0 终点的路径
    const reachMemo = new Map<string, boolean>();
    const reachesEnd = (id: string): boolean => {
      const memo = reachMemo.get(id);
      if (memo !== undefined) return memo;
      reachMemo.set(id, false); // 环回保护
      const targets = edges.get(id) ?? [];
      const ok =
        targets.length === 0 || targets.some((t) => reachesEnd(t));
      reachMemo.set(id, ok);
      return ok;
    };
    for (const id of visited) {
      if (!reachesEnd(id)) {
        pushUnique(`题目 ${codeOf(id)} 无法到达终点`);
      }
    }
  }

  // scoring_rule 引用的 result code 必须存在
  const referencedResults: string[] = [];
  if (scoringRule?.mode === 'dimension') {
    for (const dim of scoringRule.dims ?? []) {
      if (!dim?.name) {
        pushUnique('维度计分缺少维度名称');
      }
      for (const r of dim?.results ?? []) {
        referencedResults.push(r.result);
      }
    }
  } else {
    for (const r of scoringRule?.results ?? []) {
      referencedResults.push(r.result);
    }
  }
  for (const resultCode of referencedResults) {
    if (!knownResultCodes.has(resultCode)) {
      pushUnique(`计分规则引用了不存在的结果: ${resultCode}`);
    }
  }

  return errors;
}
