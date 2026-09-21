import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Dialogue } from '../src/modules/world/entities/dialogue.entity';
import { NpcTemplate } from '../src/modules/world/entities/npc-template.entity';
import { SceneEntitySpawn } from '../src/modules/world/entities/scene-entity-spawn.entity';
import { QuestTemplate } from '../src/modules/quest/entities/quest-template.entity';
import { ItemTemplate } from '../src/modules/inventory/entities/item-template.entity';
import {
  BindType,
  DialogueActionType,
  ItemRarity,
  ItemType,
  QuestType,
} from '../src/constants/enums';
import {
  DialogueNode,
  assertDialogueNodes,
} from '../src/modules/world/dialogue/dialogue.types';

/** 固定标识：全部用于幂等判重，不要随意改动 */
const ITEM_NAME = 'demo-铁矿石';
const QUEST_NAME = 'demo-铁匠的委托';
const DIALOGUE_CODE = 'npc_blacksmith_main';
const DIALOGUE_TITLE = '铁匠主线（demo）';
/** 绑定目标：scene_entity_spawns.id=12（spike-铁匠）对应的 npc_templates */
const NPC_SPAWN_ID = '12';

async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'game_server',
    entities: [
      Dialogue,
      NpcTemplate,
      SceneEntitySpawn,
      QuestTemplate,
      ItemTemplate,
    ],
    // 必须为 false：实体子集同步会 drop 掉其他表
    synchronize: false,
  });
  await dataSource.initialize();

  const itemRepo = dataSource.getRepository(ItemTemplate);
  const questRepo = dataSource.getRepository(QuestTemplate);
  const dialogueRepo = dataSource.getRepository(Dialogue);
  const spawnRepo = dataSource.getRepository(SceneEntitySpawn);
  const npcRepo = dataSource.getRepository(NpcTemplate);

  // ---------- 1. 道具模板（矿石） ----------
  let item = await itemRepo.findOne({ where: { name: ITEM_NAME } });
  if (item) {
    console.log(`道具模板已存在（id=${item.id} name=${item.name}），跳过`);
  } else {
    item = await itemRepo.save(
      itemRepo.create({
        name: ITEM_NAME,
        itemType: ItemType.MATERIAL,
        rarity: ItemRarity.COMMON,
        maxStack: 99,
        sellPrice: '5',
        canTrade: true,
        canDrop: true,
        bindType: BindType.NONE,
        description: 'demo 用铁矿石，铁匠对话给道具分支使用',
        configJson: {},
      }),
    );
    console.log(`创建道具模板 id=${item.id} name=${item.name}`);
  }
  const itemTemplateId = String(item.id);

  // ---------- 2. 任务模板 ----------
  let quest = await questRepo.findOne({ where: { name: QUEST_NAME } });
  if (quest) {
    console.log(`任务模板已存在（id=${quest.id} name=${quest.name}），跳过`);
  } else {
    quest = await questRepo.save(
      questRepo.create({
        name: QUEST_NAME,
        questType: QuestType.MAIN,
        minLevel: 1,
        acceptLimit: 1,
        autoReward: false,
        targetJson: {},
        rewardJson: {},
        prerequisiteIds: [],
        targetType: null,
        prerequisiteSocial: null,
        rewardSocial: null,
        repeatable: false,
      }),
    );
    console.log(`创建任务模板 id=${quest.id} name=${quest.name}`);
  }
  const questTemplateId = String(quest.id);

  // ---------- 3. 对话树（按 code upsert） ----------
  const nodes: DialogueNode[] = [
    {
      key: 'root',
      speaker: '铁匠',
      text: '哟，客人来得正好。要打点什么家伙什？',
      options: [
        {
          text: '我想找点事做',
          action: DialogueActionType.ACCEPT_QUEST,
          actionArgs: { questTemplateId },
          next: 'accepted',
        },
        {
          text: '给我点矿石',
          action: DialogueActionType.GIVE_ITEM,
          actionArgs: { itemTemplateId, quantity: 1 },
          next: 'got_item',
        },
        {
          text: '提交任务',
          // D4 验证点：未接任务时客户端看不到该选项
          condition: { questId: questTemplateId },
          action: DialogueActionType.SUBMIT_QUEST,
          actionArgs: { questTemplateId },
          next: 'submitted',
        },
        {
          text: '闲聊',
          next: 'chat',
        },
      ],
    },
    {
      key: 'accepted',
      speaker: '铁匠',
      text: '任务已接下，去外面转转吧。',
      options: [{ text: '知道了' }],
    },
    {
      key: 'got_item',
      speaker: '铁匠',
      text: '矿石给你，拿去用吧。',
      options: [{ text: '谢谢' }],
    },
    {
      key: 'submitted',
      speaker: '铁匠',
      text: '收到，辛苦了。',
      options: [{ text: '再见' }],
    },
    {
      key: 'chat',
      speaker: '铁匠',
      text: '今天天气不错，适合打铁。',
      options: [{ text: '再见' }],
    },
  ];

  // 种子数据必须满足 S5 结构约束（风险 #3：每节点至少一个无条件选项）
  const asserted = assertDialogueNodes(nodes);
  if (!asserted.ok) {
    throw new Error(`对话节点结构非法：${asserted.errors.join('；')}`);
  }

  let dialogue = await dialogueRepo.findOne({
    where: { code: DIALOGUE_CODE },
  });
  if (dialogue) {
    dialogue.title = DIALOGUE_TITLE;
    dialogue.nodes = nodes as unknown as Record<string, any>[];
    dialogue = await dialogueRepo.save(dialogue);
    console.log(
      `对话已存在（id=${dialogue.id} code=${dialogue.code}），已更新 nodes/title`,
    );
  } else {
    dialogue = await dialogueRepo.save(
      dialogueRepo.create({
        code: DIALOGUE_CODE,
        title: DIALOGUE_TITLE,
        nodes: nodes as unknown as Record<string, any>[],
        version: 1,
        isActive: true,
      }),
    );
    console.log(
      `创建对话 id=${dialogue.id} code=${dialogue.code} 节点数=${nodes.length}`,
    );
  }
  const dialogueId = String(dialogue.id);

  // ---------- 4. 绑定 NPC（只改 spawnId=12 对应的模板这一行） ----------
  const spawn = await spawnRepo.findOne({ where: { id: NPC_SPAWN_ID } });
  if (!spawn) {
    throw new Error(`scene_entity_spawns 中不存在 id=${NPC_SPAWN_ID} 的落位`);
  }
  const npc = await npcRepo.findOne({ where: { id: spawn.templateId } });
  if (!npc) {
    throw new Error(`npc_templates 中不存在 id=${spawn.templateId}`);
  }
  npc.dialogueId = Number(dialogueId);
  await npcRepo.save(npc);
  console.log(
    `绑定 NPC：spawnId=${spawn.id} -> npc_templates.id=${npc.id}（${npc.name}）dialogue_id=${npc.dialogueId}`,
  );

  console.log(
    `对话演示数据播种完成（幂等，可重复执行）：itemTemplateId=${itemTemplateId} questTemplateId=${questTemplateId} dialogueId=${dialogueId}`,
  );
  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});