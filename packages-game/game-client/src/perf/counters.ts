/**
 * S8 上行计数（与 UI 解耦的计数点）：计划只说面板要显示「本秒 world.move 上行次数」，
 * 计数因此独立成小模块 —— `net/ws.ts` 只调用 `bumpUp`，面板只读 `upPerSec`，两者互不依赖。
 *
 * 不触碰 Laya、不依赖 DOM，可被零依赖断言脚本直接 import。
 */

/** 滑窗时长：口径为「本秒上行次数」（与面板 refreshMs=1000 一致） */
export const UP_WINDOW_MS = 1000;

/** cmd → 时间戳序列（升序；在 bumpUp/upPerSec 内按窗口裁剪，避免长时间运行后无界增长） */
const upTimestamps = new Map<string, number[]>();

function nowMs(): number {
  return typeof Date !== 'undefined' ? Date.now() : 0;
}

/** 裁掉窗口外的旧时间戳（只保留 (now-window, now]） */
function prune(list: number[], at: number): void {
  const cutoff = at - UP_WINDOW_MS;
  let i = 0;
  while (i < list.length && list[i] <= cutoff) i++;
  if (i > 0) list.splice(0, i);
}

/** 记一次上行（`ws.send` 每次发出 cmd 都调用；不区分 expectAck 路径） */
export function bumpUp(cmd: string, at: number = nowMs()): void {
  const list = upTimestamps.get(cmd) ?? [];
  list.push(at);
  prune(list, at);
  upTimestamps.set(cmd, list);
}

/** 本秒（滑窗 1 秒）该 cmd 的上行次数；静止无上行时为 0 */
export function upPerSec(cmd: string, at: number = nowMs()): number {
  const list = upTimestamps.get(cmd);
  if (!list) return 0;
  prune(list, at);
  return list.length;
}

/** 清空计数；传 cmd 只清该类 */
export function reset(cmd?: string): void {
  if (cmd === undefined) upTimestamps.clear();
  else upTimestamps.delete(cmd);
}

/** 当前窗口内所有 cmd 的计数快照（用于日志/断言） */
export function snapshot(at: number = nowMs()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [cmd, list] of upTimestamps) {
    prune(list, at);
    out[cmd] = list.length;
  }
  return out;
}