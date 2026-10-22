/**
 * 道具体系（纯逻辑，零框架依赖，可 vitest 测试）。
 *
 * 三层：
 *   assist   辅助类——信息/容错，仅在「练习局」可用（涉及欢乐豆的局视为作弊，一律禁用）
 *   gain     收益压注类——影响豆结算，仅在「押注局」可用
 *   cosmetic 外观类——永久买断，任意局均生效（不占「每局一类」配额）
 *
 * 叠加规则：每局只能使用「一类」道具（由 matchMode.allowedKinds 锁定），
 * 同类内可多张，按 stack 策略叠加：
 *   multiply 倍率相乘（明牌翻倍卡：n 张 → ×2^n）
 *   add      等级累加（记牌器增强）
 *   once     多张只生效 1 张（保险卡），其余不产生额外效果
 */

export type PropKind = 'assist' | 'gain' | 'cosmetic';
export type StackMode = 'multiply' | 'add' | 'once';

export interface PropDef {
  id: string;
  name: string;
  kind: PropKind;
  /** 欢乐豆定价（cosmetic 为买断价） */
  price: number;
  /** 同类多张时的叠加策略 */
  stack: StackMode;
  /** 本局同类内最大使用张数（0 = 不可在对局内使用，如外观） */
  maxPerRound: number;
  desc: string;
}

export const PROP_KIND_NAME: Record<PropKind, string> = {
  assist: '辅助',
  gain: '收益压注',
  cosmetic: '外观',
};

export const PROPS: PropDef[] = [
  // ---- 辅助类（仅练习局）----
  {
    id: 'counter',
    name: '记牌器增强',
    kind: 'assist',
    price: 150,
    stack: 'add',
    maxPerRound: 2,
    desc: '本局显示剩余牌明细，可叠加为全局明细',
  },
  {
    id: 'peek',
    name: '偷看底牌',
    kind: 'assist',
    price: 120,
    stack: 'once',
    maxPerRound: 1,
    desc: '叫地主阶段查看 3 张底牌',
  },
  {
    id: 'undo',
    name: '悔棋',
    kind: 'assist',
    price: 200,
    stack: 'once',
    maxPerRound: 1,
    desc: '撤销自己上一次出牌并回到自己回合',
  },
  // ---- 收益压注类（仅押注局）----
  {
    id: 'double',
    name: '明牌翻倍卡',
    kind: 'gain',
    price: 300,
    stack: 'multiply',
    maxPerRound: 2,
    desc: '本局倍率 ×2，可叠加（最多 2 张）',
  },
  {
    id: 'insure',
    name: '保险卡',
    kind: 'gain',
    price: 250,
    stack: 'once',
    maxPerRound: 1,
    desc: '本局输了不扣欢乐豆，多张只生效 1 张',
  },
  // ---- 外观类（永久买断，任意局生效）----
  {
    id: 'emote',
    name: '豪华表情包',
    kind: 'cosmetic',
    price: 600,
    stack: 'once',
    maxPerRound: 0,
    desc: '解锁额外表情贴纸',
  },
  {
    id: 'frame',
    name: '头像框',
    kind: 'cosmetic',
    price: 1500,
    stack: 'once',
    maxPerRound: 0,
    desc: '头像金框装饰',
  },
];

/** id → 定义（用循环构建，避免 Object.fromEntries 的 ES2019 依赖）。 */
export const PROPS_BY_ID: Record<string, PropDef> = {};
for (const p of PROPS) PROPS_BY_ID[p.id] = p;

export function propById(id: string): PropDef | null {
  return PROPS_BY_ID[id] || null;
}

/** 按类别取道具列表（UI 商店分组用）。 */
export function propsOfKind(kind: PropKind): PropDef[] {
  return PROPS.filter((p) => p.kind === kind);
}

/** 本局道具带来的倍率修正：所有 multiply 道具按 maxPerRound 截断后相乘。 */
export function multiplierBonus(used: Record<string, number>): number {
  let m = 1;
  for (const id in used) {
    const p = PROPS_BY_ID[id];
    if (!p || p.stack !== 'multiply') continue;
    const n = Math.min(used[id] || 0, p.maxPerRound);
    m *= Math.pow(2, n);
  }
  return m;
}

/** 本局是否用了某类叠加策略的道具（保险卡判定用）。 */
export function usedStack(
  used: Record<string, number>,
  stack: StackMode,
): boolean {
  for (const id in used) {
    const p = PROPS_BY_ID[id];
    if (p && p.stack === stack && (used[id] || 0) > 0) return true;
  }
  return false;
}

/** 本局已用道具总张数（UI 展示用）。 */
export function usedCount(used: Record<string, number>): number {
  let n = 0;
  for (const id in used) n += used[id] || 0;
  return n;
}
