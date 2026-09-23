import { AppConfig } from '../config/AppConfig';
import { AiComponent } from './components/AiComponent';
import { BuildComponent, BuildingViewComponent } from './components/BuildComponent';
import { Component } from './components/Component';
import { createInteractComponent } from './components/interact/registry';
import { TransformComponent } from './components/TransformComponent';
import { VisualComponent } from './components/VisualComponent';
import { Entity, type EntityOptions } from './Entity';
import type { BuildRuleView } from '../net/api';
import type { BuildingSpawn } from '../world/build-logic';
import type { FixedNpc, NpcInstanceConfig, ServerSpawn, StaticEntity } from '../config/schema';

const PLACEHOLDER_URL = `${AppConfig.assetBase}resources/placeholder.png`;

const COLORS: Record<string, string> = {
  player: '#2f81f7',
  npc: '#f5a524',
  object: '#7ee787',
  monster: '#ff7b72',
  // S6 建筑：与静态物件的绿色区分（木质棕）
  building: '#a1724a',
};

export class EntityFactory {
  private static texture: Laya.Texture | null = null;

  /** 一次性加载占位贴图（验证引擎 loader 与静态资源路径） */
  static async loadPlaceholder(): Promise<void> {
    await Laya.loader.load(PLACEHOLDER_URL);
    EntityFactory.texture = Laya.Loader.getRes(PLACEHOLDER_URL) as Laya.Texture;
    console.log(`[S1] 占位贴图加载完成：${PLACEHOLDER_URL}`);
  }

  static createPlayer(playerId: string, x: number, y: number): Entity {
    return EntityFactory.assemble({
      entityId: `player:${playerId}`,
      kind: 'player',
      spawnId: null,
      templateId: null,
      displayName: `我(${playerId})`,
      x,
      y,
      color: COLORS.player,
      texture: EntityFactory.texture,
    });
  }

  /**
   * 远端玩家的实体描述（S8 Task 2）：对象池的 `create` 与 `reset` 必须来自**同一份**初值，
   * 故把描述抽成唯一来源，`createOtherPlayer` 与池适配器都走这里（避免重置与创建字段漂移）。
   */
  static otherPlayerOptions(playerId: string, x: number, y: number): EntityOptions {
    return {
      entityId: `player:${playerId}`,
      kind: 'player',
      spawnId: null,
      templateId: null,
      displayName: `玩家${playerId}`,
      x,
      y,
      color: COLORS.player,
      texture: EntityFactory.texture,
    };
  }

  static createOtherPlayer(playerId: string, x: number, y: number): Entity {
    return EntityFactory.assemble(EntityFactory.otherPlayerOptions(playerId, x, y));
  }

  static createFromStatic(e: StaticEntity): Entity {
    return EntityFactory.assemble(
      {
        entityId: `object:${e.spawnId}`,
        kind: 'object',
        spawnId: e.spawnId,
        templateId: e.templateId,
        displayName: `物${e.spawnId}`,
        x: e.x,
        y: e.y,
        color: COLORS.object,
        texture: EntityFactory.texture,
      },
      // 交互组件完全由配置包的 interact 信息声明（type/cd/oneTime），工厂不做业务分支
      [
        createInteractComponent({
          kind: e.interact.type,
          cd: e.interact.cd,
          oneTime: e.interact.oneTime,
        }),
      ],
    );
  }

  static createFromFixedNpc(n: FixedNpc): Entity {
    return EntityFactory.assemble(
      {
        entityId: `npc:${n.spawnId}`,
        kind: 'npc',
        spawnId: n.spawnId,
        templateId: n.npcTemplateId,
        displayName: `NPC${n.spawnId}`,
        x: n.x,
        y: n.y,
        color: COLORS.npc,
        texture: EntityFactory.texture,
      },
      // npc_template 的交互类型 S3 固定为对话（talk）；shop/quest/transport 属 S5
      [createInteractComponent({ kind: 'talk' })],
    );
  }

  static createFromServerSpawn(sp: ServerSpawn): Entity {
    const id = Number(sp.id);
    const kind = sp.entityType === 'monster' ? 'npc' : sp.entityType;
    return EntityFactory.assemble(
      {
        entityId: `${kind}:${id}`,
        kind,
        spawnId: id,
        templateId: Number(sp.templateId),
        displayName: `${sp.entityType}${id}`,
        x: sp.spawnX,
        y: sp.spawnY,
        color: COLORS[sp.entityType] ?? COLORS.object,
        texture: EntityFactory.texture,
      },
      // 动态 NPC 与静态 NPC 一致挂对话组件；怪物的战斗交互属 S4，此处不挂交互组件
      sp.entityType === 'npc' ? [createInteractComponent({ kind: 'talk' })] : [],
    );
  }

  /**
   * 按进场景应答的 `npcs[]` 建实体（S4）：`entityId` 直接用服务端 `npcId`
   * （`npc:<spawnId>` 或 `npcs:<ruleId>:<slot>`），仅 patrol（带 `route`）挂 `AiComponent`。
   * 交互复用 S3 的 `TalkComponent`；`npcs:<ruleId>:<slot>` 形态暂不可对话（见 TalkComponent）。
   */
  static createFromNpcInstance(n: NpcInstanceConfig): Entity {
    const extras: Component[] = [createInteractComponent({ kind: 'talk' })];
    if (n.route) extras.push(new AiComponent(n.route, n.x, n.y));
    return EntityFactory.assemble(
      {
        entityId: n.npcId,
        kind: 'npc',
        spawnId: EntityFactory.spawnIdOf(n.npcId),
        templateId: Number(n.npcTemplateId),
        displayName: n.name || n.npcId,
        x: n.x,
        y: n.y,
        color: COLORS.npc,
        texture: EntityFactory.texture,
      },
      extras,
    );
  }

  /**
   * 广播漏包兜底：`world.entity_update`（npc）到达但本地无该实体时按包内数据补建。
   * 包内只有 `npcId/npcTemplateId/pos`，故补建为无 `route` 的静止 NPC（位置由后续校正继续逼近）。
   */
  static createFromNpcUpdate(npcId: string, npcTemplateId: string, x: number, y: number): Entity {
    return EntityFactory.createFromNpcInstance({
      npcId,
      npcTemplateId,
      resKey: '',
      name: npcId,
      scale: 1,
      anim: '',
      x,
      y,
    });
  }

  /** 只有 `npc:<spawnId>` 形态能映射到 `scene_entity_spawns.id`（对话接口按 spawnId 寻址） */
  private static spawnIdOf(npcId: string): number | null {
    const m = /^npc:(\d+)$/.exec(String(npcId ?? ''));
    return m ? Number(m[1]) : null;
  }

  /**
   * S6 建筑实体（Task 7 Step 3/4）：`building` 态半透明 + 进度条、`built` 态正常贴图 + 耐久、
   * `demolishing` 态淡出后从 `EntityRegistry` 移除（三态分支在 `BuildingViewComponent` 内，
   * 判定来源是纯函数 `build-logic.buildingAppearance`）。
   *
   * 零新增资源：贴图复用 S1 占位贴图（`loadPlaceholder` 已加载），半透明与耐久/进度条都用
   * `Graphics` / `Text` 画，不新增任何图片文件。出生位置用锚点格中心像素（`BuildingSpawn.x/y`）。
   */
  static createFromBuilding(spawn: BuildingSpawn, rule: BuildRuleView | null): Entity {
    return EntityFactory.assemble(
      {
        entityId: spawn.entityId,
        kind: 'building',
        spawnId: null,
        templateId: spawn.templateId ? Number(spawn.templateId) : null,
        displayName: spawn.name,
        x: spawn.x,
        y: spawn.y,
        color: COLORS.building,
        texture: EntityFactory.texture,
      },
      [
        new BuildComponent(rule),
        new BuildingViewComponent(
          spawn.state,
          spawn.finishAt,
          spawn.buildSeconds,
          spawn.durability,
        ),
      ],
    );
  }

  /**
   * 声明式装配（D2）：把一条 spawn 描述展开为**组件清单**，再逐个挂到实体上。
   * 交互组件由各 create 方法按配置包的 interact 信息声明后经 `extras` 传入，本方法与其他 create 方法无需改动。
   */
  private static assemble(opts: EntityOptions, extras: Component[] = []): Entity {
    const entity = new Entity(opts);
    const components: Component[] = [
      new TransformComponent(entity.sprite, opts.x, opts.y),
      new VisualComponent(entity.sprite, opts.kind, opts.displayName, opts.color, opts.texture),
      ...extras,
    ];
    for (const c of components) entity.attach(c);
    console.log(
      `[S3] 实体装配 entityId=${entity.entityId} 组件=[${components.map((c) => c.constructor.name).join(',')}]`,
    );
    return entity;
  }
}