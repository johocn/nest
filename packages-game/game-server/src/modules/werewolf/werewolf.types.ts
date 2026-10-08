import { Camp, WerewolfRole, WerewolfStep } from './werewolf.constants';

/** 房间内一名玩家的完整状态（服务端权威） */
export interface WerewolfPlayer {
  seat: number;
  playerId: string;
  name: string;
  role: WerewolfRole | null;
  camp: Camp | null;
  alive: boolean;
  isHost: boolean;
  /** 是否为系统机器人（会自动行动，无需真人操作） */
  isBot: boolean;
  /** 女巫药水状态 */
  witchHasAntidote: boolean;
  witchHasPoison: boolean;
  /** 守卫上一晚守护的座位（用于"不能连守同一人"规则） */
  guardLastProtected: number | null;
  /** 预言家已查验结果：seat -> camp（仅供该玩家本人客户端渲染） */
  seerKnown: Record<number, Camp>;
  /** 该玩家在游戏结束后公开亮出的角色（默认游戏结束时全部公开） */
  revealed: boolean;
}

/** 建房选项 */
export interface CreateRoomOptions {
  roomId: string;
  hostPlayerId: string;
  hostName: string;
  /** 显式角色表；缺省按人数取 PRESET_SETUPS */
  roles?: WerewolfRole[];
  /** 人数（用于选预设；显式 roles 优先） */
  playerCount?: number;
  /** 可选：覆盖各阶段时长（毫秒），用于房主自定义节奏 */
  durations?: Partial<Record<WerewolfStep, number>>;
}

/** 房间内一条发言（公共可见，服务端权威） */
export interface RoomMessage {
  /** 单调递增序号，客户端用于增量渲染/去重 */
  seq: number;
  seat: number;
  name: string;
  text: string;
  /** speech=发言 / lastwords=遗言 / system=系统公告 */
  kind: 'speech' | 'lastwords' | 'system';
  /** public=全员可见 / wolf=仅狼人可见（夜间狼人频道） */
  channel: 'public' | 'wolf';
  at: number;
}

/** 客户端可见的玩家视图（隐藏未公开的角色） */
export interface PublicPlayerView {
  seat: number;
  name: string;
  alive: boolean;
  isHost: boolean;
  /** 是否为警长（拥有 1.5 票与归票权） */
  police: boolean;
  role: WerewolfRole | null;
}

/** 某玩家本回合的私有视图（仅下发给自己） */
export interface PrivatePlayerView {
  seat: number;
  alive: boolean;
  role: WerewolfRole | null;
  camp: Camp | null;
  /** 狼人可见的同伴座位（仅狼人非空） */
  teammates: number[];
  /** 自己是否为警长 */
  isPolice: boolean;
  seerKnown: Record<number, Camp>;
  witchHasAntidote: boolean;
  witchHasPoison: boolean;
  /** 当前是否轮到你行动（用于高亮"行动"按钮） */
  canAct: boolean;
  /** 当前阶段你合法可选择的座位列表 */
  legalTargets: number[];
  /** 女巫本晚狼刀目标（仅 NIGHT_WITCH 阶段下发，用于决定解药） */
  witchTonightKill: number | null;
  /** 你（猎人）此刻是否可以开枪 */
  hunterMayShoot: boolean;
  /** 猎人开枪阶段，可击杀的座位列表 */
  hunterTargets: number[];
  /** 此刻是否可以发言（白天讨论/投票阶段且存活） */
  canSpeak: boolean;
  /** 此刻是否可以留下遗言（本回合刚出局且尚未发言过） */
  canLastWords: boolean;
  /** 狼人夜间频道消息（仅狼人可见，每夜清空） */
  wolfMessages: RoomMessage[];
  /** 此刻是否可在狼人频道发言（存活狼人且处于狼人行动阶段） */
  canWolfSpeak: boolean;
  /** 上一次行动校验失败原因（前端 toast 用） */
  lastError?: string;
}

/** 全量对局快照（广播给房间所有人） */
export interface RoomSnapshot {
  roomId: string;
  step: WerewolfStep;
  cycle: number;
  message: string;
  phaseEndsAt: number | null;
  winner: Camp | null;
  revote: number;
  players: PublicPlayerView[];
  /** 刚刚结算中出局的座位（客户端播放死亡特效用） */
  deathsThisStep: number[];
  /** 本阶段投票/行动统计（用于客户端进度条/票数条） */
  tally: Record<number, number>;
  /** 本阶段剩余需行动人数（用于"X/Y 已行动"提示） */
  pendingActions: number;
  /** 房间发言记录（含遗言与系统公告，按时间正序，最多保留最近若干条） */
  messages: RoomMessage[];
}

/** 合并视图：公共快照 + 个人私有视图 */
export interface WerewolfStateView {
  public: RoomSnapshot;
  private: PrivatePlayerView;
}

/** 客户端 → 服务端 的行动请求载荷（按需取字段） */
export interface ActionPayload {
  /** 选择的目标座位（狼刀 / 预言家查验 / 女巫毒 / 守卫守护 / 白天投票 / 猎人开枪） */
  targetSeat?: number;
  /** 女巫解药：是否使用 */
  useAntidote?: boolean;
  /** 女巫毒药：是否使用 */
  usePoison?: boolean;
  /** 警长竞选：是否上警 */
  claimPolice?: boolean;
  /** 选警长投票：投给的候选座位（-1 表示弃票） */
  votePolice?: number;
  /** 移交警徽：继任者座位（-1 表示撕徽） */
  badgeTarget?: number;
}

/** 服务端正反悔/校验错误码（复用 ErrorCodes 体系，单独定义以见名知意） */
export const WerewolfErr = {
  NOT_IN_ROOM: 'WEREWOLF_NOT_IN_ROOM',
  ROOM_FULL: 'WEREWOLF_ROOM_FULL',
  NOT_HOST: 'WEREWOLF_NOT_HOST',
  ALREADY_STARTED: 'WEREWOLF_ALREADY_STARTED',
  NOT_YOUR_TURN: 'WEREWOLF_NOT_YOUR_TURN',
  DEAD_CANNOT_ACT: 'WEREWOLF_DEAD_CANNOT_ACT',
  INVALID_TARGET: 'WEREWOLF_INVALID_TARGET',
  WITCH_NO_ANTIDOTE: 'WEREWOLF_WITCH_NO_ANTIDOTE',
  WITCH_NO_POISON: 'WEREWOLF_WITCH_NO_POISON',
  WITCH_BOTH: 'WEREWOLF_WITCH_CANNOT_BOTH',
  GUARD_SAME_TARGET: 'WEREWOLF_GUARD_SAME_TARGET',
  GAME_NOT_RUNNING: 'WEREWOLF_GAME_NOT_RUNNING',
  CANNOT_SPEAK: 'WEREWOLF_CANNOT_SPEAK',
  EMPTY_MESSAGE: 'WEREWOLF_EMPTY_MESSAGE',
} as const;
