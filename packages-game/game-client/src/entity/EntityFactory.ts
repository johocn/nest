import { AppConfig } from '../config/AppConfig';
import { Component } from './components/Component';
import { createInteractComponent } from './components/interact/registry';
import { TransformComponent } from './components/TransformComponent';
import { VisualComponent } from './components/VisualComponent';
import { Entity, type EntityOptions } from './Entity';
import type { FixedNpc, ServerSpawn, StaticEntity } from '../config/schema';

const PLACEHOLDER_URL = `${AppConfig.assetBase}resources/placeholder.png`;

const COLORS: Record<string, string> = {
  player: '#2f81f7',
  npc: '#f5a524',
  object: '#7ee787',
  monster: '#ff7b72',
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

  static createOtherPlayer(playerId: string, x: number, y: number): Entity {
    return EntityFactory.assemble({
      entityId: `player:${playerId}`,
      kind: 'player',
      spawnId: null,
      templateId: null,
      displayName: `玩家${playerId}`,
      x,
      y,
      color: COLORS.player,
      texture: EntityFactory.texture,
    });
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