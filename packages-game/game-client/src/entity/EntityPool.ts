import { AppConfig } from '../config/AppConfig';
import { EntityRegistry } from './EntityRegistry';
import type { Entity, EntityKind } from './Entity';

/**
 * S8 Task 2 实体对象池（**纯逻辑，Laya-free**）。
 *
 * 运行时 import 只有 `AppConfig`（常量字面量）与 `EntityRegistry`（同为 Laya-free），对 `Entity` 只用
 * `import type` —— 因此本模块可被零依赖 node 断言脚本直接 import（node 里没有 Laya）。
 * Laya 侧的新建与重置由调用方注入的 `PoolAdapter` 承担（见 `world/entity-pool-adapter.ts`）。
 *
 * D4：只池化「高频增删」实体（远端玩家、动态 NPC、掉落物）；静态物件与固定 NPC 不进池
 * （池化收益与增删频率成正比，静态实体池化只增加复杂度）。
 */

/** Laya 侧适配器：把引擎依赖挡在池外，让池本身可在 node 里用假实体断言 */
export interface PoolAdapter<S> {
  /** 新建实体（仅在对应 kind 的桶为空时调用） */
  create(spec: S): Entity;
  /** **无条件**把实体重置为 spec 描述的状态（含名字/位置/贴图/可见性）；实现方不得 new Laya 对象 */
  reset(entity: Entity, spec: S): void;
}

export interface PoolKindStats {
  /** `adapter.create` 的累计调用次数 */
  created: number;
  /** 从桶中复用并 reset 的累计次数 */
  reused: number;
  /** 当前空闲在桶里的实体数 */
  pooled: number;
  /** 当前已 acquire、尚未 release 的实体数 */
  live: number;
  /** 因桶达上限而被丢弃的累计次数 */
  discarded: number;
}

export type PoolStats = Record<EntityKind, PoolKindStats>;

/** stats() 的 key 集合固定为四个 kind（即使某 kind 从未用过，形状也稳定） */
const ALL_KINDS: EntityKind[] = ['player', 'npc', 'object', 'building'];

interface Bucket {
  /** 空闲实体（已 release、等待复用）；release 时从父节点摘除但不销毁 */
  free: Entity[];
  created: number;
  reused: number;
  discarded: number;
}

/** 每 kind 一个桶（按需创建） */
const buckets = new Map<EntityKind, Bucket>();
/** 已 acquire、尚未 release 的实体：用于 live 计数与 release 幂等判定 */
const live = new Set<Entity>();

function bucketOf(kind: EntityKind): Bucket {
  let bucket = buckets.get(kind);
  if (!bucket) {
    bucket = { free: [], created: 0, reused: 0, discarded: 0 };
    buckets.set(kind, bucket);
  }
  return bucket;
}

/**
 * 取一个 `kind` 类实体：优先复用桶内实例，否则新建。
 *
 * **无论新建还是复用，都无条件调用 `adapter.reset`** —— 这是「幽灵实体」（计划风险 #2）的
 * **结构性防护**：出池动作本身即一次显式重置，复用实体的残留状态在结构上不可能被带出。
 * 若只是在「复用分支」里调 reset，将来新增一条返回池内实体的路径就会漏掉重置。
 */
export function acquire<S>(kind: EntityKind, spec: S, adapter: PoolAdapter<S>): Entity {
  const bucket = bucketOf(kind);
  const pooled = bucket.free.pop();
  let entity: Entity;
  if (pooled) {
    entity = pooled;
    bucket.reused++;
  } else {
    entity = adapter.create(spec);
    bucket.created++;
  }
  adapter.reset(entity, spec);
  live.add(entity);
  return entity;
}

/**
 * 归还实体：从注册表与父节点摘除、隐藏 sprite，但**不销毁**（入桶待复用）。
 *
 * 幂等：同一实体重复 release 只有第一次生效 —— 否则同一实例会在桶里出现多次，
 * 进而被两次 acquire 拿到（两个逻辑对象共享一个 sprite）。
 * 桶达上限（`AppConfig.pool.maxPerKind`）时直接丢弃并计入 `discarded`，防止长时间运行内存无界增长。
 */
export function release(entity: Entity): void {
  if (!live.has(entity)) return;
  live.delete(entity);

  EntityRegistry.remove(entity.entityId);
  entity.sprite.visible = false;

  const bucket = bucketOf(entity.kind);
  if (bucket.free.length >= AppConfig.pool.maxPerKind) {
    bucket.discarded++;
    return;
  }
  bucket.free.push(entity);
}

/** 每 kind 计数：`created/reused/discarded` 为累计值，`pooled/live` 为当前值 */
export function stats(): PoolStats {
  const out = {} as PoolStats;
  for (const kind of ALL_KINDS) {
    const bucket = buckets.get(kind);
    let liveOfKind = 0;
    for (const e of live) if (e.kind === kind) liveOfKind++;
    out[kind] = {
      created: bucket ? bucket.created : 0,
      reused: bucket ? bucket.reused : 0,
      pooled: bucket ? bucket.free.length : 0,
      live: liveOfKind,
      discarded: bucket ? bucket.discarded : 0,
    };
  }
  return out;
}

/** 清空所有桶与 live 记录（丢弃池内实体、不再持有引用）：场景切换 / 断言收尾用；累计计数保留 */
export function clear(): void {
  buckets.clear();
  live.clear();
}

/** 累计计数归零（桶内实体与 live 记录保留）；与 `clear()` 组合即完全复位 */
export function resetStats(): void {
  for (const bucket of buckets.values()) {
    bucket.created = 0;
    bucket.reused = 0;
    bucket.discarded = 0;
  }
}