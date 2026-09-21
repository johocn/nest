import { Boot } from './Boot';
import { LoginView } from './LoginView';
import { AppConfig } from '../config/AppConfig';
import { ConfigLoader } from '../config/loader';
import type { SceneConfig, ServerSpawn } from '../config/schema';
import { Entity } from '../entity/Entity';
import { EntityFactory } from '../entity/EntityFactory';
import { Session } from '../net/Session';
import { WsClient } from '../net/ws';
import { Platform } from '../platform/Platform';
import { SceneBuilder } from '../world/SceneBuilder';
import { Toast } from '../ui/Toast';

const state = {
  cfg: null as SceneConfig | null,
  ws: null as WsClient | null,
  me: null as Entity | null,
};

interface EnterSceneSync {
  scene: { id: string; name: string; mapWidth: number; mapHeight: number };
  spawns: ServerSpawn[];
  triggers: Array<{ id: string; triggerType: string }>;
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

  // ⑤ 自己（addEntity 内部已登记到 EntityRegistry，无需重复 add）
  const me = EntityFactory.createPlayer(Session.playerId!, cfg.scene.entry.x, cfg.scene.entry.y);
  SceneBuilder.addEntity(me);
  state.me = me;
  console.log(`[S1] 本地玩家 ${me.entityId} 出生于 (${me.x},${me.y})`);

  Laya.timer.frameLoop(10, null, () => SceneBuilder.resort());
  console.log(`[S1] 客户端版本 ${AppConfig.clientVersion}，配置包 v${cfg.version}`);
}

async function main(): Promise<void> {
  await Boot.start();
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