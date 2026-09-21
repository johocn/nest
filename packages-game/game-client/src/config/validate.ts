import type { SceneConfig } from './schema';

export class ConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ConfigError';
  }
}

/** 枚举取值与 packages-game/config-schema/scene-config.schema.json 保持一致 */
const SCENE_TYPES = ['town', 'dungeon', 'arena', 'wild'];
const INTERACT_TYPES = ['collect', 'read'];
const TRIGGER_TYPES = ['transport', 'story', 'battle', 'activity', 'puzzle', 'gate', 'trap'];

function isInt(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v);
}

function isPosInt(v: unknown): boolean {
  return isInt(v) && (v as number) >= 1;
}

function isStr(v: unknown): boolean {
  return typeof v === 'string';
}

function inEnum(v: unknown, allowed: string[]): boolean {
  return typeof v === 'string' && allowed.includes(v);
}

/** 手写轻量校验：字段与枚举逐字段对齐 scene-config.schema.json（只校验客户端渲染必需项） */
export function validateSceneConfig(raw: any, file: string): SceneConfig {
  if (!raw || typeof raw !== 'object') throw new ConfigError(`${file} 不是对象`);

  for (const key of ['schemaVersion', 'sceneId', 'version']) {
    if (!isPosInt(raw[key])) throw new ConfigError(`${file} 缺少数值字段 ${key}（应为 >=1 的整数）`);
  }
  if (!isStr(raw.hash) || !/^sha256:[0-9a-f]{64}$/.test(raw.hash)) {
    throw new ConfigError(`${file} 缺少包内 hash（应为 sha256:<64 位小写十六进制>）`);
  }

  const scene = raw.scene;
  if (!scene || typeof scene !== 'object') throw new ConfigError(`${file} 缺少 scene`);
  if (!isStr(scene.name) || !isStr(scene.mapResKey)) {
    throw new ConfigError(`${file} 缺少字符串字段 scene.name/scene.mapResKey`);
  }
  for (const key of ['mapWidth', 'mapHeight']) {
    if (!isInt(scene[key])) throw new ConfigError(`${file} scene.${key} 必须是整数`);
  }
  if (!isPosInt(scene.minLevel) || !isPosInt(scene.maxPlayers)) {
    throw new ConfigError(`${file} scene.minLevel/scene.maxPlayers 必须是 >=1 的整数`);
  }
  if (!inEnum(scene.sceneType, SCENE_TYPES)) {
    throw new ConfigError(`${file} scene.sceneType 非法：${scene.sceneType}`);
  }
  if (!scene.entry || !isInt(scene.entry.x) || !isInt(scene.entry.y)) {
    throw new ConfigError(`${file} 缺少整数出生点 scene.entry`);
  }

  // layers 允许为空对象 {}
  if (!raw.layers || typeof raw.layers !== 'object' || Array.isArray(raw.layers)) {
    throw new ConfigError(`${file} layers 必须是对象（可为空 {}）`);
  }
  if (!Array.isArray(raw.staticEntities)) throw new ConfigError(`${file} staticEntities 必须是数组`);
  if (!Array.isArray(raw.fixedNpcs)) throw new ConfigError(`${file} fixedNpcs 必须是数组`);
  if (!Array.isArray(raw.triggers)) throw new ConfigError(`${file} triggers 必须是数组`);

  for (const e of raw.staticEntities) {
    const id = e?.spawnId;
    if (e?.kind !== 'object') throw new ConfigError(`${file} staticEntities[${id}] kind 必须是 object`);
    if (!isPosInt(e?.spawnId) || !isPosInt(e?.templateId) || !isInt(e?.x) || !isInt(e?.y) || !isInt(e?.rotation)) {
      throw new ConfigError(`${file} staticEntities 项缺少整数 spawnId/templateId/x/y/rotation`);
    }
    if (!isStr(e?.resKey)) throw new ConfigError(`${file} staticEntities[${id}] 缺少字符串 resKey`);
    const it = e?.interact;
    if (!it || !inEnum(it.type, INTERACT_TYPES)) {
      throw new ConfigError(`${file} staticEntities[${id}] interact.type 非法：${it?.type}`);
    }
    if (!isInt(it.cd) || it.cd < 0) throw new ConfigError(`${file} staticEntities[${id}] interact.cd 必须是非负整数`);
    if (typeof it.oneTime !== 'boolean') throw new ConfigError(`${file} staticEntities[${id}] interact.oneTime 必须是布尔`);
  }

  for (const n of raw.fixedNpcs) {
    if (!isPosInt(n?.spawnId) || !isPosInt(n?.npcTemplateId) || !isInt(n?.x) || !isInt(n?.y)) {
      throw new ConfigError(`${file} fixedNpcs 项缺少整数 spawnId/npcTemplateId/x/y`);
    }
    if (!isStr(n?.resKey) || !isStr(n?.anim)) {
      throw new ConfigError(`${file} fixedNpcs[${n?.spawnId}] 缺少字符串 resKey/anim`);
    }
  }

  for (const t of raw.triggers) {
    if (!isPosInt(t?.id) || !inEnum(t?.type, TRIGGER_TYPES)) {
      throw new ConfigError(`${file} triggers 项缺少合法 id/type`);
    }
    const a = t?.area;
    if (!a || !isInt(a.x) || !isInt(a.y) || !isInt(a.w) || !isInt(a.h)) {
      throw new ConfigError(`${file} triggers[${t?.id}] area 缺少整数 x/y/w/h`);
    }
    if (t?.targetSceneId !== null && !isInt(t?.targetSceneId)) {
      throw new ConfigError(`${file} triggers[${t?.id}] targetSceneId 必须是整数或 null`);
    }
    if (typeof t?.onceOnly !== 'boolean') throw new ConfigError(`${file} triggers[${t?.id}] onceOnly 必须是布尔`);
  }

  return raw as SceneConfig;
}