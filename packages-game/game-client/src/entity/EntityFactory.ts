import { AppConfig } from '../config/AppConfig';
import { Entity } from './Entity';
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
    return new Entity({
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
    return new Entity({
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
    return new Entity({
      entityId: `object:${e.spawnId}`,
      kind: 'object',
      spawnId: e.spawnId,
      templateId: e.templateId,
      displayName: `物${e.spawnId}`,
      x: e.x,
      y: e.y,
      color: COLORS.object,
      texture: EntityFactory.texture,
    });
  }

  static createFromFixedNpc(n: FixedNpc): Entity {
    return new Entity({
      entityId: `npc:${n.spawnId}`,
      kind: 'npc',
      spawnId: n.spawnId,
      templateId: n.npcTemplateId,
      displayName: `NPC${n.spawnId}`,
      x: n.x,
      y: n.y,
      color: COLORS.npc,
      texture: EntityFactory.texture,
    });
  }

  static createFromServerSpawn(sp: ServerSpawn): Entity {
    const id = Number(sp.id);
    const kind = sp.entityType === 'monster' ? 'npc' : sp.entityType;
    return new Entity({
      entityId: `${kind}:${id}`,
      kind,
      spawnId: id,
      templateId: Number(sp.templateId),
      displayName: `${sp.entityType}${id}`,
      x: sp.spawnX,
      y: sp.spawnY,
      color: COLORS[sp.entityType] ?? COLORS.object,
      texture: EntityFactory.texture,
    });
  }
}