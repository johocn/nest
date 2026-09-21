export interface SceneEntry {
  x: number;
  y: number;
}

export interface SceneMeta {
  name: string;
  mapResKey: string;
  mapWidth: number;
  mapHeight: number;
  minLevel: number;
  maxPlayers: number;
  sceneType: string;
  entry: SceneEntry;
}

export interface StaticEntityInteract {
  type: string;
  cd: number;
  oneTime: boolean;
}

export interface StaticEntity {
  kind: 'object';
  spawnId: number;
  templateId: number;
  resKey: string;
  x: number;
  y: number;
  rotation: number;
  interact: StaticEntityInteract;
}

export interface FixedNpc {
  spawnId: number;
  npcTemplateId: number;
  resKey: string;
  x: number;
  y: number;
  anim: string;
}

export interface ConfigTrigger {
  id: number;
  type: string;
  area: { x: number; y: number; w: number; h: number };
  targetSceneId: number | null;
  onceOnly: boolean;
}

export interface SceneConfig {
  schemaVersion: number;
  sceneId: number;
  version: number;
  hash: string;
  scene: SceneMeta;
  layers: Record<string, unknown>;
  staticEntities: StaticEntity[];
  fixedNpcs: FixedNpc[];
  triggers: ConfigTrigger[];
}

export interface ManifestScene {
  sceneId: number;
  version: number;
  hash: string;
  file: string;
}

export interface SceneManifest {
  generatedAt?: string;
  scenes: ManifestScene[];
}

/** 服务端 world.enter_scene_sync 下发的 spawn 记录（TypeORM 行，字段为驼峰） */
export interface ServerSpawn {
  id: string;
  sceneId: string;
  entityType: 'npc' | 'monster' | 'object';
  templateId: string;
  spawnX: number;
  spawnY: number;
  spawnRotation: number;
  spawnCount: number;
  spawnRadius: number;
  isActive: boolean;
}