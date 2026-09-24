import { AppConfig } from '../config/AppConfig';
import type { InteractController } from '../world/InteractController';
import type { PlayerControl } from '../world/PlayerControl';

const T = AppConfig.touch;

/** 8 向判定的分量阈值：sin 22.5° —— 与轴线的夹角在 ±22.5° 内算单轴，否则算斜向（八向等分） */
const AXIS_THRESHOLD = 0.3827;

/**
 * 摇杆偏移 → 要注入的方向键（**纯函数，8 向离散**）：`dx/dy` 是屏幕坐标偏移（y 向下 = `'s'`），
 * `deadZone` 是死区半径（像素），偏移不足则返回空数组。导出以便零依赖断言脚本直接校验八向分界。
 */
export function stickKeys(dx: number, dy: number, deadZone: number): string[] {
  const len = Math.hypot(dx, dy);
  if (len < deadZone) return [];
  const kx = dx / len;
  const ky = dy / len;
  const keys: string[] = [];
  if (kx >= AXIS_THRESHOLD) keys.push('d');
  else if (kx <= -AXIS_THRESHOLD) keys.push('a');
  if (ky >= AXIS_THRESHOLD) keys.push('s');
  else if (ky <= -AXIS_THRESHOLD) keys.push('w');
  return keys;
}

/**
 * S9 手机触控（引擎内自绘，屏幕空间）：**浮动虚拟摇杆** + 交互按钮，仅触摸设备显示。
 *
 * 定位：**只补输入通道，不改任何游戏逻辑** —— 摇杆把与键盘同名的 `'w'/'a'/'s'/'d'` 按 8 向离散
 * 注入 `PlayerControl.pressed`（复用同一条「本地位移 → 10Hz `world.move` 上报」链路），
 * 交互按钮走 `InteractController.triggerInteract()`（与键盘 F 同一分支）。
 * WS 契约、上报口径、键盘行为**全部零变更**。
 *
 * 与 `Hud` 同范式：只挂 `Laya.stage` 顶层，只用已验证基元（`Laya.Sprite` + `graphics` + `Laya.Text`），
 * 不依赖 DOM、不引 laya.ui 皮肤，故 H5 与小游戏端一致。
 *
 * 三个实现要点（引擎命中/派发语义，读 `laya.core.js` 得到）：
 *  1. **必须有可命中的激活区**：Laya 的 `MOUSE_DRAG`/`MOUSE_DRAG_END` 只向「按下时命中的节点链」
 *     （`TouchInfo.downTargets`）派发，空处按下连 `MOUSE_DOWN` 都收不到 —— 故摇杆不能只在按下时
 *     凭空造节点，得先在左下角放一块**不可见但可命中**的激活区接住按下。
 *  2. **三重抬手兜底**：`MOUSE_DRAG` 拖出激活区仍会派发（按 downTargets 而非当前位置），但
 *     `MOUSE_DRAG_END` 仅在指针移动过才派发，且舞台级 `MOUSE_UP` 会同时被**其它手指**触发 ——
 *     故用 激活区 `MOUSE_DRAG_END` + `MOUSE_DRAG` + 舞台 `MOUSE_UP` 三路收口，并按 `touchId`
 *     过滤（只认按下摇杆的那根手指），避免「交互按钮的手抬起来把摇杆一起停掉」。
 *  3. **差量注入**：只 press 新增、release 失效的键，不动键盘按住的方向键 —— 触控与键盘可并存。
 */
export class TouchControls {
  /** 舞台级抬手监听只注册一次（`attach` 可能被重复调用） */
  private static listening = false;
  /** 当前摇杆的结束回调（由 `attach` 注入；`touchId` 不匹配则忽略） */
  private static endCurrent: ((touchId: number) => void) | null = null;

  /** 在**进场景之后**调用；非触摸设备直接跳过（PC 端行为零变更） */
  static attach(player: PlayerControl, interact: InteractController): void {
    if (!TouchControls.isTouchDevice()) {
      console.log('[S9] 非触摸设备：不启用触控层（键盘 WASD/方向键 + F 照常）');
      return;
    }

    const root = new Laya.Sprite();
    root.name = 's9-touch';
    root.zOrder = T.zOrder;
    // 不设 size / 不设 mouseEnabled：根节点自身永不参与命中（否则会吃掉整个舞台的指针），
    // 命中只由下方激活区与交互按钮这两个子节点提供。详见类注释要点 1。

    // 摇杆激活区：左下角锚定，不可见但可命中
    const zone = new Laya.Sprite();
    zone.name = 's9-stick-zone';
    zone.mouseEnabled = true;
    zone.size(T.stickZoneWidth, T.stickZoneHeight);
    zone.pos(0, AppConfig.stageHeight - T.stickZoneHeight);
    root.addChild(zone);

    // 浮动底座 + 摇杆头：纯显示（mouseEnabled=false），按下时才显示并定位到按下点
    const base = new Laya.Sprite();
    base.name = 's9-stick-base';
    base.mouseEnabled = false;
    base.visible = false;
    base.graphics.drawCircle(0, 0, T.stickRadius, T.bgColor, T.borderColor, T.borderWidth);

    const knob = new Laya.Sprite();
    knob.name = 's9-stick-knob';
    knob.mouseEnabled = false;
    knob.graphics.drawCircle(0, 0, T.knobRadius, T.pressedBgColor);
    base.addChild(knob);
    root.addChild(base);

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

    /** 是否已有一根手指按在摇杆上（`activeId` 为该手指的 touchId，-1 表示未知/未做区分） */
    let active = false;
    let activeId = -1;
    /** 按下点（舞台坐标）：同时也是摇杆底座圆心，偏移以此为原点 */
    let originX = 0;
    let originY = 0;
    /** 当前已注入的方向键（差量注入用） */
    let applied: string[] = [];

    const applyKeys = (next: string[]): void => {
      for (const key of applied) if (!next.includes(key)) player.release(key);
      for (const key of next) if (!applied.includes(key)) player.press(key);
      applied = next;
    };

    /** 按下即激活：底座落在按下处（浮动），此刻偏移为 0 → 落在死区内、不注入任何方向 */
    const begin = (x: number, y: number, touchId: number): void => {
      if (active) return; // 已有手指在操控摇杆，忽略后来者
      active = true;
      activeId = touchId;
      originX = x;
      originY = y;
      base.pos(x, y);
      base.visible = true;
      knob.pos(0, 0);
      applyKeys([]);
    };

    /** 拖动：摇杆头按方向钳制在圆内（超出不额外加速），再按 8 向离散注入方向键 */
    const move = (x: number, y: number, touchId: number): void => {
      if (!active || touchId !== activeId) return;
      const dx = x - originX;
      const dy = y - originY;
      const len = Math.hypot(dx, dy);
      const clamp = len > T.stickRadius ? T.stickRadius / len : 1;
      knob.pos(dx * clamp, dy * clamp);
      applyKeys(stickKeys(dx, dy, T.stickRadius * T.deadZoneRatio));
    };

    /** 抬手：隐藏底座并释放本摇杆注入的全部方向键（不影响键盘按住的键） */
    const end = (touchId: number): void => {
      if (!active || touchId !== activeId) return;
      active = false;
      activeId = -1;
      base.visible = false;
      applyKeys([]);
    };

    zone.on(Laya.Event.MOUSE_DOWN, null, (e: Laya.Event) => {
      begin(e.stageX, e.stageY, TouchControls.touchIdOf(e));
    });
    zone.on(Laya.Event.MOUSE_DRAG, null, (e: Laya.Event) => {
      move(e.stageX, e.stageY, TouchControls.touchIdOf(e));
    });
    zone.on(Laya.Event.MOUSE_DRAG_END, null, (e: Laya.Event) => {
      end(TouchControls.touchIdOf(e));
    });

    TouchControls.endCurrent = end;
    if (!TouchControls.listening) {
      TouchControls.listening = true;
      Laya.stage.on(Laya.Event.MOUSE_UP, TouchControls, (e: Laya.Event) => {
        TouchControls.endCurrent?.(TouchControls.touchIdOf(e));
      });
    }

    Laya.stage.addChild(root);
    console.log(
      `[S9] 触控层就绪：浮动摇杆（激活区 ${T.stickZoneWidth}×${T.stickZoneHeight}，半径 ${T.stickRadius}）` +
        ` + 交互按钮，zOrder=${T.zOrder}；按住拖动移动、松手停`,
    );
  }

  /** 触摸设备判定：桌面浏览器（含 Windows 触摸本）与手机端都由两个条件之一命中 */
  private static isTouchDevice(): boolean {
    if (typeof window === 'undefined') return false;
    return 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  }

  /** 事件的 touchId：触摸事件带（引擎在 touchstart 时写入 `event.touchId`），鼠标事件不带 → 返回 -1（不区分） */
  private static touchIdOf(e: Laya.Event): number {
    const v = (e as unknown as { touchId?: number }).touchId;
    return typeof v === 'number' ? v : -1;
  }

  private static makeButton(label: string, w: number, h: number, fontSize: number): Laya.Sprite {
    const btn = new Laya.Sprite();
    // size() 必设：Laya 的命中检测按 sprite 自身边界，不设则只有 graphics 尺寸、易漏点
    btn.size(w, h);
    btn.mouseEnabled = true;
    btn.graphics.drawRect(0, 0, w, h, T.bgColor);
    btn.graphics.drawRect(0, 0, w, h, null, T.borderColor, T.borderWidth);

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
}