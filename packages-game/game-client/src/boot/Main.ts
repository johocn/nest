import { Boot } from './Boot';

async function main(): Promise<void> {
  await Boot.start();
  console.log('[S1] ready');
}

main().catch((err) => {
  console.error('[S1] 启动失败', err);
});