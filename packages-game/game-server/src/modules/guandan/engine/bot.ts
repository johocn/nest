// 掼蛋 AI：基于贪心 + 牌型评估的自动决策（出牌 / 压牌 / 过牌）
// 三档强度：easy=新手（保守且会失误）、normal=标准、hard=高手（不压搭档、残局果断用炸）

import { Action, AiLevel, Combo, GameState } from './types';
import { enumerateCombos, findBeatingCombos } from './engine';

function toAction(c: Combo): Action {
  return { type: 'play', cards: c.cards.map((x) => x.id) };
}

export function chooseAction(
  state: GameState,
  seat: number,
  level: AiLevel = 'normal',
): Action {
  const hand = state.players[seat].hand;
  const partnerSeat = (seat + 2) % 4;
  const partner = state.players[partnerSeat];
  const opponents = state.players.filter(
    (p) => p.seat % 2 !== seat % 2 && !p.isOut,
  );
  const minOppHand = opponents.length
    ? Math.min(...opponents.map((p) => p.hand.length))
    : 99;

  // ============ 自由出牌（无人压制） ============
  if (state.lastPlay == null) {
    const combos = enumerateCombos(hand, state.level, state.rules);

    // 新手：只会出最小单张，不会主动甩连牌
    if (level === 'easy') {
      const singles = combos
        .filter((c) => c.type === 'single')
        .sort((a, b) => a.rank - b.rank);
      if (singles.length) return toAction(singles[0]);
      const rest = [...combos].sort(
        (a, b) => a.cards.length - b.cards.length || a.rank - b.rank,
      );
      return toAction(rest[0]);
    }

    // 优先甩连牌减少手牌（同长度时先出小的）
    const sheds = combos
      .filter(
        (c) =>
          !c.isBomb &&
          (c.type === 'straight' ||
            c.type === 'double_straight' ||
            c.type === 'triple_straight'),
      )
      .sort((a, b) => b.cards.length - a.cards.length || a.rank - b.rank);
    if (sheds.length) return toAction(sheds[0]);

    // 高手：对手即将走完时施压，出最大单张
    if (level === 'hard' && minOppHand <= 2) {
      const big = combos
        .filter((c) => c.type === 'single')
        .sort((a, b) => b.rank - a.rank);
      if (big.length) return toAction(big[0]);
    }

    const singles = combos
      .filter((c) => c.type === 'single')
      .sort((a, b) => a.rank - b.rank);
    if (singles.length) return toAction(singles[0]);

    const rest = [...combos].sort((a, b) => a.rank - b.rank);
    return toAction(rest[0]);
  }

  // ============ 跟牌 / 压牌 ============
  const candidates = findBeatingCombos(
    hand,
    state.level,
    state.rules,
    state.lastPlay.combo,
  );
  const nonBombs: Combo[] = candidates
    .filter((c) => !c.isBomb)
    .sort((a, b) => a.rank - b.rank || a.cards.length - b.cards.length);

  const winner = nonBombs.find((c) => c.cards.length >= hand.length);

  // 高手：当前 trick 由搭档领衔时不压搭档（除非这一手能走完）
  if (level === 'hard') {
    const leaderIsPartner =
      state.lastPlayerSeat === partnerSeat && !partner.isOut;
    if (leaderIsPartner) return winner ? toAction(winner) : { type: 'pass' };
  }

  if (nonBombs.length) {
    // 新手：25% 概率失误放过（能一把走完时不失误）
    if (level === 'easy' && !winner && Math.random() < 0.25) {
      return { type: 'pass' };
    }
    return toAction(winner ?? nonBombs[0]);
  }

  // ============ 仅剩炸弹可压 ============
  const bombs = candidates
    .filter((c) => c.isBomb)
    .sort((a, b) => a.bombSize - b.bombSize || a.rank - b.rank);
  if (bombs.length) {
    const smallest = bombs[0];
    const canFinish = smallest.cards.length >= hand.length;
    if (canFinish) return toAction(smallest);
    if (level === 'easy') return { type: 'pass' };
    if (level === 'hard') {
      // 高手：对手将走完或自己手牌不多时果断炸
      if (minOppHand <= 2 || hand.length <= 5) return toAction(smallest);
      return { type: 'pass' };
    }
    if (hand.length <= 4) return toAction(smallest);
  }
  return { type: 'pass' };
}

/** 供 UI/调试：当前档位描述 */
export const AI_LEVEL_LABEL: Record<AiLevel, string> = {
  easy: '新手',
  normal: '标准',
  hard: '高手',
};
