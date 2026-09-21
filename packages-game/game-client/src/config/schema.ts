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

/** 巡逻路点（与后端 `npc_patrol_routes.points` 元素一一对应） */
export interface NpcPatrolPoint {
  x: number;
  y: number;
  /** 到达该点后的原地停留秒数；缺省即不停留 */
  pauseSec?: number;
}

/** 巡逻路径运行态（后端 `NpcInstance.route`，语义与后端推进器一致） */
export interface NpcPatrolRouteConfig {
  points: NpcPatrolPoint[];
  /** 像素/秒 */
  speed: number;
  loopMode: 'loop' | 'pingpong' | 'once';
  /** 当前所在路点索引 */
  cursor: number;
}

/**
 * 服务端 world.enter_scene_sync 下发的 NPC 实例（S4 新增字段 `npcs`，逐字段对齐后端 `NpcInstance`）。
 * `npcId` 为 `npc:<spawnId>`（fixed）或 `npcs:<ruleId>:<slot>`（random/patrol）；仅 patrol 带 `route`。
 */
export interface NpcInstanceConfig {
  npcId: string;
  npcTemplateId: string;
  resKey: string;
  name: string;
  scale: number;
  anim: string;
  x: number;
  y: number;
  route?: NpcPatrolRouteConfig;
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