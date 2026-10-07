import {
  GameState,
  PlayerState,
  Tile,
  Suit,
  Action,
  ActionType,
  Meld,
  SettlementResult,
} from './types';
import { createTiles, shuffle, toCounts, sameTile, sortHand, tileId } from './tiles';
import { isHu, satisfiesQueMen, getTing } from './hu';
import { scoreHand } from './fan';

const DEAL_COUNT = 13;
const CHA_SCORE = 2; // 查叫赔付基准分

function clone(state: GameState): GameState {
  return structuredClone(state);
}

function activeSeats(state: GameState): number[] {
  return state.players.filter((p) => !p.isHu).map((p) => p.seat);
}

function nextActiveAfter(state: GameState, from: number): number | null {
  for (let i = 1; i <= 4; i++) {
    const s = (from + i) % 4;
    if (!state.players[s].isHu) return s;
  }
  return null;
}

function emptyPlayer(seat: number, isDealer: boolean): PlayerState {
  return {
    seat,
    hand: [],
    melds: [],
    discards: [],
    queuedSuit: null,
    isHu: false,
    isDealer,
  };
}

export function createGame(mode: 'ai' | 'net' = 'ai', rng: () => number = Math.random): GameState {
  const wall = shuffle(createTiles(), rng);
  const players = [0, 1, 2, 3].map((s) => emptyPlayer(s, s === 0));
  for (const p of players) {
    for (let i = 0; i < DEAL_COUNT; i++) p.hand.push(wall.pop()!);
    p.hand = sortHand(p.hand);
  }
  return {
    wall,
    players,
    turn: 0,
    phase: 'queMen',
    round: 0,
    mode,
    huCount: 0,
    huSeats: [],
    ended: false,
    gangScores: { 0: 0, 1: 0, 2: 0, 3: 0 },
    scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
  };
}

/** 设定缺门；四人齐后开局（庄家摸牌） */
export function submitQueMen(state: GameState, seat: number, suit: Suit): GameState {
  const s = clone(state);
  s.players[seat].queuedSuit = suit;
  if (s.players.every((p) => p.queuedSuit)) startRound(s);
  return s;
}

function startRound(s: GameState) {
  s.turn = 0;
  s.phase = 'discard';
  s.firstAction = true;
  drawForTurn(s, 0, false);
}

function drawForTurn(s: GameState, seat: number, gang: boolean) {
  if (s.wall.length === 0) {
    finalize(s);
    return;
  }
  const t = s.wall.pop()!;
  s.players[seat].hand.push(t);
  s.players[seat].hand = sortHand(s.players[seat].hand);
  s.lastDrawn = t;
  s.lastTileDrawn = s.wall.length === 0;
  s.gangThisTurn = gang;
  s.turn = seat;
  s.phase = 'discard';
}

// ---------- 判定辅助 ----------
function meldsFull(p: PlayerState) {
  return p.melds.length >= 4;
}

export function canSelfHu(s: GameState, seat: number): boolean {
  const p = s.players[seat];
  if (p.isHu) return false;
  const r = isHu(p.hand, p.melds);
  return (r.standard || r.qidui !== null) && satisfiesQueMen(p.hand, p.queuedSuit);
}

export function canPeng(s: GameState, seat: number, tile: Tile): boolean {
  const p = s.players[seat];
  if (p.isHu || meldsFull(p) || tile.suit === p.queuedSuit) return false;
  return p.hand.filter((t) => sameTile(t, tile)).length >= 2;
}

export function canMingGang(s: GameState, seat: number, tile: Tile): boolean {
  const p = s.players[seat];
  if (p.isHu || meldsFull(p) || tile.suit === p.queuedSuit) return false;
  return p.hand.filter((t) => sameTile(t, tile)).length >= 3;
}

export function canHuOnTile(s: GameState, seat: number, tile: Tile): boolean {
  const p = s.players[seat];
  if (p.isHu || tile.suit === p.queuedSuit) return false;
  const test = [...p.hand, tile];
  const r = isHu(test, p.melds);
  return (r.standard || r.qidui !== null) && satisfiesQueMen(test, p.queuedSuit);
}

/** 当前出牌座位可执行的动作（出牌/自摸/暗杠或加杠） */
export function getTurnActions(s: GameState, seat: number): ActionType[] {
  if (s.phase !== 'discard' || s.turn !== seat) return [];
  const p = s.players[seat];
  const acts: ActionType[] = ['discard'];
  if (canSelfHu(s, seat)) acts.push('hu');
  if (canAngang(p) || canBugang(p)) acts.push('gang');
  return acts;
}

function canAngang(p: PlayerState): boolean {
  const counts = toCounts(p.hand);
  return counts.some((c) => c === 4);
}

function canBugang(p: PlayerState): boolean {
  return p.melds.some(
    (m) => (m.type === 'peng' || m.type === 'bugang') && p.hand.some((t) => sameTile(t, m.tile)),
  );
}

/** 一巡弃牌后其余座位的合法响应 */
export function getResponses(s: GameState): { seat: number; actions: ActionType[] }[] {
  if (s.phase !== 'response' || !s.lastDiscard) return [];
  const out: { seat: number; actions: ActionType[] }[] = [];
  for (const p of s.players) {
    if (p.seat === s.lastDiscardSeat || p.isHu) continue;
    const acts: ActionType[] = [];
    if (canHuOnTile(s, p.seat, s.lastDiscard)) acts.push('hu');
    if (canPeng(s, p.seat, s.lastDiscard)) acts.push('peng');
    if (canMingGang(s, p.seat, s.lastDiscard)) acts.push('gang');
    if (acts.length) out.push({ seat: p.seat, actions: acts });
  }
  return out;
}

// ---------- 执行动作 ----------
function checkAndPopDiscard(s: GameState, fromSeat: number) {
  const arr = s.players[fromSeat].discards;
  arr.pop();
}

export function submitTurnAction(s: GameState, seat: number, action: Action): GameState {
  if (s.phase !== 'discard' || s.turn !== seat) return s;
  if (action.type === 'discard' && action.tile) return doDiscard(s, seat, action.tile);
  if (action.type === 'hu') return doSelfHu(s, seat);
  if (action.type === 'gang' && action.tile) return doTurnGang(s, seat, action.tile);
  return s;
}

function doDiscard(s: GameState, seat: number, tile: Tile): GameState {
  const ns = clone(s);
  const p = ns.players[seat];
  const idx = p.hand.findIndex((t) => sameTile(t, tile));
  if (idx === -1) return s;
  // 缺门约束：手中仍有缺门牌时必须先打缺门
  const queued = p.queuedSuit;
  if (queued) {
    const hasQueued = p.hand.some((t) => t.suit === queued);
    if (hasQueued && tile.suit !== queued) return s; // 非法，忽略
  }
  p.hand.splice(idx, 1);
  p.hand = sortHand(p.hand);
  p.discards.push(tile);
  ns.lastDiscard = tile;
  ns.lastDiscardSeat = seat;
  ns.pendingSeat = seat;
  ns.firstAction = false;
  ns.responses = getResponses(ns);
  if (ns.responses.length === 0) {
    ns.responses = undefined;
    proceedAfterResolved(ns);
  } else {
    ns.phase = 'response';
  }
  return ns;
}

function doSelfHu(s: GameState, seat: number): GameState {
  if (!canSelfHu(s, seat)) return s;
  const ns = clone(s);
  markHu(ns, seat, ns.lastDrawn!, true, false);
  if (!checkEnd(ns)) proceedAfterResolved(ns);
  return ns;
}

function doTurnGang(s: GameState, seat: number, tile: Tile): GameState {
  const p = s.players[seat];
  const cnt = p.hand.filter((t) => sameTile(t, tile)).length;
  // 暗杠
  if (cnt === 4) {
    const ns = clone(s);
    const np = ns.players[seat];
    for (let i = 0; i < 4; i++) np.hand.splice(np.hand.findIndex((t) => sameTile(t, tile)), 1);
    np.melds.push({ type: 'angang', tile, concealed: true });
    for (let o = 0; o < 4; o++) {
      if (o === seat) continue;
      ns.scores[o] -= 2;
      ns.scores[seat] += 2;
      ns.gangScores[seat] += 2;
    }
    drawForTurn(ns, seat, true);
    return ns;
  }
  // 加杠（抢杠）
  if (canBugang(p) && p.melds.some((m) => (m.type === 'peng' || m.type === 'bugang') && sameTile(m.tile, tile))) {
    const ns = clone(s);
    // 抢杠判定：他人可胡该牌
    const robbers = ns.players.filter(
      (op) => op.seat !== seat && !op.isHu && canHuOnTile(ns, op.seat, tile),
    );
    if (robbers.length) {
      const rb = robbers[0];
      const npp = ns.players[seat];
      npp.hand.splice(npp.hand.findIndex((t) => sameTile(t, tile)), 1);
      const m = npp.melds.find((mm) => (mm.type === 'peng' || mm.type === 'bugang') && sameTile(mm.tile, tile))!;
      m.type = 'bugang';
      markHu(ns, rb.seat, tile, false, true, seat);
      if (!checkEnd(ns)) proceedAfterResolved(ns);
      else finalize(ns);
      return ns;
    }
    const npp = ns.players[seat];
    npp.hand.splice(npp.hand.findIndex((t) => sameTile(t, tile)), 1);
    const m = npp.melds.find((mm) => (mm.type === 'peng' || mm.type === 'bugang') && sameTile(mm.tile, tile))!;
    m.type = 'bugang';
    for (let o = 0; o < 4; o++) {
      if (o === seat) continue;
      ns.scores[o] -= 1;
      ns.scores[seat] += 1;
      ns.gangScores[seat] += 1;
    }
    drawForTurn(ns, seat, true);
    return ns;
  }
  return s;
}

/** 弃牌响应裁决：choices 为各响应座位的动作（缺省视为过） */
export function resolveDiscard(s: GameState, choices: Record<number, ActionType>): GameState {
  if (s.phase !== 'response') return s;
  const ns = clone(s);
  const resp = getResponses(ns);
  const huSeats = resp.filter((r) => choices[r.seat] === 'hu' && r.actions.includes('hu')).map((r) => r.seat);
  if (huSeats.length) {
    for (const seat of huSeats) markHu(ns, seat, ns.lastDiscard!, false, false, ns.lastDiscardSeat);
    if (!checkEnd(ns)) proceedAfterResolved(ns);
    else finalize(ns);
    return ns;
  }
  const pg = resp.filter(
    (r) => (choices[r.seat] === 'peng' && r.actions.includes('peng')) || (choices[r.seat] === 'gang' && r.actions.includes('gang')),
  );
  if (pg.length) {
    const discarder = ns.lastDiscardSeat!;
    pg.sort((a, b) => ((a.seat - discarder + 4) % 4) - ((b.seat - discarder + 4) % 4));
    const w = pg[0];
    const tile = ns.lastDiscard!;
    if (choices[w.seat] === 'gang') doMingGang(ns, w.seat, tile, discarder);
    else doPeng(ns, w.seat, tile, discarder);
    return ns;
  }
  proceedAfterResolved(ns);
  return ns;
}

function doPeng(s: GameState, seat: number, tile: Tile, fromSeat: number) {
  const p = s.players[seat];
  let removed = 0;
  p.hand = p.hand.filter((t) => {
    if (removed < 2 && sameTile(t, tile)) {
      removed++;
      return false;
    }
    return true;
  });
  p.melds.push({ type: 'peng', tile, fromSeat });
  checkAndPopDiscard(s, fromSeat);
  s.turn = seat;
  s.phase = 'discard';
}

function doMingGang(s: GameState, seat: number, tile: Tile, fromSeat: number) {
  const p = s.players[seat];
  let removed = 0;
  p.hand = p.hand.filter((t) => {
    if (removed < 3 && sameTile(t, tile)) {
      removed++;
      return false;
    }
    return true;
  });
  p.melds.push({ type: 'gang', tile, fromSeat });
  s.scores[fromSeat] -= 2;
  s.scores[seat] += 2;
  s.gangScores[seat] += 2;
  checkAndPopDiscard(s, fromSeat);
  drawForTurn(s, seat, true);
}

function markHu(
  s: GameState,
  seat: number,
  tile: Tile,
  selfDraw: boolean,
  robbed: boolean,
  payerSeat?: number,
) {
  const p = s.players[seat];
  const evalHand = [...p.hand, tile];
  const r = isHu(evalHand, p.melds);
  const pattern = r.standard ? 'standard' : r.qidui || 'qidui';
  const fan = scoreHand(evalHand, p.melds, {
    selfDraw,
    robbed,
    gangFlowers: s.gangThisTurn,
    lastTile: s.lastTileDrawn,
    isDealer: p.isDealer,
    firstAction: s.firstAction,
  });
  p.isHu = true;
  p.huResult = { isHu: true, pattern, winningTile: tile, selfDraw, robbed };
  s.huSeats.push(seat);
  s.huCount++;
  if (selfDraw) {
    // 自摸：每位未胡玩家各付全额给赢家（血战到底已胡者退出不付费）
    for (let o = 0; o < 4; o++) {
      if (o !== seat && !s.players[o].isHu) {
        s.scores[o] -= fan.score;
        s.scores[seat] += fan.score;
      }
    }
  } else {
    const payer = payerSeat ?? s.lastDiscardSeat!;
    if (!s.players[payer].isHu) {
      s.scores[payer] -= fan.score;
      s.scores[seat] += fan.score;
    }
  }
}

function proceedAfterResolved(s: GameState) {
  if (checkEnd(s)) return;
  const ns = nextActiveAfter(s, s.lastDiscardSeat!);
  if (ns === null) {
    finalize(s);
    return;
  }
  drawForTurn(s, ns, false);
}

function checkEnd(s: GameState): boolean {
  const active = activeSeats(s);
  if (active.length <= 1) {
    finalize(s);
    return true;
  }
  return false;
}

function finalize(s: GameState) {
  if (s.ended) return; // 幂等，避免重复结算（查叫赔付被叠加）
  s.ended = true;
  s.phase = 'ended';
  const ting: Record<number, boolean> = {};
  for (const p of s.players) {
    ting[p.seat] = p.isHu || getTing(p.hand, p.melds, p.queuedSuit).length > 0;
  }
  const details: Record<number, string> = {};
  for (const p of s.players) {
    if (!p.isHu && !ting[p.seat]) {
      for (const o of s.players) {
        if (o.seat === p.seat) continue;
        if (ting[o.seat]) {
          s.scores[p.seat] -= CHA_SCORE;
          s.scores[o.seat] += CHA_SCORE;
          details[p.seat] = (details[p.seat] ? details[p.seat] + '；' : '') + `查叫赔付 Seat${o.seat} ${CHA_SCORE}`;
        }
      }
    }
  }
  const result: SettlementResult = {
    scores: { ...s.scores },
    details: Object.fromEntries(s.players.map((p) => [p.seat, details[p.seat] || '无'])),
    draw: s.wall.length === 0,
  };
  s.settlement = result;
}

// 避免未使用告警
void tileId;
