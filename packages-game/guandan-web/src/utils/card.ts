import type { Card, Combo } from '../types';

export function rankLabel(rank: number): string {
  const m: Record<number, string> = {
    3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王',
  };
  return m[rank] ?? String(rank);
}

export function suitSymbol(suit: string): string {
  const m: Record<string, string> = {
    spades: '♠',
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    joker: '🃏',
  };
  return m[suit] ?? '';
}

export function isRed(suit: string): boolean {
  return suit === 'hearts' || suit === 'diamonds';
}

export function isWildCard(card: Card, level: number, rules: Record<string, any>): boolean {
  if (card.suit === 'joker') return false;
  if (card.rank !== level) return false;
  if (card.suit === 'hearts') return true;
  return !!rules?.nonHeartLevelWild;
}

export function comboLabel(c: Combo): string {
  const m: Record<string, string> = {
    single: '单张',
    pair: '对子',
    triple: '三张',
    triple_pair: '三带二',
    straight: '顺子',
    double_straight: '连对',
    triple_straight: '钢板',
    straight_flush: '同花顺',
    bomb: '炸弹',
    four_two: '四带二',
    four_two_pair: '四带两对',
    king_bomb: '四王炸',
  };
  return m[c.type] || c.type;
}
