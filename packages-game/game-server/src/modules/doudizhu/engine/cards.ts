/**
 * 斗地主牌库（纯逻辑，零框架依赖，可 vitest 测试）。
 * 牌模型：{ id, rank, suit, label, suitChar, isJoker }
 *   rank: 3..15 对应 3..10,J,Q,K,A,2；小王=16，大王=17（用于大小与排序）。
 *   suit: 0=♠ 1=♥ 2=♣ 3=♦；大小王 suit=-1。
 */

export interface Card {
  id: string;
  rank: number; // 3..15, 16=小王, 17=大王
  suit: number; // 0..3, -1=王
  label: string;
  suitChar: string;
  isJoker: boolean;
}

export const SUITS = [
  { suit: 0, char: '♠' },
  { suit: 1, char: '♥' },
  { suit: 2, char: '♣' },
  { suit: 3, char: '♦' },
];

export const RANK_LABEL: Record<number, string> = {
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
  15: '2',
  16: '小王',
  17: '大王',
};

/** 生成一副 54 张牌（含大小王）。 */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  let id = 0;
  for (let suit = 0; suit < SUITS.length; suit++) {
    for (let rank = 3; rank <= 15; rank++) {
      deck.push({
        id: 'c' + id++,
        rank,
        suit,
        label: RANK_LABEL[rank],
        suitChar: SUITS[suit].char,
        isJoker: false,
      });
    }
  }
  deck.push({
    id: 'c' + id++,
    rank: 16,
    suit: -1,
    label: '小王',
    suitChar: '🃏',
    isJoker: true,
  });
  deck.push({
    id: 'c' + id++,
    rank: 17,
    suit: -1,
    label: '大王',
    suitChar: '🃏',
    isJoker: true,
  });
  return deck;
}

/**
 * Fisher-Yates 洗牌。rng 为可选 () => [0,1) 随机源，便于测试可复现。
 */
export function shuffle(deck: Card[], rng?: () => number): Card[] {
  const r = rng || Math.random;
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * 发牌：3 名玩家各 17 张，剩 3 张作底牌。
 * 返回 { hands: Card[][], bottom: Card[] }（hands 已排序）。
 */
export function deal(deck: Card[]): { hands: Card[][]; bottom: Card[] } {
  const hands: Card[][] = [[], [], []];
  for (let i = 0; i < 51; i++) hands[i % 3].push(deck[i]);
  const bottom = deck.slice(51, 54);
  for (let h = 0; h < 3; h++) hands[h] = sortHand(hands[h]);
  return { hands, bottom };
}

/** 按 rank 升序、同 rank 按 suit 排序（UI 展示用）。 */
export function sortHand(cards: Card[]): Card[] {
  return cards
    .slice()
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.suit - b.suit));
}

/** 统计每张 rank 的数量：{ rank: count }。 */
export function countByRank(cards: Card[]): Record<number, number> {
  const m: Record<number, number> = {};
  for (const c of cards) m[c.rank] = (m[c.rank] || 0) + 1;
  return m;
}

/** 从手牌中按 rank 取出 n 张，返回 { taken, rest }。 */
export function takeByRank(
  hand: Card[],
  rank: number,
  n: number,
): { taken: Card[]; rest: Card[] } {
  const taken: Card[] = [];
  const rest: Card[] = [];
  let need = n;
  for (const c of hand) {
    if (need > 0 && c.rank === rank) {
      taken.push(c);
      need--;
    } else rest.push(c);
  }
  return { taken, rest };
}

/** 判断 hand 是否包含 selected 这组牌（按 id 去重），用于出牌校验。 */
export function containsCards(hand: Card[], selected: Card[]): boolean {
  const pool = hand.slice();
  for (const s of selected) {
    const idx = pool.findIndex((p) => p.id === s.id);
    if (idx === -1) return false;
    pool.splice(idx, 1);
  }
  return true;
}
