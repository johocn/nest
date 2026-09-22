import { EntityRegistry } from '../entity/EntityRegistry';
import type { Entity } from '../entity/Entity';
import type {
  BuildRuleView,
  BuildingState,
  BuildingTemplate,
  BuildingView,
} from '../net/api';

/**
 * S6 建造的**纯逻辑模块**（零引擎依赖）。
 *
 * ⚠️ 本文件不 import 任何会牵连 Laya 的模块（类型只走 `import type`；`EntityRegistry` 顶层无引擎调用），
 * 故产物 `bin/js/world/build-logic.js` 可被 `node` 直接 import，供 `scripts/smoke-s6-build.mjs`
 * 断言「本地预判 / 三态表现分支 / 进度换算 / 广播帧解析」；`BuildPanel`、`EntityFactory`、
 * `Main` 只做委托（与 S3 `spawn-merge.ts`、S4 `patrol.ts` 同一套路）。
 *
 * 权威性：本地预判**只是提示**，服务端 `assertCanBuild` 才是权威（计划 §4 默认）。
 */

/** 后端 `build-rule.service.ts` 的 DEFAULT_GRID_SIZE，无规则行时的默认格边长（像素） */
export const DEFAULT_GRID_SIZE = 64;

/** 本地预判结论文案（与后端错误语义一一对应，供 UI 与断言脚本共用同一来源） */
export const PLOT_REASON = {
  forbidden: '此场景不允许建造',
  outOfBounds: '超出场景范围',
  reserved: '该区域为保留区',
  limit: '建造数量已达上限',
  occupied: '该地块已被占用',
  ok: '可建造',
} as const;

/** 建筑三态的表现分支（`EntityFactory` 与断言脚本共用同一来源，避免声明与实现漂移） */
export interface BuildingAppearance {
  /** 整体透明度（building 态半透明 = 未落成） */
  alpha: number;
  /** 是否显示进度条 */
  progressBar: boolean;
  /** 是否显示耐久 */
  durability: boolean;
  /** 是否淡出后移除（demolishing） */
  fadeOut: boolean;
}

export function buildingAppearance(state: BuildingState): BuildingAppearance {
  switch (state) {
    case 'built':
      return { alpha: 1, progressBar: false, durability: true, fadeOut: false };
    case 'demolishing':
      return { alpha: 1, progressBar: false, durability: false, fadeOut: true };
    case 'building':
    default:
      return { alpha: 0.5, progressBar: true, durability: false, fadeOut: false };
  }
}

/**
 * 建造进度（0~1）。
 * `finishAt` 为空或 `buildSeconds<=0` → 返回 null（不确定进度，UI 画中性条）。
 * 客户端**不做本地到点落成**：落成一律由服务端广播驱动，这里只做两帧广播之间的视觉插值。
 */
export function calcProgress(
  finishAt: string | null,
  nowMs: number,
  buildSeconds: number,
): number | null {
  if (!finishAt || !(buildSeconds > 0)) return null;
  const finish = new Date(finishAt).getTime();
  if (!Number.isFinite(finish)) return null;
  const remaining = finish - nowMs;
  const progress = 1 - remaining / (buildSeconds * 1000);
  return Math.min(1, Math.max(0, progress));
}

/** 像素 → 格点（与后端 `BuildRuleService.toGrid` 同口径） */
export function worldToGrid(
  x: number,
  y: number,
  gridSize: number,
): { gx: number; gy: number } {
  const size = gridSize > 0 ? gridSize : DEFAULT_GRID_SIZE;
  return { gx: Math.floor(x / size), gy: Math.floor(y / size) };
}

/** 格点 → 格中心像素（与后端 `BuildRuleService.toCenter` 同口径） */
export function gridCenter(
  gx: number,
  gy: number,
  gridSize: number,
): { x: number; y: number } {
  const size = gridSize > 0 ? gridSize : DEFAULT_GRID_SIZE;
  return { x: (gx + 0.5) * size, y: (gy + 0.5) * size };
}

/** 占地格集合：`(gx,gy)` 为左上角锚点格，半开矩形 [gx,gx+w) × [gy,gy+h) */
export function footprintCells(
  gx: number,
  gy: number,
  w: number,
  h: number,
): Array<{ gx: number; gy: number }> {
  const cells: Array<{ gx: number; gy: number }> = [];
  const width = Math.max(1, Math.floor(w || 1));
  const height = Math.max(1, Math.floor(h || 1));
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) cells.push({ gx: gx + i, gy: gy + j });
  }
  return cells;
}

/** 已有建筑占用的格集合（`BuildingView.x/y` 是锚点格中心像素） */
export function occupiedCells(
  buildings: readonly BuildingView[],
  gridSize: number,
): Array<{ gx: number; gy: number }> {
  const cells: Array<{ gx: number; gy: number }> = [];
  for (const b of buildings) {
    const { gx, gy } = worldToGrid(b.x, b.y, gridSize);
    cells.push(...footprintCells(gx, gy, b.w, b.h));
  }
  return cells;
}

export interface PlotPredictionInput {
  rule: BuildRuleView | null;
  gx: number;
  gy: number;
  w: number;
  h: number;
  mapWidth: number;
  mapHeight: number;
  /** 已被建筑占用的格点 */
  occupied: ReadonlyArray<{ gx: number; gy: number }>;
  /** 当前玩家在场景内的有效建筑数（state ∈ building/built） */
  ownBuildingCount: number;
}

/**
 * 格点合法性**本地预判**（越界/保留区/上限/地块占用），顺序与后端 `assertCanBuild` 一致：
 * 模式 → 场景边界 → 保留区 → 玩家上限 → 地块占用。
 */
export function predictPlot(input: PlotPredictionInput): { legal: boolean; reason: string } {
  const { rule, gx, gy, w, h, mapWidth, mapHeight, occupied, ownBuildingCount } = input;

  if (!rule || rule.mode === 'forbidden') {
    return { legal: false, reason: PLOT_REASON.forbidden };
  }

  const gridSize = rule.landGridSize > 0 ? rule.landGridSize : DEFAULT_GRID_SIZE;
  const maxGx = Math.floor(mapWidth / gridSize);
  const maxGy = Math.floor(mapHeight / gridSize);
  const width = Math.max(1, Math.floor(w || 1));
  const height = Math.max(1, Math.floor(h || 1));
  if (gx < 0 || gy < 0 || gx + width > maxGx || gy + height > maxGy) {
    return { legal: false, reason: PLOT_REASON.outOfBounds };
  }

  const zones = rule.reservedZones ?? [];
  const inReserved = zones.some(
    (z) => gx < z.x + z.w && gx + width > z.x && gy < z.y + z.h && gy + height > z.y,
  );
  if (inReserved) return { legal: false, reason: PLOT_REASON.reserved };

  if (ownBuildingCount >= rule.maxBuildingsPerPlayer) {
    return { legal: false, reason: PLOT_REASON.limit };
  }

  const taken = new Set(occupied.map((c) => `${c.gx},${c.gy}`));
  if (footprintCells(gx, gy, width, height).some((c) => taken.has(`${c.gx},${c.gy}`))) {
    return { legal: false, reason: PLOT_REASON.occupied };
  }

  return { legal: true, reason: PLOT_REASON.ok };
}

/** 广播帧 / HTTP 视图归一化后的建筑更新（建造广播 `entityType='building'`） */
export interface BuildingUpdate {
  entityId: string;
  buildingId: string;
  templateId: string;
  x: number;
  y: number;
  state: BuildingState;
  /** 广播帧不带该字段（null）；HTTP 视图带 */
  finishAt: string | null;
}

/** 建实体所需的完整描述（广播帧缺 w/h/name/durability，由蓝图补齐） */
export interface BuildingSpawn extends BuildingUpdate {
  w: number;
  h: number;
  name: string;
  /** 蓝图 durability；取不到为 null（不显示耐久） */
  durability: number | null;
  /** 蓝图建造耗时（秒），进度条插值用；取不到为 0 */
  buildSeconds: number;
}

/**
 * 解析 `world.entity_update` 的建筑帧。
 * ⚠️ 帧内 `data.playerId` 为 **null**（建造广播不属于任何玩家），本函数**不读取该字段**。
 * 非建筑帧或缺少 buildingId → 返回 null（调用方跳过，不影响 player/npc 分支）。
 */
export function parseBuildingUpdate(data: unknown): BuildingUpdate | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, any>;
  if (d.entityType !== 'building') return null;

  const buildingId = String(d.buildingId ?? '');
  if (!buildingId) return null;

  const pos = (d.pos ?? {}) as Record<string, any>;
  return {
    entityId: String(d.entityId ?? `building:${buildingId}`),
    buildingId,
    templateId: String(d.templateId ?? ''),
    x: Number(pos.x ?? 0),
    y: Number(pos.y ?? 0),
    state: (d.state ?? 'building') as BuildingState,
    finishAt: d.finishAt ?? null,
  };
}

export interface BuildingSpawnSource {
  buildingId: string;
  templateId: string;
  x: number;
  y: number;
  state: BuildingState;
  finishAt?: string | null;
  w?: number;
  h?: number;
}

/** 视图/广播帧 + 蓝图 → 实体描述（蓝图缺失时退化为 1×1、无耐久、无耗时） */
export function toBuildingSpawn(
  src: BuildingSpawnSource,
  template: BuildingTemplate | null,
): BuildingSpawn {
  return {
    entityId: `building:${src.buildingId}`,
    buildingId: src.buildingId,
    templateId: src.templateId,
    x: src.x,
    y: src.y,
    state: src.state,
    finishAt: src.finishAt ?? null,
    w: Math.max(1, Math.floor(src.w ?? template?.footprintW ?? 1)),
    h: Math.max(1, Math.floor(src.h ?? template?.footprintH ?? 1)),
    name: template?.name ?? `建筑${src.buildingId}`,
    durability: template ? template.durability : null,
    buildSeconds: template?.buildSeconds ?? 0,
  };
}

/** HTTP 视图（含 finishAt/w/h）→ 实体描述；视图是唯一带 finishAt 的来源（广播帧不带） */
export function viewToSpawn(
  view: BuildingView,
  template: BuildingTemplate | null,
): BuildingSpawn {
  return toBuildingSpawn(
    {
      buildingId: view.id,
      templateId: view.templateId,
      x: view.x,
      y: view.y,
      state: view.state,
      finishAt: view.finishAt,
      w: view.w,
      h: view.h,
    },
    template,
  );
}

/** 帧数据是否指向本地已存在的建筑实体（`EntityRegistry.upsert` 的 upsert 语义判定） */
export function buildingEntityExists(entityId: string): boolean {
  return EntityRegistry.get(entityId) !== undefined;
}

/**
 * 建造广播接入（计划 Task 7 Step 4）：`entityType==='building'` → `EntityRegistry.upsert(entityId, pos, create)`。
 * 复用既有 upsert 语义（已存在只更新坐标），**不新增推送机制**；返回 null 表示非建筑帧。
 */
export function upsertBuildingEntity(
  data: unknown,
  create: (update: BuildingUpdate) => Entity,
): { entity: Entity; created: boolean; update: BuildingUpdate } | null {
  const update = parseBuildingUpdate(data);
  if (!update) return null;
  const created = !buildingEntityExists(update.entityId);
  const entity = EntityRegistry.upsert(
    update.entityId,
    { x: update.x, y: update.y },
    () => create(update),
  );
  return { entity, created, update };
}
