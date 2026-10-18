import { SceneBuilder } from './SceneBuilder';

/**
 * 主世界挂起控制：进入狼人杀时把主世界「藏起来 + 停掉」，退出后原样恢复。
 *
 * 为什么用「标志守卫」而不是 `Laya.timer.clear` 掉循环再重注册：
 * - 世界循环是以匿名回调注册的（`Laya.timer.frameLoop(1, null, …)`），拿不到稳定引用，
 *   clear 后重注册会引入重复注册/竞态；标志守卫幂等，暂停/恢复可任意次数调用。
 * - `?ww=1` 直入路径下世界层根本没建（`SceneBuilder.layer` 为 null），
 *   挂起/恢复必须是 no-op 而不是报错。
 *
 * 注意：`layer.visible=false` 只是不画，逐帧回调仍会被调用，故调用点（`Main.ts` 的三处世界
 * 循环、`PlayerControl`、`InteractController`）仍要各自加 `isWorldPaused()` 早退守卫。
 */
let paused = false;

/** 世界当前是否处于挂起态（供各循环/输入回调早退判断） */
export function isWorldPaused(): boolean {
  return paused;
}

/** 挂起主世界：隐藏世界层 + 置位挂起标志 */
export function pauseWorld(): void {
  if (paused) return;
  paused = true;
  const layer = SceneBuilder.layer;
  if (layer) layer.visible = false;
  console.log('[WW] 主世界已挂起（世界层隐藏 + 循环/输入停用）');
}

/** 恢复主世界：显示世界层 + 复位挂起标志 */
export function resumeWorld(): void {
  if (!paused) return;
  paused = false;
  const layer = SceneBuilder.layer;
  if (layer) layer.visible = true;
  console.log('[WW] 主世界已恢复');
}
