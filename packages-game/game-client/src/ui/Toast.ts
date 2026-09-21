import { Platform } from '../platform/Platform';

export const Toast = {
  info(text: string): void {
    Platform.toast(text);
  },
  error(text: string): void {
    console.error(`[S1] ${text}`);
    Platform.toast(text, 3600);
  },
};