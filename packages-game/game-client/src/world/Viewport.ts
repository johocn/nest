/**
 * S8 Task 4：视口裁剪的**判定逻辑**，全部是本文件的 Laya-free 纯函数。
 *
 * 为什么单独成文件：`SceneBuilder` / `Entity` 都会 `new Laya.Sprite`，node 里无法求值，而
 * 「视口矩形怎么算」「某坐标在不在视口内」是纯几何 —— 抽出来才能被零依赖断言脚本
 * `scripts/smoke-s8-perf.mjs` 直接 import（同 `world/static-layer.ts` / `world/spawn-merge.ts` 的惯例）。
 * **真正读 `Laya.stage.width/height` 的位置在调用方（`SceneBuilder.cull`）**，本模块只吃显式入参。
 *
 * 本文件只 import 类型，故产物 `bin/js/world/Viewport.js` 无任何运行时依赖。
 *
 * ⚠️ 裁剪只改 `sprite.visible`，**绝不改坐标**（计划风险 #4：S1 验收按配置坐标核对，不看可见性）。
 */

/** 轴对齐矩形（世界坐标，像素） */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 视口矩形：以 `(cx, cy)`（本地玩家）为**中心**，尺寸 = 舞台尺寸 + 两侧各扩 `marginPx`。
 * 即 `w = stageW + 2*marginPx`、`h = stageH + 2*marginPx`。
 */
export function viewportRect(
  cx: number,
  cy: number,
  stageW: number,
  stageH: number,
  marginPx: number,
): Rect {
  const w = stageW + 2 * marginPx;
  const h = stageH + 2 * marginPx;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** 点是否在矩形内（**含四条边界**） */
export function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * 实体的目标可见性：`keepVisible=true`（本地玩家等「永不裁剪」实体）恒可见，否则视矩形包含而定。
 * 调用方拿它与 `sprite.visible` 现值对比，**只在不同时才赋值**（避免每帧无谓标脏）。
 */
export function shouldBeVisible(rect: Rect, x: number, y: number, keepVisible = false): boolean {
  return keepVisible || containsPoint(rect, x, y);
}

/**
 * 实体层排序键（`resort` 用，无对象分配）：**可见实体在前**（`true` < `false`），同组内按 y 升序。
 * 被裁剪的实体因此稳定地落在实体层末尾（可见组 0..k-1、不可见组 k..n-1），
 * 隐藏实体不会插在可见实体中间打断「第 i 个孩子 = 第 i 个实体」的索引不变量。
 * 同键（同为可见/不可见且 y 相同）返回 0，`Array.sort` 稳定 → 不可见组内部序保持稳定。
 */
export function compareVisibleThenY(
  aY: number,
  aVisible: boolean,
  bY: number,
  bVisible: boolean,
): number {
  if (aVisible !== bVisible) return aVisible ? -1 : 1;
  return aY - bY;
}