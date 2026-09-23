import type { SceneConfig, ServerSpawn } from '../config/schema';
import { AppConfig } from '../config/AppConfig';
import { Entity } from '../entity/Entity';
import { EntityFactory } from '../entity/EntityFactory';
import { EntityRegistry } from '../entity/EntityRegistry';
import type { QualitySwitches } from '../perf/Quality';
import { Quality } from '../perf/Quality';
import {
  gridLinePositions,
  shouldDrawGrid,
  shouldDrawTriggerOutline,
  shouldResort,
} from './static-layer';
import type { ResortSnapshot } from './static-layer';
import { mergeServerSpawns as mergeSpawnList } from './spawn-merge';

const BG = AppConfig.sceneBg;

export class SceneBuilder {
  /** 世界层：child[0] = 背景层（地形/网格/触发器区域），child[1..] = 实体层（按 y 升序） */
  static layer: Laya.Sprite | null = null;

  /** 背景层（静态，合图缓存对象）与场景配置：切档时 `applyQuality` 需要原地重绘，故持有引用 */
  private static bg: Laya.Sprite | null = null;
  private static cfg: SceneConfig | null = null;
  /** 档位订阅的注销函数（重复 build 时先注销上一次，避免监听器泄漏） */
  private static offQuality: (() => void) | null = null;
  /** 上一次**真正排序后**的实体快照（D8 增量的比较基准） */
  private static sortedKey: ResortSnapshot = { ids: [], ys: {} };

  static build(cfg: SceneConfig): Laya.Sprite {
    const layer = new Laya.Sprite();
    SceneBuilder.layer = layer;
    SceneBuilder.cfg = cfg;

    const bg = new Laya.Sprite();
    bg.name = 's8-scene-bg';
    SceneBuilder.bg = bg;
    const cmds = SceneBuilder.drawBackground(bg, cfg, Quality.switches());
    // 必须在绘制完成后设置 cacheAs：缓存是「设置那一刻」的快照，先设后画会缓存空图且不再刷新
    if (BG.cacheAsBitmap) bg.cacheAs = 'bitmap';
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

    // 增量排序基准：静态实体已按 y 排好，记录初始快照（动态实体后到会因「集合变化」触发重排）
    SceneBuilder.sortedKey = SceneBuilder.snapshot();

    // 切档当场生效（A10）：重绘背景层并刷新合图缓存
    SceneBuilder.offQuality?.();
    SceneBuilder.offQuality = Quality.onChange(() => SceneBuilder.applyQuality());

    console.log(
      `[S1] 静态层渲染完成：地形 ${cfg.scene.mapWidth}x${cfg.scene.mapHeight}，物件 ${cfg.staticEntities.length}，NPC ${cfg.fixedNpcs.length}，触发器 ${cfg.triggers.length}，出生点 (${cfg.scene.entry.x},${cfg.scene.entry.y})`,
    );
    console.log(
      `[S8] 背景层合图：graphics 命令 ${cmds} 条 → cacheAs=${BG.cacheAsBitmap ? 'bitmap' : 'none'}（quality=${Quality.tier()} 网格${shouldDrawGrid(Quality.switches()) ? '开' : '关'} 描边${shouldDrawTriggerOutline(Quality.switches()) ? '开' : '关'}）`,
    );
    return layer;
  }

  /**
   * 背景绘制（含网格与触发区描边）：全部 graphics 命令的唯一来源，`build` 与 `applyQuality` 共用。
   * 返回本次下发的命令数（供面板/日志量化「几十条 → 1 个缓存位图」的收益，不参与渲染）。
   */
  private static drawBackground(bg: Laya.Sprite, cfg: SceneConfig, sw: QualitySwitches): number {
    let cmds = 0;
    bg.graphics.clear();
    bg.graphics.drawRect(0, 0, cfg.scene.mapWidth, cfg.scene.mapHeight, BG.groundColor);
    cmds++;

    if (shouldDrawGrid(sw)) {
      const { verticals, horizontals } = gridLinePositions(
        cfg.scene.mapWidth,
        cfg.scene.mapHeight,
        BG.gridInterval,
      );
      for (const x of verticals) {
        bg.graphics.drawLine(x, 0, x, cfg.scene.mapHeight, BG.gridColor, BG.gridLineWidth);
        cmds++;
      }
      for (const y of horizontals) {
        bg.graphics.drawLine(0, y, cfg.scene.mapWidth, y, BG.gridColor, BG.gridLineWidth);
        cmds++;
      }
    }

    if (shouldDrawTriggerOutline(sw)) {
      for (const t of cfg.triggers) {
        bg.graphics.drawRect(
          t.area.x,
          t.area.y,
          t.area.w,
          t.area.h,
          null,
          BG.triggerOutlineColor,
          BG.triggerOutlineWidth,
        );
        cmds++;
      }
    }
    return cmds;
  }

  /** 切档当场生效（A10）：按当前 `Quality.switches()` 重绘背景层并刷新合图缓存 */
  static applyQuality(): void {
    const bg = SceneBuilder.bg;
    const cfg = SceneBuilder.cfg;
    if (!bg || !cfg) return;
    const cmds = SceneBuilder.drawBackground(bg, cfg, Quality.switches());
    // 重绘后缓存已失效：显式刷新（引擎不会因自身 graphics 变化自动重建位图）
    if (BG.cacheAsBitmap) bg.reCache();
    console.log(
      `[S8] 背景层按 quality=${Quality.tier()} 重绘：graphics 命令 ${cmds} 条，缓存已刷新`,
    );
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
   * 纯逻辑在 `world/spawn-merge.ts`（零引擎依赖，可被 node 断言），本方法只做委托。
   */
  static mergeServerSpawns(cfg: SceneConfig, spawns: ServerSpawn[]): ServerSpawn[] {
    return mergeSpawnList(cfg, spawns);
  }

  /** 当前注册表快照（id 集合 + 各实体 y），供 D8 增量比对 */
  private static snapshot(): ResortSnapshot {
    const snap: ResortSnapshot = { ids: [], ys: {} };
    for (const e of EntityRegistry.all()) {
      snap.ids.push(e.entityId);
      snap.ys[e.entityId] = e.y;
    }
    return snap;
  }

  /**
   * 每 N 帧按 y 升序重排实体层，实现伪 3D 遮挡。
   * S8 Task 3（D8）增量化：**实体集合未变且无实体位移 ≥ 阈值**时直接返回（零排序、零 setChildIndex）；
   * 判定逻辑见 `world/static-layer.shouldResort`（纯函数，可 node 断言）。
   */
  static resort(): void {
    const entityLayer = SceneBuilder.entityLayer();
    if (!entityLayer) return;

    const all = EntityRegistry.all();
    const cur: ResortSnapshot = { ids: [], ys: {} };
    for (const e of all) {
      cur.ids.push(e.entityId);
      cur.ys[e.entityId] = e.y;
    }
    if (!shouldResort(SceneBuilder.sortedKey, cur, BG.resortMoveThreshold)) return;

    const list = all.slice().sort((a, b) => a.y - b.y);
    for (let i = 0; i < list.length; i++) {
      if (entityLayer.getChildIndex(list[i].sprite) !== i) {
        entityLayer.setChildIndex(list[i].sprite, i);
      }
    }
    SceneBuilder.sortedKey = cur;
  }
}