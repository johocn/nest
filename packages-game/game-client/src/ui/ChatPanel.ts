import { AppConfig } from '../config/AppConfig';
import { Platform } from '../platform/Platform';
import { keyTokenFromEvent } from './login-logic';
import { Toast } from './Toast';
import type { ChatMessageView } from '../net/chat';

/** 聊天 UI 常量：与 hud/dialogue 同风格集中在此（仅本面板使用，不进 AppConfig） */
const CHAT = {
  /** 消息条 zOrder：高于 Hud(9999)，低于登录页(10002)/性能面板(10003) */
  zOrder: 10004,
  margin: 12,
  barWidth: 460,
  padX: 8,
  padY: 6,
  maxLines: 3,
  lineHeight: 18,
  fontSize: 12,
  maxLineChars: 44,
  maxMessages: 50,
  bgColor: 'rgba(0,0,0,0.55)',
  textColor: '#e6edf3',
  hintColor: '#8b949e',
  hintText: '[聊天] 按 Enter 输入，Esc 取消',
  inputHeight: 26,
  inputGap: 4,
  inputFontSize: 14,
  inputBgColor: 'rgba(0,0,0,0.75)',
  inputBorderColor: '#2f81f7',
  inputBorderWidth: 1,
  maxInputLen: 120,
};

export interface ChatRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChatLayout {
  bar: ChatRect;
  input: ChatRect;
}

/** 布局计算（纯函数）：消息条贴底部左侧，输入框悬在消息条上方 */
export function layoutChatBar(stageWidth: number, stageHeight: number): ChatLayout {
  const barH = CHAT.padY * 2 + CHAT.maxLines * CHAT.lineHeight;
  const bar: ChatRect = {
    x: CHAT.margin,
    y: stageHeight - CHAT.margin - barH,
    w: Math.min(CHAT.barWidth, stageWidth - CHAT.margin * 2),
    h: barH,
  };
  const input: ChatRect = {
    x: bar.x,
    y: bar.y - CHAT.inputHeight - CHAT.inputGap,
    w: bar.w,
    h: CHAT.inputHeight,
  };
  return { bar, input };
}

/** 消息条单行文案（纯函数）：`senderName: content` */
export function formatChatLine(m: ChatMessageView): string {
  const name = String(m.senderName ?? '').trim() || '匿名';
  return `${name}: ${String(m.content ?? '')}`;
}

/** 超长行截断（纯函数） */
export function clipChatLine(line: string, maxChars: number): string {
  return line.length > maxChars ? `${line.slice(0, maxChars)}…` : line;
}

/** 输入框按键归约（纯函数）：token 约定与 login-logic 一致（单字符=可见字符，多字符=键名） */
export function applyChatInputKey(
  text: string,
  token: string | null,
  maxLen: number,
): { text: string; intent: 'send' | 'close' | null } {
  if (!token) return { text, intent: null };
  if (token === 'enter') return { text, intent: 'send' };
  if (token === 'escape') return { text, intent: 'close' };
  if (token === 'backspace') return { text: text.slice(0, -1), intent: null };
  if (token.length === 1) {
    return text.length >= maxLen ? { text, intent: null } : { text: text + token, intent: null };
  }
  return { text, intent: null };
}

/**
 * 聊天面板（引擎内自绘，禁 DOM）：底部左侧最近 3 条 world 消息条（只读、无命中区、触摸穿透），
 * Enter 开关输入框，Enter 发送（空串忽略）、Esc 关闭；输入打开时由 PlayerControl 屏蔽移动键。
 *
 * 小游戏端本期**只展示消息条、不提供输入**：软键盘（wx.showKeyboard）接入成本高，且 KEY_DOWN
 * 字符捕获在原生壳内不可靠，留待后续照 LoginView 双源方案补齐（init 里已做平台分支并 console 提示）。
 */
export class ChatPanel {
  private static root: Laya.Sprite | null = null;
  private static messages: ChatMessageView[] = [];
  private static inputOpen = false;
  private static inputText = '';
  private static onSend: ((content: string) => Promise<void>) | null = null;
  private static inputEnabled = true;

  /** 必须在 Laya.init 之后调用；幂等（重复调用只更新发送回调） */
  static init(onSend?: (content: string) => Promise<void>): void {
    if (typeof Laya === 'undefined' || !Laya.stage) return;
    ChatPanel.onSend = onSend ?? null;
    if (ChatPanel.root) return;

    const root = new Laya.Sprite();
    root.name = 'chat-panel';
    root.zOrder = CHAT.zOrder;
    // 不设 mouseEnabled / 不设 size：根节点与消息条都不参与命中，触摸穿透到下层操作区
    Laya.stage.addChild(root);
    ChatPanel.root = root;

    if (Platform.isMiniGame()) {
      ChatPanel.inputEnabled = false;
      console.log('[Chat] 小游戏端：仅展示消息条，输入待接入 wx.showKeyboard（双源方案）');
      return;
    }
    Laya.stage.on(Laya.Event.KEY_DOWN, ChatPanel, ChatPanel.onKeyDown);
    ChatPanel.rebuild();
    console.log(`[Chat] ChatPanel 就绪：zOrder=${CHAT.zOrder}（Enter 开关输入，Esc 关闭）`);
  }

  /** 输入框是否打开（PlayerControl 据此忽略移动键） */
  static get isOpen(): boolean {
    return ChatPanel.inputOpen;
  }

  /** 新消息入缓冲并重绘；本期消息条只展示 world 频道 */
  static push(m: ChatMessageView): void {
    if (m.channel !== 'world') return;
    ChatPanel.messages.push(m);
    if (ChatPanel.messages.length > CHAT.maxMessages) {
      ChatPanel.messages.splice(0, ChatPanel.messages.length - CHAT.maxMessages);
    }
    ChatPanel.rebuild();
  }

  /** 彻底销毁（照 BuildPanel/DialogueView 清理方式）：注销 KEY_DOWN、移除 root、清状态 */
  static destroy(): void {
    ChatPanel.inputOpen = false;
    ChatPanel.inputText = '';
    ChatPanel.messages = [];
    ChatPanel.onSend = null;
    ChatPanel.inputEnabled = true;
    if (typeof Laya === 'undefined' || !Laya.stage) {
      ChatPanel.root = null;
      return;
    }
    Laya.stage.off(Laya.Event.KEY_DOWN, ChatPanel, ChatPanel.onKeyDown);
    if (ChatPanel.root && ChatPanel.root.parent) {
      ChatPanel.root.parent.removeChild(ChatPanel.root);
    }
    ChatPanel.root = null;
  }

  private static onKeyDown(e: Laya.Event): void {
    if (ChatPanel.inputOpen) {
      const ev = e as unknown as { keyCode?: number; key?: string; shiftKey?: boolean };
      const token = keyTokenFromEvent(ev.keyCode ?? 0, ev.key ?? null, ev.shiftKey === true);
      const res = applyChatInputKey(ChatPanel.inputText, token, CHAT.maxInputLen);
      ChatPanel.inputText = res.text;
      if (res.intent === 'close') {
        ChatPanel.closeInput();
        return;
      }
      if (res.intent === 'send') {
        ChatPanel.submit();
        return;
      }
      ChatPanel.rebuild();
      return;
    }
    const key = String((e as unknown as { key?: string }).key ?? '').toLowerCase();
    if (key === 'enter') {
      ChatPanel.inputOpen = true;
      ChatPanel.inputText = '';
      ChatPanel.rebuild();
    }
  }

  private static closeInput(): void {
    ChatPanel.inputOpen = false;
    ChatPanel.inputText = '';
    ChatPanel.rebuild();
  }

  /** Enter 发送：空串忽略；输入框随即关闭，发送失败走 Toast */
  private static submit(): void {
    const content = ChatPanel.inputText.trim();
    if (!content) return;
    const send = ChatPanel.onSend;
    ChatPanel.closeInput();
    if (!send) {
      console.warn('[Chat] onSend 未接线，消息未发送');
      return;
    }
    void send(content).catch((err: unknown) =>
      Toast.error(err instanceof Error ? err.message : String(err)),
    );
  }

  private static rebuild(): void {
    const root = ChatPanel.root;
    if (!root) return;
    root.removeChildren();

    const layout = layoutChatBar(AppConfig.stageWidth, AppConfig.stageHeight);
    const recent = ChatPanel.messages.slice(-CHAT.maxLines);
    const lines =
      recent.length > 0
        ? recent.map((m) => clipChatLine(formatChatLine(m), CHAT.maxLineChars))
        : [CHAT.hintText];

    const bar = new Laya.Sprite();
    bar.mouseEnabled = false;
    bar.graphics.drawRect(layout.bar.x, layout.bar.y, layout.bar.w, layout.bar.h, CHAT.bgColor);
    root.addChild(bar);
    for (let i = 0; i < lines.length; i++) {
      root.addChild(
        ChatPanel.makeText(
          lines[i],
          layout.bar.x + CHAT.padX,
          layout.bar.y + CHAT.padY + i * CHAT.lineHeight,
          CHAT.fontSize,
          recent.length > 0 ? CHAT.textColor : CHAT.hintColor,
        ),
      );
    }

    if (!ChatPanel.inputOpen) return;
    const input = new Laya.Sprite();
    input.mouseEnabled = false;
    input.graphics.drawRect(
      layout.input.x,
      layout.input.y,
      layout.input.w,
      layout.input.h,
      CHAT.inputBgColor,
    );
    input.graphics.drawRect(
      layout.input.x,
      layout.input.y,
      layout.input.w,
      layout.input.h,
      null,
      CHAT.inputBorderColor,
      CHAT.inputBorderWidth,
    );
    root.addChild(input);
    root.addChild(
      ChatPanel.makeText(
        `${ChatPanel.inputText}|`,
        layout.input.x + CHAT.padX,
        layout.input.y + Math.round((layout.input.h - CHAT.inputFontSize) / 2),
        CHAT.inputFontSize,
        CHAT.textColor,
      ),
    );
  }

  private static makeText(content: string, x: number, y: number, fontSize: number, color: string): Laya.Text {
    const text = new Laya.Text();
    text.text = content;
    text.fontSize = fontSize;
    text.color = color;
    text.stroke = 2;
    text.strokeColor = '#000000';
    text.mouseEnabled = false;
    text.pos(x, y);
    return text;
  }
}
