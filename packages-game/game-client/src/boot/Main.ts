import { Boot } from './Boot';
import { LoginView } from './LoginView';
import { AppConfig } from '../config/AppConfig';
import { ConfigLoader } from '../config/loader';
import type { NpcInstanceConfig, SceneConfig, ServerSpawn } from '../config/schema';
import { AiComponent } from '../entity/components/AiComponent';
import { BuildingViewComponent } from '../entity/components/BuildComponent';
import { Entity } from '../entity/Entity';
import { EntityFactory } from '../entity/EntityFactory';
import { acquire } from '../entity/EntityPool';
import { EntityRegistry } from '../entity/EntityRegistry';
import { Api } from '../net/api';
import type { BuildRuleView, BuildingTemplate, BuildingView } from '../net/api';
import { Session } from '../net/Session';
import { WsClient } from '../net/ws';
import { Platform } from '../platform/Platform';
import { PerfPanel } from '../perf/PerfPanel';
import { Quality } from '../perf/Quality';
import { PlayerControl } from '../world/PlayerControl';
import { InteractController } from '../world/InteractController';
import { SceneBuilder } from '../world/SceneBuilder';
import { BuildPanel } from '../world/BuildPanel';
import { toBuildingSpawn, upsertBuildingEntity, viewToSpawn } from '../world/build-logic';
import { remotePlayerAdapter } from '../world/entity-pool-adapter';
import { Toast } from '../ui/Toast';
import { Hud } from '../ui/Hud';
import { DialogueView } from '../ui/DialogueView';

const state = {
  cfg: null as SceneConfig | null,
  ws: null as WsClient | null,
  me: null as Entity | null,
  buildRule: null as BuildRuleView | null,
};

interface EnterSceneSync {
  scene: { id: string; name: string; mapWidth: number; mapHeight: number };
  spawns: ServerSpawn[];
  triggers: Array<{ id: string; triggerType: string }>;
  /** S4 新增：NPC 实例（含巡逻路点）；旧客户端可缺失，按空数组处理（风险 #4） */
  npcs?: NpcInstanceConfig[];
}

async function afterLogin(): Promise<void> {
  if (Platform.isMiniGame()) {
    // S1 微信端只验收「配置包 + 静态层 + HTTP 登录」，WS 适配见 S7（Task 13）
    const cfg = await ConfigLoader.loadScene();
    await EntityFactory.loadPlaceholder();
    Laya.stage.addChild(SceneBuilder.build(cfg));
    Toast.info('微信端 S1：静态场景已渲染（WS 待 S7）');
    return;
  }

  // ① 配置包 → 静态层
  const cfg = await ConfigLoader.loadScene();
  await EntityFactory.loadPlaceholder();
  Laya.stage.addChild(SceneBuilder.build(cfg));
  state.cfg = cfg;

  // ② WS 连接
  const ws = new WsClient();
  await ws.connect(Session.token!);
  state.ws = ws;

  // ③ 进场景（应答 cmd 为 world.enter_scene_sync）
  const sync = await ws.send<EnterSceneSync>('world.enter-scene', { sceneId: cfg.sceneId });
  if (sync.code !== 0) throw new Error(`进场景失败：${sync.msg}`);
  console.log(
    `[S1] 进场景应答 cmd=${sync.cmd} scene=${sync.data.scene?.name} 服务端 spawns=${sync.data.spawns.length} triggers=${sync.data.triggers.length}`,
  );

  // ④ 合并实体表（配置包优先，去重后再生成动态实体）
  const accepted = SceneBuilder.mergeServerSpawns(cfg, sync.data.spawns);
  for (const sp of accepted) {
    SceneBuilder.addEntity(EntityFactory.createFromServerSpawn(sp));
  }

  // ④b S4：NPC 实例（含巡逻路点）。fixed 实例会与上一步的 spawn 实体同 id（npc:<spawnId>），
  // 已在注册表中的不重复建；random/patrol 的 npcs:<ruleId>:<slot> 是新实体。
  const npcInstances = sync.data.npcs ?? [];
  let npcCreated = 0;
  for (const npc of npcInstances) {
    if (EntityRegistry.get(npc.npcId)) continue;
    SceneBuilder.addEntity(EntityFactory.createFromNpcInstance(npc));
    npcCreated++;
  }
  console.log(`[S4] NPC 实例下发 ${npcInstances.length} 个（新建 ${npcCreated}）`);

  // ⑤ 自己（addEntity 内部已登记到 EntityRegistry，无需重复 add）
  const me = EntityFactory.createPlayer(Session.playerId!, cfg.scene.entry.x, cfg.scene.entry.y);
  SceneBuilder.addEntity(me);
  state.me = me;
  console.log(`[S1] 本地玩家 ${me.entityId} 出生于 (${me.x},${me.y})`);

  // ⑥ 世界广播（按 entityType 严格分流，player 分支行为零变更）
  ws.onBroadcast((m) => {
    if (m.cmd !== 'world.entity_update') return;
    const d = m.data;
    if (!d) return;

    if (d.entityType === 'player') {
      if (String(d.playerId) === String(Session.playerId)) return;

      const pos = d.pos ?? { x: 0, y: 0 };
      // S8 Task 2：仅「不存在 → 创建」这条路径改走对象池（upsert 的已存在语义零变更）；
      // 实体由池负责 reset，addEntity 负责登记注册表与挂进实体层
      const entity = EntityRegistry.upsert(d.entityId, pos, () =>
        acquire('player', { playerId: String(d.playerId), x: pos.x, y: pos.y }, remotePlayerAdapter),
      );
      SceneBuilder.addEntity(entity);
      return;
    }

    // S4：NPC 位置校正（复用 world.move 的同一 cmd）。本地只做限速逼近，不瞬移（D5）
    if (d.entityType === 'npc') {
      const pos = d.pos ?? { x: 0, y: 0 };
      const existing = EntityRegistry.get(d.entityId);
      if (existing) {
        // 无 route 的 NPC（fixed/random）不会收到校正；收到也仅忽略，不重复建实体
        existing.getComponent(AiComponent)?.applyCorrection(pos.x, pos.y);
        return;
      }
      // 漏包兜底：按下发数据补建
      console.warn(`[S4] 收到未登记的 NPC 校正 ${d.entityId}，按包内数据补建`);
      SceneBuilder.addEntity(
        EntityFactory.createFromNpcUpdate(String(d.entityId), String(d.npcTemplateId ?? ''), pos.x, pos.y),
      );
      return;
    }

    // S6：建筑状态广播（建造/落成/拆除）→ 复用 EntityRegistry.upsert 语义，不新增推送机制
    if (d.entityType === 'building') {
      const res = upsertBuildingEntity(d, (u) =>
        EntityFactory.createFromBuilding(
          toBuildingSpawn(u, BuildPanel.templateOf(u.templateId)),
          state.buildRule,
        ),
      );
      if (!res) return;
      SceneBuilder.addEntity(res.entity);
      // 广播帧不带 finishAt（落成/拆除只需状态）；applyState 缺省保留既有 finishAt，进度条继续可用
      res.entity.getComponent(BuildingViewComponent)?.applyState(res.update.state);
      if (res.update.state === 'demolishing') BuildPanel.removeBuilding(res.update.buildingId);
    }
  });

  // ⑦ 本地移动 → 10Hz 上报
  new PlayerControl(me, ws, { width: cfg.scene.mapWidth, height: cfg.scene.mapHeight }).attach();

  // ⑧ 就近交互（F 键）
  new InteractController(me).attach();

  // ⑧b S6 建造（规则/蓝图/建筑列表走服务端权威接口；面板为引擎内自绘）
  await attachBuild(me, cfg);

  // ⑨ 组件逐帧驱动（AiComponent 的路点插值按 Laya.timer.delta 推进）
  Laya.timer.frameLoop(1, null, () => EntityRegistry.updateAll(Laya.timer.delta));
  Laya.timer.frameLoop(10, null, () => SceneBuilder.resort());
  console.log(`[S1] 客户端版本 ${AppConfig.clientVersion}，配置包 v${cfg.version}`);
}

/** 无规则行的兜底视图（与后端 `BuildRuleService.getRule` 的 forbidden 默认视图同口径，宁可禁用不可误建） */
function forbiddenRule(sceneId: string): BuildRuleView {
  return {
    id: null,
    sceneId,
    mode: 'forbidden',
    landGridSize: 64,
    maxBuildingsPerPlayer: 0,
    allowDemolish: false,
    coopMinContributors: 2,
    coopExpireHours: 24,
    reservedZones: [],
  };
}

/** 建筑视图 → 实体（已存在则只更新状态与位置；HTTP 视图是 finishAt 的唯一来源） */
function syncBuilding(view: BuildingView): void {
  const spawn = viewToSpawn(view, BuildPanel.templateOf(view.templateId));
  const existing = EntityRegistry.get(spawn.entityId);
  if (existing) {
    existing.setPos(spawn.x, spawn.y);
    existing.getComponent(BuildingViewComponent)?.applyState(view.state, view.finishAt);
    return;
  }
  SceneBuilder.addEntity(EntityFactory.createFromBuilding(spawn, state.buildRule));
}

/**
 * S6 建造接线（计划 Task 7 Step 2/4）：规则/蓝图/建筑列表全部走服务端接口
 * （蓝图接口是**计划外的必要补充**：Task 6 的 5 个客户端接口未含蓝图，客户端面板需要成本/耗时/占地）。
 * 任一请求失败 → 按 forbidden 兜底并记日志，不阻断进场景。
 */
async function attachBuild(me: Entity, cfg: SceneConfig): Promise<void> {
  const sceneId = String(cfg.sceneId);
  const token = Session.token ?? '';
  let rule = forbiddenRule(sceneId);
  let templates: BuildingTemplate[] = [];
  let buildings: BuildingView[] = [];
  try {
    const [ruleView, templateList, buildingList] = await Promise.all([
      Api.getBuildRule(sceneId, token),
      Api.listBuildingTemplates(null, token),
      Api.listBuildings(sceneId, null, token),
    ]);
    rule = ruleView;
    templates = templateList;
    buildings = buildingList;
  } catch (err) {
    console.warn(`[S6] 建造数据加载失败，按 forbidden 兜底：${String(err)}`);
  }

  state.buildRule = rule;
  BuildPanel.attach(
    me,
    SceneBuilder.layer,
    {
      sceneId,
      mapWidth: cfg.scene.mapWidth,
      mapHeight: cfg.scene.mapHeight,
      rule,
      templates,
    },
    syncBuilding,
  );

  for (const view of buildings) syncBuilding(view);
  BuildPanel.setBuildings(buildings);
  console.log(
    `[S6] 建造接入：模式=${rule.mode} 蓝图=${templates.length} 场景建筑=${buildings.length}（按 B 打开建造面板）`,
  );
}

async function main(): Promise<void> {
  await Boot.start();
  // 引擎内自绘 HUD 挂到舞台顶层（须在 Laya.init 之后），此后所有提示走 Hud
  Hud.init();
  // S5 对话框（同为引擎内自绘，屏幕空间，zOrder 高于 HUD）
  DialogueView.init();
  // S6 建造面板（引擎内自绘，zOrder 高于 HUD/对话框）
  BuildPanel.init();
  // S8 质量分级 + 性能面板（面板 zOrder 须高于 login；F3 开关）
  Quality.init();
  PerfPanel.init();
  Session.load();

  if (Session.token) {
    console.log('[S1] 复用本地 token');
    await afterLogin();
    return;
  }

  LoginView.show(() => {
    void afterLogin().catch((err) => Toast.error(err instanceof Error ? err.message : String(err)));
  });
}

main().catch((err) => {
  console.error('[S1] 启动失败', err);
  Toast.error(err instanceof Error ? err.message : String(err));
});