// 斗地主对外协议类型：客户端动作（ActionDto）与下发视图（View）。

import { Card } from './engine';
import { CardType } from './engine';

/** 客户端上行动作。play 用 card id 列表（服务端再解析为 Card 对象）。 */
export type DoudizhuActionDto =
  | { type: 'bid'; choice: 'grab' | 'mingpai' | 'nograb' }
  | { type: 'double'; action: 'none' | 'double' | 'super' }
  | { type: 'play'; cards: string[] }
  | { type: 'pass' };

export type DoudizhuMode = 'ai' | 'net';

/** 单座位可见信息（他人手牌仅暴露张数与最后出牌，本人视角返回手牌与提示） */
export interface DoudizhuClientPlayer {
  seat: number;
  playerId: string | null;
  nickname: string;
  isBot: boolean;
  handCount: number;
  isCurrent: boolean;
  isLandlord: boolean;
  lastPlay: { cards: Card[]; type: CardType } | null;
  /** 仅本人视角（或当局结束后）返回 */
  hand?: Card[];
  /** 本人轮到出牌时返回可压牌组提示 */
  actionHint?: Card[][];
  connected: boolean;
  hosted: boolean;
}

export interface DoudizhuClientState {
  phase: string;
  current: number;
  landlord: number;
  multiplier: number;
  baseScore: number;
  /** 底牌（定地主后展示，否则空数组） */
  bottom: Card[];
  lastPlay: { seat: number; cards: Card[]; type: CardType } | null;
  spring: string;
  scores: [number, number, number];
  winner: number;
  landlordWin: boolean;
  doubleMode: boolean;
  doubleDecisions: (string | undefined)[];
  turnDeadline: number | null;
  /** 记牌器：rank -> 已出现张数 */
  playedCount: Record<number, number>;
}

export interface DoudizhuView {
  roomId: string;
  mode: DoudizhuMode;
  state: DoudizhuClientState;
  players: DoudizhuClientPlayer[];
  yourSeat: number;
  seated: number;
  /** 当前可操作的座位（仅本人轮到时含本人） */
  awaiting: number[];
}

/** 复盘动作日志条目 */
export interface DoudizhuActionLogEntry {
  seat: number;
  type: 'bid' | 'double' | 'play' | 'pass';
  choice?: 'grab' | 'mingpai' | 'nograb';
  action?: 'none' | 'double' | 'super';
  cards?: string[];
}
