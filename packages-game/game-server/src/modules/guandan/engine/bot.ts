// 掼蛋 AI：基于贪心 + 牌型评估的自动决策（出牌 / 压牌 / 过牌）

import { Action, GameState } from './types';
import { enumerateCombos, findBeatingCombos } from './engine';

export function chooseAction(state: GameState, seat: number): Action {
  const player = state.players[seat];
  const hand = player.hand;

  // 自由出牌（无人压制）：优先甩连牌减少手牌，否则出最小单张
  if (state.lastPlay == null) {
    const combos = enumerateCombos(hand, state.level, state.rules);
    const sheds = combos
      .filter((c) => !c.isBomb && (c.type === 'straight' || c.type === 'double_straight' || c.type === 'triple_straight'))
      .sort((a, b) => b.cards.length - a.cards.length);
    if (sheds.length) return { type: 'play', cards: sheds[0].cards.map((c) => c.id) };

    const singles = combos.filter((c) => c.type === 'single').sort((a, b) => a.rank - b.rank);
    if (singles.length) return { type: 'play', cards: singles[0].cards.map((c) => c.id) };

    combos.sort((a, b) => a.rank - b.rank);
    return { type: 'play', cards: combos[0].cards.map((c) => c.id) };
  }

  // 跟牌 / 压牌
  const candidates = findBeatingCombos(hand, state.level, state.rules, state.lastPlay.combo);
  const nonBombs = candidates
    .filter((c) => !c.isBomb)
    .sort((a, b) => a.rank - b.rank || a.cards.length - b.cards.length);
  if (nonBombs.length) return { type: 'play', cards: nonBombs[0].cards.map((c) => c.id) };

  // 仅剩炸弹可压：手牌较多时保留炸弹（过牌），手牌很少或能一把清完则炸
  const bombs = candidates.filter((c) => c.isBomb).sort((a, b) => a.bombSize - b.bombSize || a.rank - b.rank);
  if (bombs.length) {
    const smallest = bombs[0];
    if (smallest.cards.length >= hand.length || hand.length <= 4) {
      return { type: 'play', cards: smallest.cards.map((c) => c.id) };
    }
  }
  return { type: 'pass' };
}
