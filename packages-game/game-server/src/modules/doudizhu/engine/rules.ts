/**
 * 斗地主规则引擎（纯逻辑，零框架依赖）。
 * 牌型类别：
 *   rocket          火箭（双王，最大）
 *   bomb            炸弹（四张同点）
 *   single / pair / trio
 *   trio_single     三带一
 *   trio_pair       三带二（三带一对）
 *   straight        单顺（>=5 连续单，不含 2/王）
 *   straight_pair   连对（>=3 连续对，不含 2/王）
 *   plane           飞机（>=2 连续三张，不带翼）
 *   plane_single    飞机带单翼（k 个三张 + k 张单）
 *   plane_pair      飞机带对翼（k 个三张 + k 个对）
 *   four_two_single 四带二单
 *   four_two_pair   四带二对
 * identify() 返回 { type, rank, length }，rank 为比较主值（顺子/连对/飞机取最大点），
 * length 仅用于顺子/连对/飞机系列（比较时要求相等）。
 */

import { Card, countByRank } from './cards';

export interface CardType {
  type: string;
  rank: number;
  length: number;
}

function isSeq(ranks: number[]): boolean {
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

export function identify(cards: Card[]): CardType | null {
  if (!cards || cards.length === 0) return null;
  const n = cards.length;
  const cnt = countByRank(cards);
  const ranks = Object.keys(cnt)
    .map(Number)
    .sort((a, b) => a - b);
  const maxR = ranks[ranks.length - 1];

  // 火箭
  if (n === 2 && cnt[16] === 1 && cnt[17] === 1)
    return { type: 'rocket', rank: 100, length: 1 };
  // 炸弹
  if (n === 4 && ranks.length === 1)
    return { type: 'bomb', rank: ranks[0], length: 1 };
  // 单 / 对 / 三
  if (n === 1) return { type: 'single', rank: ranks[0], length: 1 };
  if (n === 2 && ranks.length === 1)
    return { type: 'pair', rank: ranks[0], length: 1 };
  if (n === 3 && ranks.length === 1)
    return { type: 'trio', rank: ranks[0], length: 1 };
  // 三带一
  if (n === 4) {
    const t3 = ranks.filter((r) => cnt[r] === 3);
    if (t3.length === 1 && ranks.length === 2)
      return { type: 'trio_single', rank: t3[0], length: 1 };
    return null;
  }
  // 三带二
  if (n === 5) {
    const t35 = ranks.filter((r) => cnt[r] === 3);
    const p25 = ranks.filter((r) => cnt[r] === 2);
    if (t35.length === 1 && p25.length === 1)
      return { type: 'trio_pair', rank: t35[0], length: 1 };
  }

  const singles = ranks.filter((r) => cnt[r] === 1);
  const pairs = ranks.filter((r) => cnt[r] === 2);
  const trios = ranks.filter((r) => cnt[r] === 3);
  const bombs = ranks.filter((r) => cnt[r] === 4);

  // 四带二
  if (bombs.length === 1) {
    const rest = n - 4;
    if (rest === 2)
      return { type: 'four_two_single', rank: bombs[0], length: 1 };
    if (rest === 4 && pairs.length === 2)
      return { type: 'four_two_pair', rank: bombs[0], length: 1 };
    return null;
  }
  // 单顺
  if (n >= 5 && singles.length === n && maxR <= 14 && isSeq(ranks)) {
    return { type: 'straight', rank: maxR, length: n };
  }
  // 连对
  if (
    pairs.length >= 3 &&
    pairs.length * 2 === n &&
    maxR <= 14 &&
    isSeq(pairs)
  ) {
    return { type: 'straight_pair', rank: maxR, length: pairs.length };
  }
  // 飞机系列：rank 取三张序列最大值（不含翼牌）
  if (trios.length >= 2 && maxR <= 14 && isSeq(trios)) {
    const k = trios.length;
    const trioMax = trios[trios.length - 1];
    if (n === 3 * k) return { type: 'plane', rank: trioMax, length: k };
    const rem = n - 3 * k;
    if (rem === k) return { type: 'plane_single', rank: trioMax, length: k };
    if (rem === 2 * k) {
      const nonTrio = ranks.filter((r) => cnt[r] !== 3);
      if (nonTrio.length === k && nonTrio.every((r) => cnt[r] === 2)) {
        return { type: 'plane_pair', rank: trioMax, length: k };
      }
    }
    return null;
  }
  return null;
}

/** cur 是否能压过 prev（prev 为 null 表示自由出牌）。 */
export function canBeat(prev: CardType | null, cur: CardType | null): boolean {
  if (!prev) return true;
  if (!cur) return false;
  if (cur.type === 'rocket') return true;
  if (prev.type === 'rocket') return false;
  if (cur.type === 'bomb') {
    if (prev.type === 'bomb') return cur.rank > prev.rank;
    return true;
  }
  if (prev.type === 'bomb') return false;
  if (cur.type !== prev.type) return false;
  if (cur.length !== prev.length) return false;
  return cur.rank > prev.rank;
}

/** 简要中文名（UI 展示用）。 */
export const TYPE_NAME: Record<string, string> = {
  rocket: '火箭',
  bomb: '炸弹',
  single: '单张',
  pair: '对子',
  trio: '三张',
  trio_single: '三带一',
  trio_pair: '三带二',
  straight: '顺子',
  straight_pair: '连对',
  plane: '飞机',
  plane_single: '飞机带单',
  plane_pair: '飞机带对',
  four_two_single: '四带二',
  four_two_pair: '四带两对',
};
