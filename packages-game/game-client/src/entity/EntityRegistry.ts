import type { Entity, EntityKind } from './Entity';
import { containsPoint } from '../world/Viewport';
import type { Rect } from '../world/Viewport';

const byId = new Map<string, Entity>();

export const EntityRegistry = {
  add(entity: Entity): void {
    byId.set(entity.entityId, entity);
  },

  remove(entityId: string): void {
    const e = byId.get(entityId);
    if (e && e.sprite.parent) e.sprite.parent.removeChild(e.sprite);
    byId.delete(entityId);
  },

  get(entityId: string): Entity | undefined {
    return byId.get(entityId);
  },

  all(): Entity[] {
    return Array.from(byId.values());
  },

  byKind(kind: EntityKind): Entity[] {
    const list: Entity[] = [];
    for (const e of byId.values()) {
      if (e.kind === kind) list.push(e);
    }
    return list;
  },

  /** 以 (x,y) 为圆心、r 为半径内的实体（含边界）；不做任何 kind 过滤，由调用方决定 */
  inRadius(x: number, y: number, r: number): Entity[] {
    const list: Entity[] = [];
    for (const e of byId.values()) {
      if (Math.hypot(e.x - x, e.y - y) <= r) list.push(e);
    }
    return list;
  },

  /**
   * 视口矩形内（**含边界**）的实体：按实体坐标 `e.x/e.y` 判定。
   * 裁剪 tick 的线性扫描入口 —— 150 实体量级无需空间索引（判定纯函数在 `world/Viewport`）。
   */
  inRect(rect: Rect): Entity[] {
    const list: Entity[] = [];
    for (const e of byId.values()) {
      if (containsPoint(rect, e.x, e.y)) list.push(e);
    }
    return list;
  },

  /** 可见实体数：口径与 `PerfPanel` 一致（`sprite.visible !== false` 是可见性的唯一真值来源） */
  visibleCount(): number {
    let n = 0;
    for (const e of byId.values()) if (e.sprite.visible !== false) n++;
    return n;
  },

  /** 按 entityId upsert：已存在则仅更新坐标（§9 的广播 upsert 语义），否则交付给传入的创建函数 */
  upsert(entityId: string, position: { x: number; y: number }, create: () => Entity): Entity {
    const existing = byId.get(entityId);
    if (existing) {
      existing.setPos(position.x, position.y);
      return existing;
    }
    const created = create();
    EntityRegistry.add(created);
    return created;
  },

  /**
   * 逐帧推进所有实体的组件（`Component.update` 契约的唯一驱动点，S4 的 AiComponent 依赖它）。
   *
   * S8 Task 4：可选谓词 `shouldUpdate` —— 传了才过滤（**缺省行为与基线逐字一致**，S4 依赖不受影响）。
   * `Main.ts` 传入「可见才更新」，让离屏实体不再做路点插值等逐帧计算。
   */
  updateAll(dtMs: number, shouldUpdate?: (entity: Entity) => boolean): void {
    for (const e of byId.values()) {
      if (shouldUpdate && !shouldUpdate(e)) continue;
      for (const c of e.components.values()) c.update(dtMs);
    }
  },

  clear(): void {
    for (const e of byId.values()) {
      if (e.sprite.parent) e.sprite.parent.removeChild(e.sprite);
    }
    byId.clear();
  },
};