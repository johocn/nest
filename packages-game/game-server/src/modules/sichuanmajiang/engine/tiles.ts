import { Tile, Suit } from './types';

export const SUITS: Suit[] = ['m', 's', 'p'];
export const SUIT_LABEL: Record<Suit, string> = { m: '万', s: '条', p: '筒' };

/** 生成 108 张四川麻将牌（三门 × 1-9 × 4） */
export function createTiles(): Tile[] {
  const tiles: Tile[] = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 9; rank++) {
      for (let i = 0; i < 4; i++) {
        tiles.push({ suit, rank });
      }
    }
  }
  return tiles;
}

/** 牌的数字索引 0-26，便于计数数组运算 */
export function tileId(t: Tile): number {
  const si = SUITS.indexOf(t.suit);
  return si * 9 + (t.rank - 1);
}

/** 由数字索引还原牌（rank 从 0 计数传入 0-26） */
export function tileFromId(id: number): Tile {
  const si = Math.floor(id / 9);
  const rank = (id % 9) + 1;
  return { suit: SUITS[si], rank };
}

export function tileKey(t: Tile): string {
  return `${t.suit}${t.rank}`;
}

export function sameTile(a: Tile, b: Tile): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/** 手牌排序：先花色(m,s,p)后点数 */
export function sortHand(hand: Tile[]): Tile[] {
  return [...hand].sort((a, b) => {
    if (a.suit !== b.suit) return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
    return a.rank - b.rank;
  });
}

/** 将手牌转为 27 长度计数数组 */
export function toCounts(hand: Tile[]): number[] {
  const c = new Array(27).fill(0);
  for (const t of hand) c[tileId(t)]++;
  return c;
}

/** Fisher-Yates 洗牌（可注入随机源以便测试） */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function handContains(hand: Tile[], t: Tile): boolean {
  return hand.some((x) => sameTile(x, t));
}
