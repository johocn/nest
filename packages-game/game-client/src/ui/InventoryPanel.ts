import { AppConfig } from '../config/AppConfig';
import { Api } from '../net/api';
import { Session } from '../net/Session';
import { ChatPanel } from './ChatPanel';
import { Toast } from './Toast';

/** 背包面板常量：与 ChatPanel/MatchPanel 同风格集中在此 */
const IP = {
  /** 高于 Hud(9999)、聊天/建造(10004)、匹配(10005) */
  zOrder: 10006,
  margin: 12,
  panelWidth: 380,
  padX: 10,
  padY: 8,
  lineHeight: 20,
  buttonHeight: 30,
  fontSize: 13,
  /** 每页物品行数，超过则两按钮翻页 */
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

export interface InventoryRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 面板几何（纯函数）：贴右下角（左上/右上/左下已被匹配/建造/聊天占用） */
export function inventoryPanelRect(stageWidth: number, stageHeight: number, contentHeight: number): InventoryRect {
  const w = Math.min(IP.panelWidth, stageWidth - IP.margin * 2);
  const h = Math.min(IP.padY * 2 + contentHeight, stageHeight - IP.margin * 2);
  return {
    x: stageWidth - IP.margin - w,
    y: stageHeight - IP.margin - h,
    w,
    h,
  };
}

/** 服务端 GET /inventory/list 视图（InventoryItem 实体下发，relations 带出 itemTemplate） */
export interface InventoryItemView {
  id: string;
  itemTemplateId: string;
  quantity: number;
  bindStatus?: string;
  itemTemplate?: { name?: string } | null;
}

/** 物品行文案（纯函数）：优先模板名，模板缺失（脏数据）回退 #id，绑定态后缀标注 */
export function formatInventoryItemLine(item: InventoryItemView): string {
  const name = item.itemTemplate?.name ?? `#${item.itemTemplateId}`;
  const bound = String(item.bindStatus ?? '') === 'bound' ? '（绑定）' : '';
  return `${name} × ${item.quantity}${bound}`;
}

interface InvRow {
  text: string;
  color: string;
  bg?: string;
  button?: boolean;
  onClick?: () => void;
}

/**
 * 背包面板（引擎内自绘，禁 DOM，照 ChatPanel/MatchPanel 惯例）。
 * 打开时懒加载 GET /inventory/list（全量，服务端无分页参数），选中行 → 使用（POST /inventory/use，
 * 服务端仅消耗品可使用）；I 开关面板，Esc 关闭。服务端无丢弃接口，故不提供丢弃按钮。
 */
export class InventoryPanel {
  private static root: Laya.Sprite | null = null;
  private static opened = false;
  private static items: InventoryItemView[] = [];
  /** 选中行（items 下标，-1 未选） */
  private static selected = -1;
  private static page = 0;
  private static loaded = false;
  private static loading = false;
  private static loadError = '';
  private static busy = false;

  /** 必须在 Laya.init 之后调用；幂等 */
  static init(): void {
    if (typeof Laya === 'undefined' || !Laya.stage) return;
    if (InventoryPanel.root) return;
    const root = new Laya.Sprite();
    root.name = 'inventory-panel';
    root.zOrder = IP.zOrder;
    // 不设 mouseEnabled / 不设 size：根节点不参与命中，行命中区作为子节点照常接收点击（照 MatchPanel）
    Laya.stage.addChild(root);
    InventoryPanel.root = root;
    Laya.stage.on(Laya.Event.KEY_DOWN, InventoryPanel, InventoryPanel.onKeyDown);
    console.log(`[Inventory] InventoryPanel 就绪：zOrder=${IP.zOrder}（I 开关面板）`);
  }

  static get isOpen(): boolean {
    return InventoryPanel.opened;
  }

  /** 彻底销毁（照 ChatPanel/MatchPanel 清理方式） */
  static destroy(): void {
    if (typeof Laya !== 'undefined' && Laya.stage) {
      Laya.stage.off(Laya.Event.KEY_DOWN, InventoryPanel, InventoryPanel.onKeyDown);
    }
    if (InventoryPanel.root && InventoryPanel.root.parent) {
      InventoryPanel.root.parent.removeChild(InventoryPanel.root);
    }
    InventoryPanel.root = null;
    InventoryPanel.opened = false;
    InventoryPanel.items = [];
    InventoryPanel.selected = -1;
    InventoryPanel.page = 0;
    InventoryPanel.loaded = false;
    InventoryPanel.loading = false;
    InventoryPanel.loadError = '';
    InventoryPanel.busy = false;
  }

  // ── 交互 ───────────────────────────────────────────────────────────────

  static toggle(): void {
    if (InventoryPanel.opened) {
      InventoryPanel.opened = false;
      InventoryPanel.root?.removeChildren();
    } else {
      InventoryPanel.opened = true;
      void InventoryPanel.refresh();
    }
  }

  private static onKeyDown(e: Laya.Event): void {
    if (ChatPanel.isOpen) return; // 聊天输入打开时忽略（防打字误触背包操作）
    const key = String((e as unknown as { key?: string }).key ?? '').toLowerCase();
    if (key === 'i') {
      if (!Session.token) return; // 登录页门禁：未登录不打开
      InventoryPanel.toggle();
      return;
    }
    if (!InventoryPanel.opened) return;
    if (key === 'escape') {
      InventoryPanel.toggle();
      return;
    }
    if (key === 'u') void InventoryPanel.doUse();
    if (key === 'd') void InventoryPanel.doDrop();
  }

  /** 拉取背包列表并重绘（打开面板与操作后刷新共用） */
  private static async refresh(): Promise<void> {
    if (InventoryPanel.loading) return;
    InventoryPanel.loading = true;
    InventoryPanel.loadError = '';
    InventoryPanel.rebuild();
    try {
      const list = await Api.getInventory(Session.token ?? '');
      InventoryPanel.items = Array.isArray(list) ? (list as InventoryItemView[]) : [];
      InventoryPanel.loaded = true;
      if (InventoryPanel.selected >= InventoryPanel.items.length) InventoryPanel.selected = -1;
      const pages = InventoryPanel.pageCount();
      if (InventoryPanel.page >= pages) InventoryPanel.page = pages - 1;
    } catch (err) {
      InventoryPanel.loadError = err instanceof Error ? err.message : String(err);
    } finally {
      InventoryPanel.loading = false;
      InventoryPanel.rebuild();
    }
  }

  private static async doUse(): Promise<void> {
    if (InventoryPanel.busy) return;
    const item = InventoryPanel.items[InventoryPanel.selected];
    if (!item) {
      Toast.info('请先选择物品');
      return;
    }
    InventoryPanel.busy = true;
    try {
      await Api.useItem(item.itemTemplateId, Session.token ?? '');
      Toast.info('使用成功');
      await InventoryPanel.refresh();
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      InventoryPanel.busy = false;
    }
  }

  /** 丢弃整堆（服务端拒绝绑定/不可丢弃时 Toast 错误信息） */
  private static async doDrop(): Promise<void> {
    if (InventoryPanel.busy) return;
    const item = InventoryPanel.items[InventoryPanel.selected];
    if (!item) {
      Toast.info('请先选择物品');
      return;
    }
    InventoryPanel.busy = true;
    try {
      await Api.dropItem(item.id, item.quantity, Session.token ?? '');
      Toast.info('丢弃成功');
      InventoryPanel.selected = -1;
      await InventoryPanel.refresh();
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      InventoryPanel.busy = false;
    }
  }

  private static pageCount(): number {
    return Math.max(1, Math.ceil(InventoryPanel.items.length / IP.pageSize));
  }

  private static turnPage(delta: number): void {
    const next = InventoryPanel.page + delta;
    if (next < 0 || next >= InventoryPanel.pageCount()) return;
    InventoryPanel.page = next;
    InventoryPanel.rebuild();
  }

  // ── 渲染 ───────────────────────────────────────────────────────────────

  private static rows(): InvRow[] {
    const rows: InvRow[] = [];
    rows.push({ text: '背包（I 开关面板）', color: IP.titleColor });
    if (InventoryPanel.loading) {
      rows.push({ text: '加载中…', color: IP.dimColor });
      return rows;
    }
    if (InventoryPanel.loadError) {
      rows.push({ text: `加载失败：${InventoryPanel.loadError}`, color: IP.warnColor });
      rows.push({
        text: '重试',
        color: IP.lineColor,
        button: true,
        onClick: () => void InventoryPanel.refresh(),
      });
      return rows;
    }
    const items = InventoryPanel.items;
    if (!InventoryPanel.loaded || items.length === 0) {
      rows.push({ text: '背包空空如也', color: IP.dimColor });
      return rows;
    }
    const pages = InventoryPanel.pageCount();
    const start = InventoryPanel.page * IP.pageSize;
    const slice = items.slice(start, start + IP.pageSize);
    rows.push({
      text: `—— 物品（共 ${items.length} 件，第 ${InventoryPanel.page + 1}/${pages} 页）——`,
      color: IP.dimColor,
    });
    for (let i = 0; i < slice.length; i++) {
      const idx = start + i;
      const sel = InventoryPanel.selected === idx;
      rows.push({
        text: `${sel ? '▸' : '　'} ${formatInventoryItemLine(slice[i])}`,
        color: sel ? IP.titleColor : IP.lineColor,
        bg: sel ? IP.selectedBgColor : undefined,
        onClick: () => {
          InventoryPanel.selected = idx;
          InventoryPanel.rebuild();
        },
      });
    }
    if (pages > 1) {
      rows.push({
        text: '上一页',
        color: InventoryPanel.page > 0 ? IP.lineColor : IP.dimColor,
        button: true,
        onClick: () => InventoryPanel.turnPage(-1),
      });
      rows.push({
        text: '下一页',
        color: InventoryPanel.page < pages - 1 ? IP.lineColor : IP.dimColor,
        button: true,
        onClick: () => InventoryPanel.turnPage(1),
      });
    }
    if (InventoryPanel.items[InventoryPanel.selected]) {
      rows.push({
        text: '使用（U，仅消耗品）',
        color: IP.okColor,
        button: true,
        onClick: () => void InventoryPanel.doUse(),
      });
      rows.push({
        text: '丢弃（D，整堆）',
        color: IP.warnColor,
        button: true,
        onClick: () => void InventoryPanel.doDrop(),
      });
    } else {
      rows.push({ text: '点击物品行选中后可操作', color: IP.dimColor });
    }
    return rows;
  }

  private static rebuild(): void {
    const root = InventoryPanel.root;
    if (!root || !InventoryPanel.opened) return;
    root.removeChildren();

    const rows = InventoryPanel.rows();
    let contentH = 0;
    for (const row of rows) contentH += row.button ? IP.buttonHeight + 4 : IP.lineHeight;
    const rect = inventoryPanelRect(AppConfig.stageWidth, AppConfig.stageHeight, contentH);

    const bg = new Laya.Sprite();
    bg.mouseEnabled = false;
    bg.graphics.drawRect(rect.x, rect.y, rect.w, rect.h, IP.bgColor);
    bg.graphics.drawRect(rect.x, rect.y, rect.w, IP.borderWidth, IP.borderColor);
    root.addChild(bg);

    const contentX = rect.x + IP.padX;
    const contentW = rect.w - IP.padX * 2;
    let y = rect.y + IP.padY;
    for (const row of rows) {
      const h = row.button ? IP.buttonHeight : IP.lineHeight;
      if (row.bg) {
        const hl = new Laya.Sprite();
        hl.mouseEnabled = false;
        hl.graphics.drawRect(contentX, y, contentW, h, row.bg);
        root.addChild(hl);
      }
      if (row.button) {
        const btn = new Laya.Sprite();
        btn.mouseEnabled = false;
        btn.graphics.drawRect(contentX, y, contentW, h, IP.buttonBgColor);
        root.addChild(btn);
      }
      const textTop = row.button ? y + Math.round((h - IP.fontSize) / 2) : y + 3;
      root.addChild(InventoryPanel.makeText(row.text, contentX, textTop, row.color));
      if (row.onClick) {
        // 命中区在视觉之后 addChild（引擎逆序命中，后加的盖过同行视觉，照 MatchPanel）；按下即响应
        const hit = new Laya.Sprite();
        hit.name = 'inventory-hit';
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
    text.fontSize = IP.fontSize;
    text.color = color;
    text.stroke = 2;
    text.strokeColor = '#000000';
    text.mouseEnabled = false;
    text.pos(x, y);
    return text;
  }
}
