import { AppConfig } from '../config/AppConfig';
import { Platform } from '../platform/Platform';
import {
  applyKey,
  createLoginState,
  keyTokenFromEvent,
  loginLayout,
  setFieldText,
  validateLogin,
} from './login-logic';
import type { LoginField, LoginState } from './login-logic';

const L = AppConfig.login;

/**
 * S7 登录页（**引擎内自绘，小游戏端无 DOM 依赖**）。
 *
 * 只用已验证基元：`Laya.Sprite` + `graphics.drawRect` + `Laya.Text`（与 `Hud` / `DialogueView` 同一套路），
 * 根节点挂 `Laya.stage` 顶层并设 `AppConfig.login.zOrder` —— 屏幕空间，不随世界层滚动。
 *
 * 键盘输入**双源**：先问平台能力 `Platform.ui.showKeyboard`，小游戏端由 wx 软键盘（showKeyboard）接管；
 * 返回 false（H5 / 能力缺失）时视图自行订阅 Laya 键盘事件兜底（H5 有物理键盘）。
 *
 * 本类**不含登录编排**（login → register 兜底 → Session.save → 提示），那是 `boot/LoginView.ts` 的事：
 * 只通过 `onSubmit` 回调交回上层，避免与 boot 层循环依赖。
 */
export class LoginView {
  private static root: Laya.Sprite | null = null;
  private static state: LoginState = createLoginState();
  private static handlers: { onSubmit: (username: string, password: string) => Promise<void> } | null =
    null;
  private static opened = false;
  private static busy = false;
  /** 平台软键盘是否已接管输入（true 时视图不再订阅引擎键盘事件） */
  private static softKeyboard = false;

  /** 打开登录页；重复调用不叠加节点（已打开则只更新回调并重绘） */
  static show(handlers: { onSubmit: (username: string, password: string) => Promise<void> }): void {
    if (typeof Laya === 'undefined' || !Laya.stage) {
      console.log('[S7] LoginView 未就绪（引擎未初始化），跳过打开');
      return;
    }

    LoginView.handlers = handlers;
    if (LoginView.opened) {
      LoginView.rebuild();
      return;
    }

    LoginView.opened = true;
    LoginView.busy = false;
    LoginView.state = createLoginState();

    const root = new Laya.Sprite();
    root.name = 's7-login';
    root.zOrder = L.zOrder;
    root.mouseEnabled = true;
    root.size(AppConfig.stageWidth, AppConfig.stageHeight);
    Laya.stage.addChild(root);
    LoginView.root = root;

    if (!LoginView.openSoftKeyboard()) {
      // 无软键盘（H5）：订阅引擎键盘事件兜底
      Laya.stage.on(Laya.Event.KEY_DOWN, LoginView, LoginView.onKeyDown);
    }
    LoginView.rebuild();
  }

  /** 关闭并清理（幂等）：解除键盘订阅、收软键盘、移除节点 */
  static hide(): void {
    LoginView.opened = false;
    LoginView.busy = false;
    LoginView.handlers = null;
    LoginView.state = createLoginState();
    LoginView.closeSoftKeyboard();
    LoginView.offKeyDown();

    const root = LoginView.root;
    LoginView.root = null;
    if (!root) return;
    root.removeChildren();
    if (root.parent) root.removeSelf();
  }

  // ── 软键盘（小游戏） ────────────────────────────────────────────────────

  /** 打开平台软键盘；返回 true 表示平台已接管输入（此时解除引擎键盘订阅，避免双源重复输入） */
  private static openSoftKeyboard(): boolean {
    LoginView.softKeyboard = Platform.ui.showKeyboard({
      defaultValue: LoginView.fieldText(LoginView.state.focus),
      maxLength: LoginView.state.focus === 'username' ? L.maxUserLen : L.maxPassLen,
      field: LoginView.state.focus,
      handlers: {
        onInput: (value) => LoginView.applyPlatformInput(value),
        onConfirm: () => void LoginView.submit(),
        onComplete: () => {
          LoginView.softKeyboard = false;
        },
      },
    });
    if (LoginView.softKeyboard) LoginView.offKeyDown();
    return LoginView.softKeyboard;
  }

  /** 收软键盘（能力缺失时 Platform 内部已吞异常） */
  private static closeSoftKeyboard(): void {
    if (!LoginView.softKeyboard) return;
    LoginView.softKeyboard = false;
    Platform.ui.hideKeyboard();
  }

  /** 平台软键盘给的是**整串**文本（非增量），故整体替换当前焦点字段 */
  private static applyPlatformInput(value: string): void {
    LoginView.state = setFieldText(LoginView.state, LoginView.state.focus, value);
    LoginView.rebuild();
  }

  // ── 引擎键盘（H5 兜底） ─────────────────────────────────────────────────

  private static onKeyDown(e: Laya.Event): void {
    if (!LoginView.opened) return;
    const ev = e as unknown as { keyCode?: number; key?: string; shiftKey?: boolean };
    const token = keyTokenFromEvent(ev.keyCode ?? 0, ev.key ?? null, ev.shiftKey === true);
    if (!token) return;

    const before = LoginView.state.focus;
    const result = applyKey(LoginView.state, token);
    LoginView.state = result.state;

    if (result.state.focus !== before) LoginView.reopenSoftKeyboard();

    if (result.intent === 'submit') {
      void LoginView.submit();
      return;
    }
    LoginView.rebuild();
  }

  private static offKeyDown(): void {
    if (typeof Laya === 'undefined' || !Laya.stage) return;
    Laya.stage.off(Laya.Event.KEY_DOWN, LoginView, LoginView.onKeyDown);
  }

  /**
   * （重）打开软键盘：小游戏的软键盘绑定了字段长度上限，切换字段必须换绑。
   * 也用于「点击输入框」——用户手势是宿主接受软键盘最可靠的时机；H5 下 Platform 直接返回 false，无副作用。
   */
  private static reopenSoftKeyboard(): void {
    if (LoginView.softKeyboard) LoginView.closeSoftKeyboard();
    LoginView.openSoftKeyboard();
  }

  private static setFocus(field: LoginField): void {
    const changed = LoginView.state.focus !== field;
    if (changed) LoginView.state = { ...LoginView.state, focus: field };
    LoginView.reopenSoftKeyboard();
    if (changed) LoginView.rebuild();
  }

  // ── 提交 ────────────────────────────────────────────────────────────────

  private static async submit(): Promise<void> {
    if (LoginView.busy) return;

    const error = validateLogin(LoginView.state);
    if (error) {
      // 校验不过不发请求，只把文案落到错误行
      LoginView.state = { ...LoginView.state, error };
      LoginView.rebuild();
      return;
    }

    const handlers = LoginView.handlers;
    if (!handlers) return;

    LoginView.closeSoftKeyboard();
    LoginView.busy = true;
    LoginView.rebuild();

    try {
      await handlers.onSubmit(LoginView.state.username, LoginView.state.password);
    } catch (e: unknown) {
      LoginView.state = {
        ...LoginView.state,
        error: e instanceof Error ? e.message : String(e),
      };
    } finally {
      // tsconfig 的 lib 为 ES2017（无 Promise.prototype.finally），故用 try/finally 等价实现
      LoginView.busy = false;
      LoginView.rebuild();
    }
  }

  // ── 渲染 ────────────────────────────────────────────────────────────────

  private static fieldText(field: LoginField): string {
    return field === 'username' ? LoginView.state.username : LoginView.state.password;
  }

  private static rebuild(): void {
    const root = LoginView.root;
    if (!root || !LoginView.opened) return;
    root.removeChildren();

    const layout = loginLayout(AppConfig.stageWidth, AppConfig.stageHeight);
    const state = LoginView.state;

    const panel = new Laya.Sprite();
    panel.mouseEnabled = false;
    panel.graphics.drawRect(
      layout.panel.x,
      layout.panel.y,
      layout.panel.w,
      layout.panel.h,
      L.panelBgColor,
    );
    panel.graphics.drawRect(
      layout.panel.x,
      layout.panel.y,
      layout.panel.w,
      L.panelBorderWidth,
      L.panelBorderColor,
    );
    root.addChild(panel);

    root.addChild(LoginView.makeText('江湖录 · 登录', layout.title, L.titleFontSize, L.titleColor));
    root.addChild(
      LoginView.makeText(
        `账号（3-${L.maxUserLen} 位字母/数字/下划线）`,
        layout.userLabel,
        L.labelFontSize,
        L.labelColor,
      ),
    );
    root.addChild(
      LoginView.makeText(
        `密码（6-${L.maxPassLen} 位）`,
        layout.passLabel,
        L.labelFontSize,
        L.labelColor,
      ),
    );

    LoginView.drawField(root, layout.userBox, 'username', state.username, state.focus === 'username');
    LoginView.drawField(
      root,
      layout.passBox,
      'password',
      L.maskChar.repeat(state.password.length),
      state.focus === 'password',
    );

    const button = new Laya.Sprite();
    button.pos(layout.button.x, layout.button.y);
    button.size(layout.button.w, layout.button.h);
    button.mouseEnabled = !LoginView.busy;
    button.graphics.drawRect(
      0,
      0,
      layout.button.w,
      layout.button.h,
      LoginView.busy ? L.buttonDisabledBgColor : L.buttonBgColor,
    );
    button.addChild(
      LoginView.makeText(
        LoginView.busy ? L.buttonBusyText : L.buttonIdleText,
        { x: 0, y: Math.round((layout.button.h - L.buttonFontSize) / 2), w: layout.button.w, h: L.buttonFontSize },
        L.buttonFontSize,
        LoginView.busy ? L.buttonDisabledColor : L.buttonColor,
        'center',
      ),
    );
    button.on(Laya.Event.CLICK, null, () => void LoginView.submit());
    root.addChild(button);

    if (state.error) {
      root.addChild(LoginView.makeText(state.error, layout.error, L.errorFontSize, L.errorColor));
    }
  }

  /** 输入框：底色随焦点变化 + 文本（密码已掩码）+ 焦点光标竖线；点击可切焦点 */
  private static drawField(
    root: Laya.Sprite,
    rect: { x: number; y: number; w: number; h: number },
    field: LoginField,
    text: string,
    focused: boolean,
  ): void {
    const box = new Laya.Sprite();
    box.pos(rect.x, rect.y);
    box.size(rect.w, rect.h);
    box.mouseEnabled = true;
    box.graphics.drawRect(0, 0, rect.w, rect.h, focused ? L.inputFocusBgColor : L.inputBgColor);
    box.graphics.drawRect(
      0,
      0,
      rect.w,
      rect.h,
      null,
      focused ? L.inputFocusBorderColor : L.inputBorderColor,
      L.inputBorderWidth,
    );
    box.on(Laya.Event.CLICK, null, () => LoginView.setFocus(field));
    root.addChild(box);

    // 文本框内边距由常量给出，避免与框边界贴死
    root.addChild(
      LoginView.makeText(
        focused ? `${text}${L.caretChar}` : text,
        {
          x: rect.x + L.inputPadX,
          y: rect.y + Math.round((rect.h - L.inputFontSize) / 2),
          w: rect.w - L.inputPadX * 2,
          h: L.inputFontSize,
        },
        L.inputFontSize,
        L.inputTextColor,
      ),
    );
  }

  private static makeText(
    content: string,
    rect: { x: number; y: number; w: number; h: number },
    fontSize: number,
    color: string,
    align?: 'center',
  ): Laya.Text {
    const text = new Laya.Text();
    text.text = content;
    text.fontSize = fontSize;
    text.color = color;
    text.stroke = 2;
    text.strokeColor = '#000000';
    text.mouseEnabled = false;
    text.pos(rect.x, rect.y);
    if (align === 'center') {
      text.width = rect.w;
      text.align = 'center';
    }
    return text;
  }
}