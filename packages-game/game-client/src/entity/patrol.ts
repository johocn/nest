import type { NpcPatrolPoint, NpcPatrolRouteConfig } from '../config/schema';

/**
 * NPC 路点插值与位移校正的**纯逻辑模块**（S4 Task 5）。
 *
 * ⚠️ 本文件**不 import 任何引擎模块（不牵连 Laya）**：类型只走 `import type`（编译期即被擦除），
 * 故产物 `bin/js/entity/patrol.js` 可被 `node` 直接 import，供 `scripts/smoke-s4-npc.mjs` 断言；
 * `AiComponent` 只做「持有状态 + 写回 sprite」的薄壳。
 *
 * 推进语义**逐字对齐后端** `NpcPresenceService.advancePatrol`（客户端只表现、不决策，总纲 §10）：
 * 沿当前路点向下一路点直线插值；到达后按 `pauseSec` 停留；`loop` 循环 / `pingpong` 端点折返 / `once` 到末尾停止。
 */

/** 纠偏单帧最大位移（像素/帧）：收到服务端校正时**限速逼近、不瞬移**（总纲 §10 权威边界） */
export const MAX_CORRECTION_STEP_PX = 8;

/** 巡逻运行态：由服务端 `route` 初始化，之后仅在本地推进 */
export interface PatrolState {
  points: NpcPatrolPoint[];
  /** 像素/秒 */
  speed: number;
  loopMode: NpcPatrolRouteConfig['loopMode'];
  /** 当前所在路点索引 */
  cursor: number;
  /** pingpong 方向：1 正向 / -1 反向 */
  dir: 1 | -1;
  /** 到达路点后的剩余停留时间（毫秒） */
  pauseMs: number;
  x: number;
  y: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** 按服务端 route 初始化运行态 */
export function initPatrolState(route: NpcPatrolRouteConfig, x: number, y: number): PatrolState {
  return {
    points: Array.isArray(route.points) ? route.points : [],
    speed: route.speed,
    loopMode: route.loopMode,
    cursor: Number.isFinite(route.cursor) ? route.cursor : 0,
    dir: 1,
    pauseMs: 0,
    x,
    y,
  };
}

/** 按 loopMode 计算下一个路点索引（`once` 到末尾返回 null，表示不再前进） */
function nextWaypoint(state: PatrolState): { idx: number; dir: 1 | -1 } | null {
  const n = state.points.length;
  const cursor = Math.min(Math.max(state.cursor, 0), n - 1);

  if (state.loopMode === 'pingpong') {
    let dir: 1 | -1 = state.dir === -1 ? -1 : 1;
    let next = cursor + dir;
    if (next >= n) {
      dir = -1;
      next = cursor - 1;
    } else if (next < 0) {
      dir = 1;
      next = cursor + 1;
    }
    return { idx: next, dir };
  }

  if (state.loopMode === 'once') {
    return cursor >= n - 1 ? null : { idx: cursor + 1, dir: 1 };
  }

  return { idx: (cursor + 1) % n, dir: 1 }; // loop（默认）
}

/**
 * 单帧推进（纯函数：不修改入参，返回新状态）。
 * `points.length < 2`、`speed <= 0`、`dtMs <= 0` 时原地静止，**不产生 NaN**（风险 #5）。
 */
export function stepPatrol(state: PatrolState, dtMs: number): PatrolState {
  const next: PatrolState = { ...state, points: state.points };
  const points = state.points;
  if (!(dtMs > 0)) return next;
  if (!Array.isArray(points) || points.length < 2) return next;
  if (!(state.speed > 0)) return next;
  if (!Number.isFinite(next.cursor)) next.cursor = 0;
  next.cursor = Math.min(Math.max(next.cursor, 0), points.length - 1);

  let remaining = dtMs;

  // 先消费上一轮遗留的路点停留时间（停留期间不移动）
  if (next.pauseMs > 0) {
    if (next.pauseMs >= remaining) {
      next.pauseMs -= remaining;
      return next;
    }
    remaining -= next.pauseMs;
    next.pauseMs = 0;
  }

  // 硬上限，避免重合路点导致的死循环
  let guard = points.length * 2 + 4;
  while (remaining > 0 && guard-- > 0) {
    const waypoint = nextWaypoint(next);
    if (!waypoint) break; // once 已到末尾：保持最后一点
    const to = points[waypoint.idx];
    if (!to) break;

    const dist = Math.hypot(to.x - next.x, to.y - next.y);
    if (dist <= 0) {
      // 与目标路点重合：直接推进索引
      next.cursor = waypoint.idx;
      next.dir = waypoint.dir;
      const pauseMs = Math.max(0, (to.pauseSec ?? 0) * 1000);
      if (pauseMs <= 0) break; // 无耗时，跳出避免死循环
      if (pauseMs >= remaining) {
        next.pauseMs = pauseMs - remaining;
        break;
      }
      remaining -= pauseMs;
      continue;
    }

    const needMs = (dist / next.speed) * 1000;
    if (needMs > remaining) {
      // 未到达：沿直线插值前进
      const ratio = (remaining * next.speed) / 1000 / dist;
      next.x += (to.x - next.x) * ratio;
      next.y += (to.y - next.y) * ratio;
      remaining = 0;
      break;
    }

    // 到达路点
    next.x = to.x;
    next.y = to.y;
    remaining -= needMs;
    next.cursor = waypoint.idx;
    next.dir = waypoint.dir;

    const pauseMs = Math.max(0, (to.pauseSec ?? 0) * 1000);
    if (pauseMs > 0) {
      if (pauseMs >= remaining) {
        next.pauseMs = pauseMs - remaining;
        break;
      }
      remaining -= pauseMs;
    }
  }

  return next;
}

/**
 * 限速逼近（纯函数）：把 `cur` 朝 `target` 移动，单次位移不超过 `maxStep`；距离已在内则直接落到 `target`。
 * 用于服务端位置校正——**绝不瞬移**。
 */
export function limitApproach(cur: Vec2, target: Vec2, maxStep: number): Vec2 {
  const dx = target.x - cur.x;
  const dy = target.y - cur.y;
  const dist = Math.hypot(dx, dy);

  if (!Number.isFinite(dist) || dist <= 0) return { x: cur.x, y: cur.y };
  if (!(maxStep > 0) || dist <= maxStep) return { x: target.x, y: target.y };

  const ratio = maxStep / dist;
  return { x: cur.x + dx * ratio, y: cur.y + dy * ratio };
}

/** 点到线段的最短距离 */
function distToSegment(p: Vec2, a: NpcPatrolPoint, b: NpcPatrolPoint): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.min(Math.max(t, 0), 1);
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

/**
 * 把位置重定位到「所在路段」的起点索引（校正后对齐本地游标用）。
 *
 * ⚠️ 不能简单取「最近路点」：位置走过路段中点时最近路点是路段**终点**，`cursor` 会因此跳过整段
 * （客户端抄近道切角），与另一端产生数十像素的持续偏差。故按**点到路段的最短距离**定路段：
 * - loop：路段含末点→首点的回绕段，游标取路段起点；
 * - pingpong：反向行进时取路段终点（保证 `dir` 与游标同向，端点上能正确折返）；
 * - once：取路段起点；落在末点时取末点索引（`nextWaypoint` 返回 null 即停）。
 * 无路点返回 -1。
 */
export function nearestRouteIndex(
  points: NpcPatrolPoint[],
  x: number,
  y: number,
  loopMode: NpcPatrolRouteConfig['loopMode'],
  dir: 1 | -1,
): number {
  if (!Array.isArray(points) || points.length === 0) return -1;
  if (points.length === 1) return 0;

  const p = { x, y };
  const last = points.length - 1;
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < last; i++) {
    const d = distToSegment(p, points[i], points[i + 1]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = loopMode === 'pingpong' && dir === -1 ? i + 1 : i;
    }
  }

  if (loopMode === 'loop') {
    const d = distToSegment(p, points[last], points[0]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = last;
    }
  }

  const dLast = Math.hypot(points[last].x - x, points[last].y - y);
  if (dLast < bestDist) bestIdx = last;

  return bestIdx;
}
