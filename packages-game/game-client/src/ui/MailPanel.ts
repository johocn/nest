import { AppConfig } from '../config/AppConfig';
import { Api } from '../net/api';
import { Session } from '../net/Session';
import { ChatPanel } from './ChatPanel';
import { Toast } from './Toast';

/** 邮件面板常量：与 InventoryPanel 同风格集中在此 */
const MP = {
  /** 高于背包(10006)、匹配(10005)、聊天/建造(10004)、HUD(9999) */
  zOrder: 10007,
  margin: 12,
  panelWidth: 380,
  padX: 10,
  padY: 8,
  lineHeight: 20,
  buttonHeight: 30,
  fontSize: 13,
  /** 每页邮件行数，超过则两按钮翻页（照背包） */
  pageSize: 10,
  bgColor: 'rgba(0,0,0,0.72)',
  borderColor: '#2f81f7',
  borderWidth: 1,
  titleColor: '#e6edf3',
  lineColor: '#c9d1d9',
  dimColor: '#8b949e',
  okColor: '#3fb950',
  warnColor: '#f0883e',
  selectedBgColor: 'rgba(47,129,247,0.22)',
  buttonBgColor: 'rgba(47,129,247,0.35)',
};

export interface MailRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 面板几何（纯函数）：贴右上角（右下被背包占，左上被匹配占，左下被聊天/建造占） */
export function mailPanelRect(stageWidth: number, stageHeight: number, contentHeight: number): MailRect {
  const w = Math.min(MP.panelWidth, stageWidth - MP.margin * 2);
  const h = Math.min(MP.padY * 2 + contentHeight, stageHeight - MP.margin * 2);
  return {
    x: stageWidth - MP.margin - w,
    y: MP.margin,
    w,
    h,
  };
}

/** 服务端 GET /mail/list 视图（Mail 实体原样下发） */
export interface MailView {
  id: string;
  title: string;
  content: string;
  isRead: boolean;
  isClaimed: boolean;
  attachmentJson?: Record<string, unknown> | null;
}

/** 是否有未领取附件（纯函数）：attachmentJson 非空对象且未领取 */
export function mailHasAttachment(mail: MailView): boolean {
  return !mail.isClaimed && !!mail.attachmentJson && Object.keys(mail.attachmentJson).length > 0;
}

/** 邮件行文案（纯函数）：未读标记 + 标题 + 附件标记 */
export function formatMailLine(mail: MailView, selected: boolean): string {
  const unread = mail.isRead ? '　' : '●';
  const attach = mailHasAttachment(mail) ? '（有附件）' : '';
  return `${selected ? '▸' : '　'}${unread} ${mail.title}${attach}`;
}

interface MailRow {
  text: string;
  color: string;
  bg?: string;
  button?: boolean;
  onClick?: () => void;
}

/**
 * 邮件面板（引擎内自绘，禁 DOM，照 InventoryPanel 惯例）。
 * 打开时懒加载 GET /mail/list；选中行 → POST /mail/:id/read 标记已读并显示正文；
 * 有未领取附件时提供「领取附件」操作行（POST /mail/:id/claim）。
 * L 开关面板，Esc 关闭。服务端列表全量下发（无分页参数），>10 行本地翻页。
 */
export class MailPanel {
  private static root: Laya.Sprite | null = null;
  private static opened = false;
  private static mails: MailView[] = [];
  /** 选中行（mails 下标，-1 未选） */
  private static selected = -1;
  private static page = 0;
  private static loaded = false;
  private static loading = false;
  private static loadError = '';
  private static busy = false;

  /** 必须在 Laya.init 之后调用；幂等 */
  static init(): void {
    if (typeof Laya === 'undefined' || !Laya.stage) return;
    if (MailPanel.root) return;
    const root = new Laya.Sprite();
    root.name = 'mail-panel';
    root.zOrder = MP.zOrder;
    // 不设 mouseEnabled / 不设 size：根节点不参与命中，行命中区作为子节点照常接收点击（照 InventoryPanel）
    Laya.stage.addChild(root);
    MailPanel.root = root;
    Laya.stage.on(Laya.Event.KEY_DOWN, MailPanel, MailPanel.onKeyDown);
    console.log(`[Mail] MailPanel 就绪：zOrder=${MP.zOrder}（L 开关面板）`);
  }

  static get isOpen(): boolean {
    return MailPanel.opened;
  }

  /** 彻底销毁（照 InventoryPanel 清理方式） */
  static destroy(): void {
    if (typeof Laya !== 'undefined' && Laya.stage) {
      Laya.stage.off(Laya.Event.KEY_DOWN, MailPanel, MailPanel.onKeyDown);
    }
    if (MailPanel.root && MailPanel.root.parent) {
      MailPanel.root.parent.removeChild(MailPanel.root);
    }
    MailPanel.root = null;
    MailPanel.opened = false;
    MailPanel.mails = [];
    MailPanel.selected = -1;
    MailPanel.page = 0;
    MailPanel.loaded = false;
    MailPanel.loading = false;
    MailPanel.loadError = '';
    MailPanel.busy = false;
  }

  // ── 交互 ───────────────────────────────────────────────────────────────

  static toggle(): void {
    if (MailPanel.opened) {
      MailPanel.opened = false;
      MailPanel.root?.removeChildren();
    } else {
      MailPanel.opened = true;
      void MailPanel.refresh();
    }
  }

  private static onKeyDown(e: Laya.Event): void {
    if (ChatPanel.isOpen) return; // 聊天输入打开时忽略（防打字误触邮件操作）
    const key = String((e as unknown as { key?: string }).key ?? '').toLowerCase();
    if (key === 'l') {
      if (!Session.token) return; // 登录页门禁：未登录不打开
      MailPanel.toggle();
      return;
    }
    if (!MailPanel.opened) return;
    if (key === 'escape') {
      MailPanel.toggle();
      return;
    }
  }

  /** 拉取邮件列表并重绘（打开面板与操作后刷新共用） */
  private static async refresh(): Promise<void> {
    if (MailPanel.loading) return;
    MailPanel.loading = true;
    MailPanel.loadError = '';
    MailPanel.rebuild();
    try {
      const list = await Api.listMail(Session.token ?? '');
      MailPanel.mails = Array.isArray(list) ? (list as MailView[]) : [];
      MailPanel.loaded = true;
      if (MailPanel.selected >= MailPanel.mails.length) MailPanel.selected = -1;
      const pages = MailPanel.pageCount();
      if (MailPanel.page >= pages) MailPanel.page = pages - 1;
    } catch (err) {
      MailPanel.loadError = err instanceof Error ? err.message : String(err);
    } finally {
      MailPanel.loading = false;
      MailPanel.rebuild();
    }
  }

  /** 选中行时标记已读（静默失败不打断阅读，列表数据本就在本地） */
  private static async doRead(idx: number): Promise<void> {
    const mail = MailPanel.mails[idx];
    if (!mail || mail.isRead) return;
    try {
      await Api.readMail(mail.id, Session.token ?? '');
      mail.isRead = true;
      if (MailPanel.selected === idx) MailPanel.rebuild();
    } catch {
      // 已读标记失败不提示，下次选中会重试
    }
  }

  private static async doClaim(): Promise<void> {
    if (MailPanel.busy) return;
    const mail = MailPanel.mails[MailPanel.selected];
    if (!mail) {
      Toast.info('请先选择邮件');
      return;
    }
    MailPanel.busy = true;
    try {
      await Api.claimMailAttachment(mail.id, Session.token ?? '');
      Toast.info('附件领取成功');
      await MailPanel.refresh();
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      MailPanel.busy = false;
    }
  }

  private static pageCount(): number {
    return Math.max(1, Math.ceil(MailPanel.mails.length / MP.pageSize));
  }

  private static turnPage(delta: number): void {
    const next = MailPanel.page + delta;
    if (next < 0 || next >= MailPanel.pageCount()) return;
    MailPanel.page = next;
    MailPanel.rebuild();
  }

  // ── 渲染 ───────────────────────────────────────────────────────────────

  private static rows(): MailRow[] {
    const rows: MailRow[] = [];
    rows.push({ text: '邮件（L 开关面板）', color: MP.titleColor });
    if (MailPanel.loading) {
      rows.push({ text: '加载中…', color: MP.dimColor });
      return rows;
    }
    if (MailPanel.loadError) {
      rows.push({ text: `加载失败：${MailPanel.loadError}`, color: MP.warnColor });
      rows.push({
        text: '重试',
        color: MP.lineColor,
        button: true,
        onClick: () => void MailPanel.refresh(),
      });
      return rows;
    }
    const mails = MailPanel.mails;
    if (!MailPanel.loaded || mails.length === 0) {
      rows.push({ text: '暂无邮件', color: MP.dimColor });
      return rows;
    }
    const pages = MailPanel.pageCount();
    const start = MailPanel.page * MP.pageSize;
    const slice = mails.slice(start, start + MP.pageSize);
    rows.push({
      text: `—— 邮件（共 ${mails.length} 封，第 ${MailPanel.page + 1}/${pages} 页）——`,
      color: MP.dimColor,
    });
    for (let i = 0; i < slice.length; i++) {
      const idx = start + i;
      const sel = MailPanel.selected === idx;
      rows.push({
        text: formatMailLine(slice[i], sel),
        color: sel ? MP.titleColor : MP.lineColor,
        bg: sel ? MP.selectedBgColor : undefined,
        onClick: () => {
          MailPanel.selected = idx;
          MailPanel.rebuild();
          void MailPanel.doRead(idx);
        },
      });
    }
    if (pages > 1) {
      rows.push({
        text: '上一页',
        color: MailPanel.page > 0 ? MP.lineColor : MP.dimColor,
        button: true,
        onClick: () => MailPanel.turnPage(-1),
      });
      rows.push({
        text: '下一页',
        color: MailPanel.page < pages - 1 ? MP.lineColor : MP.dimColor,
        button: true,
        onClick: () => MailPanel.turnPage(1),
      });
    }
    const selMail = mails[MailPanel.selected];
    if (selMail) {
      rows.push({ text: `正文：${selMail.content}`, color: MP.dimColor });
      if (mailHasAttachment(selMail)) {
        rows.push({
          text: '领取附件',
          color: MP.okColor,
          button: true,
          onClick: () => void MailPanel.doClaim(),
        });
      }
    } else {
      rows.push({ text: '点击邮件行查看正文', color: MP.dimColor });
    }
    return rows;
  }

  private static rebuild(): void {
    const root = MailPanel.root;
    if (!root || !MailPanel.opened) return;
    root.removeChildren();

    const rows = MailPanel.rows();
    let contentH = 0;
    for (const row of rows) contentH += row.button ? MP.buttonHeight + 4 : MP.lineHeight;
    const rect = mailPanelRect(AppConfig.stageWidth, AppConfig.stageHeight, contentH);

    const bg = new Laya.Sprite();
    bg.mouseEnabled = false;
    bg.graphics.drawRect(rect.x, rect.y, rect.w, rect.h, MP.bgColor);
    bg.graphics.drawRect(rect.x, rect.y, rect.w, MP.borderWidth, MP.borderColor);
    root.addChild(bg);

    const contentX = rect.x + MP.padX;
    const contentW = rect.w - MP.padX * 2;
    let y = rect.y + MP.padY;
    for (const row of rows) {
      const h = row.button ? MP.buttonHeight : MP.lineHeight;
      if (row.bg) {
        const hl = new Laya.Sprite();
        hl.mouseEnabled = false;
        hl.graphics.drawRect(contentX, y, contentW, h, row.bg);
        root.addChild(hl);
      }
      if (row.button) {
        const btn = new Laya.Sprite();
        btn.mouseEnabled = false;
        btn.graphics.drawRect(contentX, y, contentW, h, MP.buttonBgColor);
        root.addChild(btn);
      }
      const textTop = row.button ? y + Math.round((h - MP.fontSize) / 2) : y + 3;
      root.addChild(MailPanel.makeText(row.text, contentX, textTop, row.color));
      if (row.onClick) {
        // 命中区在视觉之后 addChild（引擎逆序命中，后加的盖过同行视觉）；按下即响应
        const hit = new Laya.Sprite();
        hit.name = 'mail-hit';
        hit.pos(contentX, y);
        hit.size(contentW, h);
        hit.mouseEnabled = true;
        hit.on(Laya.Event.MOUSE_DOWN, null, row.onClick);
        root.addChild(hit);
      }
      y += h + (row.button ? 4 : 0);
    }
  }

  private static makeText(content: string, x: number, y: number, color: string): Laya.Text {
    const text = new Laya.Text();
    text.text = content;
    text.fontSize = MP.fontSize;
    text.color = color;
    text.stroke = 2;
    text.strokeColor = '#000000';
    text.mouseEnabled = false;
    text.pos(x, y);
    return text;
  }
}
