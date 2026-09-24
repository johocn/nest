import { AppConfig } from '../config/AppConfig';
import type { InteractController } from '../world/InteractController';
import type { PlayerControl } from '../world/PlayerControl';

const T = AppConfig.touch;

/** 8 向网格：[列, 行, 注入的按键, 箭头字形]。3×3 网格，中心格 (1,1) 空置 */
const PAD: ReadonlyArray<{ col: number; row: number; keys: readonly string[]; glyph: string }> = [
  { col: 0, row: 0, keys: ['w', 'a'], glyph: '↖' },
  { col: 1, row: 0, keys: ['w'], glyph: '↑' },
  { col: 2, row: 0, keys: ['w', 'd'], glyph: '↗' },
  { col: 0, row: 1, keys: ['a'], glyph: '←' },
  { col: 2, row: 1, keys: ['d'], glyph: '→' },
  { col: 0, row: 2, keys: ['s', 'a'], glyph: '↙' },
  { col: 1, row: 2, keys: ['s'], glyph: '↓' },
  { col: 2, row: 2, keys: ['s', 'd'], glyph: '↘' },
];

/**
 * S9 手机触控（引擎内自绘，屏幕空间）：8 向虚拟方向键 + 交互按钮。
 *
 * 定位：**只补输入通道，不改任何游戏逻辑** —— 方向键把与键盘同名的 `'w'/'a'/'s'/'d'`
 * 注入 `PlayerControl.pressed`（复用同一条「本地位移 → 10Hz `world.move` 上报」链路），
 * 交互按钮走 `InteractController.triggerInteract()`（与键盘 F 同一分支）。
 * WS 契约、上报口径、键盘行为**全部零变更**。
 *
 * 与 `Hud` 同范式：只挂 `Laya.stage` 顶层，只用已验证基元（`Laya.Sprite` + `graphics` + `Laya.Text`），
 * 不依赖 DOM、不引 laya.ui 皮肤，故 H5 与小游戏端一致。
 *
 * 两个实现要点：
 *  1. **只在触摸设备显示**（`ontouchstart` / `maxTouchPoints`）：PC 端不出现，键盘路径逐字不变。
 *  2. 按住持续移动用 `MOUSE_DOWN`（`CLICK` 要等抬手才触发，太晚）；抬手由**舞台级** `MOUSE_UP`
 *     统一兜底释放全部方向键，避免「手指滑出按钮后按键卡住一直走」。
 */
export class TouchControls {
  /** 舞台级抬手监听只注册一次（`attach` 可能被重复调用） */
  private static listening = false;

  /** 在**进场景之后**调用；非触摸设备直接跳过（PC 端行为零变更） */
  static attach(player: PlayerControl, interact: InteractController): void {
    if (!TouchControls.isTouchDevice()) {
      console.log('[S9] 非触摸设备：不启用触控层（键盘 WASD/方向键 + F 照常）');
      return;
    }

    const root = new Laya.Sprite();
    root.name = 's9-touch';
    root.zOrder = T.zOrder;

    const buttons: Laya.Sprite[] = [];
    const pad = T.buttonSize * 3 + T.buttonGap * 2;
    const originX = T.padMargin;
    const originY = AppConfig.stageHeight - T.padMargin - pad;

    for (const cell of PAD) {
      const btn = TouchControls.makeButton(cell.glyph, T.buttonSize, T.buttonSize, T.glyphFontSize);
      btn.pos(
        originX + cell.col * (T.buttonSize + T.buttonGap),
        originY + cell.row * (T.buttonSize + T.buttonGap),
      );
      btn.on(Laya.Event.MOUSE_DOWN, null, () => {
        for (const key of cell.keys) player.press(key);
        TouchControls.paint(btn, true);
      });
      root.addChild(btn);
      buttons.push(btn);
    }

    const interactBtn = TouchControls.makeButton(
      '交互',
      T.interactWidth,
      T.interactHeight,
      T.interactFontSize,
    );
    interactBtn.pos(
      AppConfig.stageWidth - T.interactMarginRight - T.interactWidth,
      AppConfig.stageHeight - T.interactMarginBottom - T.interactHeight,
    );
    // 与键盘 F 同一入口（内部自带 busy / 对话打开 / 无目标 三重判定）
    interactBtn.on(Laya.Event.MOUSE_DOWN, null, () => void interact.triggerInteract());
    root.addChild(interactBtn);

    if (!TouchControls.listening) {
      TouchControls.listening = true;
      Laya.stage.on(Laya.Event.MOUSE_UP, TouchControls, () => {
        player.releaseAll();
        for (const btn of buttons) TouchControls.paint(btn, false);
      });
    }

    Laya.stage.addChild(root);
    console.log(
      `[S9] 触控层就绪：8 向方向键（单格 ${T.buttonSize}px）+ 交互按钮，zOrder=${T.zOrder}；按住移动、松手停`,
    );
  }

  /** 触摸设备判定：桌面浏览器（含 Windows 触摸本）与手机端都由两个条件之一命中 */
  private static isTouchDevice(): boolean {
    if (typeof window === 'undefined') return false;
    return 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  }

  private static makeButton(label: string, w: number, h: number, fontSize: number): Laya.Sprite {
    const btn = new Laya.Sprite();
    // size() 必设：Laya 的命中检测按 sprite 自身边界，不设则只有 graphics 尺寸、易漏点
    btn.size(w, h);
    btn.mouseEnabled = true;
    TouchControls.paint(btn, false);

    const text = new Laya.Text();
    text.fontSize = fontSize;
    text.color = T.textColor;
    text.stroke = 2;
    text.strokeColor = '#000000';
    text.mouseEnabled = false;
    text.text = label;
    text.pos(Math.round((w - text.textWidth) / 2), Math.round((h - text.textHeight) / 2));
    btn.addChild(text);
    return btn;
  }

  /** 重绘底色（`graphics` 只画按钮自身，子节点文字不受影响） */
  private static paint(btn: Laya.Sprite, pressed: boolean): void {
    btn.graphics.clear();
    btn.graphics.drawRect(0, 0, btn.width, btn.height, pressed ? T.pressedBgColor : T.bgColor);
    btn.graphics.drawRect(0, 0, btn.width, btn.height, null, T.borderColor, T.borderWidth);
  }
}