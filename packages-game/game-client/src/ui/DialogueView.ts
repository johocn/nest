import { AppConfig } from '../config/AppConfig';
import type { DialogueQuestMarks, DialogueStepResult, NpcTalkResult } from '../net/api';

const D = AppConfig.dialogue;
const T = AppConfig.touch;

/**
 * S5 对话视图（**引擎内自绘，禁用 DOM**，小游戏端与 H5 行为一致）。
 *
 * 只用已验证基元：`Laya.Sprite` + `graphics.drawRect` + `Laya.Text`（与 S3 的 `Hud` 同一套路）。
 * 布局与文本换行是**可导出的纯函数**（`wrapText` / `layoutDialogue` / `mapDialogueError` /
 * `normalizeTalk` / `normalizeChoose`），measure 由调用方注入，故可被零依赖断言脚本直接 import；
 * 本类只负责把它们画到舞台顶层（屏幕空间，不随世界层滚动）。
 *
 * 硬约束：客户端不本地推进对话、不本地发奖励 —— 选项一律交回控制器走 `POST /world/dialogue/choose`。
 */

/** 单个可见选项：`index` 是**服务端原始下标**（choose 必须回传它，条件过滤后本地下标会错位） */
export interface DialogueOptionItem {
  index: number;
  text: string;
}

/** 客户端渲染用的对话节点视图（由 talk / choose 响应归一化而来） */
export interface DialogueNodeView {
  code: string;
  nodeKey: string | null;
  speaker?: string;
  text: string;
  options: DialogueOptionItem[];
  finished: boolean;
  /** 错误红字（服务端业务码映射后的中文文案）；无错误为 null */
  error?: string | null;
  /** D8：服务端权威下发的任务标记（仅 talk 返回；客户端不推断） */
  questMarks?: DialogueQuestMarks;
}

/**
 * 文本换行（纯函数）：按 maxWidth 贪心切行，`measure` 返回该串在当前字号下的像素宽度。
 * 保留显式 `\n`；空串返回单个空行。除「单字符本身宽于 maxWidth」的退化情形外，每行宽度 <= maxWidth。
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  const paragraphs = String(text ?? '').split('\n');
  for (const para of paragraphs) {
    if (para === '') {
      lines.push('');
      continue;
    }
    let line = '';
    for (const ch of para) {
      const candidate = line + ch;
      if (line !== '' && measure(candidate) > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** 错误码 → 中文文案（纯函数）：覆盖 S5 对话链路会碰到的业务码，未知码给通用兜底 */
const DIALOGUE_ERROR_TEXT: Record<number, string> = {
  20002: '道具不足',
  20007: '货币不足',
  40001: '任务前置条件不满足',
  40002: '任务已完成',
  40003: '已达接取上限',
  40004: '尚未接取该任务',
  43001: '对话不存在',
  43002: '条件不满足',
  43003: '对话数据异常',
};

export function mapDialogueError(code: number): string {
  return DIALOGUE_ERROR_TEXT[code] ?? `操作失败（code=${code}）`;
}

/** talk 响应 → 节点视图（`optionIndexes` 与本地列表一一对应，缺失时退化为本地下标） */
export function normalizeTalk(res: NpcTalkResult): DialogueNodeView {
  const options: DialogueOptionItem[] = (res.options ?? []).map((opt, i) => ({
    index: res.optionIndexes?.[i] ?? i,
    text: opt.text,
  }));
  return {
    code: res.code ?? '',
    nodeKey: res.nodeKey ?? null,
    speaker: res.name,
    text: res.text ?? '',
    options,
    finished: false,
    error: null,
    questMarks: res.questMarks,
  };
}

/** choose / story 响应 → 节点视图；`finished`（或空节点）视为对话结束 */
export function normalizeChoose(res: DialogueStepResult): DialogueNodeView {
  if (res.finished || !res.node) {
    return {
      code: res.code,
      nodeKey: null,
      text: '',
      options: [],
      finished: true,
      error: null,
    };
  }
  return {
    code: res.code,
    nodeKey: res.node.key,
    speaker: res.node.speaker,
    text: res.node.text ?? '',
    options: (res.node.options ?? []).map((opt) => ({ index: opt.index, text: opt.text })),
    finished: false,
    error: null,
  };
}

export interface DialogueRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 选项行：`index` 是服务端原始下标，`label` 含数字键序号（1. 2. …） */
export interface DialogueOptionRow extends DialogueRect {
  index: number;
  label: string;
  text: string;
}

export interface DialogueLayout {
  panel: DialogueRect;
  contentWidth: number;
  speaker: { text: string; x: number; y: number } | null;
  lines: string[];
  bodyX: number;
  bodyY: number;
  lineHeight: number;
  options: DialogueOptionRow[];
  error: { text: string; x: number; y: number } | null;
  finished: boolean;
}

export interface DialogueLayoutInput {
  view: DialogueNodeView;
  stageWidth: number;
  stageHeight: number;
  /** 文本测量：返回该串在给定字号下的像素宽度（注入以便断言脚本零引擎测试） */
  measure: (text: string, fontSize: number) => number;
}

/** 布局计算（纯函数）：底部对话框面板 + 说话人 + 自动换行的正文 + 选项行 + 错误行 */
export function layoutDialogue(input: DialogueLayoutInput): DialogueLayout {
  const { view, stageWidth, stageHeight, measure } = input;

  const panelWidth = Math.min(D.panelMaxWidth, Math.max(160, stageWidth - D.panelMarginX * 2));
  const contentWidth = panelWidth - D.padX * 2;
  const lines = wrapText(view.text ?? '', contentWidth, (s) => measure(s, D.bodyFontSize));
  const optionCount = Math.min(view.options?.length ?? 0, D.maxOptions);

  let contentHeight = 0;
  if (view.speaker) contentHeight += D.speakerFontSize + D.gapAfterSpeaker;
  contentHeight += lines.length * D.bodyLineHeight;
  if (optionCount > 0) {
    contentHeight +=
      D.gapBeforeOptions + optionCount * D.optionHeight + (optionCount - 1) * D.optionGap;
  }
  if (view.error) contentHeight += D.gapBeforeOptions + D.errorFontSize;

  const panelHeight = contentHeight + D.padY * 2;
  const panelX = Math.round((stageWidth - panelWidth) / 2);
  const panelY = Math.round(stageHeight - D.panelBottomOffset - panelHeight);
  const contentX = panelX + D.padX;

  let cursorY = panelY + D.padY;

  let speaker: DialogueLayout['speaker'] = null;
  if (view.speaker) {
    speaker = { text: view.speaker, x: contentX, y: cursorY };
    cursorY += D.speakerFontSize + D.gapAfterSpeaker;
  }

  const bodyY = cursorY;
  cursorY += lines.length * D.bodyLineHeight;

  const options: DialogueOptionRow[] = [];
  if (optionCount > 0) {
    cursorY += D.gapBeforeOptions;
    for (let i = 0; i < optionCount; i++) {
      const opt = view.options[i];
      options.push({
        index: opt.index,
        label: `${i + 1}. ${opt.text}`,
        text: opt.text,
        x: contentX,
        y: cursorY,
        width: contentWidth,
        height: D.optionHeight,
      });
      cursorY += D.optionHeight + D.optionGap;
    }
  }

  let error: DialogueLayout['error'] = null;
  if (view.error) {
    cursorY += D.gapBeforeOptions;
    error = { text: view.error, x: contentX, y: cursorY };
  }

  return {
    panel: { x: panelX, y: panelY, width: panelWidth, height: panelHeight },
    contentWidth,
    speaker,
    lines,
    bodyX: contentX,
    bodyY,
    lineHeight: D.bodyLineHeight,
    options,
    error,
    finished: view.finished === true,
  };
}

/** 选择回调：参数是**服务端原始下标**（上层据此调 choose） */
export type DialogueChooseHandler = (optionIndex: number) => void;

/**
 * 对话框（屏幕空间自绘）。与 `Hud` 一致：静态单例、挂 `Laya.stage` 顶层并设较大 zOrder。
 *
 * **指针不设遮罩（S9 修复）**：根节点**不设尺寸、不显式改 `mouseEnabled`**，故它自身永远不是命中目标，
 * 触摸会穿透到下层（触控方向键）；只有选项按钮（子节点，显式 `mouseEnabled=true`）吃点击。
 * 理由：Laya 命中检测里，根节点一旦「有 bounds + 显式 mouseEnabled=true」就会成为最上层命中目标，
 * 把整个舞台的指针吃掉（`ui/TouchControls` zOrder 9998 在其下 → 按住方向键完全无反应），
 * 于是出现「对话打开时键盘能走、触控走不了」的不一致。现在键盘 W/A/S/D 与触控方向键行为一致：
 * **都能走**；交互键 F 与触控「交互」按钮由 `InteractController.triggerInteract` 统一屏蔽，避免连点重复请求。
 * **选项行为什么在手机上点不动（S9 第二轮修复）**：与 S6 建造面板同源 ——
 *  1. 选项行带 `D.optionHeight=22` 舞台像素，`SCALE_SHOWALL` 缩到手机宽度（390 CSS px 时缩放比仅 ~0.41）
 *     后只有 **9 CSS px 高**，手指落点误差普遍 >4 CSS px；→ 命中区撑到 `touch.minHitHeight`（视觉不变）。
 *     注意相邻选项都是可点行，物理上无法各自到 44，故只能各吃到行距（`optionGap=4`）的一半（22→26）。
 *  2. 原来绑 `CLICK`：引擎 `clickTestThreshold=10`（舞台像素 ≈ 手机 4 CSS px），真机手指轻滚即不派发。
 *     → 改 `MOUSE_DOWN`（按下即响应，与触控层交互按钮同口径）。
 */
export class DialogueView {
  private static root: Laya.Sprite | null = null;
  private static view: DialogueNodeView | null = null;
  private static onChoose: DialogueChooseHandler | null = null;
  private static opened = false;
  /** 共享的测量用 Text（挂在舞台上但不可见/不可点），供 wrapText 的 measure 注入 */
  private static measureText: Laya.Text | null = null;

  /** 必须在 Laya.init 之后调用；重复调用无副作用 */
  static init(): void {
    if (DialogueView.root) return;

    const root = new Laya.Sprite();
    root.name = 's5-dialogue';
    root.zOrder = D.zOrder;
    // 不设 mouseEnabled / 不设 size：根节点自身不参与命中（否则会吃掉舞台上的触摸），
    // 选项按钮作为子节点照常接收点击。详见类注释「指针不设遮罩」。
    Laya.stage.addChild(root);
    DialogueView.root = root;

    const measure = new Laya.Text();
    measure.visible = false;
    measure.mouseEnabled = false;
    Laya.stage.addChild(measure);
    DialogueView.measureText = measure;

    // ESC 关闭 / 数字键 1-9 选择（打开时才生效）
    Laya.stage.on(Laya.Event.KEY_DOWN, DialogueView, DialogueView.onKeyDown);
    console.log(`[S5] DialogueView 就绪：zOrder=${D.zOrder}（引擎内自绘，无 DOM）`);
  }

  static get isOpen(): boolean {
    return DialogueView.opened;
  }

  /** 打开并渲染首节点；`onChoose` 之后可省略（同一会话沿用上一次的回调） */
  static open(view: DialogueNodeView, onChoose?: DialogueChooseHandler): void {
    if (!DialogueView.root) {
      console.log('[S5] DialogueView 未初始化，跳过打开');
      return;
    }
    DialogueView.view = view;
    if (onChoose) DialogueView.onChoose = onChoose;
    DialogueView.opened = true;
    DialogueView.rebuild();
  }

  /** 渲染下一节点（服务端 choose 成功后的返回值） */
  static render(view: DialogueNodeView): void {
    if (!DialogueView.opened) return;
    DialogueView.view = view;
    DialogueView.rebuild();
  }

  /** 服务端业务码 → 面板内错误红字（不关闭视图，玩家可清包后重选） */
  static showError(code: number, msg?: string): void {
    if (!DialogueView.opened || !DialogueView.view) return;
    DialogueView.view.error = mapDialogueError(code);
    if (msg) console.warn(`[S5] 对话错误 code=${code} msg=${msg}`);
    DialogueView.rebuild();
  }

  static close(): void {
    DialogueView.opened = false;
    DialogueView.view = null;
    DialogueView.onChoose = null;
    if (!DialogueView.root) return;
    DialogueView.root.removeChildren();
  }

  /** 选项被选中（数字键或点击）：把服务端原始下标交回控制器 */
  private static select(optionIndex: number): void {
    if (DialogueView.onChoose) DialogueView.onChoose(optionIndex);
  }

  private static onKeyDown(e: Laya.Event): void {
    if (!DialogueView.opened) return;
    const key = String((e as unknown as { key?: string }).key ?? '').toLowerCase();
    if (key === 'escape') {
      DialogueView.close();
      return;
    }
    const n = Number(key);
    if (!Number.isInteger(n) || n < 1 || n > D.maxOptions) return;
    const opt = DialogueView.view?.options[n - 1];
    if (opt) DialogueView.select(opt.index);
  }

  /** 按布局纯函数的结果重建显示节点（对话渲染频率低，直接重建最简单） */
  private static rebuild(): void {
    const root = DialogueView.root;
    const view = DialogueView.view;
    if (!root || !view) return;
    root.removeChildren();

    const layout = layoutDialogue({
      view,
      stageWidth: AppConfig.stageWidth,
      stageHeight: AppConfig.stageHeight,
      measure: (text, fontSize) => DialogueView.measure(text, fontSize),
    });

    const panel = new Laya.Sprite();
    panel.mouseEnabled = false;
    panel.graphics.drawRect(
      layout.panel.x,
      layout.panel.y,
      layout.panel.width,
      layout.panel.height,
      D.panelBgColor,
    );
    panel.graphics.drawRect(
      layout.panel.x,
      layout.panel.y,
      layout.panel.width,
      D.panelBorderWidth,
      D.panelBorderColor,
    );
    root.addChild(panel);

    if (layout.speaker) {
      root.addChild(
        DialogueView.makeText(
          layout.speaker.text,
          layout.speaker.x,
          layout.speaker.y,
          D.speakerFontSize,
          D.speakerColor,
        ),
      );
    }
    root.addChild(
      DialogueView.makeText(
        layout.lines.join('\n'),
        layout.bodyX,
        layout.bodyY,
        D.bodyFontSize,
        D.bodyColor,
      ),
    );

    for (let i = 0; i < layout.options.length; i++) {
      const row = layout.options[i];
      const prev = layout.options[i - 1];
      const next = layout.options[i + 1];
      // 命中区（**视觉不变**）：以行带为中心向上下扩到 touch.minHitHeight，边界夹在相邻选项行的分界
      // 中点（首/末行不再向外扩，避免把正文区/错误行也变成选项）。相邻行都可点 → 只能各吃半个行距。
      const half = T.minHitHeight / 2;
      const center = row.y + row.height / 2;
      const topBound = prev ? (prev.y + prev.height + row.y) / 2 : row.y;
      const bottomBound = next ? (row.y + row.height + next.y) / 2 : row.y + row.height;
      const top = Math.max(topBound, center - half);
      const bottom = Math.min(bottomBound, center + half);

      const button = new Laya.Sprite();
      button.pos(row.x, top);
      button.size(row.width, bottom - top);
      button.mouseEnabled = true;
      // 底色与文字仍画在行带上（`row.y - top` 是命中区比行带多出来的上边距）→ 视觉零变化
      button.graphics.drawRect(0, row.y - top, row.width, row.height, D.optionBgColor);
      button.addChild(
        DialogueView.makeText(
          row.label,
          D.optionPadX,
          row.y - top + Math.round((row.height - D.optionFontSize) / 2),
          D.optionFontSize,
          D.optionColor,
        ),
      );
      // MOUSE_DOWN 而非 CLICK：CLICK 要求按下→抬起位移小于 clickTestThreshold（10 舞台像素 ≈ 手机 4 CSS px），
      // 真机手指轻滚就把它判掉（详见类注释）。
      button.on(Laya.Event.MOUSE_DOWN, null, () => DialogueView.select(row.index));
      root.addChild(button);
    }

    if (layout.error) {
      root.addChild(
        DialogueView.makeText(
          layout.error.text,
          layout.error.x,
          layout.error.y,
          D.errorFontSize,
          D.errorColor,
        ),
      );
    }
  }

  private static makeText(
    content: string,
    x: number,
    y: number,
    fontSize: number,
    color: string,
  ): Laya.Text {
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

  /** 单串宽度测量（wrapText 的 measure 注入口） */
  private static measure(content: string, fontSize: number): number {
    const text = DialogueView.measureText ?? (DialogueView.measureText = new Laya.Text());
    text.fontSize = fontSize;
    text.text = content;
    return text.textWidth;
  }
}