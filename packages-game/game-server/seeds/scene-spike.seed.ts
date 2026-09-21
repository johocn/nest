import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { Scene } from '../src/modules/world/entities/scene.entity';
import { SceneTrigger } from '../src/modules/world/entities/scene-trigger.entity';
import { SceneEntitySpawn } from '../src/modules/world/entities/scene-entity-spawn.entity';
import { ObjectTemplate } from '../src/modules/world/entities/object-template.entity';
import { NpcTemplate } from '../src/modules/world/entities/npc-template.entity';
import {
  EntityType,
  ObjectType,
  SceneStatus,
  SceneType,
  TriggerType,
} from '../src/constants/enums';

const SCENE_NAME = '新手村（Spike）';
const CONFIG_DIR = join(__dirname, '..', '..', 'game-client', 'assets', 'config');

/** ObjectType -> InteractType（客户端交互组件与后端交互链路对齐） */
const INTERACT_BY_OBJECT_TYPE: Record<string, string> = {
  [ObjectType.COLLECT]: 'collect',
  [ObjectType.STONE]: 'collect',
  [ObjectType.PLANT]: 'collect',
  [ObjectType.CHEST]: 'collect',
  [ObjectType.LANDMARK]: 'read',
};

const OBJECT_TEMPLATES = [
  { name: 'spike-草药丛', resKey: 'obj/plant_01', type: ObjectType.PLANT, interactCd: 10, reward: { type: 'currency', currencyType: 'gold', amount: 3 } },
  { name: 'spike-铁矿脉', resKey: 'obj/stone_01', type: ObjectType.STONE, interactCd: 20, reward: { type: 'currency', currencyType: 'gold', amount: 8 } },
  { name: 'spike-旧木箱', resKey: 'obj/chest_01', type: ObjectType.CHEST, interactCd: 0, reward: { type: 'currency', currencyType: 'gold', amount: 20 }, isOneTime: true },
  { name: 'spike-路牌', resKey: 'obj/landmark_01', type: ObjectType.LANDMARK, interactCd: 0, reward: null },
];

const NPC_TEMPLATES = [
  { name: 'spike-村长', resKey: 'npc/elder_01', interactType: 'talk', greeting: '村长：远来的客人，先四处看看吧。' },
  { name: 'spike-铁匠', resKey: 'npc_smith_01', interactType: 'talk', greeting: '铁匠：要打铁，先得有矿。' },
  { name: 'spike-货郎', resKey: 'npc/peddler_01', interactType: 'talk', greeting: '货郎：今日的货物，价钱好商量。' },
];

/** [x, y]：静态物件 10 个，其中 2 个紧邻出生点，保证 F 键可达 */
const OBJECT_SPOTS: Array<[number, number]> = [
  [560, 480], [720, 400], [420, 600], [860, 620], [300, 380],
  [640, 300], [980, 420], [520, 760], [760, 820], [380, 200],
];

/** [x, y]：NPC 3 个，均在出生点 200px 内 */
const NPC_SPOTS: Array<[number, number]> = [
  [600, 380], [700, 520], [500, 560],
];

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as any)[k])}`).join(',')}}`;
}

function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'game_server',
    entities: [Scene, SceneTrigger, SceneEntitySpawn, ObjectTemplate, NpcTemplate],
    // 必须为 false：实体子集同步会 drop 掉其他表
    synchronize: false,
  });
  await dataSource.initialize();

  const sceneRepo = dataSource.getRepository(Scene);
  const triggerRepo = dataSource.getRepository(SceneTrigger);
  const spawnRepo = dataSource.getRepository(SceneEntitySpawn);
  const objRepo = dataSource.getRepository(ObjectTemplate);
  const npcRepo = dataSource.getRepository(NpcTemplate);

  let scene = await sceneRepo.findOne({ where: { name: SCENE_NAME } });
  if (scene) {
    console.log(`场景已存在（id=${scene.id}），跳过播种，仅重新生成配置包`);
  } else {
    scene = await sceneRepo.save(
      sceneRepo.create({
        name: SCENE_NAME,
        sceneType: SceneType.TOWN,
        mapResKey: 'map/town_spike_01',
        mapWidth: 1280,
        mapHeight: 960,
        layerConfig: {},
        minLevel: 1,
        maxPlayers: 50,
        status: SceneStatus.OPEN,
      }),
    );
    console.log(`创建场景 id=${scene.id}`);

    const objs = await objRepo.save(OBJECT_TEMPLATES.map((t) => objRepo.create(t)));
    const objsByType = new Map(objs.map((o) => [o.type as string, o]));
    const order = [ObjectType.PLANT, ObjectType.STONE, ObjectType.CHEST, ObjectType.LANDMARK];
    for (let i = 0; i < OBJECT_SPOTS.length; i++) {
      const tpl = objsByType.get(order[i % order.length])!;
      const [x, y] = OBJECT_SPOTS[i];
      await spawnRepo.save(
        spawnRepo.create({
          sceneId: scene.id,
          entityType: EntityType.OBJECT,
          templateId: tpl.id,
          spawnX: x,
          spawnY: y,
          spawnCount: 1,
          spawnRadius: 0,
          isActive: true,
        }),
      );
    }
    console.log(`创建物件模板 ${objs.length} 个、物件落位 ${OBJECT_SPOTS.length} 个`);

    const npcs = await npcRepo.save(
      NPC_TEMPLATES.map((t) =>
        npcRepo.create({
          name: t.name,
          resKey: t.resKey,
          interactType: t.interactType as any,
          scale: 1.0,
          defaultAnim: 'idle',
          dialogueId: null,
          moveRange: 0,
          isAutoWander: false,
          attr: { greeting: t.greeting },
        }),
      ),
    );
    for (let i = 0; i < NPC_SPOTS.length; i++) {
      const [x, y] = NPC_SPOTS[i];
      await spawnRepo.save(
        spawnRepo.create({
          sceneId: scene.id,
          entityType: EntityType.NPC,
          templateId: npcs[i].id,
          spawnX: x,
          spawnY: y,
          spawnCount: 1,
          spawnRadius: 0,
          isActive: true,
        }),
      );
    }
    console.log(`创建 NPC 模板 ${npcs.length} 个、NPC 落位 ${NPC_SPOTS.length} 个`);

    await triggerRepo.save([
      triggerRepo.create({
        sceneId: scene.id,
        triggerType: TriggerType.TRANSPORT,
        areaX: 0,
        areaY: 0,
        areaW: 120,
        areaH: 120,
        targetSceneId: scene.id,
        condition: null,
        onceOnly: false,
      }),
      triggerRepo.create({
        sceneId: scene.id,
        triggerType: TriggerType.STORY,
        areaX: 600,
        areaY: 200,
        areaW: 160,
        areaH: 120,
        targetSceneId: null,
        condition: { storyId: 1 },
        onceOnly: true,
      }),
    ]);
    console.log('创建触发器 2 个');
  }

  // ---- 生成配置包 ----
  const sceneId = scene.id;
  const spawns = await spawnRepo.find({ where: { sceneId, isActive: true } });
  const triggers = await triggerRepo.find({ where: { sceneId }, order: { id: 'ASC' } });

  const staticEntities: any[] = [];
  const fixedNpcs: any[] = [];
  for (const sp of spawns) {
    if (sp.entityType === EntityType.OBJECT) {
      const tpl = await objRepo.findOne({ where: { id: sp.templateId } });
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
      const tpl = await npcRepo.findOne({ where: { id: sp.templateId } });
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

  const payload = {
    schemaVersion: 1,
    sceneId: Number(sceneId),
    version: 1,
    scene: {
      name: scene.name,
      mapResKey: scene.mapResKey,
      mapWidth: scene.mapWidth,
      mapHeight: scene.mapHeight,
      minLevel: scene.minLevel,
      maxPlayers: scene.maxPlayers,
      sceneType: scene.sceneType,
      entry: { x: 640, y: 480 },
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

  const withHash = { ...payload, hash: sha256(canonicalJson(payload)) };
  const fileName = `scene-${Number(sceneId)}-v1.json`;
  const fileText = `${JSON.stringify(withHash, null, 2)}\n`;
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(join(CONFIG_DIR, fileName), fileText, 'utf8');

  const manifest = {
    generatedAt: new Date().toISOString(),
    scenes: [
      { sceneId: Number(sceneId), version: 1, hash: sha256(fileText), file: fileName },
    ],
  };
  writeFileSync(join(CONFIG_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`配置包已生成：${join(CONFIG_DIR, fileName)}`);
  console.log(`manifest 已生成：${join(CONFIG_DIR, 'manifest.json')}`);
  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});