import { GameState, PlayerState, ActionType, Suit, Tile } from './engine';

/** 客户端下发的动作（与引擎 Action 对齐，额外携带 seat 由服务端裁定） */
export interface ActionDto {
  type: ActionType;
  tile?: Tile;
  suit?: Suit;
}

/** 下发给客户端的玩家状态：他人手牌被遮蔽时只提供张数 */
export interface ClientPlayerState extends PlayerState {
  handCount?: number;
}

/** 下发给客户端的牌局状态：牌墙被遮蔽时只提供剩余张数 */
export interface ClientGameState extends Omit<GameState, 'players'> {
  players: ClientPlayerState[];
  wallCount?: number;
}

/** 返回给客户端的牌桌视图（与前端 store 约定一致） */
export interface GameView {
  roomId: string;
  mode: 'ai' | 'net';
  state: ClientGameState;
  awaiting: number[];
  actionHint: ActionType[];
  yourSeat: number;
  /** 已入座人数（含 AI 座位），用于展示同桌人数 n/4 */
  seated: number;
}
