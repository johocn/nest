import type { EntityKind } from '../entity/Entity';
import type { QualitySwitches } from '../perf/Quality';

/**
 * S8 Task 3：静态背景层与增量排序的**判定逻辑**，全部抽成本文件的 Laya-free 纯函数。
 *
 * 为什么单独成文件：`SceneBuilder` / `VisualComponent` 都会 `new Laya.Sprite`，node 里无法求值，
 * 而「画不画网格/描边」「是否显示名标签」「resort 是否需要执行」是纯开关判定 —— 抽出来才能被
 * 零依赖断言脚本 `scripts/smoke-s8-perf.mjs` 直接 import（同 `world/spawn-merge.ts` 的惯例）。
 *
 * 本文件只 import 类型（tsc 编译后不留任何运行时 import），故产物 `bin/js/world/static-layer.js` 无依赖。
 */

/** 背景绘制关心的开关子集（QualitySwitches 的子集，避免本文件耦合未消费的降级项） */
export type SceneBgSwitches = Pick<QualitySwitches, 'gridLines' | 'triggerOutline'>;

/** 名标签关心的开关子集 */
export type NameLabelSwitches = Pick<QualitySwitches, 'nameLabels'>;

/** 网格线位置：`x`/`y` 从 0 起，按 `interval` 步进到**不超过** width/height（含边界点） */
export interface GridLines {
  verticals: number[];
  horizontals: number[];
}

/**
 * 网格线坐标（与基线循环逐字等价：`for (x = 0; x <= width; x += interval)`）。
 * 1280x960 / 100px → 13 竖 + 10 横（= 基线 23 条 drawLine）。
 */
export function gridLinePositions(width: number, height: number, interval: number): GridLines {
  const verticals: number[] = [];
  const horizontals: number[] = [];
  // interval 为 0 会让下面的循环永不收敛；此处直接返回空集而不是死循环
  if (!(interval > 0)) return { verticals, horizontals };
  for (let x = 0; x <= width; x += interval) verticals.push(x);
  for (let y = 0; y <= height; y += interval) horizontals.push(y);
  return { verticals, horizontals };
}

/** low 档关网格（D3-②） */
export function shouldDrawGrid(switches: SceneBgSwitches): boolean {
  return switches.gridLines === true;
}

/** low 档关触发区描边（D3-③） */
export function shouldDrawTriggerOutline(switches: SceneBgSwitches): boolean {
  return switches.triggerOutline === true;
}

/**
 * 名标签显示（D3-①）：high 档全部显示 = 基线表现；low 档只保留「人」的名字（player / npc），
 * 物件（object）与建筑（building）不显示 —— 人数少、辨识价值高，照样看得出谁是谁。
 */
export function shouldShowNameLabel(kind: EntityKind, switches: NameLabelSwitches): boolean {
  if (switches.nameLabels === true) return true;
  return kind === 'player' || kind === 'npc';
}

/** resort 增量比对用的快照：集合签名（ids）＋ 各实体 y ＋ 视口裁剪出的不可见集合 */
export interface ResortSnapshot {
  ids: string[];
  ys: Record<string, number>;
  /**
   * 当前**不可见**（被视口裁掉）的实体 id（S8 Task 4）。
   * 缺省 = 未启用裁剪；此时不做可见性比对（**向后兼容**：旧调用方只传 ids/ys，行为与基线一致）。
   */
  culled?: string[];
}

/** 两组 id 是否表示同一集合；`undefined` 视同空集（旧调用方不带 culled 时行为不变） */
const EMPTY_IDS: readonly string[] = [];

function sameIdSet(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const x = a ?? EMPTY_IDS;
  const y = b ?? EMPTY_IDS;
  if (x.length !== y.length) return false;
  const set = new Set(y);
  for (const id of x) if (!set.has(id)) return false;
  return true;
}

/**
 * D8 增量判定：**有实体位移 ≥ threshold**、**实体集合发生变化**、或**可见集合发生变化**才需要重排，
 * 否则零排序零 setChildIndex。
 * `prev` 是「上一次真正排序后」的快照，故阈值是**累计**位移：逐帧小碎步累到阈值也会触发一次重排。
 *
 * S8 Task 4：可见集合差异必须触发重排 —— 否则刚被裁掉的实体会滞留在实体层中间层。
 */
export function shouldResort(prev: ResortSnapshot, cur: ResortSnapshot, threshold: number): boolean {
  if (prev.ids.length !== cur.ids.length) return true;
  for (const id of cur.ids) {
    if (!(id in prev.ys)) return true; // 有新增实体（等长但换人：新增的那个必然不在 prev）
    if (Math.abs(cur.ys[id] - prev.ys[id]) >= threshold) return true;
  }
  if (!sameIdSet(prev.culled, cur.culled)) return true;
  return false;
}