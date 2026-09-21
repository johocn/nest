import type { SceneConfig, ServerSpawn } from '../config/schema';
import { Entity } from '../entity/Entity';
import { EntityFactory } from '../entity/EntityFactory';
import { EntityRegistry } from '../entity/EntityRegistry';

export class SceneBuilder {
  /** 世界层：child[0] = 背景层（地形/网格/触发器区域），child[1..] = 实体层（按 y 升序） */
  static layer: Laya.Sprite | null = null;

  static build(cfg: SceneConfig): Laya.Sprite {
    const layer = new Laya.Sprite();
    SceneBuilder.layer = layer;

    const bg = new Laya.Sprite();
    bg.graphics.drawRect(0, 0, cfg.scene.mapWidth, cfg.scene.mapHeight, '#2f6b3a');
    for (let x = 0; x <= cfg.scene.mapWidth; x += 100) {
      bg.graphics.drawLine(x, 0, x, cfg.scene.mapHeight, '#3d7a4a', 1);
    }
    for (let y = 0; y <= cfg.scene.mapHeight; y += 100) {
      bg.graphics.drawLine(0, y, cfg.scene.mapWidth, y, '#3d7a4a', 1);
    }
    for (const t of cfg.triggers) {
      bg.graphics.drawRect(t.area.x, t.area.y, t.area.w, t.area.h, null, '#f5c542', 2);
    }
    layer.addChild(bg);

    const entityLayer = new Laya.Sprite();
    entityLayer.name = 's1-entities';
    layer.addChild(entityLayer);

    const statics: Entity[] = [
      ...cfg.staticEntities.map((e) => EntityFactory.createFromStatic(e)),
      ...cfg.fixedNpcs.map((n) => EntityFactory.createFromFixedNpc(n)),
    ];
    statics.sort((a, b) => a.y - b.y);
    for (const e of statics) {
      EntityRegistry.add(e);
      entityLayer.addChild(e.sprite);
    }

    console.log(
      `[S1] 静态层渲染完成：地形 ${cfg.scene.mapWidth}x${cfg.scene.mapHeight}，物件 ${cfg.staticEntities.length}，NPC ${cfg.fixedNpcs.length}，触发器 ${cfg.triggers.length}，出生点 (${cfg.scene.entry.x},${cfg.scene.entry.y})`,
    );
    return layer;
  }

  private static entityLayer(): Laya.Sprite | null {
    const layer = SceneBuilder.layer;
    if (!layer) return null;
    return (layer.getChildByName('s1-entities') as Laya.Sprite) ?? null;
  }

  /** 幂等挂载：同一实体重复调用不会重复 addChild */
  static addEntity(entity: Entity): void {
    const target = SceneBuilder.entityLayer();
    if (!target) return;
    EntityRegistry.add(entity);
    if (entity.sprite.parent !== target) target.addChild(entity.sprite);
  }

  /**
   * 总纲 §6.5 去重规则：按 spawnId 求交，配置包优先。
   * - entity_type='object' 一律忽略（静态物件已在配置包，避免同屏双份与坐标漂移）
   * - entity_type='npc' 且 spawnId 已在配置包 fixedNpcs 中 → 忽略（位置以服务端为准的规则留给 S4 的巡逻/随机 NPC）
   * 返回被保留的动态 spawn，供调用方生成实体。
   */
  static mergeServerSpawns(cfg: SceneConfig, spawns: ServerSpawn[]): ServerSpawn[] {
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

  /** 每 N 帧按 y 升序重排实体层，实现伪 3D 遮挡（n ≤ 150，成本可忽略） */
  static resort(): void {
    const entityLayer = SceneBuilder.entityLayer();
    if (!entityLayer) return;

    const list = EntityRegistry.all().slice().sort((a, b) => a.y - b.y);
    for (let i = 0; i < list.length; i++) {
      if (entityLayer.getChildIndex(list[i].sprite) !== i) {
        entityLayer.setChildIndex(list[i].sprite, i);
      }
    }
  }
}