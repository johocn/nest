// 四川麻将(血战到底)核心类型定义

export type Suit = 'm' | 's' | 'p'; // 万 / 条 / 筒（无字牌、无花牌）

export interface Tile {
  suit: Suit;
  rank: number; // 1-9
}

export type MeldType = 'peng' | 'gang' | 'angang' | 'bugang';

export interface Meld {
  type: MeldType;
  tile: Tile; // 刻子/杠的中心牌
  fromSeat?: number; // 碰/明杠的来源座位（用于刮风下雨算分）
  concealed?: boolean; // 暗杠隐藏
}

export type Phase = 'queMen' | 'discard' | 'response' | 'ended';

export type ActionType =
  | 'queMen'
  | 'draw'
  | 'discard'
  | 'peng'
  | 'gang'
  | 'hu'
  | 'pass';

export interface Action {
  type: ActionType;
  seat: number;
  tile?: Tile; // queMen 的目标牌 / discard 打出的牌
}

export interface HuResult {
  isHu: true;
  pattern: 'standard' | 'qidui' | 'longqidui';
  winningTile: Tile;
  selfDraw: boolean; // 自摸
  robbed?: boolean; // 抢杠胡
}

export interface PlayerState {
  seat: number;
  hand: Tile[]; // 手牌（不含已碰杠）
  melds: Meld[];
  discards: Tile[]; // 牌河
  queuedSuit: Suit | null; // 定缺门
  isHu: boolean;
  huResult?: HuResult;
  isDealer: boolean; // 庄家（天胡/地胡判定）
}

export interface FanItem {
  name: string;
  count: number; // 该番出现次数
}

export interface FanResult {
  fans: FanItem[];
  totalFan: number; // 总番数
  base: number; // 底分
  multiplier: number; // 2^totalFan（封顶）
  score: number; // 本局该玩家应收（未乘人数）
  detail: string;
}

export interface GameState {
  wall: Tile[]; // 牌墙（剩余可摸）
  players: PlayerState[];
  turn: number; // 当前应出牌/摸牌的座位
  phase: Phase;
  lastDiscard?: Tile;
  lastDiscardSeat?: number;
  pendingSeat?: number; // 刚打出牌的座位，其余玩家响应
  round: number; // 回合计数
  mode: 'ai' | 'net';
  huCount: number; // 已胡人数（血战到底）
  huSeats: number[]; // 已胡座位
  firstAction?: boolean; // 首巡标记（天胡/地胡）
  lastTileDrawn?: boolean; // 刚摸到的是否为最后一张（海底捞月）
  // 响应窗口：每个可响应座位的合法动作
  responses?: { seat: number; actions: ActionType[] }[];
  lastDrawn?: Tile; // 最近摸到的牌（杠上开花/海底判定）
  gangThisTurn?: boolean; // 本次摸牌是否因杠触发（用于杠上开花）
  ended: boolean;
  // 刮风下雨累计分：seat -> 分数（来自杠）
  gangScores: Record<number, number>;
  // 实时累计净分：seat -> 分数（胡分 + 杠分 + 查叫）
  scores: Record<number, number>;
  // 终局结算结果
  settlement?: SettlementResult;
  winnerLog?: string[];
}

export interface SettlementResult {
  scores: Record<number, number>; // 最终净分（含胡分+杠分-查叫）
  details: Record<number, string>;
  draw: boolean; // 是否流局（查叫）
}
