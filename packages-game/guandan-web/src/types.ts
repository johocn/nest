// 掼蛋前端与后端视图片段对应的本地类型（与 game-server guandan.types 对齐）

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs' | 'joker';

export interface Card {
  id: string;
  suit: Suit;
  rank: number; // 3..15 -> 3..10,J,Q,K,A,2; 16=小王 17=大王
  joker?: 'small' | 'big';
}

export type ComboType =
  | 'single'
  | 'pair'
  | 'triple'
  | 'triple_pair'
  | 'straight'
  | 'double_straight'
  | 'triple_straight'
  | 'straight_flush'
  | 'bomb'
  | 'four_two'
  | 'four_two_pair'
  | 'king_bomb';

export interface Combo {
  type: ComboType;
  cards: Card[];
  rank: number;
  length: number;
  bombSize: number;
  isBomb: boolean;
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
  isCurrentTurn: boolean;
  hand?: Card[];
  passed?: boolean;
  connected?: boolean;
  hosted?: boolean;
}

export interface CardCounterItem {
  rank: number; // 3..15 点数；16=小王 17=大王
  label: string; // 紧凑标签：3..10,J,Q,K,A,2,小,大
  left: number; // 还剩多少张未现（对手手牌 + 未亮底牌）
  total: number; // 该牌总张数（点数 8 / 王 2）
}

export interface KowtowInfo {
  anti: boolean;
  reason?: 'double-down' | 'joker';
  giverSeat?: number;
  receiverSeat?: number;
  given?: Card;
  returned?: Card;
}

export interface ReplayAction {
  step: number;
  seat: number;
  type: 'play' | 'pass' | 'kitty';
  cards?: Card[];
  comboType?: Combo['type'];
  comboRank?: number;
  comboLength?: number;
  isBomb?: boolean;
}

export interface ReplayRound {
  id: string;
  tableId: string;
  level: number;
  players: { seat: number; nickname: string; isBot: boolean }[];
  initialHands: Card[][];
  actions: ReplayAction[];
  settlement?: {
    winningTeam: number;
    levelUp: number;
    desc: string;
    finishOrders?: Record<number, number>;
  } | null;
  kowtow?: any;
  createdAt: string;
}

export interface FriendItem {
  playerId: string;
  nickname: string;
  online: boolean;
}

export interface RankRow {
  rank: number;
  playerId: string;
  nickname: string;
  games: number;
  wins: number;
  levelUp: number;
  score: number;
  title: string;
}

export interface RankPayload {
  top: RankRow[];
  me: RankRow | null;
  total: number;
}

export interface EmojiEvent {
  seat: number;
  nickname: string;
  emoji: string;
  ts: number;
}

export interface InviteNotice {
  tableId: string;
  from: string;
  fromNickname: string;
}

export interface ClientGameState {
  level: number;
  levelLabel: string;
  phase: string;
  turn: number;
  lastPlay: { seat: number; combo: Combo } | null;
  kittyCount: number;
  roundOver: boolean;
  matchWinner: number | null;
  turnDeadline?: number | null;
  counter?: CardCounterItem[];
  bombCount?: number;
  kowtow?: KowtowInfo | null;
  settlement?: {
    finishOrders: Record<number, number>;
    winningTeam: number;
    levelUp: number;
    desc: string;
  };
  rules: Record<string, any>;
}

export type AiLevel = 'easy' | 'normal' | 'hard';

export interface GameView {
  roomId: string;
  mode: 'ai' | 'net';
  aiLevel?: AiLevel;
  state: ClientGameState;
  awaiting: number[];
  actionHint: Combo[];
  yourSeat: number;
  seated: number;
  players: ClientPlayerState[];
}

export interface HistoryItem {
  tableId: string;
  seat: number;
  team: number;
  levelUp: number;
  isWinner: boolean;
  detail: any;
  levelIndex: number | null;
  status: string | null;
  createdAt: string;
}

export interface AuthResult {
  token: string;
  accountId: string;
  playerId: string;
}
