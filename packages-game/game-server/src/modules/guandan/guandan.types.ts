// 掼蛋模块对外类型：动作、下发视图（隐藏他人手牌/牌墙）

import { Card, Combo, Rules } from './engine';

export interface ActionDto {
  type: 'play' | 'pass';
  /** 出牌的卡牌 id 列表（play 时必填） */
  cards?: string[];
}

export interface ClientPlayerState {
  seat: number;
  playerId: string | null;
  nickname: string;
  isBot: boolean;
  isOut: boolean;
  finishOrder: number;
  partnerSeat: number;
  handCount: number;
  /** 是否为当前出牌者 */
  isCurrentTurn: boolean;
  /** 本人视角才返回手牌与可操作的牌型提示 */
  hand?: Card[];
  actionHint?: Combo[];
  passed?: boolean;
}

export interface ClientGameState {
  level: number;
  levelLabel: string;
  phase: string;
  turn: number;
  lastPlay: { seat: number; combo: { type: string; cards: Card[]; rank: number; length: number } } | null;
  kittyCount: number;
  roundOver: boolean;
  matchWinner: number | null;
  settlement?: any;
  rules: Rules;
}

export interface GameView {
  roomId: string;
  mode: 'ai' | 'net';
  state: ClientGameState;
  /** 每位玩家的可见信息（手牌数/是否出完/是否轮到/昵称等） */
  players: ClientPlayerState[];
  /** 当前可操作的座位 */
  awaiting: number[];
  /** 本人合法牌型提示（yourSeat 视角） */
  actionHint: Combo[];
  yourSeat: number;
  seated: number;
}
