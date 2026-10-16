// 三国杀模块对外类型：动作、下发视图（隐藏他人手牌与身份）

import { SgsCard } from './engine';

/** 客户端动作（与 SgsClientAction 对齐，仅暴露安全字段） */
export interface ActionDto {
  /** 出牌 / 响应 / 结束回合 / 技能 */
  type: 'play' | 'respond' | 'end_turn' | 'skill';
  /** 选中的牌 id 列表 */
  cardIds?: string[];
  /** 目标座位 */
  target?: number;
  /** 响应是否出闪 */
  dodge?: boolean;
  /** 响应是否打出无懈可击 */
  wuxie?: boolean;
  /** 技能 id（type=skill 时） */
  skillId?: string;
}

/** 单玩家视图（服务端按座位裁剪，杜绝信息泄露） */
export interface ClientPlayerView {
  seat: number;
  playerId: string | null;
  nickname: string;
  heroId: string | null;
  heroName: string;
  isBot: boolean;
  isAlive: boolean;
  hp: number;
  maxHp: number;
  /** 身份：仅本人 / 主公（主公固定亮明）；其余对局结束前隐藏 */
  identity: string | null;
  /** 手牌数（他人不返回手牌内容） */
  handCount: number;
  hand?: SgsCard[];
  weapon: string | null;
  armor: string | null;
  horsePlus: string | null;
  horseMinus: string | null;
  judge: string[];
  isCurrentTurn: boolean;
}

export interface ClientGameView {
  roomId: string;
  mode: 'ai' | 'net';
  turn: number;
  phase: string;
  round: number;
  lordSeat: number;
  winner: string | null;
  players: ClientPlayerView[];
  /** 当前等待响应的请求（仅相关玩家可见） */
  pendingAsk?: {
    kind: string;
    target: number;
    desc: string;
  } | null;
  /** 本人合法动作提示（yourSeat 视角） */
  awaiting: number[];
  yourSeat: number;
  seated: number;
  /** 最近若干条事件（飘字/系统提示用） */
  recentLogs: { type: string; text: string; seat?: number }[];
}
