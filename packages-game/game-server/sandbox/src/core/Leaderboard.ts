import { GameConfig, GameLevel, GameSummary } from '../config/GameConfig';

/** 排行榜一条成绩 */
export interface LeaderboardEntry {
  id: string;
  name: string;
  seed: number;
  level: GameLevel;
  /** 行情情景 id */
  scenario: string;
  /** 总收益率（小数，0.12 = 12%） */
  returnRate: number;
  maxDrawdown: number;
  rating: string;
  missions: number;
  total: number;
  days: number;
  createdAt: number;
}

/** 提交成绩的上送字段（不含服务端生成的 id / createdAt） */
export interface ScoreSubmission {
  name: string;
  seed: number;
  level: GameLevel;
  scenario: string;
  returnRate: number;
  maxDrawdown: number;
  rating: string;
  missions: number;
  total: number;
  days: number;
}

export type LeaderboardScope = 'all' | 'scenario' | 'level';

export interface LeaderboardQuery {
  scope?: LeaderboardScope;
  scenario?: string;
  level?: GameLevel;
  limit?: number;
}

export interface LeaderboardResult {
  ok: true;
  scope: LeaderboardScope;
  total: number;
  entries: LeaderboardEntry[];
}
export interface LeaderboardError {
  ok: false;
  error: string;
}
export type LeaderboardResponse = LeaderboardResult | LeaderboardError;

export interface SubmitResult {
  ok: true;
  entry: LeaderboardEntry;
  rank: number;
}
export type SubmitResponse = SubmitResult | LeaderboardError;

const RATING_RANK: Record<string, number> = { A: 4, B: 3, C: 2, D: 1 };

/** 排序：收益率降序 → 回撤升序 → 评级降序 → 提交时间升序（纯函数，供测试与后端复用） */
export function sortEntries(
  list: readonly LeaderboardEntry[],
): LeaderboardEntry[] {
  return [...list].sort((a, b) => {
    if (b.returnRate !== a.returnRate) return b.returnRate - a.returnRate;
    if (a.maxDrawdown !== b.maxDrawdown) return a.maxDrawdown - b.maxDrawdown;
    const ra = RATING_RANK[b.rating] || 0;
    const rb = RATING_RANK[a.rating] || 0;
    if (ra !== rb) return ra - rb;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

function inScope(entry: LeaderboardEntry, query: LeaderboardQuery): boolean {
  if (query.scope === 'scenario') return entry.scenario === query.scenario;
  if (query.scope === 'level') return entry.level === query.level;
  return true;
}

/** 给定成绩在指定范围内列表里的 1-based 排名（0 表示未找到） */
export function rankInList(
  entries: readonly LeaderboardEntry[],
  id: string,
): number {
  const idx = entries.findIndex((e) => e.id === id);
  return idx < 0 ? 0 : idx + 1;
}

/** 严格优于 b 的判定（与后端一致） */
function isBetter(a: LeaderboardEntry, b: LeaderboardEntry): boolean {
  if (a.returnRate !== b.returnRate) return a.returnRate > b.returnRate;
  if (a.maxDrawdown !== b.maxDrawdown) return a.maxDrawdown < b.maxDrawdown;
  const ra = RATING_RANK[a.rating] || 0;
  const rb = RATING_RANK[b.rating] || 0;
  if (ra !== rb) return ra > rb;
  return (a.createdAt || 0) < (b.createdAt || 0);
}

/** 计算某成绩在给定范围内的排名（不依赖已拉取列表，用于「我的排名」预估） */
export function rankInScope(
  all: readonly LeaderboardEntry[],
  query: LeaderboardQuery,
  probe: LeaderboardEntry,
): number {
  const filtered = all.filter((e) => inScope(e, query));
  const better = filtered.filter((e) => isBetter(e, probe)).length;
  return better + 1;
}

/** 从结算成绩单构造提交对象 */
export function submissionFromSummary(
  summary: GameSummary,
  name: string,
  seed: number,
): ScoreSubmission {
  return {
    name,
    seed,
    level: summary.level,
    scenario: summary.scenario.id,
    returnRate: summary.totalReturnRate,
    maxDrawdown: summary.maxDrawdown,
    rating: summary.rating,
    missions: summary.missions.completed,
    total: summary.missions.total,
    days: summary.days,
  };
}

/** 排行榜后端客户端：所有方法在网络异常时优雅降级（返回 ok:false，不抛错、不打印 console.error） */
export class LeaderboardClient {
  constructor(private readonly apiBase: string = GameConfig.API_BASE) {}

  private _url(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): string {
    const base = this.apiBase.replace(/\/$/, '');
    let u = `${base}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== '') params.set(k, String(v));
      }
      const s = params.toString();
      if (s) u += `?${s}`;
    }
    return u;
  }

  /** 提交一局成绩，返回服务端生成的条目与全量排名 */
  async submitScore(s: ScoreSubmission): Promise<SubmitResponse> {
    try {
      const res = await fetch(this._url('/leaderboard'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
      if (!res.ok) return { ok: false, error: `http ${res.status}` };
      return (await res.json()) as SubmitResponse;
    } catch (e) {
      return { ok: false, error: 'network' };
    }
  }

  /** 拉取榜单（按范围过滤 + 限制条数） */
  async fetchLeaderboard(
    query: LeaderboardQuery = {},
  ): Promise<LeaderboardResponse> {
    try {
      const q: Record<string, string | number | undefined> = {
        scope: query.scope ?? 'all',
        limit: query.limit ?? 50,
      };
      if (query.scope === 'scenario') q.scenario = query.scenario;
      if (query.scope === 'level') q.level = query.level;
      const res = await fetch(this._url('/leaderboard', q));
      if (!res.ok) return { ok: false, error: `http ${res.status}` };
      return (await res.json()) as LeaderboardResponse;
    } catch (e) {
      return { ok: false, error: 'network' };
    }
  }

  /** 计算某成绩在指定范围的排名（不上送、不存储） */
  async fetchMyRank(
    probe: { returnRate: number; maxDrawdown: number; rating: string },
    query: LeaderboardQuery = {},
  ): Promise<
    { ok: true; scope: string; rank: number; total: number } | LeaderboardError
  > {
    try {
      const q: Record<string, string | number | undefined> = {
        scope: query.scope ?? 'all',
        returnRate: probe.returnRate,
        maxDrawdown: probe.maxDrawdown,
        rating: probe.rating,
      };
      if (query.scope === 'scenario') q.scenario = query.scenario;
      if (query.scope === 'level') q.level = query.level;
      const res = await fetch(this._url('/leaderboard/me', q));
      if (!res.ok) return { ok: false, error: `http ${res.status}` };
      return (await res.json()) as {
        ok: true;
        scope: string;
        rank: number;
        total: number;
      };
    } catch (e) {
      return { ok: false, error: 'network' };
    }
  }
}

/** 默认单例 */
export const leaderboard = new LeaderboardClient();
