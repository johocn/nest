import { Card } from './cards';
import { AiContext, chooseFreePlay, decidePlay } from './ai';

let uid = 0;
function c(rank: number): Card {
  return {
    id: `c${uid++}`,
    rank,
    suit: rank >= 16 ? -1 : 0,
    label: String(rank),
    suitChar: '♠',
    isJoker: rank >= 16,
  };
}
const hand = (...ranks: number[]) => ranks.map(c);

const ctx = (over: Partial<AiContext> = {}): AiContext => ({
  landlord: 0,
  me: 1,
  prevPlayer: 0,
  teammateHand: 6,
  landlordHand: 8,
  threatHand: 8,
  ...over,
});

describe('斗地主 AI 强化', () => {
  it('对手剩 2 张（危急）：农民该炸则炸，不再留炸', () => {
    const h = hand(9, 9, 9, 9, 3, 5);
    const prev = { type: 'single', rank: 15, length: 1 };
    const d = decidePlay(h, prev, ctx({ landlordHand: 2, threatHand: 2 }));
    expect(d.pass).toBe(false);
    expect(d.cards).toHaveLength(4);
    expect(d.cards.every((x) => x.rank === 9)).toBe(true);
  });

  it('对手牌还厚：仅有炸弹可压时保存炸弹', () => {
    const h = hand(9, 9, 9, 9, 3, 5);
    const prev = { type: 'single', rank: 15, length: 1 };
    const d = decidePlay(h, prev, ctx({ landlordHand: 10, threatHand: 10 }));
    expect(d.pass).toBe(true);
  });

  it('优先不拆炸弹：有普通牌可压时不用炸弹里的牌', () => {
    const h = hand(9, 9, 9, 9, 7, 8);
    const prev = { type: 'single', rank: 5, length: 1 };
    const d = decidePlay(h, prev, ctx({ threatHand: 6 }));
    expect(d.pass).toBe(false);
    expect(d.cards).toHaveLength(1);
    expect(d.cards[0].rank).toBe(7);
  });

  it('农民领出优先最小散单，不拆对子/三张', () => {
    const h = hand(3, 3, 5, 9, 9, 9);
    const d = chooseFreePlay(h);
    expect(d).toHaveLength(1);
    expect(d[0].rank).toBe(5);
  });
});
