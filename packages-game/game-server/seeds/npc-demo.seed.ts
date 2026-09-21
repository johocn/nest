import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Scene } from '../src/modules/world/entities/scene.entity';
import { SceneEntitySpawn } from '../src/modules/world/entities/scene-entity-spawn.entity';
import { NpcTemplate } from '../src/modules/world/entities/npc-template.entity';
import { NpcSpawnRule } from '../src/modules/world/entities/npc-spawn-rule.entity';
import { NpcPatrolRoute } from '../src/modules/world/entities/npc-patrol-route.entity';
import { EntityType, NpcPatrolLoopMode, NpcSpawnRuleType } from '../src/constants/enums';

const RANDOM_RULE_NAME = 'demo-随机出现（2 只）';
const PATROL_RULE_NAME = 'demo-路径巡逻（4 点环形）';
const PATROL_ROUTE_NAME = 'demo-环形巡逻路线';

async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'game_server',
    entities: [
      Scene,
      SceneEntitySpawn,
      NpcTemplate,
      NpcSpawnRule,
      NpcPatrolRoute,
    ],
    // 必须为 false：实体子集同步会 drop 掉其他表
    synchronize: false,
  });
  await dataSource.initialize();

  const sceneRepo = dataSource.getRepository(Scene);
  const spawnRepo = dataSource.getRepository(SceneEntitySpawn);
  const ruleRepo = dataSource.getRepository(NpcSpawnRule);
  const routeRepo = dataSource.getRepository(NpcPatrolRoute);

  // 目标场景：优先 scene_id=1，不存在则取第一个场景
  let scene = await sceneRepo.findOne({ where: { id: '1' } });
  if (!scene) {
    const first = await sceneRepo.find({ order: { id: 'ASC' }, take: 1 });
    scene = first[0] ?? null;
  }
  if (!scene) {
    throw new Error('库中没有任何场景，请先执行 npm run seed:scene-spike');
  }
  console.log(`目标场景 id=${scene.id} name=${scene.name}`);

  // NPC 模板取自该场景已有的 npc 落位，不凭空造模板
  const npcSpawn = await spawnRepo.findOne({
    where: { sceneId: scene.id, entityType: EntityType.NPC },
    order: { id: 'ASC' },
  });
  if (!npcSpawn) {
    throw new Error(`场景 ${scene.id} 内没有 entity_type='npc' 的落位，无法播种`);
  }
  const npcTemplateId = npcSpawn.templateId;
  const cx = npcSpawn.spawnX;
  const cy = npcSpawn.spawnY;
  console.log(`使用 NPC 模板 id=${npcTemplateId}，基准坐标 (${cx}, ${cy})`);

  // 巡逻路径（幂等：按 sceneId + name 判重）
  let route = await routeRepo.findOne({
    where: { sceneId: scene.id, name: PATROL_ROUTE_NAME },
  });
  if (route) {
    console.log(`巡逻路径已存在（id=${route.id}），跳过`);
  } else {
    const points = [
      { x: cx + 100, y: cy, pauseSec: 0 },
      { x: cx, y: cy + 100, pauseSec: 1 },
      { x: cx - 100, y: cy, pauseSec: 0 },
      { x: cx, y: cy - 100, pauseSec: 1 },
    ];
    route = await routeRepo.save(
      routeRepo.create({
        sceneId: scene.id,
        npcTemplateId,
        name: PATROL_ROUTE_NAME,
        loopMode: NpcPatrolLoopMode.LOOP,
        speed: 60,
        points,
        isActive: true,
      }),
    );
    console.log(`创建巡逻路径 id=${route.id}，路点 ${points.length} 个`);
  }

  // 随机规则（幂等：按 sceneId + name 判重）
  const randomRule = await ruleRepo.findOne({
    where: { sceneId: scene.id, name: RANDOM_RULE_NAME },
  });
  if (randomRule) {
    console.log(`随机规则已存在（id=${randomRule.id}），跳过`);
  } else {
    const saved = await ruleRepo.save(
      ruleRepo.create({
        sceneId: scene.id,
        npcTemplateId,
        ruleType: NpcSpawnRuleType.RANDOM,
        spawnX: cx,
        spawnY: cy,
        spawnRadius: 120,
        spawnCount: 2,
        condition: null,
        patrolRouteId: null,
        name: RANDOM_RULE_NAME,
        isActive: true,
      }),
    );
    console.log(`创建随机规则 id=${saved.id}（count=2, radius=120）`);
  }

  // 巡逻规则（幂等：按 sceneId + name 判重）
  const patrolRule = await ruleRepo.findOne({
    where: { sceneId: scene.id, name: PATROL_RULE_NAME },
  });
  if (patrolRule) {
    console.log(`巡逻规则已存在（id=${patrolRule.id}），跳过`);
  } else {
    const saved = await ruleRepo.save(
      ruleRepo.create({
        sceneId: scene.id,
        npcTemplateId,
        ruleType: NpcSpawnRuleType.PATROL,
        spawnX: cx,
        spawnY: cy,
        spawnRadius: 0,
        spawnCount: 1,
        condition: null,
        patrolRouteId: route.id,
        name: PATROL_RULE_NAME,
        isActive: true,
      }),
    );
    console.log(`创建巡逻规则 id=${saved.id}（route=${route.id}, speed=60）`);
  }

  console.log('NPC 演示数据播种完成（幂等，可重复执行）');
  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
