import { AppConfig } from '../config/AppConfig';
import { Hud } from './Hud';

/**
 * 提示出口：统一走引擎内自绘 Hud（DOM 提示已移除，小游戏端与 H5 行为一致）。
 * 对外签名保持不变，调用方无需改动。
 */
export const Toast = {
  info(text: string): void {
    Hud.toast(text);
  },
  error(text: string): void {
    console.error(`[S1] ${text}`);
    Hud.toast(text, AppConfig.hud.toastErrorMs);
  },
};