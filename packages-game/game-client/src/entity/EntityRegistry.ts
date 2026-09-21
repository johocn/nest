import type { Entity, EntityKind } from './Entity';

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

  clear(): void {
    for (const e of byId.values()) {
      if (e.sprite.parent) e.sprite.parent.removeChild(e.sprite);
    }
    byId.clear();
  },
};