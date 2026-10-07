// 掼蛋牌型识别与大小比较（含级牌/逢人配补位）

import { Card, Combo, ComboType, Rules } from './types';
import { isJoker, isWild } from './cards';

/**
 * 从一组牌识别牌型。返回 Combo 或 null（非法）。
 * 级牌按 isWild 视为百搭，可补位到任意非王牌型；王只能单出或组成四王炸。
 */
export function identifyCombo(cards: Card[], level: number, rules: Rules): Combo | null {
  if (!cards.length) return null;

  const jokers = cards.filter(isJoker);
  // 四王炸
  if (jokers.length === 4 && cards.length === 4) {
    return { type: 'king_bomb', cards, rank: 17, length: 4, bombSize: 4, isBomb: true };
  }
  // 单张王
  if (jokers.length === 1 && cards.length === 1) {
    return { type: 'single', cards, rank: jokers[0].rank, length: 1, bombSize: 0, isBomb: false };
  }
  // 王不可与其他牌组合
  if (jokers.length > 0) return null;

  const wilds = cards.filter((c) => isWild(c, level, rules));
  const others = cards.filter((c) => !isWild(c, level, rules));
  const w = wilds.length;
  const total = cards.length;

  const byRank = new Map<number, number>();
  for (const c of others) byRank.set(c.rank, (byRank.get(c.rank) || 0) + 1);
  const distinct = [...byRank.keys()];

  // 炸弹：所有非百搭牌同点（含百搭补位形成 4+ 炸弹）
  if (others.length > 0 && distinct.length === 1 && total >= 4) {
    return { type: 'bomb', cards, rank: distinct[0], length: total, bombSize: total, isBomb: true };
  }
  if (w === total && total >= 4) {
    return { type: 'bomb', cards, rank: level, length: total, bombSize: total, isBomb: true };
  }

  // 单张
  if (total === 1) {
    return { type: 'single', cards, rank: w === 1 ? level : others[0].rank, length: 1, bombSize: 0, isBomb: false };
  }
  // 对子
  if (total === 2) {
    if (others.length > 0 && distinct.length === 1) {
      return { type: 'pair', cards, rank: distinct[0], length: 2, bombSize: 0, isBomb: false };
    }
    if (w === 2) return { type: 'pair', cards, rank: level, length: 2, bombSize: 0, isBomb: false };
    return null;
  }
  // 三张
  if (total === 3) {
    if (others.length > 0 && distinct.length === 1 && byRank.get(distinct[0])! + w === 3) {
      return { type: 'triple', cards, rank: distinct[0], length: 3, bombSize: 0, isBomb: false };
    }
    if (w === 3 && others.length === 0) {
      return { type: 'triple', cards, rank: level, length: 3, bombSize: 0, isBomb: false };
    }
    return null;
  }
  // 三带二
  if (total === 5) {
    const r = tryTriplePair(byRank, w, level);
    if (r !== null) return { type: 'triple_pair', cards, rank: r, length: 5, bombSize: 0, isBomb: false };
  }

  // 同花顺（花炸）优先于普通顺子识别
  const sf = tryStraightFlush(cards, others, byRank, w, level, rules);
  if (sf) return sf;

  // 顺子 / 连对 / 钢板（必须在四带二/四带两对之前识别，避免与 钢板、连对 歧义）
  const run = tryRun(1, total, byRank, w, level);
  if (run) return run;
  const dbl = tryRun(2, total, byRank, w, level);
  if (dbl) return dbl;
  const trip = tryRun(3, total, byRank, w, level);
  if (trip) return trip;

  // 四带二（单）：含四张 + 两张单牌（与 钢板 歧义时已由上方顺子类优先识别）
  if (total === 6) {
    const r = tryFourTwo(byRank, w);
    if (r !== null) return { type: 'four_two', cards, rank: r, length: 6, bombSize: 0, isBomb: false };
  }
  // 四带两对
  if (total === 8) {
    const r = tryFourTwoPair(byRank, w);
    if (r !== null) return { type: 'four_two_pair', cards, rank: r, length: 8, bombSize: 0, isBomb: false };
  }

  return null;
}

/** 三带二：返回三张的点数，或 null */
function tryTriplePair(byRank: Map<number, number>, w: number, level: number): number | null {
  // 候选三张点：非百搭牌中某点 + 百搭凑成 3
  const ranks = [...byRank.keys()];
  for (const r of ranks) {
    const have = byRank.get(r)!;
    if (have > 3) continue;
    const needTriple = 3 - have;
    if (needTriple > w) continue;
    const restWild = w - needTriple;
    // 剩余牌需能组成一对（与三张不同点）
    for (const p of ranks) {
      if (p === r) continue;
      const haveP = byRank.get(p)!;
      if (haveP > 2) continue;
      const needPair = 2 - haveP;
      if (needPair >= 0 && needPair <= restWild) return r;
    }
    // 用百搭单独凑一对（点取 level）
    if (restWild >= 2) return r;
  }
  // 全百搭：三张+二张 均用百搭（点=level）
  if (w === 5) return level;
  return null;
}

/** 四带二（单）：返回四张的点数，或 null。四张必须自然成组（百搭可补位） */
function tryFourTwo(byRank: Map<number, number>, w: number): number | null {
  const ranks = [...byRank.keys()];
  for (const r of ranks) {
    const have = byRank.get(r)!;
    if (have > 4) continue;
    const need = 4 - have;
    if (need < 0 || need > w) continue;
    const restWild = w - need;
    const restOthers = ranks.reduce((s, k) => s + (k === r ? 0 : byRank.get(k)!), 0);
    // 额外 2 张可由其余非四张牌（任意点，不能凑成炸弹）或百搭提供
    if (restOthers + restWild === 2) return r;
  }
  return null;
}

/** 四带两对：返回四张的点数，或 null */
function tryFourTwoPair(byRank: Map<number, number>, w: number): number | null {
  const ranks = [...byRank.keys()];
  for (const r of ranks) {
    const have = byRank.get(r)!;
    if (have > 4) continue;
    const need = 4 - have;
    if (need < 0 || need > w) continue;
    const restWild = w - need;
    // 其余牌须恰好能分成两对（每点 ≤2，且成对数量够），或百搭补足
    let pairSlots = 0;
    let extra = 0;
    for (const k of ranks) {
      if (k === r) continue;
      const c = byRank.get(k)!;
      if (c > 2) { pairSlots = -1; break; }
      pairSlots += c === 2 ? 1 : 0;
      extra += c;
    }
    if (pairSlots === -1) continue;
    // 还需 (2 - pairSlots) 对，每对消耗 2 张（自然 pair 已计；不足用百搭）
    const needPairs = 2 - pairSlots;
    if (needPairs * 2 <= restWild + (extra - pairSlots * 2)) return r;
  }
  return null;
}

/**
 * 顺子/连对/钢板：groupSize=1/2/3。窗口搜索，百搭补位。
 * 顺子长度≥5，连对长度≥3，钢板长度≥2。
 */
function tryRun(
  groupSize: number,
  total: number,
  byRank: Map<number, number>,
  w: number,
  level: number,
): Combo | null {
  const L = total / groupSize;
  if (!Number.isInteger(L)) return null;
  if (groupSize === 1 && L < 5) return null;
  if (groupSize === 2 && L < 3) return null;
  if (groupSize === 3 && L < 2) return null;

  // 非百搭点不得出现重复超过 groupSize（否则不是该 run）
  for (const c of byRank.values()) {
    if (c > groupSize) return null;
  }

  const maxRank = 14;
  for (let a = 3; a + L - 1 <= maxRank; a++) {
    // 窗口不能跨越级牌（级牌不可入顺）
    if (level >= 3 && level <= 14 && level >= a && level <= a + L - 1) continue;
    let need = 0;
    for (let r = a; r <= a + L - 1; r++) {
      need += Math.max(0, groupSize - (byRank.get(r) || 0));
    }
    if (need === w) {
      const top = a + L - 1;
      const type: ComboType = groupSize === 1 ? 'straight' : groupSize === 2 ? 'double_straight' : 'triple_straight';
      return { type, cards: [], rank: top, length: L, bombSize: 0, isBomb: false };
    }
  }
  return null;
}

function tryStraightFlush(
  cards: Card[],
  others: Card[],
  byRank: Map<number, number>,
  w: number,
  level: number,
  rules: Rules,
): Combo | null {
  if (others.length === 0) {
    // 全百搭：默认黑桃顺
    const run = tryRun(1, cards.length, byRank, w, level);
    if (run) return { ...run, type: 'straight_flush', isBomb: true };
    return null;
  }
  const suit = others[0].suit;
  for (const c of others) if (c.suit !== suit) return null;
  // 同花顺不允许含级牌自然牌（级牌不能入顺），但百搭可补位
  for (const [r, c] of byRank) {
    if (c > 1) return null;
    if (r === level) return null; // 级牌本身不能进顺（即便作百搭也只在同花色下补位，但自然级牌不入顺）
  }
  const run = tryRun(1, cards.length, byRank, w, level);
  if (run) return { ...run, type: 'straight_flush', isBomb: true };
  return null;
}

/** a 能否压制 b（a 为待出牌，b 为桌面上一手） */
export function beats(a: Combo, b: Combo, rules: Rules): boolean {
  // 四王炸：最大（除非开启"六连及以上炸弹可压四王炸"且对手为 6+ 炸弹）
  if (a.type === 'king_bomb') {
    if (b.type === 'king_bomb') return false;
    if (rules.sixBombOverKingBomb && b.isBomb && b.bombSize >= 6) return false;
    return true;
  }
  if (b.type === 'king_bomb') {
    // 仅六连及以上炸弹在开启开关时可压四王炸（能到这里 a 一定非四王炸）
    return rules.sixBombOverKingBomb && a.isBomb && a.bombSize >= 6;
  }

  // 同花顺（花炸）：默认严格大于普通炸弹；花炸之间比长度/顶张
  if (a.type === 'straight_flush') {
    if (b.type === 'straight_flush') {
      if (a.length !== b.length) return a.length > b.length;
      return a.rank > b.rank;
    }
    if (b.isBomb) return rules.straightFlushOverBomb; // 花炸 vs 普通炸弹
    return false; // 花炸不能压非炸弹/非花炸
  }
  if (b.type === 'straight_flush') return false; // 普通炸弹/非炸弹无法压花炸

  // 普通炸弹
  if (a.isBomb) {
    if (b.isBomb) {
      if (a.bombSize !== b.bombSize) return a.bombSize > b.bombSize;
      return a.rank > b.rank;
    }
    return true; // 炸弹压非炸弹
  }
  if (b.isBomb) return false;

  // 非炸弹：必须同型同长，比顶张
  if (a.type !== b.type) return false;
  if (a.length !== b.length) return false;
  return a.rank > b.rank;
}
