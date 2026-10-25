/**
 * 斗地主 AI（纯逻辑，零框架依赖）。
 * 能力：
 *   - decideGrab：按手牌强度抢地主（抢 / 明牌抢×2 / 不抢）。
 *   - generateBeats：枚举所有能压过 prev 的合法牌组（用于跟牌 / 提示）。
 *   - decidePlay：跟牌时取最优（尽量不拆炸/王、点数最小）；自由出牌时选最小牌力组合。
 *   - chooseFreePlay：自由出牌策略（顺/连对/飞机优先清小牌，否则出最小单/对）。
 *   - findHints：给玩家的可出提示（自由出牌返回建议一手，跟牌返回所有可压候选）。
 * 设计目标：能稳定自动跑完整局（用于测试与玩家对战 2 个 AI），不追求竞技级最优。
 */

import { Card, countByRank } from './cards';
import { identify, canBeat, CardType } from './rules';

/** 手牌强度评估 0..~40，用于叫分。 */
export function evaluateStrength(hand: Card[]): number {
  const cnt = countByRank(hand);
  let s = 0;
  if (cnt[17]) s += 8; // 大王
  if (cnt[16]) s += 6; // 小王
  s += (cnt[15] || 0) * 4; // 2
  s += (cnt[14] || 0) * 2; // A
  for (const r in cnt) if (cnt[r] === 4) s += 10; // 炸弹
  return s;
}

/** 抢地主决策：按手牌强度决定 抢 / 明牌抢（额外 ×2）/ 不抢。 */
export function decideGrab(
  hand: Card[],
  rng: () => number = Math.random,
): 'grab' | 'mingpai' | 'nograb' {
  const s = evaluateStrength(hand);
  if (s >= 22) return 'mingpai';
  if (s >= 14) return 'grab';
  if (s >= 8) return rng() < 0.5 ? 'grab' : 'nograb';
  return 'nograb';
}

/** 兼容旧叫分 / 测试：明牌抢=3，抢=1，不抢=0。 */
export function decideBid(hand: Card[], _currentMax: number = 0): number {
  const c = decideGrab(hand);
  return c === 'nograb' ? 0 : c === 'mingpai' ? 3 : 1;
}

/** 加倍决策：地主更积极，农民看牌力；默认不抢超级加倍（保守）。 */
export function decideDouble(
  hand: Card[],
  isLandlord: boolean,
): 'none' | 'double' | 'super' {
  const s = evaluateStrength(hand);
  if (isLandlord) return s >= 13 ? 'double' : 'none';
  return s >= 17 ? 'double' : 'none';
}

function byRank(hand: Card[], r: number, n: number): Card[] {
  return hand.filter((c) => c.rank === r).slice(0, n);
}

/** 枚举所有能压过 prev 的合法牌组（prev 为 null 时返回空，用 chooseFreePlay）。 */
export function generateBeats(hand: Card[], prev: CardType | null): Card[][] {
  if (!prev) return [];
  const cnt = countByRank(hand);
  const ranks = Object.keys(cnt)
    .map(Number)
    .sort((a, b) => a - b);
  const res: Card[][] = [];

  const tryPush = (cards: Card[]): void => {
    const t = identify(cards);
    if (t && canBeat(prev, t)) res.push(cards);
  };

  switch (prev.type) {
    case 'single':
      for (const r of ranks) if (r > prev.rank) tryPush(byRank(hand, r, 1));
      break;
    case 'pair':
      for (const r of ranks)
        if (r > prev.rank && cnt[r] >= 2) tryPush(byRank(hand, r, 2));
      break;
    case 'trio':
      for (const r of ranks)
        if (r > prev.rank && cnt[r] >= 3) tryPush(byRank(hand, r, 3));
      break;
    case 'trio_single':
      for (const r of ranks)
        if (r > prev.rank && cnt[r] >= 3) {
          const sgl = hand.find((c) => c.rank !== r);
          if (sgl) tryPush([...byRank(hand, r, 3), sgl]);
        }
      break;
    case 'trio_pair':
      for (const r of ranks)
        if (r > prev.rank && cnt[r] >= 3) {
          const pr = ranks.find((x) => x !== r && cnt[x] >= 2);
          if (pr !== undefined)
            tryPush([...byRank(hand, r, 3), ...byRank(hand, pr, 2)]);
        }
      break;
    case 'bomb':
      for (const r of ranks)
        if (r > prev.rank && cnt[r] === 4) tryPush(byRank(hand, r, 4));
      if (cnt[16] && cnt[17])
        tryPush([...byRank(hand, 16, 1), ...byRank(hand, 17, 1)]);
      break;
    case 'rocket':
      break; // 无法压
    case 'straight': {
      for (let start = 3; start <= 14 - prev.length + 1; start++) {
        const seq: Card[] = [];
        let ok = true;
        for (let i = 0; i < prev.length; i++) {
          const r = start + i;
          if (!(cnt[r] >= 1)) {
            ok = false;
            break;
          }
          seq.push(byRank(hand, r, 1)[0]);
        }
        if (ok) tryPush(seq);
      }
      break;
    }
    case 'straight_pair': {
      for (let start = 3; start <= 14 - prev.length + 1; start++) {
        const seq: Card[] = [];
        let ok = true;
        for (let i = 0; i < prev.length; i++) {
          const r = start + i;
          if (!(cnt[r] >= 2)) {
            ok = false;
            break;
          }
          seq.push(...byRank(hand, r, 2));
        }
        if (ok) tryPush(seq);
      }
      break;
    }
    case 'plane':
    case 'plane_single':
    case 'plane_pair': {
      for (let start = 3; start <= 14 - prev.length + 1; start++) {
        const trioRanks: number[] = [];
        let ok = true;
        for (let i = 0; i < prev.length; i++) {
          const r = start + i;
          if (!(cnt[r] >= 3)) {
            ok = false;
            break;
          }
          trioRanks.push(r);
        }
        if (!ok) continue;
        const trios: Card[] = [];
        for (const r of trioRanks) trios.push(...byRank(hand, r, 3));
        if (prev.type === 'plane') {
          tryPush(trios);
        } else if (prev.type === 'plane_single') {
          const wings = hand
            .filter((c) => !trioRanks.includes(c.rank))
            .slice(0, prev.length);
          if (wings.length === prev.length) tryPush([...trios, ...wings]);
        } else {
          const pairRanks = ranks
            .filter((r) => r >= 3 && !trioRanks.includes(r) && cnt[r] >= 2)
            .slice(0, prev.length);
          if (pairRanks.length === prev.length) {
            const wings: Card[] = [];
            for (const r of pairRanks) wings.push(...byRank(hand, r, 2));
            tryPush([...trios, ...wings]);
          }
        }
      }
      break;
    }
    case 'four_two_single':
      for (const r of ranks)
        if (cnt[r] === 4) {
          const singles = hand.filter((c) => c.rank !== r).slice(0, 2);
          if (singles.length === 2)
            tryPush([...byRank(hand, r, 4), ...singles]);
        }
      break;
    case 'four_two_pair':
      for (const r of ranks)
        if (cnt[r] === 4) {
          const prs = ranks.filter((x) => x !== r && cnt[x] >= 2).slice(0, 2);
          if (prs.length === 2) {
            const wings: Card[] = [];
            for (const x of prs) wings.push(...byRank(hand, x, 2));
            tryPush([...byRank(hand, r, 4), ...wings]);
          }
        }
      break;
  }

  // 炸弹/火箭可压任何非炸弹牌型（此前遗漏，导致 AI 危急时也不会炸）
  if (prev.type !== 'bomb' && prev.type !== 'rocket') {
    for (const r of ranks) if (cnt[r] === 4) tryPush(byRank(hand, r, 4));
    if (cnt[16] && cnt[17])
      tryPush([...byRank(hand, 16, 1), ...byRank(hand, 17, 1)]);
  }
  return res;
}

function scorePlay(cards: Card[]): number {
  const t = identify(cards)!;
  let penalty = 0;
  if (cards.some((c) => c.isJoker)) penalty += 100;
  if (t.type === 'bomb' || t.type === 'rocket') penalty += 50;
  return penalty + t.rank * 1 + cards.length * 0.1;
}

/** 决策上下文：用于农民配合与记牌推算。 */
export interface AiContext {
  landlord: number;
  me: number;
  prevPlayer: number | null;
  teammateHand: number; // 队友剩余手牌数
  landlordHand: number; // 地主剩余手牌数
  /** 最大威胁对手的剩余手牌数（地主看最小农民，农民看地主）。用于判断是否需要炸停。 */
  threatHand: number;
  /** 已出牌统计（记牌推算）：rank → 已出张数。 */
  seen?: Record<number, number>;
}

/** 外面剩余的大牌（2 与王）数量：越多说明对手仍握有控制权，炸弹更该留。 */
function remainingBigOut(hand: Card[], seen: Record<number, number>): number {
  const cnt = countByRank(hand);
  let out = 0;
  for (const r of [15, 16, 17]) {
    const total = r === 15 ? 4 : 1;
    out += total - (cnt[r] || 0) - (seen[r] || 0);
  }
  return Math.max(0, out);
}

/** 该手是否「拆炸」：用了某点数 4 张中的 1-3 张（王不算）。 */
function breaksBomb(beat: Card[], hand: Card[]): boolean {
  const cnt = countByRank(hand);
  const used: Record<number, number> = {};
  for (const c of beat) used[c.rank] = (used[c.rank] || 0) + 1;
  for (const k in used) {
    const rank = Number(k);
    if (rank >= 16) continue;
    if (cnt[rank] === 4 && used[rank] < 4) return true;
  }
  return false;
}

/** 跟牌/自由出牌决策。prev 为 null 表示自由出牌。ctx 提供农民配合与记牌上下文。 */
export function decidePlay(
  hand: Card[],
  prev: CardType | null,
  ctx?: AiContext,
): { pass: boolean; cards: Card[] } {
  const isFarmer = !!(ctx && ctx.me !== ctx.landlord);
  const prevPlayer = ctx ? ctx.prevPlayer : null;
  if (!prev) {
    // 领出分流：农民重控制（先走散单/对，不浪费大牌），地主重清牌（优先完整结构）
    return {
      pass: false,
      cards: isFarmer ? farmerLead(hand) : chooseFreePlay(hand),
    };
  }
  const beats = generateBeats(hand, prev);
  if (beats.length === 0) return { pass: true, cards: [] };

  const prevIsTeammate = !!(
    ctx &&
    isFarmer &&
    prevPlayer !== null &&
    prevPlayer !== ctx.me &&
    prevPlayer !== ctx.landlord
  );

  // 队友出的牌：把控场权留给队友，不压队友；除非能一手走完（抢着赢）
  if (prevIsTeammate) {
    const win = beats.find((b) => b.length === hand.length);
    if (win) return { pass: false, cards: win };
    return { pass: true, cards: [] };
  }

  // 危急（最大威胁对手临近获胜）：能一手赢则赢，否则该炸则炸夺回控制权
  const critical = !!ctx && ctx.threatHand <= 2;
  if (critical) {
    const win = beats.find((b) => b.length === hand.length);
    if (win) return { pass: false, cards: win };
    const bombs = beats.filter((b) => {
      const t = identify(b)!;
      return t.type === 'bomb' || t.type === 'rocket';
    });
    if (bombs.length) {
      bombs.sort((a, b) => scorePlay(a) - scorePlay(b));
      return { pass: false, cards: bombs[0] };
    }
  }

  // 非危急：优先不拆炸，再按牌力最低挑选
  beats.sort((a, b) => {
    const ba = breaksBomb(a, hand) ? 1 : 0;
    const bb = breaksBomb(b, hand) ? 1 : 0;
    if (ba !== bb) return ba - bb;
    return scorePlay(a) - scorePlay(b);
  });
  const best = beats[0];
  const bestType = identify(best)!.type;

  // 能一手走完则直接获胜
  if (best.length === hand.length) return { pass: false, cards: best };

  // 农民跟地主、队友濒危(≤2)且下一手不是队友 → 炸停保护
  if (ctx && isFarmer && prevPlayer === ctx.landlord) {
    const mate = [0, 1, 2].find((i) => i !== ctx.me && i !== ctx.landlord)!;
    const nextIsMate = (ctx.me + 1) % 3 === mate;
    if (!nextIsMate && ctx.teammateHand <= 2) {
      const bomb = beats.find((b) => {
        const t = identify(b)!;
        return t.type === 'bomb' || t.type === 'rocket';
      });
      if (bomb) return { pass: false, cards: bomb };
    }
  }

  // 保存昂贵大牌：仅能靠炸弹/火箭/王压、对手牌还厚(>4)、且非一手赢 → 放弃保存实力
  const usesJoker = best.some((c) => c.isJoker);
  const precious = bestType === 'bomb' || bestType === 'rocket' || usesJoker;
  if (precious && ctx && ctx.threatHand > 4 && best.length < hand.length) {
    const bigOut = ctx.seen ? remainingBigOut(hand, ctx.seen) : 0;
    if (bigOut > 0 || usesJoker) return { pass: true, cards: [] };
  }

  // 农民跟地主、仅有炸弹可压：下一手由队友接且队友仍在局 → 让权、保留炸弹
  const prevIsLandlord = !!(ctx && prevPlayer === ctx.landlord);
  if (
    isFarmer &&
    prevIsLandlord &&
    (bestType === 'bomb' || bestType === 'rocket') &&
    ctx
  ) {
    const teammate = [0, 1, 2].find((i) => i !== ctx.me && i !== ctx.landlord)!;
    if ((ctx.me + 1) % 3 === teammate && ctx.teammateHand > 0) {
      return { pass: true, cards: [] };
    }
  }
  return { pass: false, cards: best };
}

/** 自由出牌（领出）：优先完整结构、不拆炸弹/对子/三张，减少散单。 */
export function chooseFreePlay(hand: Card[]): Card[] {
  // 整手一气呵成直接甩出（残局收割）
  if (identify(hand)) return hand;

  const cnt = countByRank(hand);
  const ranks = Object.keys(cnt)
    .map(Number)
    .sort((a, b) => a - b);

  // 1) 完整结构优先（零拆搭，取最长连续段）
  const straight = longestCleanRun(hand, cnt, 5, 1, 1);
  if (straight) return straight;
  const sp = longestCleanRun(hand, cnt, 3, 2, 2);
  if (sp) return sp;
  const plane = longestCleanRun(hand, cnt, 2, 3, 3);
  if (plane) return plane;

  // 2) 真正的散单（不拆对/三/炸）
  const loneRanks = ranks.filter((r) => cnt[r] === 1 && r <= 15);
  if (loneRanks.length) return byRank(hand, loneRanks[0], 1);
  // 3) 最小的对
  const pairRanks = ranks.filter((r) => cnt[r] === 2 && r <= 15);
  if (pairRanks.length) return byRank(hand, pairRanks[0], 2);
  // 4) 三张（带一张散单翼）
  const trioRanks = ranks.filter((r) => cnt[r] === 3 && r <= 15);
  if (trioRanks.length) {
    const trio = byRank(hand, trioRanks[0], 3);
    const wing = loneRanks.length ? byRank(hand, loneRanks[0], 1) : [];
    return trio.concat(wing);
  }
  // 5) 只剩 王/炸弹
  if (cnt[16] && cnt[17] && ranks.length === 1)
    return byRank(hand, 16, 1).concat(byRank(hand, 17, 1));
  const bombRank = ranks.find((r) => cnt[r] === 4);
  if (bombRank !== undefined) return byRank(hand, bombRank, 4);
  if (cnt[17]) return byRank(hand, 17, 1);
  if (cnt[16]) return byRank(hand, 16, 1);
  return [hand[0]];
}

/** 在 3..14 中找「最长连续段」，每点张数恰为 need、各取 take 张；零拆搭。 */
function longestCleanRun(
  hand: Card[],
  cnt: Record<number, number>,
  minLen: number,
  need: number,
  take: number,
): Card[] | null {
  let best: Card[] | null = null;
  let start = 3;
  while (start <= 14) {
    if (cnt[start] === need) {
      let end = start;
      while (end + 1 <= 14 && cnt[end + 1] === need) end++;
      const len = end - start + 1;
      if (len >= minLen) {
        const out: Card[] = [];
        for (let r = start; r <= end; r++) out.push(...byRank(hand, r, take));
        if (!best || out.length > best.length) best = out;
      }
      start = end + 1;
    } else {
      start++;
    }
  }
  return best;
}

/** 农民领出：重控制权——优先最小散单/对，不送地主、不浪费大牌。 */
function farmerLead(hand: Card[]): Card[] {
  if (identify(hand)) return hand; // 能一手走完直接赢
  const cnt = countByRank(hand);
  const ranks = Object.keys(cnt)
    .map(Number)
    .sort((a, b) => a - b);

  const lone = ranks.filter((r) => cnt[r] === 1 && r <= 15);
  if (lone.length) return byRank(hand, lone[0], 1);
  const pair = ranks.filter((r) => cnt[r] === 2 && r <= 15);
  if (pair.length) return byRank(hand, pair[0], 2);
  const st = longestCleanRun(hand, cnt, 5, 1, 1);
  if (st) return st;
  const sp = longestCleanRun(hand, cnt, 3, 2, 2);
  if (sp) return sp;
  const pl = longestCleanRun(hand, cnt, 2, 3, 3);
  if (pl) return pl;
  const trio = ranks.filter((r) => cnt[r] === 3 && r <= 15);
  if (trio.length) return byRank(hand, trio[0], 3);
  if (cnt[16] && cnt[17] && ranks.length === 1)
    return byRank(hand, 16, 1).concat(byRank(hand, 17, 1));
  const bomb = ranks.find((r) => cnt[r] === 4);
  if (bomb !== undefined) return byRank(hand, bomb, 4);
  if (cnt[17]) return byRank(hand, 17, 1);
  if (cnt[16]) return byRank(hand, 16, 1);
  return [hand[0]];
}

/** 给玩家的可出提示：自由出牌返回建议一手；跟牌返回所有可压候选（UI 可循环高亮）。 */
export function findHints(hand: Card[], prev: CardType | null): Card[][] {
  if (!prev) return [chooseFreePlay(hand)];
  return generateBeats(hand, prev);
}
