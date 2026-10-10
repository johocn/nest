import { AppConfig } from '../config/AppConfig';
import { ChatPanel } from './ChatPanel';

/** 评分面板常量：与 QuizPanel 同风格集中在此 */
const SP = {
  /** 高于答题面板(10008)：评分展示是模态焦点，紧邻 QuizPanel 之上 */
  zOrder: 10009,
  margin: 12,
  panelWidth: 320,
  padX: 12,
  padY: 10,
  lineHeight: 20,
  groupGap: 6,
  /** 按钮行高（关闭）：对齐 QuizPanel.buttonHeight */
  buttonHeight: 44,
  fontSize: 14,
  titleFontSize: 15,
  bgColor: 'rgba(0,0,0,0.88)',
  borderColor: '#4a5568',
  borderWidth: 2,
  titleColor: '#ffd75e',
  lineColor: '#e6edf3',
  dimColor: '#8b949e',
  buttonBgColor: 'rgba(255,255,255,0.10)',
};

/** 评分面板行（纯文本行；button 行带命中区） */
interface ScoreRow {
  text: string;
  color: string;
  height: number;
  fontSize: number;
  button?: boolean;
  onClick?: () => void;
}

/**
 * 评分面板（引擎内自绘，禁 DOM；静态单例对齐 QuizPanel 惯例，不 import DialogueView 内部）。
 *
 * 展示服务端 DialogueView.score 下发的 visible 轴快照：每个 gameId 一组「label: value」纯文本行，
 * 组顺序与轴顺序均按服务端配置声明顺序（客户端不排序不推断）。无复杂交互：
 * 打开由 choose 响应的 `res.score` 触发（InteractController），Esc 或「关闭」行关闭。
 */
export class ScorePanel {
  private static root: Laya.Sprite | null = null;
  private static opened = false;
  private static score: Record<string, Array<{ id: string; label: string; value: number }>> = {};

  /** 必须在 Laya.init 之后调用；幂等 */
  static init(): void {
    if (typeof Laya === 'undefined' || !Laya.stage) return;
    if (ScorePanel.root) return;
    const root = new Laya.Sprite();
    root.name = 'score-panel';
    root.zOrder = SP.zOrder;
    // 不设 mouseEnabled / 不设 size：根节点不参与命中，行命中区作为子节点照常接收点击（照 QuizPanel）
    Laya.stage.addChild(root);
    ScorePanel.root = root;

    Laya.stage.on(Laya.Event.KEY_DOWN, ScorePanel, ScorePanel.onKeyDown);
    console.log(`[Score] ScorePanel 就绪：zOrder=${SP.zOrder}`);
  }

  static get isOpen(): boolean {
    return ScorePanel.opened;
  }

  /** 彻底销毁（照 QuizPanel 清理方式） */
  static destroy(): void {
    if (typeof Laya !== 'undefined' && Laya.stage) {
      Laya.stage.off(Laya.Event.KEY_DOWN, ScorePanel, ScorePanel.onKeyDown);
    }
    if (ScorePanel.root && ScorePanel.root.parent) {
      ScorePanel.root.parent.removeChild(ScorePanel.root);
    }
    ScorePanel.root = null;
    ScorePanel.opened = false;
    ScorePanel.score = {};
  }

  /** choose 响应的 score 快照入口（key=gameId → visible 轴数组，均为服务端权威数据） */
  static open(score: Record<string, Array<{ id: string; label: string; value: number }>>): void {
    ScorePanel.score = score ?? {};
    ScorePanel.opened = true;
    ScorePanel.rebuild();
  }

  static close(): void {
    ScorePanel.opened = false;
    ScorePanel.score = {};
    ScorePanel.root?.removeChildren();
  }

  // ── 交互 ───────────────────────────────────────────────────────────────

  private static onKeyDown(e: Laya.Event): void {
    if (ChatPanel.isOpen) return; // 聊天输入打开时忽略（防打字误触关闭）
    if (!ScorePanel.opened) return;
    const key = String((e as unknown as { key?: string }).key ?? '').toLowerCase();
    if (key === 'escape') ScorePanel.close();
  }

  // ── 渲染 ───────────────────────────────────────────────────────────────

  private static rows(): ScoreRow[] {
    const rows: ScoreRow[] = [];
    rows.push({ text: '评分', color: SP.titleColor, height: SP.lineHeight, fontSize: SP.titleFontSize });

    const gameIds = Object.keys(ScorePanel.score);
    if (gameIds.length === 0) {
      rows.push({ text: '（暂无可展示的评分轴）', color: SP.dimColor, height: SP.lineHeight, fontSize: SP.fontSize });
    }
    for (const gid of gameIds) {
      rows.push({ text: `【${gid}】`, color: SP.dimColor, height: SP.lineHeight + SP.groupGap, fontSize: SP.fontSize });
      for (const axis of ScorePanel.score[gid] ?? []) {
        rows.push({
          text: `${axis.label}: ${axis.value}`,
          color: SP.lineColor,
          height: SP.lineHeight,
          fontSize: SP.fontSize,
        });
      }
    }
    rows.push({
      text: '关闭',
      color: SP.lineColor,
      height: SP.buttonHeight,
      fontSize: SP.fontSize,
      button: true,
      onClick: () => ScorePanel.close(),
    });
    return rows;
  }

  private static rebuild(): void {
    const root = ScorePanel.root;
    if (!root || !ScorePanel.opened) return;
    root.removeChildren();

    const rows = ScorePanel.rows();
    let contentH = 0;
    for (const row of rows) contentH += row.height + (row.button ? 4 : 0);
    // 面板居中（对齐 QuizPanel 的焦点面板口径）
    const w = Math.min(SP.panelWidth, AppConfig.stageWidth - SP.margin * 2);
    const h = Math.min(contentH + SP.padY * 2, AppConfig.stageHeight - SP.margin * 2);
    const x = Math.round((AppConfig.stageWidth - w) / 2);
    const y = Math.round((AppConfig.stageHeight - h) / 2);

    const bg = new Laya.Sprite();
    bg.mouseEnabled = false;
    bg.graphics.drawRect(x, y, w, h, SP.bgColor);
    bg.graphics.drawRect(x, y, w, SP.borderWidth, SP.borderColor);
    root.addChild(bg);

    const contentX = x + SP.padX;
    const contentW = w - SP.padX * 2;
    let ry = y + SP.padY;
    for (const row of rows) {
      if (row.button) {
        const btnBg = new Laya.Sprite();
        btnBg.mouseEnabled = false;
        btnBg.graphics.drawRect(contentX, ry, contentW, row.height, SP.buttonBgColor);
        root.addChild(btnBg);
      }
      const textTop = row.button ? ry + Math.round((row.height - row.fontSize) / 2) : ry + 3;
      root.addChild(ScorePanel.makeText(row.text, contentX, textTop, row.fontSize, row.color));
      if (row.onClick) {
        // 命中区在视觉之后 addChild（引擎逆序命中）；按下即响应（对齐 QuizPanel）
        const hit = new Laya.Sprite();
        hit.name = 'score-hit';
        hit.pos(contentX, ry);
        hit.size(contentW, row.height);
        hit.mouseEnabled = true;
        hit.on(Laya.Event.MOUSE_DOWN, null, row.onClick);
        root.addChild(hit);
      }
      ry += row.height + (row.button ? 4 : 0);
    }
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
