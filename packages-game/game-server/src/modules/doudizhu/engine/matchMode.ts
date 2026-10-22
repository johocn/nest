/**
 * 局类型系统（纯逻辑，零框架依赖，可 vitest 测试）。
 *
 * 六种局，按「营销留客 + 公平」两条主线设计：
 *   免费零风险（只奖不扣）：休闲局 / 练习局 / 每日福利局 / 星光秀场
 *   花豆入场（有输有赢）：公平竞技局 / 押注局
 *
 * 公平性主线：辅助类属于「信息优势」，只允许出现在免费局（练习局）；
 * 凡涉及欢乐豆输赢的局（arena / stake）一律禁用辅助类，杜绝套利。
 */
import { PropDef, PropKind, PROP_KIND_NAME } from './props';

export type MatchMode =
  | 'casual'
  | 'practice'
  | 'daily'
  | 'showcase'
  | 'arena'
  | 'stake'
  | 'noshuffle';

/** 赔率规则：决定欢乐豆结算口径。 */
export type Payout =
  | 'rewardOnly'
  | 'rewardDouble'
  | 'stakeTimesMult'
  | 'stakeHalfTimesMult';

export interface MatchModeDef {
  mode: MatchMode;
  name: string;
  /** 本局允许使用的道具类别；空数组 = 禁用一切道具 */
  allowedKinds: PropKind[];
  /** 是否花欢乐豆入场（有输有赢） */
  isStake: boolean;
  payout: Payout;
  baseScore: number;
  /** 每日可进入次数上限（0 = 不限） */
  dailyLimit: number;
  desc: string;
}

// 顺序即选局面板的展示顺序（2 列网格），由 matchmode.spec.ts 锁定，调整需同步改测试
export const MATCH_MODES: MatchModeDef[] = [
  {
    mode: 'casual',
    name: '休闲局',
    allowedKinds: [],
    isStake: false,
    payout: 'rewardOnly',
    baseScore: 1,
    dailyLimit: 0,
    desc: '无道具 · 只奖不扣 · 零门槛',
  },
  {
    mode: 'practice',
    name: '练习局',
    allowedKinds: ['assist'],
    isStake: false,
    payout: 'rewardOnly',
    baseScore: 1,
    dailyLimit: 0,
    desc: '可用辅助道具 · 只奖不扣',
  },
  {
    mode: 'daily',
    name: '每日福利局',
    allowedKinds: [],
    isStake: false,
    payout: 'rewardDouble',
    baseScore: 1,
    dailyLimit: 3,
    desc: '无道具 · 奖励×2 · 每日 3 次',
  },
  {
    mode: 'showcase',
    name: '星光秀场',
    allowedKinds: ['cosmetic'],
    isStake: false,
    payout: 'rewardOnly',
    baseScore: 1,
    dailyLimit: 0,
    desc: '外观全开 · 只奖不扣',
  },
  {
    mode: 'arena',
    name: '公平竞技局',
    allowedKinds: [],
    isStake: true,
    payout: 'stakeTimesMult',
    baseScore: 2,
    dailyLimit: 0,
    desc: '无道具 · 花豆入场 · 赔率最高',
  },
  {
    mode: 'stake',
    name: '押注局',
    allowedKinds: ['gain'],
    isStake: true,
    payout: 'stakeHalfTimesMult',
    baseScore: 2,
    dailyLimit: 0,
    desc: '仅收益压注 · 花豆入场 · 有输有赢',
  },
  {
    mode: 'noshuffle',
    name: '不洗牌',
    allowedKinds: [],
    isStake: false,
    payout: 'rewardOnly',
    baseScore: 1,
    dailyLimit: 0,
    desc: '牌序固定 · 可记牌预测 · 只奖不扣',
  },
];

export const MODE_BY_ID: Record<MatchMode, MatchModeDef> = {} as Record<
  MatchMode,
  MatchModeDef
>;
for (const d of MATCH_MODES) MODE_BY_ID[d.mode] = d;

/** 花豆局的入场费档位。 */
export const ENTRY_FEES = [100, 300, 800];

export const DEFAULT_MODE: MatchMode = 'casual';

export function modeDef(mode: MatchMode): MatchModeDef {
  return MODE_BY_ID[mode] || MODE_BY_ID[DEFAULT_MODE];
}

export function modeName(mode: MatchMode): string {
  return modeDef(mode).name;
}

/** 该局是否允许某类道具（UI 决定按钮显隐）。 */
export function allowsKind(mode: MatchMode, kind: PropKind): boolean {
  return modeDef(mode).allowedKinds.indexOf(kind) >= 0;
}

/**
 * 使用前校验：强制「每局一类、同类可多张、跨类禁止」。
 * 返回 ok=false 时 reason 可直接展示给玩家。
 */
export function canUseProp(
  mode: MatchMode,
  prop: PropDef,
  usedThisRound: Record<string, number>,
): { ok: boolean; reason?: string } {
  const def = modeDef(mode);
  if (def.allowedKinds.indexOf(prop.kind) < 0) {
    return {
      ok: false,
      reason: `${def.name}不允许使用${PROP_KIND_NAME[prop.kind]}道具`,
    };
  }
  const used = usedThisRound[prop.id] || 0;
  if (prop.maxPerRound > 0 && used >= prop.maxPerRound) {
    return {
      ok: false,
      reason: `${prop.name}本局最多使用 ${prop.maxPerRound} 次`,
    };
  }
  return { ok: true };
}

/** 能否进入某局（花豆局需校验入场费与豆余额）。 */
export function canEnter(
  mode: MatchMode,
  beans: number,
  entryFee: number,
): { ok: boolean; reason?: string } {
  const def = modeDef(mode);
  if (!def.isStake) return { ok: true };
  if (entryFee <= 0) return { ok: false, reason: '请选择入场费档位' };
  if (beans < entryFee)
    return { ok: false, reason: `欢乐豆不足（需要 ${entryFee}）` };
  return { ok: true };
}

/** 每日次数是否还能进入（dailyLimit=0 不限）。 */
export function withinDailyLimit(mode: MatchMode, usedToday: number): boolean {
  const def = modeDef(mode);
  return def.dailyLimit <= 0 || usedToday < def.dailyLimit;
}
