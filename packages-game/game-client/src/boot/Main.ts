import { Boot } from './Boot';
import { LoginView } from './LoginView';
import { AppConfig } from '../config/AppConfig';
import { ConfigLoader } from '../config/loader';
import { EntityFactory } from '../entity/EntityFactory';
import { Session } from '../net/Session';
import { SceneBuilder } from '../world/SceneBuilder';
import { Platform } from '../platform/Platform';
import { Toast } from '../ui/Toast';

async function afterLogin(): Promise<void> {
  if (Platform.isMiniGame()) {
    // S1 微信端只验收「配置包 + 静态层 + HTTP 登录」，WS 适配见 S7
    const cfg = await ConfigLoader.loadScene();
    await EntityFactory.loadPlaceholder();
    Laya.stage.addChild(SceneBuilder.build(cfg));
    Toast.info('微信端 S1：静态场景已渲染（WS 待 S7）');
    return;
  }

  const cfg = await ConfigLoader.loadScene();
  await EntityFactory.loadPlaceholder();
  const layer = SceneBuilder.build(cfg);
  Laya.stage.addChild(layer);

  // Task 10 起在此处接 WS 进场景与实体合并
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
});