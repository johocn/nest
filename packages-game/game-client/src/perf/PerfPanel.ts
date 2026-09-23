import { AppConfig } from '../config/AppConfig';
import { EntityRegistry } from '../entity/EntityRegistry';
import { upPerSec } from './counters';
import { Quality, createFpsWatcher } from './Quality';
import type { FpsWatcher, QualityTier } from './Quality';

const P = AppConfig.perf;
const MOVE_CMD = 'world.move';

/**
 * S8 性能面板（**引擎内自绘，禁用 DOM / HTML**，小游戏端与 H5 一致，F3 开关）。
 * 只用已验证基元：`Laya.Sprite` + `graphics.drawRect` + `Laya.Text`（同 Hud/BuildPanel 同一套路），
 * 挂在 `Laya.stage` 顶层（屏幕空间，不随世界层滚动）。
 *
 * 指标口径（总纲 §12）：fps 取自**自计帧率**（每帧累加 ÷ 墙钟，每秒刷新一次），`Laya.Stat.FPS` 仅作交叉校验；
 * drawcall 读引擎统计（拿不到显示 n/a，绝不抛错）；实体总数/可见数来自 `EntityRegistry`；
 * 上行读 `perf/counters` 的 1 秒滑窗；内存 H5 用 `performance.memory`，小游戏端无该 API 时显示 n/a。
 *
 * 自动降级（D2/风险 #8）在此驱动：每秒把自计 fps 喂给 `createFpsWatcher`，连续 3 秒低于目标 80% → 降一档；
 * 存在强制覆盖（`Quality.override() !== null`）时不自动降级；本 Task 只降不升。
 */

/** `globalThis.__PERF__` 快照：供零依赖采样脚本 `page.evaluate` 读取（dev/验收钩子，非生产契约） */
interface PerfSnapshot {
  fps: number;
  statFps: number | null;
  drawcall: number | null;
  entityTotal: number;
  entityVisible: number;
  upPerSec: number;
  quality: QualityTier;
  heapMB: number | null;
}

/**
 * 引擎统计（2D drawcall）：`LayaGL.statAgent` 由 laya.webgl_2D 装载，枚举值挂在 `Laya.StatElement`
 * （实测：`LayaGL.StatElement` 为 undefined，`Laya.StatElement.CT_DrawCall=26`），故两条路径都试。
 * 任何一步拿不到都返回 null（面板显示 n/a），绝不抛错。
 */
function statDrawCall(): number | null {
  try {
    const L: any = (globalThis as any).Laya;
    const gl = L?.LayaGL;
    const el = L?.StatElement ?? gl?.StatElement;
    const agent = gl?.statAgent;
    if (!el || !agent || typeof agent.getElementData !== 'function') return null;
    const v = agent.getElementData(el.CT_DrawCall);
    // 引擎返回的是按采样窗口平滑过的浮点值，取整后才是「次数」语义
    return typeof v === 'number' && isFinite(v) ? Math.round(v) : null;
  } catch {
    return null;
  }
}

/** `Laya.Stat.FPS`（getter，每秒刷新一次）：仅作交叉校验，缺失返回 null */
function statFps(): number | null {
  try {
    const v: any = (globalThis as any).Laya?.Stat?.FPS;
    return typeof v === 'number' && isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** H5 堆内存（MB）：小游戏端无 `performance.memory` → null */
function heapMB(): number | null {
  try {
    const mem: any = (globalThis as any).performance?.memory;
    if (!mem || typeof mem.usedJSHeapSize !== 'number') return null;
    return Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10;
  } catch {
    return null;
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export class PerfPanel {
  private static root: Laya.Sprite | null = null;
  private static bg: Laya.Sprite | null = null;
  private static text: Laya.Text | null = null;
  private static visible = false;
  private static watcher: FpsWatcher | null = null;
  /** 自计帧率（指标口径）：每帧累加 frames，满一个 refreshMs 窗口结算一次 */
  private static frames = 0;
  private static windowStart = 0;
  private static fps = 0;

  /** 必须在 Laya.init 之后调用；重复调用无副作用 */
  static init(): void {
    if (PerfPanel.root) return;
    const root = new Laya.Sprite();
    root.name = 's8-perf-panel';
    root.zOrder = P.zOrder;
    root.mouseEnabled = false;
    root.visible = false;

    const bg = new Laya.Sprite();
    bg.mouseEnabled = false;
    const text = new Laya.Text();
    text.fontSize = P.fontSize;
    text.color = P.textColor;
    text.stroke = 2;
    text.strokeColor = '#000000';
    text.mouseEnabled = false;

    root.addChild(bg);
    root.addChild(text);
    Laya.stage.addChild(root);

    PerfPanel.root = root;
    PerfPanel.bg = bg;
    PerfPanel.text = text;
    PerfPanel.windowStart = Date.now();
    PerfPanel.refreshWatcher();

    Laya.stage.on(Laya.Event.KEY_DOWN, PerfPanel, PerfPanel.onKeyDown);
    // 始终每帧计数（面板隐藏时也计，否则 __PERF__ 快照会失真）；只累加、不重绘
    Laya.timer.frameLoop(1, PerfPanel, PerfPanel.onFrame);
    console.log(`[S8] PerfPanel 就绪：F3 开关 zOrder=${P.zOrder}（引擎内自绘，无 DOM）`);
  }

  static get isVisible(): boolean {
    return PerfPanel.visible;
  }

  static toggle(): void {
    PerfPanel.show(!PerfPanel.visible);
  }

  static show(on: boolean): void {
    if (!PerfPanel.root) return;
    PerfPanel.visible = on;
    PerfPanel.root.visible = on;
    if (on) PerfPanel.render();
  }

  // ── 交互 / 采样 ──────────────────────────────────────────────────────────

  private static onKeyDown(e: Laya.Event): void {
    // 与 PlayerControl.normKey 同口径：Laya 事件不携带 keyCode，只代理 nativeEvent.key
    const key = String((e as unknown as { key?: string }).key ?? '').toLowerCase();
    if (key === 'f3') PerfPanel.toggle();
  }

  /** 每帧：累加计数；满一个采样窗口才结算 fps 并（可见时）重绘文本 */
  private static onFrame(): void {
    PerfPanel.frames++;
    const now = Date.now();
    const elapsed = now - PerfPanel.windowStart;
    if (elapsed < P.refreshMs) return;

    PerfPanel.fps = elapsed > 0 ? round1((PerfPanel.frames * 1000) / elapsed) : 0;
    PerfPanel.frames = 0;
    PerfPanel.windowStart = now;

    PerfPanel.autoDegrade(PerfPanel.fps, now);
    if (PerfPanel.visible) PerfPanel.render();
  }

  /** 目标帧率随档位取值：低帧连续 sustainMs 才降一档；有强制覆盖时不介入 */
  private static refreshWatcher(): void {
    const targetFps = Quality.tier() === 'low' ? P.targetFpsLow : P.targetFpsHigh;
    PerfPanel.watcher = createFpsWatcher({
      targetFps,
      ratio: P.degradeRatio,
      sustainMs: P.sustainMs,
    });
  }

  private static autoDegrade(fps: number, now: number): void {
    if (!PerfPanel.watcher || Quality.override() !== null) return;
    if (PerfPanel.watcher.push(fps, now)) {
      Quality.setTier('low');
      console.log(
        `[S8] 连续 ${P.sustainMs}ms fps 低于目标 ${Math.round(P.degradeRatio * 100)}% → 自动降级 quality=low`,
      );
    }
  }

  // ── 渲染 ────────────────────────────────────────────────────────────────

  private static render(): void {
    const text = PerfPanel.text;
    const bg = PerfPanel.bg;
    if (!text || !bg) return;
    text.text = PerfPanel.lines().join('\n');

    const w = text.textWidth + P.padX * 2;
    const h = text.textHeight + P.padY * 2;
    bg.graphics.clear();
    bg.graphics.drawRect(P.x, P.y, w, h, P.bgColor);
    text.pos(P.x + P.padX, P.y + P.padY);
  }

  private static lines(): string[] {
    const snap = PerfPanel.snapshot();
    const all = EntityRegistry.all();
    let visible = 0;
    for (const e of all) if (e.sprite.visible !== false) visible++;

    // 自计 fps 与 Stat.FPS 交叉校验：相差超阈值只在面板上标注，不报错
    const stat = snap.statFps;
    const fpsLine =
      stat === null
        ? `fps ${snap.fps.toFixed(1)} (stat n/a)`
        : Math.abs(stat - snap.fps) > P.statFpsTolerance
          ? `fps ${snap.fps.toFixed(1)} (stat ${stat.toFixed(1)} 偏差超 ${P.statFpsTolerance})`
          : `fps ${snap.fps.toFixed(1)} (stat ${stat.toFixed(1)})`;

    const s = Quality.switches();
    return [
      fpsLine,
      `drawcall ${snap.drawcall === null ? 'n/a' : snap.drawcall}`,
      `实体 ${all.length}/${visible}（总/可见）`,
      `上行 ${MOVE_CMD} ${snap.upPerSec}/s`,
      `quality ${snap.quality} 名标签${s.nameLabels ? '开' : '关'} 网格${s.gridLines ? '开' : '关'} 描边${
        s.triggerOutline ? '开' : '关'
      } 插值${s.interpPrecision === 'full' ? '全' : '降'} 远端${s.remoteUpdateHz}Hz`,
      `内存 ${snap.heapMB === null ? 'n/a' : `${snap.heapMB}MB`}`,
    ];
  }

  /** 采样快照：面板与自动化钩子共用（面板隐藏时 fps 仍在计，故快照始终有意义） */
  static snapshot(): PerfSnapshot {
    return {
      fps: PerfPanel.fps,
      statFps: statFps(),
      drawcall: statDrawCall(),
      entityTotal: EntityRegistry.all().length,
      entityVisible: EntityRegistry.all().filter((e) => e.sprite.visible !== false).length,
      upPerSec: upPerSec(MOVE_CMD),
      quality: Quality.tier(),
      heapMB: heapMB(),
    };
  }
}

/**
 * 自动化钩子（**dev/验收专用**，非生产契约）：零依赖采样脚本用 `page.evaluate` 读这里，
 * 替代人工点检作为 Task 2-5 的回归门禁。模块顶层只挂纯函数，不触碰 Laya —— 只在被调用时读引擎。
 */
(globalThis as any).__PERF__ = {
  snapshot(): PerfSnapshot {
    return PerfPanel.snapshot();
  },
  /** 面板开关：不传参 → 切换并返回新状态；传参 → 设定并返回该状态 */
  panel(on?: boolean): boolean {
    if (on === undefined) PerfPanel.toggle();
    else PerfPanel.show(on);
    return PerfPanel.isVisible;
  },
  /** 强制切档（验收手动切档用；设置后自动降级不再介入） */
  quality(tier: QualityTier): void {
    Quality.forceTier(tier);
  },
};