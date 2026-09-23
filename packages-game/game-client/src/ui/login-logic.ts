import { AppConfig } from '../config/AppConfig';

/**
 * S7 登录页的**纯逻辑模块**（零引擎依赖）。
 *
 * 不 import 任何牵连 Laya 的模块（`AppConfig` 顶层无副作用），故产物
 * `bin/js/ui/login-logic.js` 可被 `node` 直接 import，供 `scripts/smoke-platform-s7.mjs` 场景 G 断言
 * 「状态归约 / 校验文案 / 布局矩形 / 键盘 token 映射」（与 S5 `dialogue` 的 layout 纯函数同一套路）。
 * 绘制在 `ui/LoginView.ts`，本文件不碰任何宿主 API。
 */

const L = AppConfig.login;

/** 账号最小长度；上限取 `AppConfig.login.maxUserLen`（与 H5 表单标签口径一致） */
const USER_MIN_LEN = 3;
/** 密码最小长度；上限取 `AppConfig.login.maxPassLen` */
const PASS_MIN_LEN = 6;

export type LoginField = 'username' | 'password';

/** 登录页状态（纯数据；`error` 为空串表示无错误） */
export interface LoginState {
  username: string;
  password: string;
  focus: LoginField;
  error: string;
}

export function createLoginState(): LoginState {
  return { username: '', password: '', focus: 'username', error: '' };
}

/** 归约结果：`intent==='submit'` 仅由 Enter 产生，调用方据此走提交流程 */
export interface LoginKeyResult {
  state: LoginState;
  intent?: 'submit';
}

/** 切换焦点的键（Tab 与四个方向键） */
const FOCUS_TOGGLE_KEYS = new Set(['tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

function fieldValue(state: LoginState, field: LoginField): string {
  return field === 'username' ? state.username : state.password;
}

function otherField(field: LoginField): LoginField {
  return field === 'username' ? 'password' : 'username';
}

function maxLenOf(field: LoginField): number {
  return field === 'username' ? L.maxUserLen : L.maxPassLen;
}

/** 写入字段并清掉上一次的错误文案（继续编辑即视为重试） */
function withField(state: LoginState, field: LoginField, value: string): LoginState {
  return field === 'username'
    ? { ...state, username: value, error: '' }
    : { ...state, password: value, error: '' };
}

/**
 * 直接置字段文本（软键盘 onInput 给的是**整串**而非增量，故需整体替换）；超长按上限截断。
 * 与 `applyKey` 同为纯函数。
 */
export function setFieldText(state: LoginState, field: LoginField, text: string): LoginState {
  const limit = maxLenOf(field);
  const value = String(text ?? '').slice(0, limit);
  return withField(state, field, value);
}

/**
 * 键盘事件归约（纯函数，不改入参，一律返回新对象）。
 *
 * token 约定（见 `keyTokenFromEvent`）：
 *  - **单字符** = 可见字符（按 `length` 追加，含中文/字母/数字/@/下划线等），受字段上限约束；
 *  - **多字符** = 键名（小写）：`backspace` 退格、`escape` 清空当前字段、
 *    `tab`/`arrow*` 切换焦点、`enter` 返回 submit 意图；其余键名（shift/ctrl/F1…）一律忽略。
 */
export function applyKey(state: LoginState, key: string): LoginKeyResult {
  if (key.length === 1) {
    const current = fieldValue(state, state.focus);
    if (current.length >= maxLenOf(state.focus)) return { state: { ...state } };
    return { state: withField(state, state.focus, current + key) };
  }

  if (key.length > 1) {
    const token = key.toLowerCase();
    if (token === 'backspace') {
      const current = fieldValue(state, state.focus);
      return { state: withField(state, state.focus, current.slice(0, -1)) };
    }
    if (token === 'escape') return { state: withField(state, state.focus, '') };
    if (FOCUS_TOGGLE_KEYS.has(token)) {
      return { state: { ...state, focus: otherField(state.focus) } };
    }
    if (token === 'enter') return { state: { ...state }, intent: 'submit' };
  }

  // 空 token / 不可见键名：无变化（不得当作字符插入）
  return { state: { ...state } };
}

/** 账号字符集：字母 / 数字 / 下划线 */
const USER_PATTERN = /^[A-Za-z0-9_]+$/;

/**
 * 登录表单校验（纯函数）：返回错误文案，合格返回 null。
 * 文案与 H5 表单标签口径一致（`Platform.showLoginForm` 的 label）。
 */
export function validateLogin(state: LoginState): string | null {
  const user = state.username;
  if (user.length === 0) return '账号不能为空';
  if (user.length < USER_MIN_LEN || user.length > L.maxUserLen) {
    return `账号需 ${USER_MIN_LEN}-${L.maxUserLen} 位字母/数字/下划线`;
  }
  if (!USER_PATTERN.test(user)) return '账号只能包含字母/数字/下划线';

  const pass = state.password;
  if (pass.length === 0) return '密码不能为空';
  if (pass.length < PASS_MIN_LEN || pass.length > L.maxPassLen) {
    return `密码需 ${PASS_MIN_LEN}-${L.maxPassLen} 位`;
  }
  return null;
}

export interface LoginRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 登录页各控件的屏幕坐标矩形（全部是舞台坐标，视图直接照此绘制） */
export interface LoginLayout {
  panel: LoginRect;
  contentWidth: number;
  title: LoginRect;
  userLabel: LoginRect;
  userBox: LoginRect;
  passLabel: LoginRect;
  passBox: LoginRect;
  button: LoginRect;
  error: LoginRect;
}

/**
 * 布局计算（纯函数）：面板居中，内部自上而下为 标题 / 账号(标签+框) / 密码(标签+框) / 按钮 / 错误行。
 * 全宽元素左右各留 `padX`；面板高度由内容累加得出，故不会与控件脱节。
 */
export function loginLayout(stageWidth: number, stageHeight: number): LoginLayout {
  const panelWidth = Math.min(
    L.panelMaxWidth,
    Math.max(L.panelWidthMin, stageWidth - L.panelMarginX * 2),
  );
  const contentWidth = panelWidth - L.padX * 2;
  const fieldBlockHeight = L.labelHeight + L.gapAfterLabel + L.inputHeight;
  const panelHeight =
    L.padY * 2 +
    L.titleHeight +
    L.gapAfterTitle +
    fieldBlockHeight * 2 +
    L.gapBetweenFields +
    L.gapBeforeButton +
    L.buttonHeight +
    L.gapBeforeError +
    L.errorHeight;

  const panelX = Math.round((stageWidth - panelWidth) / 2);
  const panelY = Math.round(Math.max(L.panelMarginY, (stageHeight - panelHeight) / 2));
  const contentX = panelX + L.padX;

  let y = panelY + L.padY;
  const title: LoginRect = { x: contentX, y, w: contentWidth, h: L.titleHeight };
  y += L.titleHeight + L.gapAfterTitle;

  const userLabel: LoginRect = { x: contentX, y, w: contentWidth, h: L.labelHeight };
  y += L.labelHeight + L.gapAfterLabel;
  const userBox: LoginRect = { x: contentX, y, w: contentWidth, h: L.inputHeight };
  y += L.inputHeight + L.gapBetweenFields;

  const passLabel: LoginRect = { x: contentX, y, w: contentWidth, h: L.labelHeight };
  y += L.labelHeight + L.gapAfterLabel;
  const passBox: LoginRect = { x: contentX, y, w: contentWidth, h: L.inputHeight };
  y += L.inputHeight + L.gapBeforeButton;

  const button: LoginRect = { x: contentX, y, w: contentWidth, h: L.buttonHeight };
  y += L.buttonHeight + L.gapBeforeError;

  const error: LoginRect = { x: contentX, y, w: contentWidth, h: L.errorHeight };

  return {
    panel: { x: panelX, y: panelY, w: panelWidth, h: panelHeight },
    contentWidth,
    title,
    userLabel,
    userBox,
    passLabel,
    passBox,
    button,
    error,
  };
}

/** 不可见命名键的 keyCode（各宿主一致，故优先于 `key` 字符串判定） */
const NAMED_KEY_BY_CODE: Record<number, string> = {
  8: 'backspace',
  9: 'tab',
  13: 'enter',
  27: 'escape',
  37: 'arrowleft',
  38: 'arrowup',
  39: 'arrowright',
  40: 'arrowdown',
};

/** 可见字符的 keyCode → [无 shift, 有 shift]（覆盖 US 布局里登录会用到的字符） */
const CHAR_BY_CODE: Record<number, [string, string]> = {
  32: [' ', ' '],
  59: [';', ':'],
  61: ['=', '+'],
  173: ['-', '_'],
  186: [';', ':'],
  187: ['=', '+'],
  188: [',', '<'],
  189: ['-', '_'],
  190: ['.', '>'],
  191: ['/', '?'],
  192: ['`', '~'],
  219: ['[', '{'],
  220: ['\\', '|'],
  221: [']', '}'],
  222: ["'", '"'],
};

/**
 * 键盘事件 → 归约 token（纯函数）。
 *
 * 为何不用 `key` 单一来源：Laya 各宿主下 `keyCode` 一致性更好，且 `key` 在部分宿主为空；
 * 但 `keyCode` 也可能缺失（为 0），此时才退回 `key`。
 * **不可见键（Shift/Ctrl/F1/未映射键）返回键名或 null，绝不当成可见字符**。
 */
export function keyTokenFromEvent(
  keyCode: number,
  key: string | null | undefined,
  shift: boolean,
): string | null {
  const code = Number(keyCode) || 0;

  // 字母 / 主键盘数字 / 小键盘数字：keyCode 与字符一一对应
  if (code >= 65 && code <= 90) {
    const upper = String.fromCharCode(code);
    return shift ? upper : upper.toLowerCase();
  }
  if (code >= 48 && code <= 57) {
    const pair = CHAR_BY_CODE[code];
    if (pair) return pair[shift ? 1 : 0];
    return String.fromCharCode(code);
  }
  if (code >= 96 && code <= 105) return String.fromCharCode(code - 48);

  const named = NAMED_KEY_BY_CODE[code];
  if (named) return named;

  const pair = CHAR_BY_CODE[code];
  if (pair) return pair[shift ? 1 : 0];

  const raw = typeof key === 'string' ? key : '';
  if (raw.length === 0) return null;
  // 单字符即可见字符；多字符只能是键名（如 Enter/Shift/F1），交给 applyKey 判定采纳或忽略
  return raw.length > 1 ? raw.toLowerCase() : raw;
}