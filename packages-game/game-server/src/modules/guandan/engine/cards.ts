// 掼蛋牌组：108 张（两副扑克），级牌/逢人配判定，洗牌发牌

import { Card, Rules, Suit } from './types';

/** rank 值映射：3..10 -> 3..10, J=11, Q=12, K=13, A=14, 2=15, 小王=16, 大王=17 */
export const RANKS: number[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/** 级数序列（rank 值）：从 2 打到 A */
export const LEVEL_SEQUENCE: number[] = [15, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

export const RANK_LABEL: Record<number, string> = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王',
};

export const SUIT_LABEL: Record<Suit, string> = {
  spades: '♠', // ♠
  hearts: '♥', // ♥
  diamonds: '♦', // ♦
  clubs: '♣', // ♣
  joker: '🃏',
};

export function isJoker(card: Card): boolean {
  return card.suit === 'joker';
}

/** 该牌是否为级牌（当前级数的牌） */
export function isLevelCard(card: Card, level: number): boolean {
  return !isJoker(card) && card.rank === level;
}

/** 该牌是否为百搭（逢人配）：红桃级牌，或非红桃级牌按规则同为百搭 */
export function isWild(card: Card, level: number, rules: Rules): boolean {
  if (isJoker(card)) return false;
  if (card.rank !== level) return false;
  if (card.suit === 'hearts') return true;
  return rules.nonHeartLevelWild;
}

/** 构造一副完整 108 张牌（两副） */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ id: `${suit}-${rank}#${copy}`, suit, rank });
      }
    }
    // 两副各含 2 张王：小王(small=16) + 大王(big=17)
    deck.push({ id: `joker-small#${copy}`, suit: 'joker', rank: 16, joker: 'small' });
    deck.push({ id: `joker-big#${copy}`, suit: 'joker', rank: 17, joker: 'big' });
  }
  return deck;
}

/** Fisher-Yates 洗牌（原地） */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export interface DealResult {
  hands: Card[][];
  kitty: Card[];
}

/** 发牌：4 人各 25 张，余 8 张为底牌 */
export function deal(deck: Card[]): DealResult {
  const hands: Card[][] = [[], [], [], []];
  const order = shuffle([...deck]);
  for (let i = 0; i < 100; i++) {
    hands[i % 4].push(order[i]);
  }
  const kitty = order.slice(100, 108);
  return { hands, kitty };
}

/** 按展示排序：先花色后点数（便于前端展示与玩家阅读） */
export function sortHand(hand: Card[]): Card[] {
  const suitOrder: Record<Suit, number> = {
    spades: 0, hearts: 1, diamonds: 2, clubs: 3, joker: 4,
  };
  return [...hand].sort((a, b) => {
    if (suitOrder[a.suit] !== suitOrder[b.suit]) return suitOrder[a.suit] - suitOrder[b.suit];
    return a.rank - b.rank;
  });
}

/** 从手牌中按 id 取出指定卡牌（返回新数组，不修改原手牌） */
export function pickCards(hand: Card[], ids: string[]): Card[] {
  const map = new Map(hand.map((c) => [c.id, c]));
  const out: Card[] = [];
  for (const id of ids) {
    const c = map.get(id);
    if (c) out.push(c);
  }
  return out;
}
