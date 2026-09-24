import { AppConfig } from '../config/AppConfig';
import type { Entity } from '../entity/Entity';
import { Api } from '../net/api';
import type {
  BuildCostEntry,
  BuildRuleView,
  BuildingTemplate,
  BuildingView,
} from '../net/api';
import { ApiError } from '../net/http';
import { Session } from '../net/Session';
import { Hud } from '../ui/Hud';
import {
  DEFAULT_GRID_SIZE,
  calcProgress,
  footprintCells,
  occupiedCells,
  predictPlot,
  worldToGrid,
} from './build-logic';

const B = AppConfig.build;
const T = AppConfig.touch;

/** 面板运行上下文：场景尺寸 + 建造规则 + 蓝图（由 Main 在进场景后注入） */
export interface BuildPanelContext {
  sceneId: string;
  mapWidth: number;
  mapHeight: number;
  rule: BuildRuleView;
  templates: BuildingTemplate[];
}

/** 一行面板内容（`onClick` 非空即渲染为可点击按钮行） */
interface PanelRow {
  text: string;
  color: string;
  bg?: string;
  onClick?: () => void;
  /** 该行是否与面板同宽（按钮行），false 时按文本左对齐 */
  button?: boolean;
}

/** `addRowHit` 入参：一行命中区的几何（行带 + 允许向外扩的上下边界） */
interface RowHit {
  x: number;
  width: number;
  /** 行带（该行视觉所在的位置） */
  top: number;
  height: number;
  /** 命中区允许向上/向下扩到的边界（由相邻行是否可点决定；面板矩形是硬边界） */
  minTop: number;
  maxBottom: number;
  onClick?: () => void;
}

/**
 * S6 建造面板（**引擎内自绘，禁用 DOM / HTML**，小游戏端与 H5 行为一致）。
 *
 * 只用已验证基元：`Laya.Sprite` + `graphics.drawRect` + `Laya.Text`（与 `Hud` / `DialogueView` 同一套路），
 * 挂在 `Laya.stage` 顶层（屏幕空间，不随世界层滚动）。
 *
 * 内容：模式提示（forbidden → 「此场景不允许建造」+ 禁用操作行）、蓝图列表（名称/成本/耗时）、
 * 选格预览（半透明方块，合法绿 / 非法红）、建造/投料/拆除按钮、光标处建筑的进度条。
 *
 * 权威性：合法性只是**本地预判**（`build-logic.predictPlot`），服务端 `assertCanBuild` 才是权威；
 * 落成/拆除一律由服务端广播驱动，面板不做本地状态推进。
 *
 * **指针不设遮罩（S9 修复）**：根节点既不 `size()` 也不改 `mouseEnabled` —— 引擎的命中检测是**纯几何**的
 * （`hitTest` 只看自身 `width>0 && height>0` 且包含该点），根节点一旦有边界就会成为最上层命中目标、
 * 吃掉整个舞台的指针（表现为「面板打开后手机摇杆按不动」）。去掉后根节点自身永不命中，行命中区/进度条
 * 作为子节点照常接收点击，空白处点击穿透到下层并**继续冒泡到舞台**，故 `onStageDown`（移动建造光标）不受影响。
 *
 * **行为什么在手机上点不动（S9 第二轮修复）**：两个原因叠加，都与「遮罩」无关 ——
 *
 *  1. **命中区太矮**：`SCALE_SHOWALL` 把 960×640 等比缩到手机宽度，常见机型（390 CSS px 宽）缩放比
 *     仅 ~0.41 —— 文本行带 `B.lineHeight=20` 落到屏幕上只有 **8 CSS px 高**，手指落点误差普遍 >4 CSS px，
 *     于是「想点按钮」的那一下多半压在相邻的**信息行**上（信息行没有 `onClick`）→ 看起来就是没反应。
 *     对照：交互按钮 `interactHeight=88`（≈36 CSS px）在手机上一直好使，正是因为它够高。
 *     → 处置：所有可点行的命中区撑到 `touch.minHitHeight`（见 `addRowHit`），**视觉尺寸不变**。
 *  2. **绑的是 CLICK**：引擎 `TouchInfo` 的 `clickTestThreshold = 10`（舞台像素），按下到抬起位移超过它
 *     （或中途有 `touchmove`、浏览器把手势判定成缩放而发 `touchcancel`）CLICK 就**不派发** ——
 *     10 舞台像素换算到手机上只有 ~4 CSS px，真实手指抖动轻易超过。而摇杆（`MOUSE_DOWN`/`DRAG`/`UP`）
 *     与交互按钮（`MOUSE_DOWN`）都不走这层判定，所以在手机上一直正常。
 *     → 处置：可点行一律改 `MOUSE_DOWN`（与交互按钮同一口径，按下即响应）。
 */
export class BuildPanel {
  private static root: Laya.Sprite | null = null;
  private static preview: Laya.Sprite | null = null;
  private static progressBar: Laya.Sprite | null = null;
  private static ctx: BuildPanelContext | null = null;
  private static me: Entity | null = null;
  private static layer: Laya.Sprite | null = null;
  /** 视图变更回调（由 Main 注入：HTTP 视图是唯一带 finishAt 的来源，据此立即建/更新实体） */
  private static onView: ((view: BuildingView) => void) | null = null;
  private static opened = false;
  private static busy = false;
  private static templateIndex = 0;
  private static cursor = { gx: 0, gy: 0 };
  private static buildings: BuildingView[] = [];
  private static panelRect = { x: 0, y: 0, w: 0, h: 0 };

  /** 必须在 Laya.init 之后调用；重复调用无副作用 */
  static init(): void {
    if (BuildPanel.root) return;
    const root = new Laya.Sprite();
    root.name = 's6-build-panel';
    root.zOrder = B.zOrder;
    // 不设 mouseEnabled / 不设 size：根节点自身不参与命中（否则会吃掉整个舞台的指针 → 触控层收不到按下）。
    // 面板行按钮作为子节点照常接收点击。详见类注释「指针不设遮罩」。
    Laya.stage.addChild(root);
    BuildPanel.root = root;

    Laya.stage.on(Laya.Event.KEY_DOWN, BuildPanel, BuildPanel.onKeyDown);
    Laya.stage.on(Laya.Event.MOUSE_DOWN, BuildPanel, BuildPanel.onStageDown);
    console.log(`[S6] BuildPanel 就绪：zOrder=${B.zOrder}（引擎内自绘，无 DOM）`);
  }

  /** 进场景后注入上下文（场景尺寸 / 规则 / 蓝图 / 世界层）并启动刷新循环 */
  static attach(
    me: Entity,
    layer: Laya.Sprite | null,
    ctx: BuildPanelContext,
    onView?: (view: BuildingView) => void,
  ): void {
    BuildPanel.me = me;
    BuildPanel.layer = layer;
    BuildPanel.ctx = ctx;
    if (onView) BuildPanel.onView = onView;
    BuildPanel.templateIndex = 0;
    const gridSize = BuildPanel.gridSize();
    BuildPanel.cursor = worldToGrid(me.x, me.y, gridSize);
    if (!BuildPanel.preview) {
      const preview = new Laya.Sprite();
      preview.name = 's6-build-preview';
      preview.mouseEnabled = false;
      preview.visible = false;
      BuildPanel.preview = preview;
      layer?.addChild(preview);
    }
    Laya.timer.frameLoop(B.refreshFrameInterval, BuildPanel, BuildPanel.refresh);
    console.log(
      `[S6] 建造面板接入：场景 ${ctx.sceneId} 模式=${ctx.rule.mode} 格 ${gridSize}px 蓝图 ${ctx.templates.length} 个`,
    );
  }

  static get isOpen(): boolean {
    return BuildPanel.opened;
  }

  /** 蓝图查询（广播补建实体时按 templateId 取占地/耐久/耗时） */
  static templateOf(templateId: string): BuildingTemplate | null {
    return (
      BuildPanel.ctx?.templates.find((t) => String(t.id) === String(templateId)) ??
      null
    );
  }

  /** 打开面板：先立即渲染（可能短暂显示 forbidden），再拉服务端权威规则/蓝图/建筑列表 */
  static async open(): Promise<void> {
    const root = BuildPanel.root;
    const ctx = BuildPanel.ctx;
    if (!root || !ctx || BuildPanel.opened) return;

    BuildPanel.opened = true;
    BuildPanel.rebuild();

    await BuildPanel.reload();
  }

  static close(): void {
    BuildPanel.opened = false;
    if (BuildPanel.root) {
      BuildPanel.root.removeChildren();
    }
    if (BuildPanel.preview) {
      BuildPanel.preview.visible = false;
      BuildPanel.preview.graphics.clear();
    }
    BuildPanel.progressBar = null;
  }

  static toggle(): void {
    if (BuildPanel.opened) BuildPanel.close();
    else void BuildPanel.open();
  }

  /** 建筑列表同步（进场景拉取 / 重拉列表）：只入列表，实体由调用方按 `viewToSpawn` 建 */
  static setBuildings(list: BuildingView[]): void {
    BuildPanel.buildings = list;
    if (BuildPanel.opened) BuildPanel.rebuild();
  }

  static upsertBuilding(view: BuildingView): void {
    const idx = BuildPanel.buildings.findIndex((b) => String(b.id) === String(view.id));
    if (idx >= 0) BuildPanel.buildings[idx] = view;
    else BuildPanel.buildings.push(view);
    BuildPanel.onView?.(view);
    if (BuildPanel.opened) BuildPanel.rebuild();
  }

  /** 拆除终态：从列表移除（实体侧淡出由 BuildingViewComponent 负责） */
  static removeBuilding(buildingId: string): void {
    BuildPanel.buildings = BuildPanel.buildings.filter(
      (b) => String(b.id) !== String(buildingId),
    );
    if (BuildPanel.opened) BuildPanel.rebuild();
  }

  /** 光标格上的建筑（含多格占地：命中任一格即算） */
  static buildingAt(gx: number, gy: number): BuildingView | null {
    const gridSize = BuildPanel.gridSize();
    for (const b of BuildPanel.buildings) {
      const anchor = worldToGrid(b.x, b.y, gridSize);
      const hit = footprintCells(anchor.gx, anchor.gy, b.w, b.h).some(
        (c) => c.gx === gx && c.gy === gy,
      );
      if (hit) return b;
    }
    return null;
  }

  private static gridSize(): number {
    const size = BuildPanel.ctx?.rule.landGridSize ?? DEFAULT_GRID_SIZE;
    return size > 0 ? size : DEFAULT_GRID_SIZE;
  }

  /** 拉取权威规则 / 蓝图 / 建筑列表（蓝图接口失败不致命：沿用进场景时注入的那份） */
  private static async reload(): Promise<void> {
    const ctx = BuildPanel.ctx;
    if (!ctx) return;
    const token = Session.token ?? '';
    try {
      const [rule, buildings] = await Promise.all([
        Api.getBuildRule(ctx.sceneId, token),
        Api.listBuildings(ctx.sceneId, null, token),
      ]);
      ctx.rule = rule;
      BuildPanel.setBuildings(buildings);
      // HTTP 视图带 finishAt/w/h（广播帧不带）：回灌一次，让实体进度条用上权威时刻
      for (const v of buildings) BuildPanel.onView?.(v);
    } catch (err) {
      Toast(err);
    }
    try {
      ctx.templates = await Api.listBuildingTemplates(null, token);
    } catch (err) {
      console.warn(`[S6] 蓝图列表拉取失败，沿用本地缓存：${String(err)}`);
    }
    if (BuildPanel.templateIndex >= ctx.templates.length) BuildPanel.templateIndex = 0;
    if (BuildPanel.opened) BuildPanel.rebuild();
  }

  private static selectedTemplate(): BuildingTemplate | null {
    const templates = BuildPanel.ctx?.templates ?? [];
    return templates[BuildPanel.templateIndex] ?? null;
  }

  private static prediction(): { legal: boolean; reason: string } {
    const ctx = BuildPanel.ctx;
    if (!ctx) return { legal: false, reason: '建造规则未就绪' };
    const template = BuildPanel.selectedTemplate();
    const gridSize = BuildPanel.gridSize();
    return predictPlot({
      rule: ctx.rule,
      gx: BuildPanel.cursor.gx,
      gy: BuildPanel.cursor.gy,
      w: template?.footprintW ?? 1,
      h: template?.footprintH ?? 1,
      mapWidth: ctx.mapWidth,
      mapHeight: ctx.mapHeight,
      occupied: occupiedCells(BuildPanel.buildings, gridSize),
      ownBuildingCount: BuildPanel.ownBuildings().length,
    });
  }

  /** 自己在场景内的有效建筑（building/built 计入上限，demolishing 不计） */
  private static ownBuildings(): BuildingView[] {
    const myId = String(Session.playerId ?? '');
    return BuildPanel.buildings.filter(
      (b) => String(b.ownerId) === myId && b.state !== 'demolishing',
    );
  }

  // ── 交互 ────────────────────────────────────────────────────────────────

  private static onKeyDown(e: Laya.Event): void {
    const key = String((e as unknown as { key?: string }).key ?? '').toLowerCase();
    if (!BuildPanel.opened) {
      if (key === 'b') BuildPanel.toggle();
      return;
    }
    switch (key) {
      case 'b':
      case 'escape':
        BuildPanel.close();
        return;
      case 'q':
        BuildPanel.cycleTemplate(-1);
        return;
      case 'e':
        BuildPanel.cycleTemplate(1);
        return;
      case 'enter':
        void BuildPanel.doBuild();
        return;
      case 'g':
        void BuildPanel.doContribute();
        return;
      case 'delete':
      case 'backspace':
        void BuildPanel.doDemolish();
        return;
      default:
        return;
    }
  }

  /** 按下世界选格（面板区域内、或触控层上的按下交给它们自己处理，不移动光标） */
  private static onStageDown(e: Laya.Event): void {
    if (!BuildPanel.opened) return;
    // 触控层（摇杆激活区/交互按钮）上的按下不算选格 —— 否则「想走路」的那一下会把建造光标甩过去
    if (BuildPanel.fromTouchLayer(e)) return;
    const x = Number(e.stageX ?? 0);
    const y = Number(e.stageY ?? 0);
    const r = BuildPanel.panelRect;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return;
    const { gx, gy } = worldToGrid(x, y, BuildPanel.gridSize());
    BuildPanel.cursor = { gx, gy };
    BuildPanel.rebuild();
  }

  /** 事件是否来自触控层：沿 `e.target` 的父链找 `s9-touch`（引擎 bubble 会把 `target` 保持为最初命中的节点） */
  private static fromTouchLayer(e: Laya.Event): boolean {
    let node = e.target as unknown as { name?: string; parent?: unknown } | null;
    while (node) {
      if (node.name === 's9-touch') return true;
      node = node.parent as never;
    }
    return false;
  }

  private static cycleTemplate(step: number): void {
    const count = BuildPanel.ctx?.templates.length ?? 0;
    if (count === 0) return;
    BuildPanel.templateIndex = (BuildPanel.templateIndex + step + count) % count;
    BuildPanel.rebuild();
  }

  private static async doBuild(): Promise<void> {
    const ctx = BuildPanel.ctx;
    const template = BuildPanel.selectedTemplate();
    if (!ctx || !template || BuildPanel.busy) return;
    if (ctx.rule.mode === 'forbidden') {
      Hud.toast('此场景不允许建造');
      return;
    }
    if (!BuildPanel.prediction().legal) {
      Hud.toast(BuildPanel.prediction().reason);
      return;
    }

    BuildPanel.busy = true;
    try {
      const view = await Api.createBuilding(
        {
          sceneId: ctx.sceneId,
          templateId: String(template.id),
          gx: BuildPanel.cursor.gx,
          gy: BuildPanel.cursor.gy,
        },
        Session.token ?? '',
      );
      BuildPanel.upsertBuilding(view);
      Hud.toast(
        `开始建造「${template.name}」，预计 ${template.buildSeconds} 秒（已扣除材料）`,
      );
    } catch (err) {
      Toast(err);
    } finally {
      BuildPanel.busy = false;
    }
  }

  private static async doContribute(): Promise<void> {
    const ctx = BuildPanel.ctx;
    const target = BuildPanel.buildingAt(BuildPanel.cursor.gx, BuildPanel.cursor.gy);
    if (!ctx || BuildPanel.busy) return;
    if (!target) {
      Hud.toast('光标格上没有可投料的建筑');
      return;
    }
    if (target.state !== 'building') {
      Hud.toast('该建筑不在建造中，无需投料');
      return;
    }
    const template = BuildPanel.templateOf(target.templateId);
    const items: BuildCostEntry[] = template?.buildCost ?? [];
    if (items.length === 0) {
      Hud.toast('该建筑没有可投料的材料清单');
      return;
    }

    BuildPanel.busy = true;
    try {
      const res = await Api.contributeBuilding(target.id, items, Session.token ?? '');
      BuildPanel.upsertBuilding(res.building);
      Hud.toast(
        res.reached
          ? `共建达标（${res.contributors} 人投料），建筑开始落成计时`
          : `已投料，当前 ${res.contributors} 人参与（未达标）`,
      );
    } catch (err) {
      Toast(err);
    } finally {
      BuildPanel.busy = false;
    }
  }

  private static async doDemolish(): Promise<void> {
    const ctx = BuildPanel.ctx;
    const target = BuildPanel.buildingAt(BuildPanel.cursor.gx, BuildPanel.cursor.gy);
    if (!ctx || BuildPanel.busy) return;
    if (!target) {
      Hud.toast('光标格上没有建筑');
      return;
    }
    if (ctx.rule.allowDemolish !== true) {
      Hud.toast('该场景不允许拆除');
      return;
    }
    if (String(target.ownerId) !== String(Session.playerId ?? '')) {
      Hud.toast('只有建筑所有者可拆除');
      return;
    }

    BuildPanel.busy = true;
    try {
      const res = await Api.demolishBuilding(target.id, Session.token ?? '');
      BuildPanel.removeBuilding(res.building.id);
      Hud.toast('已拆除（不返还材料）');
    } catch (err) {
      Toast(err);
    } finally {
      BuildPanel.busy = false;
    }
  }

  // ── 渲染 ────────────────────────────────────────────────────────────────

  /** 每帧（节流）：重绘格点预览与面板进度条，不重建文本节点 */
  private static refresh(): void {
    if (!BuildPanel.opened || !BuildPanel.preview) return;
    const ctx = BuildPanel.ctx;
    if (!ctx) return;

    const gridSize = BuildPanel.gridSize();
    const template = BuildPanel.selectedTemplate();
    const w = template?.footprintW ?? 1;
    const h = template?.footprintH ?? 1;
    const { legal } = BuildPanel.prediction();
    const color = legal ? B.legalColor : B.illegalColor;

    const preview = BuildPanel.preview;
    preview.visible = true;
    preview.graphics.clear();
    preview.graphics.drawRect(
      BuildPanel.cursor.gx * gridSize,
      BuildPanel.cursor.gy * gridSize,
      w * gridSize,
      h * gridSize,
      fill(color, B.previewAlpha),
    );
    preview.graphics.drawRect(
      BuildPanel.cursor.gx * gridSize,
      BuildPanel.cursor.gy * gridSize,
      w * gridSize,
      h * gridSize,
      null,
      color,
      B.previewLineWidth,
    );

    const bar = BuildPanel.progressBar;
    if (bar) {
      const target = BuildPanel.buildingAt(BuildPanel.cursor.gx, BuildPanel.cursor.gy);
      const template2 = target ? BuildPanel.templateOf(target.templateId) : null;
      const progress =
        target && target.state === 'building'
          ? calcProgress(target.finishAt, Date.now(), template2?.buildSeconds ?? 0)
          : null;
      const width = B.panelWidth - B.padX * 2;
      bar.graphics.clear();
      bar.graphics.drawRect(0, 0, width, B.progressBarHeight, B.progressBgColor);
      if (target && target.state === 'building') {
        const filled = progress === null ? width / 2 : width * progress;
        bar.graphics.drawRect(
          0,
          0,
          filled,
          B.progressBarHeight,
          progress === null ? B.progressUnknownColor : B.progressFgColor,
        );
      }
    }
  }

  private static rebuild(): void {
    const root = BuildPanel.root;
    const ctx = BuildPanel.ctx;
    if (!root || !ctx) return;
    root.removeChildren();
    BuildPanel.progressBar = null;

    const rows = BuildPanel.rows(ctx);
    const panelX = AppConfig.stageWidth - B.panelWidth - B.panelMargin;
    const panelY = B.panelMargin;
    const contentX = panelX + B.padX;
    const contentWidth = B.panelWidth - B.padX * 2;

    let height = B.padY * 2;
    for (const row of rows) height += row.button ? B.buttonHeight + 4 : B.lineHeight;
    BuildPanel.panelRect = { x: panelX, y: panelY, w: B.panelWidth, h: height };

    const bg = new Laya.Sprite();
    bg.mouseEnabled = false;
    bg.graphics.drawRect(panelX, panelY, B.panelWidth, height, B.panelBgColor);
    bg.graphics.drawRect(panelX, panelY, B.panelWidth, B.panelBorderWidth, B.panelBorderColor);
    root.addChild(bg);

    // 行带预排：命中区的加高要按「相邻行是否可点」夹边界，避免加高后误触到相邻的建造/投料/拆除
    const bands: { top: number; height: number; onClick?: () => void }[] = [];
    let y = panelY + B.padY;
    for (const row of rows) {
      const h = row.button ? B.buttonHeight : B.lineHeight;
      bands.push({ top: y, height: h, onClick: row.onClick });
      y += h + (row.button ? 4 : 0);
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const band = bands[i];
      const prev = bands[i - 1];
      const next = bands[i + 1];
      if (row.button) {
        const button = new Laya.Sprite();
        button.pos(contentX, band.top);
        button.size(contentWidth, B.buttonHeight);
        button.mouseEnabled = false;
        button.graphics.drawRect(0, 0, contentWidth, B.buttonHeight, row.bg ?? B.buttonBgColor);
        button.addChild(
          BuildPanel.makeText(
            row.text,
            6,
            Math.round((B.buttonHeight - B.lineFontSize) / 2),
            row.color,
          ),
        );
        root.addChild(button);
      } else {
        if (row.bg) {
          const hl = new Laya.Sprite();
          hl.mouseEnabled = false;
          hl.graphics.drawRect(contentX, band.top, contentWidth, B.lineHeight, row.bg);
          root.addChild(hl);
        }
        root.addChild(BuildPanel.makeText(row.text, contentX, band.top + 3, row.color));
      }
      BuildPanel.addRowHit(root, {
        x: contentX,
        width: contentWidth,
        top: band.top,
        height: band.height,
        // 可扩到相邻的**信息行**上（那行本来就没反应），但不越进相邻的**可点行**（否则会误触）
        minTop: prev ? (prev.onClick ? band.top : prev.top) : panelY,
        maxBottom: next
          ? next.onClick
            ? band.top + band.height
            : next.top + next.height
          : panelY + height,
        onClick: row.onClick,
      });
    }

    // 光标处建筑的进度条（每帧 refresh 重绘填充）
    const target = BuildPanel.buildingAt(BuildPanel.cursor.gx, BuildPanel.cursor.gy);
    if (target && target.state === 'building') {
      const bar = new Laya.Sprite();
      bar.mouseEnabled = false;
      bar.pos(contentX, y + 4);
      bar.size(contentWidth, B.progressBarHeight);
      root.addChild(bar);
      BuildPanel.progressBar = bar;
    }
  }

  /** 面板内容（模式提示 / 蓝图列表 / 选格与合法性 / 操作按钮） */
  private static rows(ctx: BuildPanelContext): PanelRow[] {
    const rows: PanelRow[] = [];
    const rule = ctx.rule;
    const forbidden = rule.mode === 'forbidden';

    rows.push({ text: '建造（B 关闭）', color: B.titleColor });
    rows.push({
      text: `模式：${rule.mode}　格 ${BuildPanel.gridSize()}px　上限 ${rule.maxBuildingsPerPlayer}`,
      color: forbidden ? B.illegalColor : B.lineColor,
    });

    if (forbidden) {
      rows.push({ text: '此场景不允许建造', color: B.illegalColor });
      rows.push({ text: '建造入口已禁用', color: B.dimColor });
      rows.push({
        text: '关闭面板（B）',
        color: B.dimColor,
        button: true,
        onClick: () => BuildPanel.close(),
      });
      return rows;
    }

    rows.push({ text: '—— 蓝图（Q/E 切换）——', color: B.dimColor });
    if (ctx.templates.length === 0) {
      rows.push({ text: '（暂无启用中的蓝图）', color: B.dimColor });
    }
    ctx.templates.forEach((t, i) => {
      const selected = i === BuildPanel.templateIndex;
      rows.push({
        text: `${selected ? '▸' : '　'}${t.name}　${costText(t.buildCost)}　${t.buildSeconds}s`,
        color: selected ? B.titleColor : B.lineColor,
        bg: selected ? B.selectedBgColor : undefined,
        onClick: () => {
          BuildPanel.templateIndex = i;
          BuildPanel.rebuild();
        },
      });
    });

    rows.push({ text: '—— 选格（点击地图选格）——', color: B.dimColor });
    const prediction = BuildPanel.prediction();
    rows.push({
      text: `格 (${BuildPanel.cursor.gx},${BuildPanel.cursor.gy})　${prediction.reason}`,
      color: prediction.legal ? B.legalColor : B.illegalColor,
    });

    const target = BuildPanel.buildingAt(BuildPanel.cursor.gx, BuildPanel.cursor.gy);
    if (target) {
      const template = BuildPanel.templateOf(target.templateId);
      const stateText =
        target.state === 'building'
          ? '建造中'
          : target.state === 'built'
            ? '已落成'
            : '拆除中';
      const durability = template ? `　耐久 ${template.durability}` : '';
      rows.push({
        text: `建筑 #${target.id}　${stateText}${durability}`,
        color: B.lineColor,
      });
    } else {
      rows.push({ text: '建筑：无', color: B.dimColor });
    }

    rows.push({ text: '—— 操作 ——', color: B.dimColor });
    rows.push({
      text: `建造（Enter）　${costText(BuildPanel.selectedTemplate()?.buildCost ?? [])}`,
      color: prediction.legal ? B.legalColor : B.dimColor,
      button: true,
      onClick: () => void BuildPanel.doBuild(),
    });
    rows.push({
      text: '投料（G）　共建场景向光标处建筑投料',
      color: target && target.state === 'building' ? B.lineColor : B.dimColor,
      button: true,
      onClick: () => void BuildPanel.doContribute(),
    });
    rows.push({
      text: '拆除（Del）　不返还材料',
      color: B.lineColor,
      button: true,
      onClick: () => void BuildPanel.doDemolish(),
    });
    // 手机上的退出口：触控「建造」按钮在面板下方，可能被面板盖住，且面板不吃指针 —— 必须有行内关闭
    rows.push({
      text: '关闭面板（B）',
      color: B.dimColor,
      button: true,
      onClick: () => BuildPanel.close(),
    });

    return rows;
  }

  /**
   * 追加一行的命中区（**不可见**，视觉尺寸不变）：高度取 `max(行带, touch.minHitHeight)` 并以行带为中心
   * 上下扩，扩的范围夹在 `minTop..maxBottom`（相邻可点行之间）与面板矩形内。
   * `onClick` 为空（信息行）则不建节点 —— 信息行本来就没有反应。
   *
   * **必须在行视觉之后 addChild**：引擎 `getSpriteUnderPoint` 逆序遍历子节点、取最先命中的那个，
   * 后加入的命中区因此盖过同行视觉（视觉 sprite 一律 `mouseEnabled=false`，避免两个目标争同一片区域）。
   * 用 `MOUSE_DOWN` 而非 `CLICK`：CLICK 要求按下到抬起位移小于 `clickTestThreshold`（10 舞台像素 ≈
   * 手机 4 CSS px），真实手指抖动会把它判掉（详见类注释）。
   */
  private static addRowHit(root: Laya.Sprite, spec: RowHit): void {
    if (!spec.onClick) return;
    const extra = Math.max(0, T.minHitHeight - spec.height) / 2;
    const panel = BuildPanel.panelRect;
    const top = Math.max(panel.y, spec.minTop, spec.top - extra);
    const bottom = Math.min(panel.y + panel.h, spec.maxBottom, spec.top + spec.height + extra);
    const hit = new Laya.Sprite();
    hit.name = 's6-build-hit';
    hit.pos(spec.x, top);
    hit.size(spec.width, Math.max(spec.height, bottom - top));
    hit.mouseEnabled = true;
    hit.on(Laya.Event.MOUSE_DOWN, null, spec.onClick);
    root.addChild(hit);
  }

  private static makeText(content: string, x: number, y: number, color: string): Laya.Text {
    const text = new Laya.Text();
    text.text = content;
    text.fontSize = B.lineFontSize;
    text.color = color;
    text.stroke = 2;
    text.strokeColor = '#000000';
    text.mouseEnabled = false;
    text.pos(x, y);
    return text;
  }
}

/** 半透明填充色：Laya 的 drawRect 不支持 alpha 参数，用 rgba 字符串表达 */
function fill(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 成本文案：道具 `道具#id×n` / 货币 `货币type×n` */
function costText(entries: readonly BuildCostEntry[]): string {
  if (!entries || entries.length === 0) return '无消耗';
  return entries
    .map((e) =>
      e.itemTemplateId !== undefined
        ? `道具#${e.itemTemplateId}×${e.amount}`
        : `货币${e.currencyType}×${e.amount}`,
    )
    .join(' ');
}

/**
 * 统一的错误出口：业务码走 ApiError，其余打日志
 */
function Toast(err: unknown): void {
  if (err instanceof ApiError) Hud.toast(`${err.message}（code=${err.code}）`);
  else {
    console.error('[S6] 建造请求失败', err);
    Hud.toast(String(err));
  }
}
