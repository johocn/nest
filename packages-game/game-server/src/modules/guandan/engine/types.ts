// 掼蛋纯函数引擎：类型定义（无 Nest 依赖，可单测）

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs' | 'joker';

/** big=大王(红)，small=小王(黑) */
export type JokerType = 'big' | 'small';

export interface Card {
  /** 牌实例唯一 id（同副牌内唯一），如 'spades-3#0' */
  id: string;
  suit: Suit;
  /** 3..15 映射：3=3 ... 10=10, J=11, Q=12, K=13, A=14, 2=15；王：small=16, big=17 */
  rank: number;
  joker?: JokerType;
}

export type ComboType =
  | 'single' // 单张
  | 'pair' // 对子
  | 'triple' // 三张
  | 'triple_pair' // 三带二
  | 'straight' // 顺子（≥5 连单）
  | 'double_straight' // 连对（≥3 连对）
  | 'triple_straight' // 钢板（≥2 连三）
  | 'straight_flush' // 同花顺（花炸）
  | 'bomb' // 炸弹（级牌可补位形成更大炸弹）
  | 'four_two' // 四带二（单）
  | 'four_two_pair' // 四带两对
  | 'king_bomb'; // 四王炸

export interface Combo {
  type: ComboType;
  cards: Card[];
  /** 比较用决定点数（单/对/三/顺子顶张/炸弹点数） */
  rank: number;
  /** 顺子/连对/钢板的连续组数；其余为总牌数 */
  length: number;
  /** 炸弹类牌数（4+），非炸弹为 0 */
  bombSize: number;
  /** 是否为炸弹类（炸弹/同花顺/四王炸），可压非炸弹 */
  isBomb: boolean;
}

export type Phase = 'deal' | 'play' | 'ended';

export type ActionType = 'play' | 'pass';

export interface PlayAction {
  type: 'play';
  /** 出牌的卡牌 id 列表 */
  cards: string[];
}
export interface PassAction {
  type: 'pass';
}
export type Action = PlayAction | PassAction;

export interface PlayerState {
  seat: number;
  hand: Card[];
  isBot: boolean;
  partnerSeat: number;
  /** 是否已走完（出完手牌） */
  isOut: boolean;
  /** 走完顺序：1=头游 ... 4=末游；0 表示未走完 */
  finishOrder: number;
  /** 本回合是否已 pass（用于判定 trick 结束） */
  passedThisTrick: boolean;
}

/** 规则开关：标准玩法之上支持地方变体 */
export interface Rules {
  /** 非红桃级牌是否同为百搭（默认仅红桃级牌为逢人配） */
  nonHeartLevelWild: boolean;
  /** 同花顺是否严格大于普通炸弹（默认 true） */
  straightFlushOverBomb: boolean;
  /** 六连及以上炸弹是否大于四王炸（默认 false） */
  sixBombOverKingBomb: boolean;
  /** 过 A 需头游且搭档非末流（默认 true） */
  passAOnlyTop: boolean;
  /** 底牌（8 张）交给首回合赢家（默认 true） */
  kittyToFirstTrickWinner: boolean;
}

export const DEFAULT_RULES: Rules = {
  nonHeartLevelWild: false,
  straightFlushOverBomb: true,
  sixBombOverKingBomb: false,
  passAOnlyTop: true,
  kittyToFirstTrickWinner: true,
};

export interface RoundSettlement {
  /** 走完顺序：seat -> finishOrder(1..4) */
  finishOrders: Record<number, number>;
  /** 获胜队伍（0=座位0&2，1=座位1&3） */
  winningTeam: number;
  /** 本回合升级数 */
  levelUp: number;
  /** 升级描述 */
  desc: string;
}

/** 进贡/还贡（贡还）信息，用于开局展示 */
export interface KowtowInfo {
  /** 是否抗贡（免贡） */
  anti: boolean;
  /** 抗贡原因：'double-down'=双下, 'joker'=末游最大牌为王 */
  reason?: 'double-down' | 'joker';
  /** 进贡者座位（末游） */
  giverSeat?: number;
  /** 收贡者座位（头游） */
  receiverSeat?: number;
  /** 进贡打出的牌（末游最大牌） */
  given?: Card;
  /** 还贡的牌（头游最小牌） */
  returned?: Card;
}

export interface GameState {
  /** 当前级数的 rank 值：15=2 ... 14=A */
  level: number;
  /** 级数在 LEVEL_SEQUENCE 中的下标 0..12（12=A） */
  levelIndex: number;
  phase: Phase;
  /** 当前出牌座位 */
  turn: number;
  /** 上一手有效出牌的座位（trick 当前持有者） */
  lastPlayerSeat: number;
  players: PlayerState[];
  lastPlay: { seat: number; combo: Combo } | null;
  /** 当前 trick 连续 pass 数 */
  passCount: number;
  /** 底牌（8 张） */
  kitty: Card[];
  /** 底牌是否已发放 */
  kittyClaimed: boolean;
  /** 本回合已打出的所有牌（用于记牌器统计剩余） */
  played: Card[];
  /** 是否已完成一回合（等待开下一回合） */
  roundOver: boolean;
  /** 整局胜负：冠军队（0/1），未分胜负为 null */
  matchWinner: number | null;
  /** 最近一次回合结算 */
  lastSettlement: RoundSettlement | null;
  /** 本回合开局贡还信息（进贡/还贡/抗贡），无则为 null */
  kowtow: KowtowInfo | null;
  /** 本回合已出现的炸弹数（含王炸/同花顺炸），用于前端音效触发 */
  bombCount: number;
  /** 本回合动作日志（回放用，开局/贡还后清空） */
  log: GameLogEntry[];
  /** 本回合开局手牌快照（贡还之后），回放起点：index=座位 */
  initialHands: Card[][];
  rules: Rules;
}

/** AI 强度档位：easy=新手, normal=标准, hard=高手 */
export type AiLevel = 'easy' | 'normal' | 'hard';

/** 回放动作日志条目 */
export interface GameLogEntry {
  step: number;
  seat: number;
  /** play=出牌, pass=过牌, kitty=领取底牌 */
  type: 'play' | 'pass' | 'kitty';
  /** 出牌/底牌的具体牌；pass 为空 */
  cards?: Card[];
  comboType?: Combo['type'];
  comboRank?: number;
  comboLength?: number;
  isBomb?: boolean;
}
