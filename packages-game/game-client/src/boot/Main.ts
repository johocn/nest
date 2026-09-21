import { Boot } from './Boot';
import { LoginView } from './LoginView';
import { Session } from '../net/Session';

async function afterLogin(): Promise<void> {
  console.log(`[S1] afterLogin playerId=${Session.playerId}（Task 8 起在此处连接 WS 并进场景）`);
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
    void afterLogin();
  });
}

main().catch((err) => {
  console.error('[S1] 启动失败', err);
});