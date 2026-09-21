import type { SceneConfig } from './schema';

export class ConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ConfigError';
  }
}

function isInt(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v);
}

/** 手写轻量校验：只校验客户端渲染必需字段，不做完整 JSON Schema 实现（S2 换正式 schema） */
export function validateSceneConfig(raw: any, file: string): SceneConfig {
  if (!raw || typeof raw !== 'object') throw new ConfigError(`${file} 不是对象`);

  for (const key of ['schemaVersion', 'sceneId', 'version']) {
    if (typeof raw[key] !== 'number') throw new ConfigError(`${file} 缺少数值字段 ${key}`);
  }
  const scene = raw.scene;
  if (!scene || typeof scene !== 'object') throw new ConfigError(`${file} 缺少 scene`);
  for (const key of ['mapWidth', 'mapHeight']) {
    if (!isInt(scene[key])) throw new ConfigError(`${file} scene.${key} 必须是整数`);
  }
  if (!scene.entry || !isInt(scene.entry.x) || !isInt(scene.entry.y)) {
    throw new ConfigError(`${file} 缺少整数出生点 scene.entry`);
  }
  if (!Array.isArray(raw.staticEntities)) throw new ConfigError(`${file} staticEntities 必须是数组`);
  if (!Array.isArray(raw.fixedNpcs)) throw new ConfigError(`${file} fixedNpcs 必须是数组`);
  if (!Array.isArray(raw.triggers)) throw new ConfigError(`${file} triggers 必须是数组`);

  for (const e of raw.staticEntities) {
    if (!isInt(e?.spawnId) || !isInt(e?.templateId) || !isInt(e?.x) || !isInt(e?.y)) {
      throw new ConfigError(`${file} staticEntities 项缺少整数 spawnId/templateId/x/y`);
    }
    if (!e.interact || typeof e.interact.type !== 'string') {
      throw new ConfigError(`${file} staticEntities[${e.spawnId}] 缺少 interact.type`);
    }
  }
  for (const n of raw.fixedNpcs) {
    if (!isInt(n?.spawnId) || !isInt(n?.npcTemplateId) || !isInt(n?.x) || !isInt(n?.y)) {
      throw new ConfigError(`${file} fixedNpcs 项缺少整数 spawnId/npcTemplateId/x/y`);
    }
  }
  for (const t of raw.triggers) {
    if (!isInt(t?.id) || !t?.area) throw new ConfigError(`${file} triggers 项缺少 id/area`);
  }

  return raw as SceneConfig;
}