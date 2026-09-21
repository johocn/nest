import { Boot } from './Boot';
import { LoginView } from './LoginView';
import { AppConfig } from '../config/AppConfig';
import { ConfigLoader } from '../config/loader';
import type { NpcInstanceConfig, SceneConfig, ServerSpawn } from '../config/schema';
import { AiComponent } from '../entity/components/AiComponent';
import { Entity } from '../entity/Entity';
import { EntityFactory } from '../entity/EntityFactory';
import { EntityRegistry } from '../entity/EntityRegistry';
import { Session } from '../net/Session';
import { WsClient } from '../net/ws';
import { Platform } from '../platform/Platform';
import { PlayerControl } from '../world/PlayerControl';
import { InteractController } from '../world/InteractController';
import { SceneBuilder } from '../world/SceneBuilder';
import { Toast } from '../ui/Toast';
import { Hud } from '../ui/Hud';

const state = {
  cfg: null as SceneConfig | null,
  ws: null as WsClient | null,
  me: null as Entity | null,
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
      const entity = EntityRegistry.upsert(d.entityId, pos, () =>
        EntityFactory.createOtherPlayer(String(d.playerId), pos.x, pos.y),
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
    }
  });

  // ⑦ 本地移动 → 10Hz 上报
  new PlayerControl(me, ws, { width: cfg.scene.mapWidth, height: cfg.scene.mapHeight }).attach();

  // ⑧ 就近交互（F 键）
  new InteractController(me).attach();

  // ⑨ 组件逐帧驱动（AiComponent 的路点插值按 Laya.timer.delta 推进）
  Laya.timer.frameLoop(1, null, () => EntityRegistry.updateAll(Laya.timer.delta));
  Laya.timer.frameLoop(10, null, () => SceneBuilder.resort());
  console.log(`[S1] 客户端版本 ${AppConfig.clientVersion}，配置包 v${cfg.version}`);
}

async function main(): Promise<void> {
  await Boot.start();
  // 引擎内自绘 HUD 挂到舞台顶层（须在 Laya.init 之后），此后所有提示走 Hud
  Hud.init();
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