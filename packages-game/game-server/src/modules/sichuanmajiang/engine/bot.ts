import { GameState, Suit, Tile, ActionType } from './types';
import { sameTile, SUITS, toCounts } from './tiles';
import { canSelfHu } from './engine';

/** 定缺：选择手牌中最少的一门 */
export function chooseQueMen(state: GameState, seat: number): Suit {
  const p = state.players[seat];
  let best: Suit = 'm';
  let min = Infinity;
  for (const s of SUITS) {
    const c = p.hand.filter((t) => t.suit === s).length;
    if (c < min) {
      min = c;
      best = s;
    }
  }
  return best;
}

function usefulness(hand: Tile[], t: Tile): number {
  let score = 0;
  for (const o of hand) {
    if (sameTile(o, t)) continue;
    if (o.suit === t.suit) {
      const d = Math.abs(o.rank - t.rank);
      if (d === 0) score += 6;
      else if (d === 1) score += 4;
      else if (d === 2) score += 2;
    }
  }
  return score;
}

/** 出牌决策：优先打缺门；否则打孤立度最高的牌 */
export function chooseDiscard(state: GameState, seat: number): Tile {
  const p = state.players[seat];
  const queued = p.queuedSuit;
  let candidates = p.hand;
  if (queued) {
    const q = p.hand.filter((t) => t.suit === queued);
    if (q.length) candidates = q;
  }
  let worst = candidates[0];
  let minScore = Infinity;
  for (const t of candidates) {
    const sc = usefulness(p.hand, t);
    if (sc < minScore) {
      minScore = sc;
      worst = t;
    }
  }
  return worst;
}

/** 自己回合的动作（自摸 > 暗杠/加杠 > 出牌） */
export function chooseTurnAction(state: GameState, seat: number): { type: ActionType; tile?: Tile } {
  if (canSelfHu(state, seat)) return { type: 'hu' };
  const p = state.players[seat];
  // 暗杠
  const counts = toCounts(p.hand);
  for (let id = 0; id < 27; id++) {
    if (counts[id] === 4) {
      const suit = SUITS[Math.floor(id / 9)];
      const rank = (id % 9) + 1;
      if (suit !== p.queuedSuit) return { type: 'gang', tile: { suit, rank } };
    }
  }
  // 加杠
  for (const m of p.melds) {
    if ((m.type === 'peng' || m.type === 'bugang') && p.hand.some((t) => sameTile(t, m.tile))) {
      if (m.tile.suit !== p.queuedSuit) return { type: 'gang', tile: m.tile };
    }
  }
  return { type: 'discard', tile: chooseDiscard(state, seat) };
}

/** 响应他人弃牌（胡 > 杠 > 碰 > 过） */
export function chooseResponse(state: GameState, seat: number, actions: ActionType[]): ActionType {
  if (actions.includes('hu')) return 'hu';
  if (actions.includes('gang')) {
    const t = state.lastDiscard!;
    if (t.suit !== state.players[seat].queuedSuit) return 'gang';
  }
  if (actions.includes('peng')) {
    const t = state.lastDiscard!;
    const cnt = state.players[seat].hand.filter((x) => sameTile(x, t)).length;
    // 该门已较多时碰，利于清一色/缺一门
    const suitCount = state.players[seat].hand.filter((x) => x.suit === t.suit).length;
    if (suitCount >= 4 && cnt === 2) return 'peng';
  }
  return 'pass';
}
