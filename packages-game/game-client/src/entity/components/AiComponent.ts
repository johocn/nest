import { Component } from './Component';
import type { Entity } from '../Entity';
import type { NpcPatrolRouteConfig } from '../../config/schema';
import { MAX_CORRECTION_STEP_PX, initPatrolState, limitApproach, nearestRouteIndex, stepPatrol } from '../patrol';
import type { PatrolState, Vec2 } from '../patrol';

/**
 * NPC 行为组件（S4）：只做**路点插值表现**，不做任何自主决策（总纲 §10 权威边界）。
 *
 * - 由服务端 `route` 初始化，每帧按 `Laya.timer.delta` 推进（驱动点见 `EntityRegistry.updateAll`）；
 * - 收到服务端 `world.entity_update` 校正时走 `applyCorrection`：**限速逼近、不瞬移**（单帧 ≤ `MAX_CORRECTION_STEP_PX`）；
 * - 无 `route`（fixed/random）的 NPC 不挂本组件（原地静止）。
 * 核心计算在纯模块 `entity/patrol.ts`（可被 node 断言），本类只持有状态并写回 sprite。
 */
export class AiComponent extends Component {
  private state: PatrolState;

  /**
   * 待消费的校正误差（像素）。
   *
   * ⚠️ 校正**不能只在收到广播的那一帧走 `MAX_CORRECTION_STEP_PX`**：服务端每 2s 才广播一次，
   * 等价纠偏速率仅 4px/s，远低于 60px/s 的巡逻速度 —— 两端「进场景时刻不同」造成的相位差
   * （先进入的一端初始位置更旧）将**永不收敛**（实测恒定偏差 ~60px）。
   * 故收到校正时只**记录误差**，由 `consumeCorrection` 在后续每帧限速消费（8px/帧 ≈ 200px/s），
   * 既不瞬移，又能在约 0.3s 内对齐权威位置。
   */
  private pendingErr: Vec2 = { x: 0, y: 0 };

  constructor(route: NpcPatrolRouteConfig, x: number, y: number) {
    super();
    this.state = initPatrolState(route, x, y);
  }

  /** 当前本地表现位置 */
  get x(): number {
    return this.state.x;
  }

  get y(): number {
    return this.state.y;
  }

  /** 本地插值状态（只读快照，供点检/调试） */
  get patrolState(): Readonly<PatrolState> {
    return this.state;
  }

  update(dtMs: number): void {
    this.state = stepPatrol(this.state, dtMs);
    this.consumeCorrection();
    this.syncSprite();
  }

  /**
   * 服务端位置校正（D5）：**本帧不移动**，只记录误差，交由 `consumeCorrection` 逐帧限速逼近，
   * 故绝不瞬移；误差已在容差内时直接重定位 `cursor`（避免下一帧沿旧游标往回跑）。
   */
  applyCorrection(x: number, y: number): void {
    const cur = { x: this.state.x, y: this.state.y };
    const dist = Math.hypot(x - cur.x, y - cur.y);
    if (!Number.isFinite(dist) || dist <= MAX_CORRECTION_STEP_PX) {
      this.pendingErr = { x: 0, y: 0 };
      this.realignCursor();
    } else {
      this.pendingErr = { x: x - cur.x, y: y - cur.y };
    }
    this.syncSprite();
  }

  /** 逐帧消费校正误差：单帧最多 `MAX_CORRECTION_STEP_PX`，消费完把 `cursor` 重定位到所在路段 */
  private consumeCorrection(): void {
    const err = this.pendingErr;
    if (err.x === 0 && err.y === 0) return;

    const step = limitApproach({ x: 0, y: 0 }, err, MAX_CORRECTION_STEP_PX);
    this.state.x += step.x;
    this.state.y += step.y;
    err.x -= step.x;
    err.y -= step.y;

    if (Math.hypot(err.x, err.y) <= 0.5) {
      this.pendingErr = { x: 0, y: 0 };
      this.realignCursor();
    }
  }

  private realignCursor(): void {
    const idx = nearestRouteIndex(
      this.state.points,
      this.state.x,
      this.state.y,
      this.state.loopMode,
      this.state.dir,
    );
    if (idx < 0) return;
    this.state.cursor = idx;
    this.state.pauseMs = 0;
  }

  private syncSprite(): void {
    this.owner?.setPos(this.state.x, this.state.y);
  }
}
