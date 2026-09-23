import type { Vec2 } from '../entity/interp';

/**
 * S8 Task 5：本地移动的**时间基步进**（纯逻辑，Laya-free），`PlayerControl` 只做「读按键 + 写 sprite + 上报」。
 *
 * 为什么抽出来：基线是**帧基** `4px/帧`，帧率一变速度就变（小游戏 30fps 只有一半速度）；
 * 改成 `px/ms` 后「同一路径 60 帧 vs 30 帧总位移相等」是可断言的性质，抽成纯函数才能被
 * `scripts/smoke-s8-perf.mjs` 直接用 node 证明（真机 30fps 不跑，等价性由该纯逻辑覆盖）。
 * 本文件只 import 类型 → 产物 `bin/js/world/move-step.js` 无运行时依赖。
 */

/** 边界夹取的字面量（**逐字保留基线值**：x∈[8, w-8]、y∈[16, h-8]，见 `PlayerControl` 原实现） */
export const BOUND_LEFT = 8;
export const BOUND_TOP = 16;
export const BOUND_RIGHT = 8;
export const BOUND_BOTTOM = 8;

/**
 * 一帧的位移（纯函数）：把方向向量归一化后按 `speedPxPerMs * dtMs` 前进。
 * `(dx,dy)` 为 0、或 `dtMs <= 0`、或速度非正 → 位移 0（并保持方向归一化的等价语义）。
 */
export function moveDelta(dx: number, dy: number, speedPxPerMs: number, dtMs: number): Vec2 {
  if (!dx && !dy) return { x: 0, y: 0 };
  if (!(dtMs > 0) || !(speedPxPerMs > 0)) return { x: 0, y: 0 };
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len <= 0) return { x: 0, y: 0 };
  const step = speedPxPerMs * dtMs;
  return { x: (dx / len) * step, y: (dy / len) * step };
}

/**
 * 地图边界夹取（纯函数）：与基线**同一表达式与同一顺序**（`min(max(v, lo), hi)`），
 * 保证 clamp 行为逐字一致（包括 `mapWidth-8 < 8` 这类退化地图）。
 */
export function clampToMapBounds(x: number, y: number, mapWidth: number, mapHeight: number): Vec2 {
  return {
    x: Math.min(Math.max(x, BOUND_LEFT), mapWidth - BOUND_RIGHT),
    y: Math.min(Math.max(y, BOUND_TOP), mapHeight - BOUND_BOTTOM),
  };
}