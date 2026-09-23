import { EntityFactory } from '../entity/EntityFactory';
import type { Entity } from '../entity/Entity';
import type { PoolAdapter } from '../entity/EntityPool';

/**
 * S8 Task 2：远端玩家对象池适配器（**Laya 侧**）。
 *
 * 池（`entity/EntityPool.ts`）刻意做成 Laya-free 的纯逻辑，Laya 相关的新建/重置在此注入 ——
 * 两者分开是为了「池的纯逻辑」可被 node 假实体断言，而「引擎侧真重置」由浏览器脚本断言。
 *
 * 只做远端玩家（D4 中「高频增删」之一）。真实 release 触发点（掉线广播 = 契约变更、离开视野 = Task 4
 * 视口裁剪）都不在本批，本 Task 只把 acquire 侧接通，release 侧留给 Task 4 与后续服务端广播。
 */

/** 复用所需的全部信息（与创建同一份描述，避免漂移） */
export interface RemotePlayerSpec {
  playerId: string;
  x: number;
  y: number;
}

export const remotePlayerAdapter: PoolAdapter<RemotePlayerSpec> = {
  create(spec: RemotePlayerSpec): Entity {
    return EntityFactory.createOtherPlayer(spec.playerId, spec.x, spec.y);
  },
  reset(entity: Entity, spec: RemotePlayerSpec): void {
    // 唯一初值来源是 EntityFactory.otherPlayerOptions：创建与重置共用同一描述，杜绝字段漂移
    entity.reset(EntityFactory.otherPlayerOptions(spec.playerId, spec.x, spec.y));
  },
};