/**
 * ScoringConfig 校验器（admin create/update 前置，纯函数无依赖）。
 * 返回错误消息数组，空数组 = 通过。
 */
/** 引擎已注册的 6 种策略 id（与 strategies/*.strategy.ts 的 id 逐一对应） */
const STRATEGY_IDS = new Set(['axis', 'dual', 'affinity', 'flag', 'faction', 'ideology']);

/** 分支条件合法的比较符 */
const CONDITION_OPS = new Set(['>=', '<=', '>', '<', '==']);

const STRING_ARRAY_FIELDS: Array<[key: string, label: string]> = [
  ['npcs', 'npcs'],
  ['factions', 'factions'],
  ['ideologies', 'ideologies'],
];

export function validateScoringConfig(cfg: unknown): string[] {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return ['配置必须为对象'];
  }
  const errors: string[] = [];
  const c = cfg as Record<string, any>;

  if (typeof c.gameId !== 'string' || c.gameId.trim() === '') {
    errors.push('gameId 不能为空');
  }

  if (!Array.isArray(c.enabled) || c.enabled.length === 0) {
    errors.push('enabled 不能为空（须为非空策略 id 数组）');
  } else {
    for (const id of c.enabled) {
      if (!STRATEGY_IDS.has(id)) {
        errors.push(`enabled 含未知策略 id: ${id}（合法值 axis/dual/affinity/flag/faction/ideology）`);
      }
    }
  }

  if (c.axes != null) {
    if (typeof c.axes !== 'object' || Array.isArray(c.axes)) {
      errors.push('axes 必须为对象');
    } else {
      for (const [id, def] of Object.entries<Record<string, any>>(c.axes)) {
        const min = Number(def?.min);
        const max = Number(def?.max);
        if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max)) {
          errors.push(`轴 ${id} 的 min/max 非法（须为数字且 min < max）`);
          continue;
        }
        if (def?.initial != null) {
          const init = Number(def.initial);
          if (!Number.isFinite(init) || init < min || init > max) {
            errors.push(`轴 ${id} 的 initial 越界（须落在 [${min},${max}]）`);
          }
        }
      }
    }
  }

  for (const [key, label] of STRING_ARRAY_FIELDS) {
    const v = c[key];
    if (v != null && (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))) {
      errors.push(`${label} 必须为字符串数组`);
    }
  }

  if (c.branches != null) {
    if (!Array.isArray(c.branches)) {
      errors.push('branches 必须为数组');
    } else {
      c.branches.forEach((r: any, i: number) => {
        if (!Array.isArray(r?.when) || r.when.length === 0) {
          errors.push(`branches[${i}].when 不能为空`);
        } else {
          r.when.forEach((cond: any, j: number) => {
            if (!cond || typeof cond !== 'object') {
              errors.push(`branches[${i}].when[${j}] 必须为条件对象`);
              return;
            }
            // flag 条件无 op 字段；其余条件 op 必须合法
            if (cond.op != null && !CONDITION_OPS.has(cond.op)) {
              errors.push(`branches[${i}].when[${j}].op 非法: ${cond.op}（合法值 >=/<=/>/</==）`);
            }
          });
        }
        if (typeof r?.goto !== 'string' || r.goto.trim() === '') {
          errors.push(`branches[${i}].goto 不能为空`);
        }
      });
    }
  }

  return errors;
}
