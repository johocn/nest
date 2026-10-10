import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
import { PlayerScoringState } from './entities/player-scoring-state.entity';

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
 * 持久化：内存 Map 为 L1 缓存，write-through 落 player_scoring_states（state jsonb
 * 仅存值，加载时与当前 config 合并——越界钳制到 [min,max]、未知 key 一律丢弃，
 * 配置改了不坏档）。miss 时查库加载但不落库，首次 dispatch 才建行；reset 删内存+删行。
 */
@Injectable()
export class ScoringService implements OnModuleInit {
  private engine = new ScoreEngine();
  private configs = new Map<string, ScoringConfig>();
  private states = new Map<string, ScoreState>(); // L1 缓存，key: `${playerId}:${gameId}`

  constructor(
    @InjectRepository(PlayerScoringState)
    private readonly stateRepo: Repository<PlayerScoringState>,
  ) {
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
    // 示例配置见 ./config/*（由 ScoringModule 注册）；配置入库与 DB 加载见阶段 2 计划 Task 3
  }

  registerGame(cfg: ScoringConfig): void {
    this.configs.set(cfg.gameId, cfg);
  }

  private key(playerId: string, gameId: string): string {
    return `${playerId}:${gameId}`;
  }

  /** L1 缓存 miss 时查库加载；无行不落库（首次 dispatch 才建行） */
  private async ensure(playerId: string, gameId: string): Promise<ScoreState> {
    const k = this.key(playerId, gameId);
    const cached = this.states.get(k);
    if (cached) return cached;
    const cfg = this.configs.get(gameId);
    const row = await this.stateRepo.findOne({ where: { playerId, gameId } });
    const st = row?.state
      ? this.merge(cfg, row.state)
      : freshState(cfg);
    this.states.set(k, st);
    return st;
  }

  /** 库里 jsonb 仅存值：与当前 config 合并（越界钳制到 [min,max]，未知 key 一律丢弃） */
  private merge(cfg: ScoringConfig | undefined, raw: Record<string, any>): ScoreState {
    const st = freshState(cfg);
    for (const [id, v] of Object.entries(raw?.axes ?? {})) {
      const ax = st.axes.get(id);
      if (ax) ax.value = Math.min(ax.max, Math.max(ax.min, Number(v) || 0));
    }
    for (const f of raw?.flags ?? []) st.flags.add(String(f));
    for (const [k, v] of Object.entries(raw?.affinity ?? {})) if (k in st.affinity) st.affinity[k] = Number(v) || 0;
    for (const [k, v] of Object.entries(raw?.reputation ?? {})) if (k in st.reputation) st.reputation[k] = Number(v) || 0;
    for (const [k, v] of Object.entries(raw?.ideology ?? {})) if (k in st.ideology) st.ideology[k] = Number(v) || 0;
    return st;
  }

  /** 选项选中后调用：把 Effect 应用到该玩家该游戏的评分状态（use 默认取配置启用的策略），write-through 落库 */
  async dispatch(
    playerId: string,
    gameId: string,
    effect: ScoreEffect,
    use?: string[],
  ): Promise<void> {
    const cfg = this.configs.get(gameId);
    if (!cfg) {
      throw new GameException(ErrorCodes.PARAM_INVALID, `未注册的评分游戏：${gameId}`);
    }
    const st = await this.ensure(playerId, gameId);
    this.engine.dispatch(effect, use ?? cfg.enabled, st);
    await this.stateRepo.upsert(
      { playerId, gameId, state: { ...toSnapshot(st) } } as unknown as PlayerScoringState,
      ['playerId', 'gameId'],
    );
  }

  /** 计算派生分数（use 默认取配置启用的策略） */
  async compute(
    playerId: string,
    gameId: string,
    use?: string[],
  ): Promise<Record<string, any>> {
    const cfg = this.configs.get(gameId);
    if (!cfg) {
      throw new GameException(ErrorCodes.PARAM_INVALID, `未注册的评分游戏：${gameId}`);
    }
    return this.engine.compute(use ?? cfg.enabled, await this.ensure(playerId, gameId));
  }

  /** 取该玩家该游戏的评分快照（未注册/无数据则返回全零） */
  async snapshot(playerId: string, gameId: string): Promise<ScoreSnapshot> {
    const cfg = this.configs.get(gameId);
    if (!cfg) {
      return { axes: {}, flags: [], affinity: {}, reputation: {}, ideology: {} };
    }
    return toSnapshot(await this.ensure(playerId, gameId));
  }

  /** 批量取多个游戏的快照（供 buildContext 一次组装上下文） */
  async snapshotFor(
    playerId: string,
    gameIds: string[],
  ): Promise<Record<string, ScoreSnapshot>> {
    const out: Record<string, ScoreSnapshot> = {};
    await Promise.all(
      gameIds.map(async (g) => {
        out[g] = await this.snapshot(playerId, g);
      }),
    );
    return out;
  }

  /** 按本游戏配置的分支规则，返回目标跳转 key（全部命中才跳转，否则 default） */
  async resolveBranch(playerId: string, gameId: string): Promise<string> {
    const cfg = this.configs.get(gameId);
    if (!cfg) return 'default';
    const snap = await this.snapshot(playerId, gameId);
    for (const r of cfg.branches ?? []) {
      if (r.when.every((c) => matchCond(c, snap))) return r.goto;
    }
    return 'default';
  }

  /** 重置某玩家某游戏的评分状态（开新档/测试用）：删内存 + 删行 */
  async reset(playerId: string, gameId: string): Promise<void> {
    this.states.delete(this.key(playerId, gameId));
    await this.stateRepo.delete({ playerId, gameId });
  }
}
