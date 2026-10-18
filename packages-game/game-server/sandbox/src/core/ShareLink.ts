import { GameLevel, AssetType } from '../config/GameConfig';

/** 课堂分享参数（可完全复现一局：难度 + 情景 + 定投 + 是否走后端行情） */
export interface ShareParams {
  level: GameLevel;
  scenarioId: string;
  dca?: {
    enabled: boolean;
    amount: number;
    intervalDays: number;
    asset: AssetType;
  };
  /** 走后端行情（?backend=1），分享链接带上后同学点开即用同一份后端行情 */
  useBackend?: boolean;
}

/** 构造课堂分享链接的 query 串（难度/情景必带，定投仅开启时带）
 *  手动拼接以保留 dca 的冒号字面量（dca=amount:interval:asset），便于阅读与解析 */
export function buildShareQuery(p: ShareParams): string {
  const parts = [`level=${p.level}`, `scenario=${p.scenarioId}`];
  if (p.dca && p.dca.enabled) {
    parts.push(`dca=${p.dca.amount}:${p.dca.intervalDays}:${p.dca.asset}`);
  }
  if (p.useBackend) {
    parts.push('backend=1');
  }
  return parts.join('&');
}
