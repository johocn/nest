import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Scene } from '../src/modules/world/entities/scene.entity';
import { SceneBuildRule } from '../src/modules/world/entities/scene-build-rule.entity';
import { BuildingTemplate } from '../src/modules/world/entities/building-template.entity';
import {
  BuildMode,
  SceneStatus,
  SceneType,
} from '../src/constants/enums';

/**
 * S6 建造系统种子（幂等，可重复执行）：
 *   1) 1 个 solo 场景规则 → 挂在本库**首个场景**（order id ASC；本地为「新手村（Spike）」）；
 *   2) 1 个 coop 场景 + 其 coop 规则 → 按名字判重，不存在则新建专用共建场景；
 *   3) 3 个建筑蓝图（木屋 / 石墙 / 议事厅，按名字判重）。
 *
 * 运行（**不新增 npm 脚本**，直接 ts-node）：
 *   npx ts-node -r tsconfig-paths/register seeds/building.seed.ts
 * 环境变量：DB_HOST / DB_PORT / DB_USERNAME / DB_PASSWORD / DB_DATABASE（默认 localhost:5432 postgres/postgres game_server）
 */
const COOP_SCENE_NAME = '共建广场';
const COOP_SCENE_RES_KEY = 'map/coop_plaza';

/** 蓝图定义（按 name 判重）；议事厅 build_cost 为空数组（零门槛，便于线上验收建一栋） */
const TEMPLATES: Array<Partial<BuildingTemplate> & { name: string }> = [
  {
    name: '木屋',
    resKey: 'building/wooden_house',
    category: 'house',
    footprintW: 2,
    footprintH: 2,
    buildCost: [{ currencyType: 'gold', amount: 50 }],
    buildSeconds: 15,
    durability: 300,
    effect: {},
    isActive: true,
  },
  {
    name: '石墙',
    resKey: 'building/stone_wall',
    category: 'defense',
    footprintW: 1,
    footprintH: 1,
    buildCost: [{ currencyType: 'gold', amount: 20 }],
    buildSeconds: 10,
    durability: 500,
    effect: {},
    isActive: true,
  },
  {
    name: '议事厅',
    resKey: 'building/town_hall',
    category: 'public',
    footprintW: 3,
    footprintH: 3,
    buildCost: [],
    buildSeconds: 5,
    durability: 800,
    effect: {},
    isActive: true,
  },
];

async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'game_server',
    entities: [Scene, SceneBuildRule, BuildingTemplate],
    // 必须为 false：实体子集同步会 drop 掉其他表
    synchronize: false,
  });
  await dataSource.initialize();

  const sceneRepo = dataSource.getRepository(Scene);
  const ruleRepo = dataSource.getRepository(SceneBuildRule);
  const tplRepo = dataSource.getRepository(BuildingTemplate);

  // ---------- 1. solo 场景规则（挂在本库首个场景）----------
  const firstScene = await sceneRepo.findOne({
    where: {},
    order: { id: 'ASC' },
  });
  if (!firstScene) {
    throw new Error('scenes 表为空：请先执行 seed:scene-spike 建场景');
  }
  const soloRule = await ruleRepo.findOne({ where: { sceneId: firstScene.id } });
  if (soloRule) {
    soloRule.mode = BuildMode.SOLO;
    soloRule.landGridSize = 64;
    soloRule.maxBuildingsPerPlayer = 5;
    soloRule.allowDemolish = true;
    soloRule.reservedZones = [];
    await ruleRepo.save(soloRule);
    console.log(`solo 规则已存在（scene=${firstScene.id}），已更新为 solo/64/5/demolish=true`);
  } else {
    await ruleRepo.save(
      ruleRepo.create({
        sceneId: firstScene.id,
        mode: BuildMode.SOLO,
        landGridSize: 64,
        maxBuildingsPerPlayer: 5,
        allowDemolish: true,
        coopMinContributors: 2,
        coopExpireHours: 24,
        reservedZones: [],
      }),
    );
    console.log(`创建 solo 规则：scene=${firstScene.id}（${firstScene.name}）`);
  }

  // ---------- 2. coop 专用场景 + 其规则 ----------
  let coopScene = await sceneRepo.findOne({ where: { name: COOP_SCENE_NAME } });
  if (coopScene) {
    console.log(`共建场景已存在（id=${coopScene.id} name=${coopScene.name}），跳过`);
  } else {
    coopScene = await sceneRepo.save(
      sceneRepo.create({
        name: COOP_SCENE_NAME,
        sceneType: SceneType.TOWN,
        mapResKey: COOP_SCENE_RES_KEY,
        mapWidth: 1280,
        mapHeight: 960,
        layerConfig: {},
        triggerGroupIds: [],
        minLevel: 1,
        maxPlayers: 100,
        status: SceneStatus.OPEN,
      }),
    );
    console.log(`创建共建场景 id=${coopScene.id} name=${coopScene.name}`);
  }

  const coopRule = await ruleRepo.findOne({ where: { sceneId: coopScene.id } });
  if (coopRule) {
    coopRule.mode = BuildMode.COOP;
    coopRule.landGridSize = 64;
    coopRule.maxBuildingsPerPlayer = 5;
    coopRule.allowDemolish = true;
    coopRule.coopMinContributors = 2;
    coopRule.coopExpireHours = 24;
    coopRule.reservedZones = [];
    await ruleRepo.save(coopRule);
    console.log(`coop 规则已存在（scene=${coopScene.id}），已更新为 coop/min=2/expire=24h`);
  } else {
    await ruleRepo.save(
      ruleRepo.create({
        sceneId: coopScene.id,
        mode: BuildMode.COOP,
        landGridSize: 64,
        maxBuildingsPerPlayer: 5,
        allowDemolish: true,
        coopMinContributors: 2,
        coopExpireHours: 24,
        reservedZones: [],
      }),
    );
    console.log(`创建 coop 规则：scene=${coopScene.id}（${coopScene.name}）`);
  }

  // ---------- 3. 建筑蓝图（按 name 判重）----------
  const tplIds: string[] = [];
  for (const spec of TEMPLATES) {
    const existing = await tplRepo.findOne({ where: { name: spec.name } });
    if (existing) {
      Object.assign(existing, spec);
      const saved = await tplRepo.save(existing);
      tplIds.push(String(saved.id));
      console.log(`蓝图已存在（id=${saved.id} name=${saved.name}），已更新`);
    } else {
      const saved = await tplRepo.save(tplRepo.create(spec));
      tplIds.push(String(saved.id));
      console.log(
        `创建蓝图 id=${saved.id} name=${saved.name} 成本=${JSON.stringify(saved.buildCost)} 耗时=${saved.buildSeconds}s`,
      );
    }
  }

  console.log(
    `S6 建造种子完成（幂等）：solo 场景=${firstScene.id}、coop 场景=${coopScene.id}、蓝图 id=[${tplIds.join(', ')}]`,
  );
  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});