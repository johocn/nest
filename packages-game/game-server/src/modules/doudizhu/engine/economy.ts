/**
 * 经济层（纯逻辑，零 UI 依赖，可 vitest 测试）。
 *
 * 双货币：
 *   points 积分——累计段位分，只增不减、不可消费、不可兑豆
 *   beans  欢乐豆——可消费软货币，花豆局有输有赢
 *
 * 结算唯一入口：settleRound()，由 DoudizhuMain.showResult() 调用一次
 * （沿用 shownResult 防重），严禁在别处二次结算。
 */
import { MatchMode, modeDef } from './matchMode';
import { multiplierBonus } from './props';

export interface CurrencyProfile {
  points: number;
  beans: number;
}

export interface SettleInput {
  mode: MatchMode;
  win: boolean;
  /** 本局倍数（明牌等已计入 game 的 multiplier） */
  multiplier: number;
  isLandlord: boolean;
  /** game.scores[HUMAN]：每局结算分，有正有负 */
  roundScore: number;
  /** 结算后的连胜数（0 表示未连胜） */
  streak: number;
  /** 本局已用道具 id → 张数 */
  propsUsed: Record<string, number>;
  /** 花豆局入场费（已在进入时扣除），非花豆局为 0 */
  entryFee: number;
  /** 今日已获得的豆（用于每日收益上限，可选） */
  dailyEarned?: number;
}

export interface SettleResult {
  pointsGain: number; // 积分增量（只增不减）
  beansDelta: number; // 欢乐豆增量（可为负，结算后不低于 0）
  tierUp: boolean; // 是否段位晋升
  pointsAfter: number;
  beansAfter: number;
}

// ---------------- 段位 ----------------

export const TIER_THRESHOLDS = [0, 100, 300, 800, 2000];
export const TIER_NAMES = ['青铜', '白银', '黄金', '钻石', '大师'];

export function tierOf(points: number): number {
  let t = 0;
  for (let i = 0; i < TIER_THRESHOLDS.length; i++) {
    if (points >= TIER_THRESHOLDS[i]) t = i;
  }
  return t;
}

export function tierName(tier: number): string {
  const i = Math.max(0, Math.min(TIER_NAMES.length - 1, tier));
  return TIER_NAMES[i];
}

/** 下一段位门槛；已满级返回 -1。 */
export function nextTierAt(points: number): number {
  const t = tierOf(points);
  return t + 1 < TIER_THRESHOLDS.length ? TIER_THRESHOLDS[t + 1] : -1;
}

// ---------------- 防刷上限 / 固定奖励 ----------------

/** 单局豆收益上限 */
export const ROUND_GAIN_CAP = 500;
/** 每日豆收益上限 */
export const DAILY_GAIN_CAP = 2000;
/** 段位晋升一次性奖励 */
export const TIER_UP_BEANS = 300;

/** 连续签到 7 天循环奖励 */
export const SIGNIN_REWARDS = [50, 80, 120, 160, 200, 260, 300];

export function signinReward(dayIndex: number): number {
  const i = ((dayIndex % 7) + 7) % 7;
  return SIGNIN_REWARDS[i];
}

/** 连胜奖励：2 连 +30 / 3 连 +60 / ≥4 连 +100 */
export function streakBeans(streak: number): number {
  if (streak >= 4) return 100;
  if (streak === 3) return 60;
  if (streak === 2) return 30;
  return 0;
}

/** 连败安慰：每局 +40，每日上限 3 次 */
export const LOSS_CONSOLATION = 40;
export const LOSS_CONSOLATION_DAILY_LIMIT = 3;

/** 破产保护：豆低于阈值时补助到目标值 */
export const BANKRUPT_THRESHOLD = 100;
export const BANKRUPT_TARGET = 200;

export function bankruptcyAid(beans: number): number {
  return beans < BANKRUPT_THRESHOLD ? Math.max(0, BANKRUPT_TARGET - beans) : 0;
}

// ---------------- 结算公式 ----------------

/** 免费局（只奖不扣）的对局奖励：胜 +30×倍率（地主 ×1.5），负 +5 保底。 */
function rewardBeans(
  win: boolean,
  multiplier: number,
  isLandlord: boolean,
): number {
  if (!win) return 5;
  const base = Math.round(30 * multiplier * (isLandlord ? 1.5 : 1));
  return Math.max(5, base);
}

/** 积分增量：胜局 +max(0, roundScore) + 连胜奖励；输了不加分，只增不减。 */
export function computePointsGain(input: SettleInput): number {
  let p = 0;
  if (input.win) p += Math.max(0, input.roundScore);
  p += 2 * Math.max(0, input.streak);
  return Math.max(0, Math.round(p));
}

/** 欢乐豆增量（未含上限截断）。 */
export function computeBeansDelta(input: SettleInput): number {
  const def = modeDef(input.mode);
  const mult = input.multiplier * multiplierBonus(input.propsUsed);

  switch (def.payout) {
    case 'rewardOnly':
      return rewardBeans(input.win, mult, input.isLandlord);
    case 'rewardDouble':
      return rewardBeans(input.win, mult, input.isLandlord) * 2;
    case 'stakeTimesMult':
      // 公平竞技局：无道具、赔率最高
      return input.win ? Math.round(input.entryFee * mult) : -input.entryFee;
    case 'stakeHalfTimesMult': {
      // 押注局：基础赔率减半，可用翻倍卡放大；保险卡免除输局损失
      if (input.win) return Math.round(input.entryFee * (mult / 2));
      const insured = (input.propsUsed['insure'] || 0) > 0;
      return insured ? 0 : -input.entryFee;
    }
    default:
      return 0;
  }
}

/** 统一结算：积分累加 + 豆增减 + 上限截断 + 段位晋升判定。 */
export function settleRound(
  cur: CurrencyProfile,
  input: SettleInput,
): SettleResult {
  const pointsGain = computePointsGain(input);

  let beansDelta = computeBeansDelta(input);

  // 单局收益上限（只截断增益，亏损不截断）
  if (beansDelta > ROUND_GAIN_CAP) beansDelta = ROUND_GAIN_CAP;

  // 每日收益上限（只截断增益）
  if (beansDelta > 0 && typeof input.dailyEarned === 'number') {
    const remain = Math.max(0, DAILY_GAIN_CAP - input.dailyEarned);
    if (beansDelta > remain) beansDelta = remain;
  }

  const pointsAfter = cur.points + pointsGain;
  const beansAfter = Math.max(0, cur.beans + beansDelta);
  const tierUp = tierOf(pointsAfter) > tierOf(cur.points);

  return { pointsGain, beansDelta, tierUp, pointsAfter, beansAfter };
}
