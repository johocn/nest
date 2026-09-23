import { AppConfig } from '../config/AppConfig';
import { Platform } from '../platform/Platform';

/**
 * S8 质量分级（计划 D2/D3）：只做**开关**，不做内容 —— 开关由 Task 2/3/4/5 消费，
 * 本模块不触及 SceneBuilder / Entity 的绘制行为。
 *
 * 本模块不触碰 Laya（只 import 常量与 Platform），可被零依赖断言脚本直接 import（同 S3-S6 的 smoke 惯例）。
 */

export type QualityTier = 'high' | 'low';

/** 降级项开关（D3 五项）：high/low 两档取值集中在 `TIER_SWITCHES` 一张表，禁止散落魔法数字 */
export interface QualitySwitches {
  /** 名标签显示（Task 3 消费） */
  nameLabels: boolean;
  /** 网格线（Task 3 消费） */
  gridLines: boolean;
  /** 触发区描边（Task 3 消费） */
  triggerOutline: boolean;
  /** 插值精度（Task 5 消费） */
  interpPrecision: 'full' | 'reduced';
  /** 远端实体位置更新频率 Hz（Task 5 消费） */
  remoteUpdateHz: number;
}

const TIER_SWITCHES: Record<QualityTier, QualitySwitches> = {
  high: {
    nameLabels: true,
    gridLines: true,
    triggerOutline: true,
    interpPrecision: 'full',
    remoteUpdateHz: 10,
  },
  low: {
    nameLabels: false,
    gridLines: false,
    triggerOutline: false,
    interpPrecision: 'reduced',
    remoteUpdateHz: 5,
  },
};

/** 覆盖值归一化：非 high/low 一律忽略（不静默猜测，也不抛错） */
function normalizeTier(value: unknown): QualityTier | null {
  return value === 'high' || value === 'low' ? value : null;
}

export interface ResolveTierInput {
  platform: 'minigame' | 'h5';
  /** `AppConfig.quality`：'auto' 表示交由平台默认 */
  config?: string;
  urlOverride?: string | null;
  envOverride?: string | null;
}

/**
 * 档位解析（纯函数）：URL 参数 > `__ENV__` 注入 > `AppConfig.quality`（非 auto）> 平台默认（小游戏 low / H5 high）。
 * 宿主读取（location / `__ENV__`）放在 `Quality.init` 侧，本函数只吃显式入参，便于 node 断言优先级。
 */
export function resolveTier(input: ResolveTierInput): QualityTier {
  return (
    normalizeTier(input.urlOverride) ??
    normalizeTier(input.envOverride) ??
    normalizeTier(input.config) ??
    (input.platform === 'minigame' ? 'low' : 'high')
  );
}

export interface FpsWatcherOptions {
  targetFps: number;
  /** 低于目标 fps × ratio 视为「低帧」 */
  ratio: number;
  /** 低帧连续维持该时长才降级（风险 #8：单次抖动不得触发） */
  sustainMs: number;
}

export interface FpsWatcher {
  /** 喂入一次采样（每秒一次）；返回 true = 本轮应降一档（只降不升，返回过后不再返回 true） */
  push(fps: number, nowMs: number): boolean;
  degraded(): boolean;
}

/**
 * 自动降级判定（纯逻辑，可 node 断言）：低帧**连续**维持 `sustainMs` 才触发一次；
 * 中间恢复一帧即重置计时（抖动不降）；降级后永久返回 false（本 Task 只降不升）。
 */
export function createFpsWatcher(opts: FpsWatcherOptions): FpsWatcher {
  const threshold = opts.targetFps * opts.ratio;
  let lowSince: number | null = null;
  let fired = false;
  return {
    push(fps: number, nowMs: number): boolean {
      if (fired) return false;
      if (!(fps < threshold)) {
        lowSince = null;
        return false;
      }
      if (lowSince === null) {
        lowSince = nowMs;
        return false;
      }
      if (nowMs - lowSince >= opts.sustainMs) {
        fired = true;
        return true;
      }
      return false;
    },
    degraded: () => fired,
  };
}

/** 覆盖来源的取值：URL `?quality=high|low` */
function readUrlOverride(): string | null {
  const loc = (globalThis as any).location;
  if (!loc || typeof loc.search !== 'string') return null;
  const m = /[?&]quality=([^&]+)/.exec(loc.search);
  return m ? decodeURIComponent(m[1]) : null;
}

/** 覆盖来源的取值：构建期注入 `globalThis.__ENV__.quality`（S7 已有机制） */
function readEnvOverride(): string | null {
  const env = (globalThis as any).__ENV__;
  const v = env && typeof env === 'object' ? env.quality : null;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function summarize(tier: QualityTier): string {
  const s = TIER_SWITCHES[tier];
  return (
    `nameLabels=${s.nameLabels ? 1 : 0} gridLines=${s.gridLines ? 1 : 0} ` +
    `triggerOutline=${s.triggerOutline ? 1 : 0} interp=${s.interpPrecision} remoteHz=${s.remoteUpdateHz}`
  );
}

let currentTier: QualityTier = 'high';
/** 强制覆盖档位（URL/ENV 或验收手动）：非 null 时自动降级不得改档（风险 #8） */
let forced: QualityTier | null = null;
const listeners = new Set<(tier: QualityTier, switches: QualitySwitches) => void>();

function emit(): void {
  for (const cb of listeners) cb(currentTier, { ...TIER_SWITCHES[currentTier] });
}

export const Quality = {
  /** 读平台与三处覆盖、解析档位并打一行日志（须在引擎起来后、进场景前调用） */
  init(): QualityTier {
    const platform: 'minigame' | 'h5' = Platform.isMiniGame() ? 'minigame' : 'h5';
    const urlOverride = readUrlOverride();
    const envOverride = readEnvOverride();
    currentTier = resolveTier({
      platform,
      config: AppConfig.quality,
      urlOverride,
      envOverride,
    });
    forced = normalizeTier(urlOverride) ?? normalizeTier(envOverride);
    console.log(
      `[S8] quality=${currentTier} switches=${summarize(currentTier)}` +
        ` (platform=${platform} url=${urlOverride ?? '-'} env=${envOverride ?? '-'} config=${AppConfig.quality})`,
    );
    return currentTier;
  },

  tier(): QualityTier {
    return currentTier;
  },

  /** 当前档位生效的开关（返回副本，调用方改不动内部表） */
  switches(): QualitySwitches {
    return { ...TIER_SWITCHES[currentTier] };
  },

  /** 切档（自动降级 / 手动）：变化时通知 onChange */
  setTier(tier: QualityTier): void {
    if (tier === currentTier) return;
    currentTier = tier;
    emit();
  },

  /** 强制覆盖（用于验收手动切档）：设置后自动降级不再生效；传 null 解除覆盖 */
  forceTier(tier: QualityTier | null): void {
    forced = tier;
    if (tier && tier !== currentTier) {
      currentTier = tier;
      emit();
    }
  },

  /** 当前强制覆盖档位（null = 未覆盖）；自动降级前须检查此值 */
  override(): QualityTier | null {
    return forced;
  },

  /** 注册档位变化回调，返回注销函数 */
  onChange(cb: (tier: QualityTier, switches: QualitySwitches) => void): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};