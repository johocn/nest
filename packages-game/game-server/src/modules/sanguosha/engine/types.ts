// 三国杀标准身份局 · 引擎类型与默认规则（纯数据类型，无副作用）

import {
  Identity,
  SgsCardType,
  SgsEquipType,
  SgsPhase,
  SgsSuit,
} from '@constants/enums';

/** 卡牌定义 id（逻辑标识） */
export type CardDefId =
  | 'sha' // 杀
  | 'shan' // 闪
  | 'tao' // 桃
  | 'jie_dou' // 决斗
  | 'nan_man' // 南蛮入侵
  | 'wan_jian' // 万箭齐发
  | 'tao_yuan' // 桃园结义
  | 'wu_zhong' // 无中生有
  | 'wu_gu' // 五谷丰登
  | 'chai_qiao' // 过河拆桥
  | 'shun_shou' // 顺手牵羊
  | 'shan_dian' // 闪电（延时）
  | 'le_bu' // 乐不思蜀（延时）
  | 'bing_liang' // 兵粮寸断（延时）
  | 'wu_xie' // 无懈可击
  | 'zhu_ge_crossbow' // 诸葛连弩
  | 'qing_long' // 青釭剑（简化：+1 距离）
  | 'gu_dao' // 古锭刀（简化）
  | 'ba_gua' // 八卦阵（防具）
  | 'di_lu' // 的卢（+1 马）
  | 'chi_tu' // 赤兔（-1 马）
  ;

/** 一张牌的实例（带唯一 id） */
export interface SgsCard {
  id: string;
  defId: CardDefId;
  name: string;
  type: SgsCardType;
  suit: SgsSuit;
  /** 点数 1~13（A=1, J=11, Q=12, K=13） */
  number: number;
  /** 锦囊子类型 */
  trickKind?: string;
  /** 装备子类 */
  equipType?: SgsEquipType;
  /** 武器攻击距离（默认 1） */
  attackRange?: number;
  /** 是否延时锦囊（进入判定区） */
  isDelayedTrick?: boolean;
}

/** 武将定义 */
export interface SgsHero {
  id: string;
  name: string;
  /** 体力上限（主公 +1） */
  hp: number;
  gender: 'male' | 'female';
  /** 技能 id 列表（见 skills.ts） */
  skills: string[];
  /** 是否隐藏身份可见（主公固定亮明） */
  isLordOnly?: boolean;
}

/** 玩家状态 */
export interface SgsPlayerState {
  seat: number;
  heroId: string | null;
  identity: Identity | null;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  isBot: boolean;
  hand: string[]; // 手牌 id
  weapon: string | null; // 装备区：武器
  armor: string | null; // 防具
  horsePlus: string | null; // +1 马
  horseMinus: string | null; // -1 马
  judge: string[]; // 判定区（延时锦囊牌 id）
  /** 本回合已出杀次数（连弩/咆哮影响） */
  shaCount: number;
}

/** 待结算的锦囊（无懈可击链结束后据此结算） */
export interface SgsPendingTrick {
  type: 'aoe' | 'duel' | 'snatch' | 'dismantle' | 'delayed';
  defId?: CardDefId;
  target?: number;
  cardId?: string;
}

/** 待响应请求（杀/无懈等需要其他玩家决策） */
export interface SgsPendingAsk {
  kind: 'dodge' | 'wuxie';
  /** 发起者座位 */
  source: number;
  /** 当前等待响应的座位（无懈链中逐个推进） */
  target: number;
  /** 关联卡牌（如被无懈的锦囊、被响应的杀） */
  cardId?: string;
  /** 描述，便于前端提示 */
  desc: string;
  /** 吕布·无双：杀/决斗需对方出两张闪/杀响应 */
  wushuang?: boolean;
  /** 无懈链当前是否已抵消 */
  negated?: boolean;
  /** 剩余可响应座位（按行动顺序，逐个推进） */
  queue?: number[];
  /** 链结束后据此结算的锦囊 */
  pendingTrick?: SgsPendingTrick;
}

/** 对局事件（驱动回放/前端飘字） */
export interface SgsEvent {
  t: number; // 序号
  type:
    | 'deal'
    | 'identity'
    | 'turn_start'
    | 'draw'
    | 'play'
    | 'dodge'
    | 'damage'
    | 'heal'
    | 'death'
    | 'equip'
    | 'judge'
    | 'skill'
    | 'discard'
    | 'win';
  seat?: number;
  target?: number;
  cardId?: string;
  text: string;
}

/** 完整对局状态（可序列化快照） */
export interface SgsGameState {
  seats: number;
  players: SgsPlayerState[];
  cards: Record<string, SgsCard>;
  drawPile: string[];
  discardPile: string[];
  turn: number; // 当前行动座位
  phase: SgsPhase;
  round: number;
  /** 主公座位（身份局核心） */
  lordSeat: number;
  /** 当前等待响应的请求；非空时阻塞出牌推进 */
  pendingAsk: SgsPendingAsk | null;
  /** 胜负身份（null=进行中） */
  winner: Identity | null;
  /** 事件日志（回放/审计） */
  log: SgsEvent[];
  /** 规则参数 */
  rules: SgsRules;
  /** 本回合是否已摸牌（防重复） */
  drewThisTurn: boolean;
}

/** 身份局规则参数 */
export interface SgsRules {
  /** 座位总数（标准 8 人） */
  seats: number;
  /** 是否启用武将技能 */
  enableSkills: boolean;
  /** 初始手牌数 */
  initHand: number;
  /** 出牌阶段可出杀次数（默认 1，连弩/咆哮可突破） */
  baseShaLimit: number;
}

export const DEFAULT_RULES: SgsRules = {
  seats: 8,
  enableSkills: true,
  initHand: 4,
  baseShaLimit: 1,
};

/** 客户端动作 */
export type SgsClientAction =
  | { type: 'play'; cardIds: string[]; target?: number; trickTarget?: number }
  | { type: 'respond'; dodge?: boolean; wuxie?: boolean; cardIds?: string[] }
  | { type: 'pass' }
  | { type: 'skill'; skillId: string; target?: number; cardIds?: string[] }
  | { type: 'end_turn' };
