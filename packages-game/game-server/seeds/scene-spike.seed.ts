import 'reflect-metadata';
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
    console.log(`场景已存在（id=${scene.id}），跳过播种`);
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

  console.log(
    '播种完成。配置包请用 `npm run config:export -- --scene <id>` 导出',
  );
  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});