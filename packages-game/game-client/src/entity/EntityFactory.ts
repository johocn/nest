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
    return new Entity(
      `player:${playerId}`,
      'player',
      null,
      null,
      null,
      `我(${playerId})`,
      x,
      y,
      COLORS.player,
      EntityFactory.texture,
    );
  }

  static createOtherPlayer(playerId: string, x: number, y: number): Entity {
    return new Entity(
      `player:${playerId}`,
      'player',
      null,
      null,
      null,
      `玩家${playerId}`,
      x,
      y,
      COLORS.player,
      EntityFactory.texture,
    );
  }

  static createFromStatic(e: StaticEntity): Entity {
    return new Entity(
      `object:${e.spawnId}`,
      'object',
      e.spawnId,
      e.templateId,
      e.interact.type,
      `物${e.spawnId}`,
      e.x,
      e.y,
      COLORS.object,
      EntityFactory.texture,
    );
  }

  static createFromFixedNpc(n: FixedNpc): Entity {
    return new Entity(
      `npc:${n.spawnId}`,
      'npc',
      n.spawnId,
      n.npcTemplateId,
      'talk',
      `NPC${n.spawnId}`,
      n.x,
      n.y,
      COLORS.npc,
      EntityFactory.texture,
    );
  }

  static createFromServerSpawn(sp: ServerSpawn): Entity {
    const id = Number(sp.id);
    const kind = sp.entityType === 'monster' ? 'npc' : sp.entityType;
    return new Entity(
      `${kind}:${id}`,
      kind,
      id,
      Number(sp.templateId),
      kind === 'npc' ? 'talk' : null,
      `${sp.entityType}${id}`,
      sp.spawnX,
      sp.spawnY,
      COLORS[sp.entityType] ?? COLORS.object,
      EntityFactory.texture,
    );
  }
}