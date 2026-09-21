import { createHash } from 'node:crypto';
import { EntityType, ObjectType } from '@constants/enums';
import {
  NpcTemplate,
  ObjectTemplate,
  Scene,
  SceneEntitySpawn,
  SceneTrigger,
} from '../entities';

/** ObjectType -> 客户端交互类型（与客户端交互组件对齐） */
export const INTERACT_BY_OBJECT_TYPE: Record<string, string> = {
  [ObjectType.COLLECT]: 'collect',
  [ObjectType.STONE]: 'collect',
  [ObjectType.PLANT]: 'collect',
  [ObjectType.CHEST]: 'collect',
  [ObjectType.LANDMARK]: 'read',
};

/**
 * 键排序后的规范化 JSON。
 * 客户端已冻结该算法（loader.ts），改动一个字符配置包校验就会全红，不得修改。
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as any)[k])}`).join(',')}}`;
}

/**
 * 文本 sha256（带 `sha256:` 前缀）。
 * 与 canonicalJson 同源冻结，不得修改。
 */
export function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

export interface BuildScenePayloadInput {
  /** 场景行 */
  scene: Scene;
  /** 配置包版本号（由调用方按同场景 max(version)+1 计算） */
  version: number;
  /** 该场景启用中的实体落位 */
  spawns: SceneEntitySpawn[];
  /** 物件模板全量（按 templateId 关联） */
  objectTemplates: ObjectTemplate[];
  /** NPC 模板全量（按 templateId 关联） */
  npcTemplates: NpcTemplate[];
  /** 该场景的触发器 */
  triggers: SceneTrigger[];
}

export interface ScenePackageResult {
  /** 配置包内容（不含 hash 字段） */
  payload: Record<string, any>;
  /** 包内 hash：sha256(canonicalJson(payload)) */
  payloadHash: string;
}

/**
 * 由 5 张配置表的行聚合出场景配置包（纯函数，不依赖 Nest DI）。
 * 产物结构与 S1 已验证的配置包逐字段一致；bigint 主键/外键在 TS 里是 string，导出时必须 Number()。
 */
export function buildScenePayload(
  input: BuildScenePayloadInput,
): ScenePackageResult {
  const { scene, version, spawns, objectTemplates, npcTemplates, triggers } =
    input;

  const objectById = new Map(objectTemplates.map((t) => [t.id, t]));
  const npcById = new Map(npcTemplates.map((t) => [t.id, t]));

  const staticEntities: any[] = [];
  const fixedNpcs: any[] = [];
  for (const sp of spawns) {
    if (sp.entityType === EntityType.OBJECT) {
      const tpl = objectById.get(sp.templateId);
      if (!tpl) continue;
      staticEntities.push({
        kind: 'object',
        spawnId: Number(sp.id),
        templateId: Number(tpl.id),
        resKey: tpl.resKey,
        x: sp.spawnX,
        y: sp.spawnY,
        rotation: sp.spawnRotation,
        interact: {
          type: INTERACT_BY_OBJECT_TYPE[tpl.type] ?? 'collect',
          cd: tpl.interactCd,
          oneTime: tpl.isOneTime,
        },
      });
    } else if (sp.entityType === EntityType.NPC) {
      const tpl = npcById.get(sp.templateId);
      if (!tpl) continue;
      fixedNpcs.push({
        spawnId: Number(sp.id),
        npcTemplateId: Number(tpl.id),
        resKey: tpl.resKey,
        x: sp.spawnX,
        y: sp.spawnY,
        anim: tpl.defaultAnim ?? 'idle',
      });
    }
  }

  // 入场点：优先场景 layerConfig.entry，缺省取地图中心
  const entry = scene.layerConfig?.entry ?? {
    x: Math.round(scene.mapWidth / 2),
    y: Math.round(scene.mapHeight / 2),
  };

  const payload = {
    schemaVersion: 1,
    sceneId: Number(scene.id),
    version,
    scene: {
      name: scene.name,
      mapResKey: scene.mapResKey,
      mapWidth: scene.mapWidth,
      mapHeight: scene.mapHeight,
      minLevel: scene.minLevel,
      maxPlayers: scene.maxPlayers,
      sceneType: scene.sceneType,
      entry,
    },
    layers: scene.layerConfig ?? {},
    staticEntities,
    fixedNpcs,
    triggers: triggers.map((t) => ({
      id: Number(t.id),
      type: t.triggerType,
      area: { x: t.areaX, y: t.areaY, w: t.areaW, h: t.areaH },
      targetSceneId: t.targetSceneId ? Number(t.targetSceneId) : null,
      onceOnly: t.onceOnly,
    })),
  };

  return { payload, payloadHash: sha256(canonicalJson(payload)) };
}