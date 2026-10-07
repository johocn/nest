// 掼蛋引擎：建局、出牌/过牌状态机、回合结算与升级、牌型枚举

import {
  Action,
  Card,
  Combo,
  GameState,
  PlayerState,
  Rules,
  DEFAULT_RULES,
  RoundSettlement,
} from './types';
import {
  createDeck,
  deal,
  sortHand,
  pickCards,
  isJoker,
  isWild,
  LEVEL_SEQUENCE,
  SUITS,
} from './cards';
import { identifyCombo, beats } from './combos';

function partnerOf(seat: number): number {
  return (seat + 2) % 4;
}

function newPlayers(level: number, isBot: boolean[]): PlayerState[] {
  return [0, 1, 2, 3].map((seat) => ({
    seat,
    hand: [],
    isBot: isBot[seat],
    partnerSeat: partnerOf(seat),
    isOut: false,
    finishOrder: 0,
    passedThisTrick: false,
  }));
}

export function createGame(
  isBot: boolean[],
  rules: Partial<Rules> = {},
  levelIndex = 0,
): GameState {
  const fullRules: Rules = { ...DEFAULT_RULES, ...rules };
  const { hands, kitty } = deal(createDeck());
  const players = newPlayers(levelIndex, isBot);
  players.forEach((p, i) => {
    p.hand = sortHand(hands[i]);
  });
  return {
    level: LEVEL_SEQUENCE[levelIndex],
    levelIndex,
    phase: 'play',
    turn: 0,
    lastPlayerSeat: 0,
    players,
    lastPlay: null,
    passCount: 0,
    kitty,
    kittyClaimed: false,
    roundOver: false,
    matchWinner: null,
    lastSettlement: null,
    rules: fullRules,
  };
}

function cloneState(s: GameState): GameState {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, hand: [...p.hand] })),
    lastPlay: s.lastPlay
      ? { seat: s.lastPlay.seat, combo: { ...s.lastPlay.combo, cards: [...s.lastPlay.combo.cards] } }
      : null,
    kitty: [...s.kitty],
    rules: { ...s.rules },
    lastSettlement: s.lastSettlement ? { ...s.lastSettlement, finishOrders: { ...s.lastSettlement.finishOrders } } : null,
  };
}

function activePlayers(s: GameState): PlayerState[] {
  return s.players.filter((p) => !p.isOut);
}

function nextActiveSeat(s: GameState, from: number): number {
  for (let i = 1; i <= 4; i++) {
    const seat = (from + i) % 4;
    if (!s.players[seat].isOut) return seat;
  }
  return from;
}

function markOut(s: GameState, seat: number) {
  const p = s.players[seat];
  p.isOut = true;
  p.finishOrder = s.players.filter((x) => x.isOut).length;
}

function checkRoundEnd(s: GameState): boolean {
  // 掼蛋：3 人出完即结束本回合，余下 1 人自动末游（见 settleRound 的末游处理）
  const out = s.players.filter((p) => p.isOut).length;
  return out >= 3;
}

/** 结算本回合并升级；若打过 A 则产生冠军队 */
function settleRound(s: GameState) {
  // 未出完者即末游（finishOrder=4）；头游恒为 finishOrder===1 的座位
  const orders: Record<number, number> = {};
  for (const p of s.players) orders[p.seat] = p.isOut ? p.finishOrder : 4;
  const headSeat = s.players.find((p) => p.finishOrder === 1)!.seat;
  const winningTeam = headSeat % 2; // 0=座位0&2, 1=座位1&3
  const partnerSeat = partnerOf(headSeat);
  const partnerOrder = orders[partnerSeat];

  let levelUp = 1;
  let desc = '单下，升 1 级';
  if (partnerOrder === 2) {
    levelUp = 3;
    desc = '双上，升 3 级';
  } else if (partnerOrder === 3) {
    levelUp = 2;
    desc = '对手单下，升 2 级';
  } else if (partnerOrder === 4) {
    levelUp = 1;
    desc = '搭档末游，升 1 级';
  }

  // 过 A 规则
  let champion = false;
  if (s.levelIndex === 12) {
    if (s.rules.passAOnlyTop && partnerOrder === 4) {
      levelUp = 0;
      desc = '过 A 失败（搭档末游），留在 A';
    } else {
      champion = true;
    }
  }

  const settlement: RoundSettlement = { finishOrders: orders, winningTeam, levelUp, desc };
  s.lastSettlement = settlement;
  s.roundOver = true;

  if (champion) {
    s.matchWinner = winningTeam;
    s.phase = 'ended';
    return;
  }

  const newLevelIndex = Math.min(12, s.levelIndex + levelUp);
  s.levelIndex = newLevelIndex;
  s.level = LEVEL_SEQUENCE[newLevelIndex];
  // 下一回合由本回合头游领衔
  s.turn = headSeat;
}

/** 开启下一回合（保留 level / 头游领衔） */
export function startNextRound(s: GameState) {
  const { hands, kitty } = deal(createDeck());
  s.players.forEach((p, i) => {
    p.hand = sortHand(hands[i]);
    p.isOut = false;
    p.finishOrder = 0;
    p.passedThisTrick = false;
  });
  s.kitty = kitty;
  s.kittyClaimed = false;
  s.lastPlay = null;
  s.lastPlayerSeat = s.turn;
  s.passCount = 0;
  s.roundOver = false;
  s.phase = 'play';
}

function resolveTrick(s: GameState) {
  const winner = s.players[s.lastPlayerSeat];
  // 发放底牌给首回合赢家（若已出局则给搭档/下家）
  if (!s.kittyClaimed && s.rules.kittyToFirstTrickWinner && s.kitty.length) {
    let recipient = winner;
    if (winner.isOut) {
      const partner = s.players[winner.partnerSeat];
      recipient = !partner.isOut ? partner : s.players[nextActiveSeat(s, winner.seat)];
    }
    recipient.hand = sortHand([...recipient.hand, ...s.kitty]);
    s.kittyClaimed = true;
  }
  s.lastPlay = null;
  for (const p of s.players) p.passedThisTrick = false;
  s.turn = winner.isOut ? nextActiveSeat(s, winner.seat) : winner.seat;
}

/** 所有“未出牌且非上家持有者”的活跃玩家都已 pass → 本回合结束 */
function allOthersPassed(s: GameState): boolean {
  const others = s.players.filter((p) => !p.isOut && p.seat !== s.lastPlayerSeat);
  if (others.length === 0) return true;
  return others.every((p) => p.passedThisTrick);
}

export function applyAction(state: GameState, seat: number, action: Action): GameState {
  if (state.phase !== 'play' || state.roundOver) throw new Error('round-over');
  if (state.turn !== seat) throw new Error('not-your-turn');
  const player = state.players[seat];
  if (player.isOut) throw new Error('already-out');

  const s = cloneState(state);
  const me = s.players[seat];

  if (action.type === 'pass') {
    if (!s.lastPlay) throw new Error('cannot-pass-free-lead');
    me.passedThisTrick = true;
    if (allOthersPassed(s)) {
      resolveTrick(s);
    } else {
      s.turn = nextActiveSeat(s, seat);
    }
    return s;
  }

  // play
  const chosen = pickCards(me.hand, action.cards);
  if (chosen.length !== action.cards.length) throw new Error('cards-not-in-hand');
  const combo = identifyCombo(chosen, s.level, s.rules);
  if (!combo) throw new Error('illegal-combo');
  if (s.lastPlay && !beats(combo, s.lastPlay.combo, s.rules)) throw new Error('cannot-beat');

  me.hand = me.hand.filter((c) => !action.cards.includes(c.id));
  me.passedThisTrick = false;
  for (const p of s.players) p.passedThisTrick = false;
  s.lastPlay = { seat, combo };
  s.lastPlayerSeat = seat;
  s.passCount = 0;

  if (me.hand.length === 0) {
    markOut(s, seat);
  }
  if (checkRoundEnd(s)) {
    settleRound(s);
    return s;
  }
  s.turn = nextActiveSeat(s, seat);
  return s;
}

// ============ 牌型枚举（供提示 / AI） ============

function groupByRank(cards: Card[]): Map<number, Card[]> {
  const m = new Map<number, Card[]>();
  for (const c of cards) {
    if (!m.has(c.rank)) m.set(c.rank, []);
    m.get(c.rank)!.push(c);
  }
  return m;
}

/** 从手牌枚举所有可出的具体牌型 */
export function enumerateCombos(hand: Card[], level: number, rules: Rules): Combo[] {
  const wilds = hand.filter((c) => isWild(c, level, rules));
  const naturals = hand.filter((c) => !isWild(c, level, rules) && !isJoker(c));
  const jokers = hand.filter(isJoker);
  const byRank = groupByRank(naturals);
  const w = wilds.length;
  const out: Combo[] = [];

  // 单张
  for (const c of naturals) out.push({ type: 'single', cards: [c], rank: c.rank, length: 1, bombSize: 0, isBomb: false });
  for (const c of jokers) out.push({ type: 'single', cards: [c], rank: c.rank, length: 1, bombSize: 0, isBomb: false });
  if (w > 0) out.push({ type: 'single', cards: [wilds[0]], rank: level, length: 1, bombSize: 0, isBomb: false });

  // 对子
  for (const [r, cs] of byRank) {
    if (cs.length >= 2) out.push({ type: 'pair', cards: [cs[0], cs[1]], rank: r, length: 2, bombSize: 0, isBomb: false });
    if (cs.length === 1 && w >= 1) out.push({ type: 'pair', cards: [cs[0], wilds[0]], rank: r, length: 2, bombSize: 0, isBomb: false });
  }
  if (w >= 2) out.push({ type: 'pair', cards: wilds.slice(0, 2), rank: level, length: 2, bombSize: 0, isBomb: false });

  // 三张
  for (const [r, cs] of byRank) {
    if (cs.length >= 3) out.push({ type: 'triple', cards: cs.slice(0, 3), rank: r, length: 3, bombSize: 0, isBomb: false });
    if (cs.length === 2 && w >= 1) out.push({ type: 'triple', cards: [...cs, wilds[0]], rank: r, length: 3, bombSize: 0, isBomb: false });
    if (cs.length === 1 && w >= 2) out.push({ type: 'triple', cards: [cs[0], ...wilds.slice(0, 2)], rank: r, length: 3, bombSize: 0, isBomb: false });
  }
  if (w >= 3) out.push({ type: 'triple', cards: wilds.slice(0, 3), rank: level, length: 3, bombSize: 0, isBomb: false });

  // 炸弹（含级牌补位形成 4+）
  for (const [r, cs] of byRank) {
    const c = cs.length;
    if (c === 0) continue;
    for (let b = Math.max(4, c); b <= c + w; b++) {
      const useWild = b - c;
      out.push({
        type: 'bomb',
        cards: [...cs.slice(0, c), ...wilds.slice(0, useWild)],
        rank: r,
        length: b,
        bombSize: b,
        isBomb: true,
      });
    }
  }
  if (w >= 4) {
    for (let b = 4; b <= w; b++) {
      out.push({ type: 'bomb', cards: wilds.slice(0, b), rank: level, length: b, bombSize: b, isBomb: true });
    }
  }
  // 四王炸
  if (jokers.length === 4) out.push({ type: 'king_bomb', cards: jokers, rank: 17, length: 4, bombSize: 4, isBomb: true });

  // 顺子 / 连对 / 钢板
  out.push(...buildRuns(byRank, wilds, w, 1, 'straight', level));
  out.push(...buildRuns(byRank, wilds, w, 2, 'double_straight', level));
  out.push(...buildRuns(byRank, wilds, w, 3, 'triple_straight', level));

  // 同花顺
  for (const suit of SUITS) {
    const suited = naturals.filter((c) => c.suit === suit);
    const bySuitRank = groupByRank(suited);
    out.push(...buildRuns(bySuitRank, wilds, w, 1, 'straight_flush', level));
  }

  return out;
}

function buildRuns(
  byRank: Map<number, Card[]>,
  wilds: Card[],
  w: number,
  groupSize: number,
  type: Combo['type'],
  level: number,
): Combo[] {
  const minLen = groupSize === 1 ? 5 : groupSize === 2 ? 3 : 2;
  const res: Combo[] = [];
  const maxRank = 14;
  for (let L = minLen; L <= 12; L++) {
    for (let a = 3; a + L - 1 <= maxRank; a++) {
      if (level >= 3 && level <= 14 && level >= a && level <= a + L - 1) continue;
      let need = 0;
      let ok = true;
      const usedCards: Card[] = [];
      for (let r = a; r <= a + L - 1; r++) {
        const cs = byRank.get(r);
        const have = cs ? Math.min(cs.length, groupSize) : 0;
        if (cs && cs.length > groupSize) {
          ok = false;
          break;
        }
        need += groupSize - have;
        if (cs) usedCards.push(...cs.slice(0, groupSize));
      }
      if (!ok) continue;
      if (need === w) {
        res.push({
          type,
          cards: [...usedCards, ...wilds.slice(0, need)],
          rank: a + L - 1,
          length: L,
          bombSize: 0,
          isBomb: type === 'straight_flush',
        });
      }
    }
  }
  return res;
}

/** 返回可压制 lastPlay 的所有牌型（lastPlay 为 null 时返回全部） */
export function findBeatingCombos(hand: Card[], level: number, rules: Rules, lastPlay: Combo | null): Combo[] {
  const all = enumerateCombos(hand, level, rules);
  if (!lastPlay) return all;
  return all.filter((c) => beats(c, lastPlay, rules));
}
