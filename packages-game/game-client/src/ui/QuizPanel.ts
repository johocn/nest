import { AppConfig } from '../config/AppConfig';
import { Api } from '../net/api';
import type { DialogueQuizHandout, SanitizedQuizQuestion } from '../net/api';
import { ChatPanel } from './ChatPanel';
import { Toast } from './Toast';

/** 答题面板常量：与 MailPanel 同风格集中在此 */
const QP = {
  /** 高于邮件(10007)：答题是模态焦点，盖过对话(10000)/建造(10001)/邮件(10007) */
  zOrder: 10008,
  margin: 12,
  panelWidth: 448,
  padX: 12,
  padY: 10,
  lineHeight: 20,
  /** 选项行带高度：对齐 dialogue.optionHeight（触控可点，44 ≈ 18 CSS px） */
  optionHeight: 44,
  /** 按钮行高（提交/下一题/关闭/重试）：对齐 build.buttonHeight */
  buttonHeight: 44,
  fontSize: 14,
  titleFontSize: 15,
  bgColor: 'rgba(0,0,0,0.88)',
  borderColor: '#4a5568',
  borderWidth: 2,
  titleColor: '#ffd75e',
  lineColor: '#e6edf3',
  dimColor: '#8b949e',
  optionColor: '#8ecdf7',
  optionBgColor: 'rgba(255,255,255,0.06)',
  pickedBgColor: 'rgba(47,129,247,0.35)',
  answerBgColor: 'rgba(63,185,80,0.25)',
  buttonBgColor: 'rgba(255,255,255,0.10)',
  okColor: '#3fb950',
  warnColor: '#ff7b72',
  rewardColor: '#ffd75e',
};

interface QuizRow {
  text: string;
  color: string;
  /** 行高（题干多行时为行数 × lineHeight） */
  height: number;
  fontSize: number;
  bg?: string;
  button?: boolean;
  onClick?: () => void;
}

function plain(text: string, color: string): QuizRow {
  return { text, color, height: QP.lineHeight, fontSize: QP.fontSize };
}

function btn(text: string, onClick: () => void): QuizRow {
  return {
    text,
    color: QP.lineColor,
    height: QP.buttonHeight,
    fontSize: QP.fontSize,
    button: true,
    onClick,
  };
}

/**
 * 答题面板（引擎内自绘，禁 DOM；静态单例对齐 MailPanel 惯例，不 import DialogueView 内部）。
 *
 * 两种模式：
 * - 知识问答：`openDraw`（自助抽题，调 quizDraw）或对话 quiz handout 进入 →
 *   选项作答 → quizSubmit → 对/错 + 正确答案 + 解析 + 奖励反馈 → 「下一题 / 关闭」；
 * - 测评：对话 assess handout 进入（sessionId + 当前题）→ assessmentAnswer →
 *   finished=false 直接换下一题 / finished=true 渲染结果页 title + content。
 *
 * 交互：单选点击即提交；多选（multiSelect）点选高亮、可反选，「提交答案」行统一提交。
 * 命中模型对齐 MailPanel（行命中区子节点 MOUSE_DOWN）；选项行带 44 对齐触控口径。
 * 错误处理对齐 MailPanel：抽题失败红字 + 重试（面板内），提交失败 Toast（保留作答状态可重试）。
 */
export class QuizPanel {
  private static root: Laya.Sprite | null = null;
  private static opened = false;
  private static token = '';
  private static mode: 'knowledge' | 'assessment' = 'knowledge';
  /** 知识模式题目队列与游标 */
  private static questions: SanitizedQuizQuestion[] = [];
  private static qIndex = 0;
  /** 测评模式会话 id */
  private static sessionId = '';
  private static question: SanitizedQuizQuestion | null = null;
  /** 多选已选下标 */
  private static picked: number[] = [];
  /** 提交后的反馈行（构造时已定色并换行）；非空时选项锁定 */
  private static feedback: QuizRow[] | null = null;
  /** 提交后保存的正确答案下标（知识模式答错时高亮正确项） */
  private static answerIdxs: number[] = [];
  /** 测评已完成（结果页：只显示反馈行 + 关闭） */
  private static resultDone = false;
  private static busy = false;
  private static loading = false;
  private static loadError = '';
  /** 共享测量用 Text（wrap 换行的 measure 注入），挂在舞台但不可见 */
  private static measureText: Laya.Text | null = null;

  /** 必须在 Laya.init 之后调用；幂等 */
  static init(): void {
    if (typeof Laya === 'undefined' || !Laya.stage) return;
    if (QuizPanel.root) return;
    const root = new Laya.Sprite();
    root.name = 'quiz-panel';
    root.zOrder = QP.zOrder;
    // 不设 mouseEnabled / 不设 size：根节点不参与命中，行命中区作为子节点照常接收点击（照 MailPanel）
    Laya.stage.addChild(root);
    QuizPanel.root = root;

    const measure = new Laya.Text();
    measure.visible = false;
    measure.mouseEnabled = false;
    Laya.stage.addChild(measure);
    QuizPanel.measureText = measure;

    Laya.stage.on(Laya.Event.KEY_DOWN, QuizPanel, QuizPanel.onKeyDown);
    console.log(`[Quiz] QuizPanel 就绪：zOrder=${QP.zOrder}`);
  }

  static get isOpen(): boolean {
    return QuizPanel.opened;
  }

  /** 彻底销毁（照 MailPanel 清理方式） */
  static destroy(): void {
    if (typeof Laya !== 'undefined' && Laya.stage) {
      Laya.stage.off(Laya.Event.KEY_DOWN, QuizPanel, QuizPanel.onKeyDown);
      if (QuizPanel.measureText && QuizPanel.measureText.parent) {
        QuizPanel.measureText.parent.removeChild(QuizPanel.measureText);
      }
    }
    if (QuizPanel.root && QuizPanel.root.parent) {
      QuizPanel.root.parent.removeChild(QuizPanel.root);
    }
    QuizPanel.root = null;
    QuizPanel.measureText = null;
    QuizPanel.opened = false;
    QuizPanel.token = '';
    QuizPanel.questions = [];
    QuizPanel.qIndex = 0;
    QuizPanel.sessionId = '';
    QuizPanel.question = null;
    QuizPanel.picked = [];
    QuizPanel.feedback = null;
    QuizPanel.answerIdxs = [];
    QuizPanel.resultDone = false;
    QuizPanel.busy = false;
    QuizPanel.loading = false;
    QuizPanel.loadError = '';
  }

  // ── 打开入口 ──────────────────────────────────────────────────────────

  /** 知识问答自助入口：抽题（quizDraw）后进入第 1 题 */
  static openDraw(token: string): void {
    QuizPanel.token = token;
    QuizPanel.mode = 'knowledge';
    QuizPanel.questions = [];
    QuizPanel.qIndex = 0;
    QuizPanel.sessionId = '';
    QuizPanel.question = null;
    QuizPanel.picked = [];
    QuizPanel.feedback = null;
    QuizPanel.answerIdxs = [];
    QuizPanel.resultDone = false;
    QuizPanel.loadError = '';
    QuizPanel.opened = true;
    void QuizPanel.refreshDraw();
  }

  /** 对话 choose 响应的 quiz handout 入口（推进与 finished 结束分支都会走到） */
  static openFromHandout(handout: DialogueQuizHandout, token: string): void {
    QuizPanel.token = token;
    QuizPanel.mode = handout.kind === 'assessment' ? 'assessment' : 'knowledge';
    if (handout.kind === 'assessment') {
      QuizPanel.sessionId = handout.sessionId;
      QuizPanel.question = handout.question ?? null;
      QuizPanel.questions = [];
      QuizPanel.qIndex = 0;
    } else {
      QuizPanel.questions = handout.questions ?? [];
      QuizPanel.qIndex = 0;
      QuizPanel.question = QuizPanel.questions[0] ?? null;
      QuizPanel.sessionId = '';
    }
    QuizPanel.picked = [];
    QuizPanel.feedback = null;
    QuizPanel.answerIdxs = [];
    QuizPanel.resultDone = false;
    QuizPanel.loadError = '';
    QuizPanel.opened = true;
    QuizPanel.rebuild();
  }

  static close(): void {
    QuizPanel.opened = false;
    QuizPanel.questions = [];
    QuizPanel.qIndex = 0;
    QuizPanel.sessionId = '';
    QuizPanel.question = null;
    QuizPanel.picked = [];
    QuizPanel.feedback = null;
    QuizPanel.answerIdxs = [];
    QuizPanel.resultDone = false;
    QuizPanel.loadError = '';
    QuizPanel.root?.removeChildren();
  }

  // ── 交互 ───────────────────────────────────────────────────────────────

  private static onKeyDown(e: Laya.Event): void {
    if (ChatPanel.isOpen) return; // 聊天输入打开时忽略（防打字误触关闭）
    if (!QuizPanel.opened) return;
    const key = String((e as unknown as { key?: string }).key ?? '').toLowerCase();
    if (key === 'escape') QuizPanel.close();
  }

  /** 抽题并重绘（openDraw 与失败重试共用；对齐 MailPanel.refresh） */
  private static async refreshDraw(): Promise<void> {
    if (QuizPanel.loading) return;
    QuizPanel.loading = true;
    QuizPanel.loadError = '';
    QuizPanel.rebuild();
    try {
      const r = await Api.quizDraw({}, QuizPanel.token);
      QuizPanel.questions = r.questions ?? [];
      QuizPanel.qIndex = 0;
      QuizPanel.question = QuizPanel.questions[0] ?? null;
    } catch (err) {
      QuizPanel.loadError = err instanceof Error ? err.message : String(err);
    } finally {
      QuizPanel.loading = false;
      QuizPanel.rebuild();
    }
  }

  /** 选项行被点：单选直接提交；多选切换高亮（提交走「提交答案」行） */
  private static onOptionClick(idx: number): void {
    const q = QuizPanel.question;
    if (!q || QuizPanel.feedback) return;
    if (!q.multiSelect) {
      void QuizPanel.doSubmit([idx]);
      return;
    }
    const at = QuizPanel.picked.indexOf(idx);
    if (at >= 0) QuizPanel.picked.splice(at, 1);
    else QuizPanel.picked.push(idx);
    QuizPanel.rebuild();
  }

  private static onSubmitClick(): void {
    if (QuizPanel.picked.length === 0) {
      Toast.info('请先选择选项');
      return;
    }
    void QuizPanel.doSubmit([...QuizPanel.picked]);
  }

  /** 提交作答：知识模式 → quizSubmit；测评模式 → assessmentAnswer（对齐 MailPanel.doClaim：失败 Toast 不丢状态） */
  private static async doSubmit(selected: number[]): Promise<void> {
    if (QuizPanel.busy || !QuizPanel.question) return;
    const q = QuizPanel.question;
    QuizPanel.busy = true;
    try {
      if (QuizPanel.mode === 'knowledge') {
        const r = await Api.quizSubmit({ questionId: q.id, selected }, QuizPanel.token);
        QuizPanel.answerIdxs = r.answerIndexes ?? [];
        const lines: QuizRow[] = [
          {
            text: r.correct
              ? '回答正确'
              : `回答错误（正确答案：${QuizPanel.answerIdxs.map((i) => i + 1).join('、') || '无'}）`,
            color: r.correct ? QP.okColor : QP.warnColor,
            height: QP.lineHeight,
            fontSize: QP.fontSize,
          },
        ];
        if (r.explain) {
          for (const seg of QuizPanel.wrap(`解析：${r.explain}`, QuizPanel.contentWidth(), QP.fontSize)) {
            lines.push(plain(seg, QP.dimColor));
          }
        }
        if (r.reward) {
          lines.push(plain(`奖励：${r.reward.currencyType} ×${r.reward.amount}`, QP.rewardColor));
        }
        QuizPanel.feedback = lines;
      } else {
        const r = await Api.assessmentAnswer(
          QuizPanel.sessionId,
          { questionId: q.id, selected },
          QuizPanel.token,
        );
        // 用 `in` 而非 r.finished 窄化：strictNullChecks 关闭时 boolean 判别式的窄化不可靠
        if ('question' in r) {
          QuizPanel.question = r.question;
          QuizPanel.picked = [];
          QuizPanel.feedback = null;
        } else {
          QuizPanel.resultDone = true;
          const lines: QuizRow[] = [
            { text: r.result.title, color: QP.titleColor, height: QP.lineHeight, fontSize: QP.titleFontSize },
          ];
          for (const seg of QuizPanel.wrap(r.result.content ?? '', QuizPanel.contentWidth(), QP.fontSize)) {
            lines.push(plain(seg, QP.lineColor));
          }
          if (r.reward) {
            lines.push(plain(`奖励：${r.reward.currencyType} ×${r.reward.amount}`, QP.rewardColor));
          }
          QuizPanel.feedback = lines;
        }
      }
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      QuizPanel.busy = false;
      QuizPanel.rebuild();
    }
  }

  /** 知识模式下一题（队列用尽即关闭） */
  private static next(): void {
    if (QuizPanel.mode !== 'knowledge') return;
    QuizPanel.qIndex += 1;
    const q = QuizPanel.questions[QuizPanel.qIndex] ?? null;
    QuizPanel.question = q;
    QuizPanel.picked = [];
    QuizPanel.feedback = null;
    QuizPanel.answerIdxs = [];
    if (!q) {
      QuizPanel.close();
      return;
    }
    QuizPanel.rebuild();
  }

  // ── 渲染 ───────────────────────────────────────────────────────────────

  private static rows(): QuizRow[] {
    const rows: QuizRow[] = [];
    if (QuizPanel.mode === 'knowledge') {
      const total = QuizPanel.questions.length;
      rows.push({
        text: total > 0 ? `知识问答（第 ${QuizPanel.qIndex + 1}/${total} 题）` : '知识问答',
        color: QP.titleColor,
        height: QP.lineHeight,
        fontSize: QP.titleFontSize,
      });
    } else {
      rows.push({ text: '测评答题', color: QP.titleColor, height: QP.lineHeight, fontSize: QP.titleFontSize });
    }

    if (QuizPanel.loading) {
      rows.push(plain('加载中…', QP.dimColor));
      return rows;
    }
    if (QuizPanel.loadError) {
      rows.push(plain(`加载失败：${QuizPanel.loadError}`, QP.warnColor));
      rows.push(btn('重试', () => void QuizPanel.refreshDraw()));
      return rows;
    }
    if (QuizPanel.resultDone) {
      for (const line of QuizPanel.feedback ?? []) rows.push(line);
      rows.push(btn('关闭', () => QuizPanel.close()));
      return rows;
    }
    const q = QuizPanel.question;
    if (!q) {
      rows.push(plain('暂时没有可答的题目', QP.dimColor));
      rows.push(btn('关闭', () => QuizPanel.close()));
      return rows;
    }

    // 题干（贪心换行成多行）
    const contentLines = QuizPanel.wrap(q.content ?? '', QuizPanel.contentWidth(), QP.fontSize);
    rows.push({
      text: contentLines.join('\n'),
      color: QP.lineColor,
      height: Math.max(1, contentLines.length) * QP.lineHeight,
      fontSize: QP.fontSize,
    });

    // 选项行（锁定后仅高亮正确项，不再响应点击）
    const locked = QuizPanel.feedback !== null;
    const opts = q.options ?? [];
    for (let i = 0; i < opts.length; i++) {
      const sel = QuizPanel.picked.includes(i);
      const isAnswer =
        locked && QuizPanel.mode === 'knowledge' && QuizPanel.answerIdxs.includes(i);
      rows.push({
        text: `${sel ? '▸ ' : ''}${i + 1}. ${opts[i]?.text ?? ''}`,
        color: QP.optionColor,
        height: QP.optionHeight,
        fontSize: QP.fontSize,
        bg: isAnswer ? QP.answerBgColor : sel ? QP.pickedBgColor : QP.optionBgColor,
        onClick: locked ? undefined : () => QuizPanel.onOptionClick(i),
      });
    }

    // 多选：点选高亮 + 提交按钮行（单选点击即提交）
    if (!locked && q.multiSelect) {
      rows.push(
        btn(
          QuizPanel.picked.length > 0
            ? `提交答案（已选 ${QuizPanel.picked.length} 项）`
            : '提交答案（先点选选项）',
          () => QuizPanel.onSubmitClick(),
        ),
      );
    }

    // 提交后的反馈 + 下一题/关闭
    if (QuizPanel.feedback) {
      for (const line of QuizPanel.feedback) rows.push(line);
      if (QuizPanel.mode === 'knowledge' && QuizPanel.qIndex + 1 < QuizPanel.questions.length) {
        rows.push(btn('下一题', () => QuizPanel.next()));
      } else {
        rows.push(btn('关闭', () => QuizPanel.close()));
      }
    }
    return rows;
  }

  private static rebuild(): void {
    const root = QuizPanel.root;
    if (!root || !QuizPanel.opened) return;
    root.removeChildren();

    const rows = QuizPanel.rows();
    let contentH = 0;
    for (const row of rows) contentH += row.height + (row.button ? 4 : 0);
    // 面板居中（答题是焦点操作；宽度上限对齐对话面板）
    const w = Math.min(QP.panelWidth, AppConfig.stageWidth - QP.margin * 2);
    const h = Math.min(contentH + QP.padY * 2, AppConfig.stageHeight - QP.margin * 2);
    const x = Math.round((AppConfig.stageWidth - w) / 2);
    const y = Math.round((AppConfig.stageHeight - h) / 2);

    const bg = new Laya.Sprite();
    bg.mouseEnabled = false;
    bg.graphics.drawRect(x, y, w, h, QP.bgColor);
    bg.graphics.drawRect(x, y, w, QP.borderWidth, QP.borderColor);
    root.addChild(bg);

    const contentX = x + QP.padX;
    const contentW = w - QP.padX * 2;
    let ry = y + QP.padY;
    for (const row of rows) {
      if (row.bg) {
        const hl = new Laya.Sprite();
        hl.mouseEnabled = false;
        hl.graphics.drawRect(contentX, ry, contentW, row.height, row.bg);
        root.addChild(hl);
      }
      if (row.button) {
        const btnBg = new Laya.Sprite();
        btnBg.mouseEnabled = false;
        btnBg.graphics.drawRect(contentX, ry, contentW, row.height, QP.buttonBgColor);
        root.addChild(btnBg);
      }
      const textTop = row.button ? ry + Math.round((row.height - row.fontSize) / 2) : ry + 3;
      root.addChild(QuizPanel.makeText(row.text, contentX, textTop, row.fontSize, row.color));
      if (row.onClick) {
        // 命中区在视觉之后 addChild（引擎逆序命中，后加的盖过同行视觉）；按下即响应
        const hit = new Laya.Sprite();
        hit.name = 'quiz-hit';
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

  /** 文本换行（纯函数）：按 maxWidth 贪心切行，保留显式 \n（本地实现，不依赖 DialogueView） */
  private static wrap(text: string, maxWidth: number, fontSize: number): string[] {
    const lines: string[] = [];
    for (const para of String(text ?? '').split('\n')) {
      if (para === '') {
        lines.push('');
        continue;
      }
      let line = '';
      for (const ch of para) {
        const candidate = line + ch;
        if (line !== '' && QuizPanel.measure(candidate, fontSize) > maxWidth) {
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

  /** 单串宽度测量（wrap 的 measure 注入口） */
  private static measure(content: string, fontSize: number): number {
    const text = QuizPanel.measureText ?? (QuizPanel.measureText = new Laya.Text());
    text.fontSize = fontSize;
    text.text = content;
    return text.textWidth;
  }

  private static contentWidth(): number {
    const w = Math.min(QP.panelWidth, AppConfig.stageWidth - QP.margin * 2);
    return w - QP.padX * 2;
  }
}
