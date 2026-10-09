import { Injectable, OnModuleInit } from '@nestjs/common';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  ScoreAxis,
  ScoreCond,
  ScoreEffect,
  ScoreSnapshot,
  ScoreState,
  ScoringConfig,
} from './scoring.types';
import { ScoreEngine } from './scoring.engine';
import { axisStrategy } from './strategies/axis.strategy';
import { dualAxisStrategy } from './strategies/dual-axis.strategy';
import { affinityStrategy } from './strategies/affinity.strategy';
import { hiddenFlagStrategy } from './strategies/hidden-flag.strategy';
import { factionStrategy } from './strategies/faction.strategy';
import { ideologyStrategy } from './strategies/ideology.strategy';

function freshState(cfg?: ScoringConfig): ScoreState {
  const axes = new Map<string, ScoreAxis>();
  for (const [id, d] of Object.entries(cfg?.axes ?? {})) {
    axes.set(id, {
      id,
      label: d.label,
      min: d.min,
      max: d.max,
      visible: d.visible,
      value: d.initial ?? 0,
    });
  }
  const affinity: Record<string, number> = {};
  for (const n of cfg?.npcs ?? []) affinity[n] = 0;
  const reputation: Record<string, number> = {};
  for (const f of cfg?.factions ?? []) reputation[f] = 0;
  const ideology: Record<string, number> = {};
  for (const i of cfg?.ideologies ?? []) ideology[i] = 0;
  return { axes, flags: new Set<string>(), affinity, reputation, ideology };
}

function toSnapshot(state: ScoreState): ScoreSnapshot {
  const axes: Record<string, number> = {};
  for (const [id, ax] of state.axes) axes[id] = ax.value;
  return {
    axes,
    flags: [...state.flags],
    affinity: state.affinity,
    reputation: state.reputation,
    ideology: state.ideology,
  };
}

function cmp(v: number, op: string, t: number): boolean {
  switch (op) {
    case '>=':
      return v >= t;
    case '<=':
      return v <= t;
    case '>':
      return v > t;
    case '<':
      return v < t;
    case '==':
      return v === t;
    default:
      return false;
  }
}

function matchCond(c: ScoreCond, snap: ScoreSnapshot): boolean {
  switch (c.kind) {
    case 'axis':
      return cmp(snap.axes[c.id] ?? 0, c.op, c.value);
    case 'flag':
      return snap.flags.includes(c.id);
    case 'affinity':
      return (snap.affinity[c.id] ?? 0) >= c.value;
    case 'reputation':
      return (snap.reputation[c.id] ?? 0) >= c.value;
    case 'ideology':
      return (snap.ideology[c.id] ?? 0) >= c.value;
  }
}

/**
 * 评分服务（NestJS 可注入）。
 * - 引擎代码只写一次，6 策略全注册；
 * - 每个游戏用 registerGame 注册一份 ScoringConfig（数据，无评分代码）；
 * - 状态按 playerId:gameId 隔离，多游戏互不影响；
 * - 对话/quiz/其他系统均可注入本服务，实现「一套评分，多游戏复用」。
 *
 * 注：当前状态存内存 Map，单实例可用；多实例/集群时把 states 换为 CacheService(redis) 即可，
 *     对外接口不变。
 */
@Injectable()
export class ScoringService implements OnModuleInit {
  private engine = new ScoreEngine();
  private configs = new Map<string, ScoringConfig>();
  private states = new Map<string, ScoreState>(); // key: `${playerId}:${gameId}`

  constructor() {
    [
      axisStrategy,
      dualAxisStrategy,
      affinityStrategy,
      hiddenFlagStrategy,
      factionStrategy,
      ideologyStrategy,
    ].forEach((s) => this.engine.register(s));
  }

  /** 模块初始化时注册内置示例（也可由各游戏模块自行 registerGame） */
  onModuleInit(): void {
    // 示例配置见 ./config/*，按需在此注册，或移交给各自游戏模块
  }

  registerGame(cfg: ScoringConfig): void {
    this.configs.set(cfg.gameId, cfg);
  }

  private key(playerId: string, gameId: string): string {
    return `${playerId}:${gameId}`;
  }

  private ensure(playerId: string, gameId: string): ScoreState {
    const k = this.key(playerId, gameId);
    let st = this.states.get(k);
    if (!st) {
      st = freshState(this.configs.get(gameId));
      this.states.set(k, st);
    }
    return st;
  }

  /** 选项选中后调用：把 Effect 应用到该玩家该游戏的评分状态（use 默认取配置启用的策略） */
  dispatch(
    playerId: string,
    gameId: string,
    effect: ScoreEffect,
    use?: string[],
  ): void {
    const cfg = this.configs.get(gameId);
    if (!cfg) {
      throw new GameException(ErrorCodes.PARAM_INVALID, `未注册的评分游戏：${gameId}`);
    }
    this.engine.dispatch(effect, use ?? cfg.enabled, this.ensure(playerId, gameId));
  }

  /** 计算派生分数（use 默认取配置启用的策略） */
  compute(playerId: string, gameId: string, use?: string[]): Record<string, any> {
    const cfg = this.configs.get(gameId);
    if (!cfg) {
      throw new GameException(ErrorCodes.PARAM_INVALID, `未注册的评分游戏：${gameId}`);
    }
    return this.engine.compute(use ?? cfg.enabled, this.ensure(playerId, gameId));
  }

  /** 取该玩家该游戏的评分快照（未注册/无数据则返回全零） */
  snapshot(playerId: string, gameId: string): ScoreSnapshot {
    const cfg = this.configs.get(gameId);
    if (!cfg) {
      return { axes: {}, flags: [], affinity: {}, reputation: {}, ideology: {} };
    }
    return toSnapshot(this.ensure(playerId, gameId));
  }

  /** 批量取多个游戏的快照（供 buildContext 一次组装上下文） */
  snapshotFor(
    playerId: string,
    gameIds: string[],
  ): Record<string, ScoreSnapshot> {
    const out: Record<string, ScoreSnapshot> = {};
    for (const g of gameIds) out[g] = this.snapshot(playerId, g);
    return out;
  }

  /** 按本游戏配置的分支规则，返回目标跳转 key（全部命中才跳转，否则 default） */
  resolveBranch(playerId: string, gameId: string): string {
    const cfg = this.configs.get(gameId);
    if (!cfg) return 'default';
    const snap = this.snapshot(playerId, gameId);
    for (const r of cfg.branches ?? []) {
      if (r.when.every((c) => matchCond(c, snap))) return r.goto;
    }
    return 'default';
  }

  /** 重置某玩家某游戏的评分状态（开新档/测试用） */
  reset(playerId: string, gameId: string): void {
    this.states.delete(this.key(playerId, gameId));
  }
}
