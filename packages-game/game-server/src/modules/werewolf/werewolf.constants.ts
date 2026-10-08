/**
 * 狼人杀（Werewolf）模块常量：角色、阵营、阶段、配置与特效参数。
 * 纯常量 + 枚举，不依赖 Nest/DI，方便在单元测试中直接 import。
 */

export enum WerewolfRole {
  WEREWOLF = 'werewolf',
  SEER = 'seer',
  WITCH = 'witch',
  HUNTER = 'hunter',
  GUARD = 'guard',
  VILLAGER = 'villager',
}

/** 阵营：好人 vs 狼人 */
export type Camp = 'good' | 'evil';

/** 对局阶段（细粒度，便于客户端做差异化转场特效） */
export enum WerewolfStep {
  LOBBY = 'lobby',
  NIGHT_BEGIN = 'night_begin',
  NIGHT_WOLF = 'night_wolf',
  NIGHT_SEER = 'night_seer',
  NIGHT_WITCH = 'night_witch',
  NIGHT_GUARD = 'night_guard',
  NIGHT_END = 'night_end',
  DAY_BEGIN = 'day_begin',
  DAY_NOMINATE = 'day_nominate',
  DAY_POLICE_VOTE = 'day_police_vote',
  DAY_DISCUSS = 'day_discuss',
  DAY_VOTE = 'day_vote',
  DAY_RESULT = 'day_result',
  DAY_BADGE_TRANSFER = 'day_badge_transfer',
  HUNTER_SHOOT = 'hunter_shoot',
  GAME_OVER = 'game_over',
}

/** 角色元信息：展示名/阵营/一句话/主题色（客户端特效用） */
export interface RoleMeta {
  role: WerewolfRole;
  name: string;
  camp: Camp;
  desc: string;
  color: string;
}

export const ROLE_META: Record<WerewolfRole, RoleMeta> = {
  [WerewolfRole.WEREWOLF]: {
    role: WerewolfRole.WEREWOLF,
    name: '狼人',
    camp: 'evil',
    desc: '每晚与同伴合谋击杀一名玩家。',
    color: '#e5484d',
  },
  [WerewolfRole.SEER]: {
    role: WerewolfRole.SEER,
    name: '预言家',
    camp: 'good',
    desc: '每晚查验一名玩家的善恶身份。',
    color: '#4f9dff',
  },
  [WerewolfRole.WITCH]: {
    role: WerewolfRole.WITCH,
    name: '女巫',
    camp: 'good',
    desc: '拥有一瓶解药与一瓶毒药，各限用一次。',
    color: '#a371f7',
  },
  [WerewolfRole.HUNTER]: {
    role: WerewolfRole.HUNTER,
    name: '猎人',
    camp: 'good',
    desc: '出局时（非毒杀）可开枪带走一人。',
    color: '#f0883e',
  },
  [WerewolfRole.GUARD]: {
    role: WerewolfRole.GUARD,
    name: '守卫',
    camp: 'good',
    desc: '每晚守护一人，不可连续两晚守同一人。',
    color: '#3fb950',
  },
  [WerewolfRole.VILLAGER]: {
    role: WerewolfRole.VILLAGER,
    name: '平民',
    camp: 'good',
    desc: '没有特殊能力，靠发言与投票找出狼人。',
    color: '#8b949e',
  },
};

/** 哪些角色在夜晚按顺序行动（狼人恒在，其余按本局是否出现决定） */
export const NIGHT_ORDER: WerewolfRole[] = [
  WerewolfRole.WEREWOLF,
  WerewolfRole.SEER,
  WerewolfRole.WITCH,
  WerewolfRole.GUARD,
];

/**
 * 标准 9 人局角色配置（3 狼 / 预言家 / 女巫 / 猎人 / 守卫 / 2 平民）。
 * 服务端建房时若不显式传 roles，按人数就近匹配下列预设。
 */
export const PRESET_SETUPS: Record<number, WerewolfRole[]> = {
  6: [
    WerewolfRole.WEREWOLF,
    WerewolfRole.WEREWOLF,
    WerewolfRole.SEER,
    WerewolfRole.WITCH,
    WerewolfRole.HUNTER,
    WerewolfRole.VILLAGER,
  ],
  9: [
    WerewolfRole.WEREWOLF,
    WerewolfRole.WEREWOLF,
    WerewolfRole.SEER,
    WerewolfRole.WITCH,
    WerewolfRole.HUNTER,
    WerewolfRole.GUARD,
    WerewolfRole.VILLAGER,
    WerewolfRole.VILLAGER,
    WerewolfRole.VILLAGER,
  ],
  12: [
    WerewolfRole.WEREWOLF,
    WerewolfRole.WEREWOLF,
    WerewolfRole.WEREWOLF,
    WerewolfRole.WEREWOLF,
    WerewolfRole.SEER,
    WerewolfRole.WITCH,
    WerewolfRole.HUNTER,
    WerewolfRole.GUARD,
    WerewolfRole.GUARD,
    WerewolfRole.VILLAGER,
    WerewolfRole.VILLAGER,
    WerewolfRole.VILLAGER,
  ],
};

/** 每个阶段的时长（毫秒），驱动服务端定时器与客户端倒计时环 */
export const STEP_DURATION_MS: Record<WerewolfStep, number> = {
  [WerewolfStep.LOBBY]: 0,
  [WerewolfStep.NIGHT_BEGIN]: 2500,
  [WerewolfStep.NIGHT_WOLF]: 30000,
  [WerewolfStep.NIGHT_SEER]: 30000,
  [WerewolfStep.NIGHT_WITCH]: 30000,
  [WerewolfStep.NIGHT_GUARD]: 30000,
  [WerewolfStep.NIGHT_END]: 3500,
  [WerewolfStep.DAY_BEGIN]: 3500,
  [WerewolfStep.DAY_NOMINATE]: 20000,
  [WerewolfStep.DAY_POLICE_VOTE]: 20000,
  [WerewolfStep.DAY_DISCUSS]: 60000,
  [WerewolfStep.DAY_VOTE]: 30000,
  [WerewolfStep.DAY_RESULT]: 4000,
  [WerewolfStep.DAY_BADGE_TRANSFER]: 15000,
  [WerewolfStep.HUNTER_SHOOT]: 15000,
  [WerewolfStep.GAME_OVER]: 0,
};

/** 单局人数上限/下限（服务端校验用） */
export const WEREWOLF_MIN_PLAYERS = 6;
export const WEREWOLF_MAX_PLAYERS = 12;

/** 一局最多平票后的加投次数（超出则本日不淘汰） */
export const MAX_REVOTE = 1;
