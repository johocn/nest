/**
 * 对话分支评分系统 —— 通用类型定义
 *
 * 设计目标：游戏无关、配置驱动、按 (playerId, gameId) 隔离，可被多个游戏复用。
 * 6 种主流评分方法（单轴/双轴/好感/隐藏Flag/阵营声望/意识形态）即 6 个 ScoreStrategy 实现，
 * 每个游戏用一份 ScoringConfig 声明「启用哪些策略 + 自己的轴/NPC/阵营 + 分支规则」。
 */

/** 评分轴（数值型，如 道德/智慧/财富/楷模-叛逆） */
export interface ScoreAxis {
  id: string;
  label: string;
  min: number;
  max: number;
  visible: boolean;
  value: number;
}

/** 内部状态（运行时，含 Map/Set，便于增量更新） */
export interface ScoreState {
  axes: Map<string, ScoreAxis>;
  flags: Set<string>;
  affinity: Record<string, number>; // npc -> 好感
  reputation: Record<string, number>; // faction -> 声望
  ideology: Record<string, number>; // dimension -> 倾向
}

/** 选项抛出的增量（对话动作 actionArgs.score.effect 即此结构） */
export interface ScoreEffect {
  axes?: Record<string, number>;
  affinity?: Record<string, number>;
  reputation?: Record<string, number>;
  ideology?: Record<string, number>;
  flags?: string[];
}

/** 对外的纯数据快照（供分支条件求值、客户端展示） */
export interface ScoreSnapshot {
  axes: Record<string, number>;
  flags: string[];
  affinity: Record<string, number>;
  reputation: Record<string, number>;
  ideology: Record<string, number>;
}

/** 轴定义（每个游戏在配置里声明自己的轴） */
export interface AxisDef {
  label: string;
  min: number;
  max: number;
  visible: boolean;
  initial?: number;
}

/** 分支条件（数据化，策划可改不改代码） */
export type ScoreCond =
  | { kind: 'axis'; id: string; op: '>=' | '<=' | '>' | '<' | '=='; value: number }
  | { kind: 'flag'; id: string }
  | { kind: 'affinity'; id: string; op: '>='; value: number }
  | { kind: 'reputation'; id: string; op: '>='; value: number }
  | { kind: 'ideology'; id: string; op: '>='; value: number };

export interface BranchRule {
  id: string;
  when: ScoreCond[];
  goto: string;
}

/** 每个游戏一份配置（数据，无评分代码） */
export interface ScoringConfig {
  gameId: string;
  enabled: string[]; // 从 6 种策略里选启用的 id
  axes?: Record<string, AxisDef>;
  npcs?: string[];
  factions?: string[];
  ideologies?: string[];
  branches?: BranchRule[];
}

/** 评分策略接口（6 种方法即 6 个实现） */
export interface ScoreStrategy {
  id: string;
  desc: string;
  apply(effect: ScoreEffect, state: ScoreState): void;
  compute(state: ScoreState): Record<string, any>;
}
