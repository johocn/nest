import { Card, Suit, JokerType } from './types';
import {
  createDeck,
  deal,
  isWild,
  isLevelCard,
  sortHand,
  pickCards,
  LEVEL_SEQUENCE,
  SUITS,
  RANKS,
} from './cards';
import { DEFAULT_RULES } from './types';

function c(suit: Suit, rank: number, id?: string): Card {
  return { id: id ?? `${suit}-${rank}`, suit, rank };
}

describe('cards', () => {
  describe('createDeck', () => {
    it('生成 108 张（两副：4 花色×13 点 + 2 王）×2', () => {
      const deck = createDeck();
      expect(deck.length).toBe(108);
      // 每种自然牌（花色+点数）各 2 张
      const natural = deck.filter((x) => x.suit !== 'joker');
      expect(natural.length).toBe(104);
      const jokers = deck.filter((x) => x.suit === 'joker');
      expect(jokers.length).toBe(4);
      // 每个 id 唯一
      expect(new Set(deck.map((x) => x.id)).size).toBe(108);
    });

    it('点数映射覆盖 3..15（含 2=15）', () => {
      expect(RANKS).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      expect(SUITS).toEqual(['spades', 'hearts', 'diamonds', 'clubs']);
    });
  });

  describe('deal', () => {
    it('4 人各 25 张，底牌 8 张，合计 108', () => {
      const { hands, kitty } = deal(createDeck());
      expect(hands.length).toBe(4);
      hands.forEach((h) => expect(h.length).toBe(25));
      expect(kitty.length).toBe(8);
      const all = [...hands.flat(), ...kitty];
      expect(all.length).toBe(108);
      expect(new Set(all.map((x) => x.id)).size).toBe(108);
    });
  });

  describe('isLevelCard / isWild', () => {
    it('级牌判定：非王且 rank 等于 level', () => {
      expect(isLevelCard(c('spades', 15), 15)).toBe(true);
      expect(isLevelCard(c('hearts', 15), 15)).toBe(true);
      expect(isLevelCard(c('spades', 15), 14)).toBe(false);
      expect(isLevelCard(c('joker', 16, 'j'), 15)).toBe(false);
    });

    it('百搭（逢人配）：红桃级牌恒为百搭', () => {
      const heartLevel = c('hearts', 15);
      const spadeLevel = c('spades', 15);
      expect(isWild(heartLevel, 15, DEFAULT_RULES)).toBe(true);
      expect(isWild(spadeLevel, 15, DEFAULT_RULES)).toBe(false);
    });

    it('百搭：非红桃级牌按规则 nonHeartLevelWild 可同为百搭', () => {
      const spadeLevel = c('spades', 15);
      expect(isWild(spadeLevel, 15, { ...DEFAULT_RULES, nonHeartLevelWild: true })).toBe(true);
      expect(isWild(spadeLevel, 15, DEFAULT_RULES)).toBe(false);
    });

    it('百搭：王牌与非级牌永远不是百搭', () => {
      expect(isWild(c('joker', 16, 'j'), 15, DEFAULT_RULES)).toBe(false);
      expect(isWild(c('spades', 3), 15, DEFAULT_RULES)).toBe(false);
    });

    it('级牌值不同时不触发百搭', () => {
      expect(isWild(c('hearts', 14), 15, DEFAULT_RULES)).toBe(false);
    });
  });

  describe('sortHand', () => {
    it('按 花色序→点数 升序排列', () => {
      const hand = [
        c('clubs', 14),
        c('spades', 3),
        c('hearts', 10),
        c('diamonds', 5),
        c('joker', 16, 'j1'),
      ];
      const sorted = sortHand(hand);
      const suitsOrder = ['spades', 'hearts', 'diamonds', 'clubs', 'joker'];
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        const sp = suitsOrder.indexOf(prev.suit) - suitsOrder.indexOf(cur.suit);
        if (sp !== 0) {
          expect(sp).toBeLessThan(0);
        } else {
          expect(prev.rank).toBeLessThanOrEqual(cur.rank);
        }
      }
    });

    it('不修改原数组', () => {
      const hand = [c('clubs', 14), c('spades', 3)];
      const copy = [...hand];
      sortHand(hand);
      expect(hand).toEqual(copy);
    });
  });

  describe('pickCards', () => {
    it('按 id 取牌，缺失 id 忽略', () => {
      const hand = [c('spades', 3, 'a'), c('hearts', 4, 'b'), c('clubs', 5, 'd')];
      expect(pickCards(hand, ['a', 'd', 'missing']).map((x) => x.id)).toEqual(['a', 'd']);
    });
  });

  describe('LEVEL_SEQUENCE', () => {
    it('从 2(15) 打到 A(14)，长度 13', () => {
      expect(LEVEL_SEQUENCE).toEqual([15, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
      expect(LEVEL_SEQUENCE.length).toBe(13);
    });
  });
});
