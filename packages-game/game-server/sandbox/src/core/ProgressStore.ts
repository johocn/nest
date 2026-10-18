import { GameSummary, GameLevel } from '../config/GameConfig';

/** 历史最佳一局的快照（用于复盘对照） */
export interface BestRun {
  returnRate: number;
  maxDrawdown: number;
  rating: string;
  /** 教学目标达成数 */
  missions: number;
  /** 教学目标总数 */
  total: number;
  days: number;
  /** 总资产曲线（降采样后） */
  curve: { date: string; total: number }[];
}

/** 单局轨迹记录（用于跨局成长对比，最多保留近若干局） */
export interface RunRecord {
  returnRate: number;
  maxDrawdown: number;
  rating: string;
  missions: number;
  total: number;
  days: number;
  level: GameLevel;
  date: string;
}

/** 多局轨迹统计 */
export interface RunsStats {
  count: number;
  avgReturn: number;
  bestReturn: number;
}

/** 本地存档（localStorage，不可用时静默降级为内存态） */
export interface SandboxProgress {
  /** 历史最高总收益率 */
  bestReturnRate: number;
  /** 最高收益率那局的评级 */
  bestRating: string;
  /** 已完成的局数 */
  games: number;
  /** 累计达成过的教学目标 id */
  missionsEverDone: string[];
  /** 最近一次选择的难度 */
  lastLevel: GameLevel;
  /** 历史最佳一局快照（含曲线，供成绩单对比） */
  best: BestRun | null;
  /** 最近完成时间（ISO） */
  lastPlayed: string;
  /** 近局轨迹（最多保留 MAX_RUNS 条，用于成长对比） */
  runs: RunRecord[];
}

const KEY = 'financial-sandbox/progress-v1';
/** 存档曲线最大点数（超出则等间隔降采样，控制 localStorage 体积） */
const MAX_CURVE_POINTS = 80;
/** 留存近局轨迹条数上限 */
const MAX_RUNS = 12;

const EMPTY: SandboxProgress = {
  bestReturnRate: 0,
  bestRating: '—',
  games: 0,
  missionsEverDone: [],
  lastLevel: 'balanced',
  best: null,
  lastPlayed: '',
  runs: [],
};

/** 等间隔降采样曲线 */
function downsample(
  curve: { date: string; total: number }[],
  max: number,
): { date: string; total: number }[] {
  if (curve.length <= max) return curve.slice();
  const step = (curve.length - 1) / (max - 1);
  const out: { date: string; total: number }[] = [];
  for (let i = 0; i < max; i++) out.push(curve[Math.round(i * step)]);
  return out;
}

/** 本局 vs 历史最佳的差异（best 为 null 时返回 null） */
export function compareToBest(
  summary: GameSummary,
  best: BestRun | null,
): {
  returnRateDelta: number;
  drawdownDelta: number;
  missionDelta: number;
  better: boolean;
} | null {
  if (!best) return null;
  return {
    returnRateDelta: summary.totalReturnRate - best.returnRate,
    drawdownDelta: summary.maxDrawdown - best.maxDrawdown,
    missionDelta: summary.missions.completed - best.missions,
    better: summary.totalReturnRate > best.returnRate,
  };
}

/** 近局轨迹统计（空则返回 null） */
export function runsStats(runs: readonly RunRecord[]): RunsStats | null {
  if (!runs.length) return null;
  const rates = runs.map((r) => r.returnRate);
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  return { count: runs.length, avgReturn: avg, bestReturn: Math.max(...rates) };
}

/** 存档读写：跨局留存历史最佳与累计达成任务 */
export class ProgressStore {
  private _data: SandboxProgress;
  private _available: boolean;
  private _storage: Storage | null;

  constructor(storage: Storage | null = safeStorage()) {
    this._available = !!storage;
    this._storage = storage;
    this._data = storage ? this._read(storage) : { ...EMPTY };
  }

  /** localStorage 是否可用 */
  get available(): boolean {
    return this._available;
  }

  /** 当前存档快照 */
  get data(): SandboxProgress {
    return this._data;
  }

  /** 结算后写入；返回是否刷新历史最佳 */
  save(
    summary: GameSummary,
    doneMissionIds: string[],
    level?: GameLevel,
    curve?: { date: string; total: number }[],
  ): { isNewBest: boolean } {
    const isNewBest = summary.totalReturnRate > this._data.bestReturnRate;
    const best: BestRun | null = isNewBest
      ? {
          returnRate: summary.totalReturnRate,
          maxDrawdown: summary.maxDrawdown,
          rating: summary.rating,
          missions: summary.missions.completed,
          total: summary.missions.total,
          days: summary.days,
          curve: downsample(curve ?? [], MAX_CURVE_POINTS),
        }
      : this._data.best;
    this._data = {
      bestReturnRate: isNewBest
        ? summary.totalReturnRate
        : this._data.bestReturnRate,
      bestRating: isNewBest ? summary.rating : this._data.bestRating,
      games: this._data.games + 1,
      missionsEverDone: unique([
        ...this._data.missionsEverDone,
        ...doneMissionIds,
      ]),
      lastLevel: level ?? this._data.lastLevel,
      best,
      lastPlayed: new Date().toISOString(),
      runs: this._data.runs,
    };
    this._persist();
    return { isNewBest };
  }

  /** 清空存档（调试用） */
  reset(): void {
    this._data = { ...EMPTY, missionsEverDone: [], best: null };
    const storage = this._storage;
    if (storage) {
      try {
        storage.removeItem(KEY);
      } catch {
        /* 忽略 */
      }
    }
  }

  /** 记录一局轨迹（结算时调用），最多保留 MAX_RUNS 条，并持久化 */
  recordRun(summary: GameSummary): void {
    const rec: RunRecord = {
      returnRate: summary.totalReturnRate,
      maxDrawdown: summary.maxDrawdown,
      rating: summary.rating,
      missions: summary.missions.completed,
      total: summary.missions.total,
      days: summary.days,
      level: summary.level,
      date: new Date().toISOString(),
    };
    const runs = [...this._data.runs, rec].slice(-MAX_RUNS);
    this._data = { ...this._data, runs };
    this._persist();
  }

  private _read(storage: Storage): SandboxProgress {
    try {
      const raw = storage.getItem(KEY);
      if (!raw) return { ...EMPTY, missionsEverDone: [], best: null };
      const parsed = JSON.parse(raw) as Partial<SandboxProgress>;
      return {
        bestReturnRate: num(parsed.bestReturnRate),
        bestRating:
          typeof parsed.bestRating === 'string' ? parsed.bestRating : '—',
        games: num(parsed.games),
        missionsEverDone: Array.isArray(parsed.missionsEverDone)
          ? parsed.missionsEverDone
          : [],
        lastLevel:
          parsed.lastLevel === 'conservative' ||
          parsed.lastLevel === 'aggressive'
            ? parsed.lastLevel
            : 'balanced',
        best: this._readBest(parsed.best),
        lastPlayed:
          typeof parsed.lastPlayed === 'string' ? parsed.lastPlayed : '',
        runs: this._readRuns(parsed.runs),
      };
    } catch (e) {
      console.warn('[ProgressStore] 读取失败，按空存档处理：', e);
      return { ...EMPTY, missionsEverDone: [], best: null };
    }
  }

  /** 读取并校验近局轨迹（非法项过滤） */
  private _readRuns(runs: unknown): RunRecord[] {
    if (!Array.isArray(runs)) return [];
    return runs
      .filter(
        (r) =>
          r &&
          typeof r === 'object' &&
          typeof (r as RunRecord).returnRate === 'number',
      )
      .map((r) => {
        const x = r as RunRecord;
        return {
          returnRate: num(x.returnRate),
          maxDrawdown: num(x.maxDrawdown),
          rating: typeof x.rating === 'string' ? x.rating : '—',
          missions: num(x.missions),
          total: num(x.total),
          days: num(x.days),
          level: (x.level === 'conservative' || x.level === 'aggressive'
            ? x.level
            : 'balanced') as GameLevel,
          date: typeof x.date === 'string' ? x.date : '',
        };
      })
      .slice(-MAX_RUNS);
  }

  /** 读取并校验历史最佳快照（曲线过滤非法点） */
  private _readBest(best: unknown): BestRun | null {
    if (!best || typeof best !== 'object') return null;
    const b = best as Partial<BestRun>;
    const curve = Array.isArray(b.curve)
      ? b.curve.filter(
          (p) => p && typeof p.date === 'string' && typeof p.total === 'number',
        )
      : [];
    return {
      returnRate: num(b.returnRate),
      maxDrawdown: num(b.maxDrawdown),
      rating: typeof b.rating === 'string' ? b.rating : '—',
      missions: num(b.missions),
      total: num(b.total),
      days: num(b.days),
      curve,
    };
  }

  /** 持久化当前数据到 localStorage */
  private _persist(): void {
    const storage = this._storage;
    if (!storage) return;
    try {
      storage.setItem(KEY, JSON.stringify(this._data));
      this._available = true;
    } catch (e) {
      console.warn('[ProgressStore] 写入失败：', e);
      this._available = false;
    }
  }
}

const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;
const unique = (arr: string[]) => Array.from(new Set(arr));

/** 安全获取 localStorage（隐私模式 / 非浏览器环境下返回 null） */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
