import { AppConfig } from '../config/AppConfig';
import type { Entity } from '../entity/Entity';
import type { WsClient } from '../net/ws';

// Laya 的 KEY_DOWN/KEY_UP 事件对象不携带 keyCode，只代理 nativeEvent.key（见引擎 Event.key 定义），
// 故用归一化后的小写字符串判定按键。
const KEY_LEFT = 'a';
const KEY_RIGHT = 'd';
const KEY_UP = 'w';
const KEY_DOWN = 's';
const KEY_ARROW_LEFT = 'arrowleft';
const KEY_ARROW_RIGHT = 'arrowright';
const KEY_ARROW_UP = 'arrowup';
const KEY_ARROW_DOWN = 'arrowdown';
const SPEED_PX_PER_FRAME = 4;

export class PlayerControl {
  private readonly pressed = new Set<string>();
  private sinceReport = 0;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private readonly me: Entity,
    private readonly ws: WsClient,
    private readonly bounds: { width: number; height: number },
  ) {}

  attach(): void {
    this.lastX = this.me.x;
    this.lastY = this.me.y;
    Laya.stage.on(Laya.Event.KEY_DOWN, this, this.onKeyDown);
    Laya.stage.on(Laya.Event.KEY_UP, this, this.onKeyUp);
    Laya.timer.frameLoop(1, this, this.onFrame);
    console.log('[S1] 移动控制就绪：WASD / 方向键；移动中约 10Hz 上报 world.move');
  }

  private onKeyDown(e: Laya.Event): void {
    this.pressed.add(PlayerControl.normKey(e));
  }

  private onKeyUp(e: Laya.Event): void {
    this.pressed.delete(PlayerControl.normKey(e));
  }

  private static normKey(e: Laya.Event): string {
    return String((e as unknown as { key?: string }).key ?? '').toLowerCase();
  }

  private onFrame(): void {
    const p = this.pressed;
    let dx = 0;
    let dy = 0;
    if (p.has(KEY_LEFT) || p.has(KEY_ARROW_LEFT)) dx -= 1;
    if (p.has(KEY_RIGHT) || p.has(KEY_ARROW_RIGHT)) dx += 1;
    if (p.has(KEY_UP) || p.has(KEY_ARROW_UP)) dy -= 1;
    if (p.has(KEY_DOWN) || p.has(KEY_ARROW_DOWN)) dy += 1;
    if (!dx && !dy) return;

    const len = Math.hypot(dx, dy);
    const nx = this.me.x + (dx / len) * SPEED_PX_PER_FRAME;
    const ny = this.me.y + (dy / len) * SPEED_PX_PER_FRAME;
    this.me.setPos(
      Math.min(Math.max(nx, 8), this.bounds.width - 8),
      Math.min(Math.max(ny, 16), this.bounds.height - 8),
    );

    const now = Date.now();
    const moved = Math.hypot(this.me.x - this.lastX, this.me.y - this.lastY);
    if (now - this.sinceReport >= AppConfig.moveReportIntervalMs && moved >= AppConfig.moveReportThreshold) {
      this.sinceReport = now;
      this.lastX = this.me.x;
      this.lastY = this.me.y;
      // fire-and-forget：expectAck=false 的 Promise 永不 settle，不要 await
      this.ws.send('world.move', { x: this.me.x, y: this.me.y, rotation: 0, state: 'move' }, false);
    }
  }
}