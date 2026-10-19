/**
 * 允许写入的目标游戏白名单。
 * 必须与前端 src/config/CrossGameMap.ts 的 TARGET_GAMES 同源一致；
 * 新增/调整目标游戏需前后端同步改动，否则会出现前端算分后后端拒收（48001）。
 */
export const ALLOWED_TARGET_GAMES: string[] = [
  'brain-processing-speed',
  'brain-working-memory',
  'brain-language',
  'brain-spatial',
  'brain-face-name',
  'brain-visual-recognition',
  'brain-inhibition',
  'brain-numeracy',
  'brain-prospective',
  'brain-time-orientation',
  'brain-reminiscence',
];
