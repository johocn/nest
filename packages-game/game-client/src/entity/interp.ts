/**
 * S8 Task 5：远端位置插值的**纯逻辑**（Laya-free）。
 *
 * 为什么单独成文件：`RemoteInterp` 组件挂在 `Entity` 上、组件表由引擎驱动，node 里无法求值；
 * 而「向目标逼近多少」「什么时候直接对齐」是纯计算 —— 抽出来才能被零依赖断言脚本
 * `scripts/smoke-s8-perf.mjs` 直接 import（同 `entity/patrol.ts` / `world/Viewport.ts` 的惯例）。
 * 本文件**只 import 类型**（编译后不留运行时 import），故产物 `bin/js/entity/interp.js` 无依赖。
 *
 * 语义（计划 Task 5 Step 1）：新广播**覆盖**目标点、不排队；每帧按 `bufferMs` 指数平滑逼近；
 * 距离超过 `snapPx` 或有冻结（离屏被裁剪）历史时**直接对齐**，绝不缓慢爬行（计划风险 #5）。
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** 插值精度档位（与 `QualitySwitches.interpPrecision` 同口径；此处用字面量联合避免耦合 perf 模块） */
export type InterpPrecision = 'full' | 'reduced';

/**
 * 单帧平滑系数：`alpha = 1 - exp(-dt/buffer)`。
 * - `buffer <= 0` → 1（等价基线：收到广播立即到位，作为 A/B 对照与紧急回退）；
 * - `dt <= 0` → 0（不前进，且不产生 NaN）。
 * alpha ∈ [0,1]，故**永不越过目标**（不会振荡）。
 */
export function interpAlpha(dtMs: number, bufferMs: number): number {
  if (!(bufferMs > 0)) return 1;
  if (!(dtMs > 0)) return 0;
  return 1 - Math.exp(-dtMs / bufferMs);
}

/**
 * 目标点量化（D3-④ 的消费点）：`reduced` 取整到整数像素、`full` 保留亚像素。
 *
 * 诚实备注：`TransformComponent.moveTo` 写 sprite 时本就 `Math.round`，故 `reduced` 的**视觉差异为 0**，
 * 收益只是省下亚像素目标状态（省下的是计算，不是画质）。真正有降级效果的是 `remoteUpdateHz` 节流。
 */
export function quantizeTarget(x: number, y: number, precision: InterpPrecision = 'full'): Vec2 {
  return precision === 'reduced' ? { x: Math.round(x), y: Math.round(y) } : { x, y };
}

/**
 * 单帧逼近（纯函数，不修改入参）：
 * - 目标非法（NaN/Inf）→ 原地不动（不污染位置）；
 * - `bufferMs <= 0`（插值关闭）或 `dist > snapPx`（越界/冻结后重入）→ 直接落到目标；
 * - 否则按 `alpha` 指数平滑逼近，**绝不越过目标**。
 */
export function stepInterp(
  cur: Vec2,
  target: Vec2,
  dtMs: number,
  bufferMs: number,
  snapPx: number,
): Vec2 {
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return { x: cur.x, y: cur.y };

  const dx = target.x - cur.x;
  const dy = target.y - cur.y;
  const dist = Math.hypot(dx, dy);

  if (!Number.isFinite(dist) || dist <= 0) return { x: target.x, y: target.y };
  if (!(bufferMs > 0) || dist > snapPx) return { x: target.x, y: target.y };

  const alpha = interpAlpha(dtMs, bufferMs);
  return { x: cur.x + dx * alpha, y: cur.y + dy * alpha };
}