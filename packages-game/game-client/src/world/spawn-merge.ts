import type { SceneConfig, ServerSpawn } from '../config/schema';

/**
 * 服务端 spawn 与配置包的去重（纯逻辑模块）。
 *
 * ⚠️ 本文件**不 import 任何引擎模块（不牵连 Laya）**：类型只走 `import type`（编译期即被擦除），
 * 故产物 `bin/js/world/spawn-merge.js` 可被 `node` 直接 import，供 `scripts/smoke-s3-components.mjs`
 * 断言去重规则；`SceneBuilder.mergeServerSpawns` 只做委托（行为逐字等价）。
 *
 * 总纲 §6.5 去重规则：按 spawnId 求交，配置包优先。
 * - entity_type='object' 一律忽略（静态物件已在配置包，避免同屏双份与坐标漂移）
 * - entity_type='npc' 且 spawnId 已在配置包 fixedNpcs 中 → 忽略（位置以服务端为准的规则留给 S4 的巡逻/随机 NPC）
 * 返回被保留的动态 spawn，供调用方生成实体。
 */
export function mergeServerSpawns(cfg: SceneConfig, spawns: ServerSpawn[]): ServerSpawn[] {
  const staticNpcSpawnIds = new Set(cfg.fixedNpcs.map((n) => n.spawnId));
  const accepted: ServerSpawn[] = [];
  let ignored = 0;

  for (const sp of spawns) {
    const id = Number(sp.id);
    if (sp.entityType === 'object') {
      ignored++;
      continue;
    }
    if (sp.entityType === 'npc' && staticNpcSpawnIds.has(id)) {
      ignored++;
      continue;
    }
    accepted.push(sp);
  }

  console.log(
    `[S1] 服务端 spawns=${spawns.length}，去重忽略=${ignored}（静态物件/已在配置包的 NPC），接受动态=${accepted.length}`,
  );
  return accepted;
}
