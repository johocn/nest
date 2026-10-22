// 斗地主权威引擎封装层（服务端化）。
// 底层 cards/rules/game/ai/matchMode/props/economy 为从 tour-game 原样移植的纯 TS 逻辑。
// 这里提供序列化/反序列化、bot 决策与牌组解析的薄封装，供 doudizhu-table.service 调用。

export * from './cards';
export * from './rules';
export * from './game';
export * from './ai';
// matchMode / props / economy 暂不暴露给桌态层（当前 P0-1 仅用核心对局 + AI）

import { DoudizhuGame } from './game';
import { Card } from './cards';
import { decideGrab, decideDouble, decidePlay } from './ai';

export type AiLevel = 'easy' | 'normal' | 'hard';

/** 将 DoudizhuGame 实例序列化为可存 Redis 的纯对象（方法/函数字段自动丢失，重建时注入）。 */
export function serializeGame(g: DoudizhuGame): Record<string, any> {
  return JSON.parse(JSON.stringify(g));
}

/** 从序列化对象恢复为可操作的 DoudizhuGame 实例（重新注入 rng/onEvent）。 */
export function restoreGame(json: Record<string, any>): DoudizhuGame {
  const g = new DoudizhuGame({ rng: Math.random, onEvent: undefined });
  Object.assign(g, json);
  return g;
}

/** 根据客户端传来的 card id 列表，从手牌中解析出对应的 Card 对象。 */
export function resolveCardsById(hand: Card[], ids: string[]): Card[] {
  return ids
    .map((id) => hand.find((c) => c.id === id))
    .filter((c): c is Card => !!c);
}

/** 累加已出牌张数（记牌器数据源）。 */
export function addPlayedCount(
  played: Record<number, number>,
  cards: Card[],
): void {
  for (const c of cards) played[c.rank] = (played[c.rank] ?? 0) + 1;
}

export type BotAction =
  | { type: 'bid'; choice: 'grab' | 'mingpai' | 'nograb' }
  | { type: 'double'; action: 'none' | 'double' | 'super' }
  | { type: 'play'; cards: Card[] }
  | { type: 'pass' };

/** 依据当前阶段为某座位生成 AI 决策（抢地主 / 加倍 / 出牌 / 不出）。 */
export function chooseBotAction(
  g: DoudizhuGame,
  seat: number,
  level: AiLevel,
  seen?: Record<number, number>,
): BotAction {
  if (g.phase === 'bidding') {
    let choice = decideGrab(g.hands[seat], Math.random);
    if (level === 'easy' && Math.random() < 0.5) choice = 'nograb';
    return { type: 'bid', choice };
  }
  if (g.phase === 'doubling') {
    let action: 'none' | 'double' | 'super' = decideDouble(
      g.hands[seat],
      seat === g.landlord,
    );
    if (level === 'easy' && Math.random() < 0.4) action = 'none';
    return { type: 'double', action };
  }
  // playing 阶段
  const prev = g.lastPlay ? g.lastPlay.type : null;
  const teammate =
    [0, 1, 2].find((i) => i !== seat && i !== g.landlord) ?? seat;
  const ctx: any =
    g.landlord >= 0
      ? {
          landlord: g.landlord,
          me: seat,
          prevPlayer: g.lastPlay ? g.lastPlay.player : null,
          teammateHand: g.hands[teammate].length,
          landlordHand: g.hands[g.landlord].length,
          threatHand: g.hands[teammate].length,
          seen,
        }
      : undefined;
  const d = decidePlay(g.hands[seat], prev, ctx);
  if (d.pass) return { type: 'pass' };
  return { type: 'play', cards: d.cards };
}
