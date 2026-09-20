/**
 * 风控检测纯函数：回环对敲 / 失衡赠与 / 价值异动三类信号判定 + 账号评分。
 * 线上批扫（wash.service）与只读回放（replay.service）复用同一实现，杜绝两套口径漂移。
 * 无 IO、无外部状态（阈值由调用方注入），便于按阈值量化命中。
 */
import { RiskCaseType, RiskLevel } from '@constants/enums';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

export interface RiskFlowInput {
  fromId: string;
  toId: string;
  assetKey: string;
  value: string;
}

/** 检测阈值对象（来源：remote_configs 的 risk.* 键 或 回放 override） */
export interface RiskThresholds {
  pairMinAmount: number;
  roundtripTotalMin: number;
  onewayBigAmount: number;
  onewayBackflowRatio: number;
  priceDevRatio: number;
  priceDevFreq: number;
  scoreCap: number;
  watchScore: number;
  highScore: number;
}

export interface RiskSignal {
  caseType: RiskCaseType;
  score: number;
  fromId: string;
  toId: string;
  detail: Record<string, any>;
}

export interface DetectResult {
  signals: RiskSignal[];
}

export interface RiskAccountScore {
  playerId: string;
  score: number;
  level: RiskLevel;
}

/** 阈值字段 ↔ remote_configs 键名映射 */
export const RISK_THRESHOLD_KEY_MAP: Record<keyof RiskThresholds, string> = {
  pairMinAmount: 'risk.pair_min_amount',
  roundtripTotalMin: 'risk.roundtrip_total_min',
  onewayBigAmount: 'risk.oneway_big_amount',
  onewayBackflowRatio: 'risk.oneway_backflow_ratio',
  priceDevRatio: 'risk.price_dev_ratio',
  priceDevFreq: 'risk.price_dev_freq',
  scoreCap: 'risk.score_cap',
  watchScore: 'risk.watch_score',
  highScore: 'risk.high_score',
};

/** 检测阈值代码默认（与远程未配置时的 fallback 一致，见 16.10） */
export const RISK_THRESHOLD_DEFAULTS: RiskThresholds = {
  pairMinAmount: 0,
  roundtripTotalMin: 1000,
  onewayBigAmount: 3000,
  onewayBackflowRatio: 0,
  priceDevRatio: 2,
  priceDevFreq: 3,
  scoreCap: 100,
  watchScore: 40,
  highScore: 70,
};

/** 以默认值为基底，逐键应用回放 override（只认检测阈值键） */
export function buildRiskThresholds(overrides?: Record<string, number>): RiskThresholds {
  const t: RiskThresholds = { ...RISK_THRESHOLD_DEFAULTS };
  if (overrides) {
    for (const [k, v] of Object.entries(RISK_THRESHOLD_KEY_MAP)) {
      if (overrides[v] !== undefined) {
        (t as any)[k] = overrides[v];
      }
    }
  }
  return t;
}

/** 校验 configOverrides：仅允许检测阈值键 + 有限数值，非法即 92901 */
export function assertValidThresholdOverrides(overrides?: Record<string, number>): void {
  if (!overrides) return;
  const allowed = new Set(Object.values(RISK_THRESHOLD_KEY_MAP));
  for (const [k, v] of Object.entries(overrides)) {
    if (!allowed.has(k) || typeof v !== 'number' || !Number.isFinite(v)) {
      throw new GameException(ErrorCodes.RISK_CASE_NOT_FOUND, `非法风控回放阈值键: ${k}`);
    }
  }
}

/**
 * 窗口内三类检测判定，输出信号列表。
 * 口径与线上定时批扫完全一致：对敲/失衡按 fromId|toId 归一化对账，异动按 assetKey 分组对均值偏离。
 */
export function detectWindow(flows: RiskFlowInput[], t: RiskThresholds): DetectResult {
  const signals: RiskSignal[] = [];

  // 1) 回环对敲 + 失衡赠与：pair 对账
  const pairTotal = new Map<string, { a2b: number; b2a: number; a: string; b: string }>();
  for (const f of flows) {
    const v = Number(f.value);
    const key = [f.fromId, f.toId].sort().join('|');
    const rec = pairTotal.get(key) ?? { a2b: 0, b2a: 0, a: '', b: '' };
    if (!rec.a) rec.a = f.fromId;
    if (!rec.b) rec.b = f.toId;
    if (f.fromId === rec.a) rec.a2b += v;
    else rec.b2a += v;
    pairTotal.set(key, rec);
  }
  for (const { a, b, a2b, b2a } of pairTotal.values()) {
    const total = a2b + b2a;
    const m = Math.max(a2b, b2a) || 1;
    if (a2b >= t.pairMinAmount && b2a >= t.pairMinAmount && total >= t.roundtripTotalMin && Math.abs(a2b - b2a) / m <= 0.2) {
      signals.push({ caseType: RiskCaseType.ROUND_TRIP, score: 60, fromId: a, toId: b, detail: { a2b, b2a } });
    }
    if (a2b >= t.onewayBigAmount && b2a / (a2b || 1) <= t.onewayBackflowRatio) {
      signals.push({ caseType: RiskCaseType.ONE_WAY, score: 40, fromId: a, toId: b, detail: { a2b, b2a } });
    }
  }

  // 2) 价值异动：同 assetKey 短时对倒数≥freq 且价格偏离均值>ratio
  const byAsset = new Map<string, { vals: number[]; u: Array<{ a: string; b: string }> }>();
  for (const f of flows) {
    const rec = byAsset.get(f.assetKey) ?? { vals: [], u: [] };
    rec.vals.push(Number(f.value));
    rec.u.push({ a: f.fromId, b: f.toId });
    byAsset.set(f.assetKey, rec);
  }
  for (const [asset, { vals, u }] of byAsset.entries()) {
    if (vals.length < t.priceDevFreq) continue;
    const mean = vals.reduce((s, n) => s + n, 0) / vals.length;
    for (let i = 0; i < vals.length; i++) {
      if (mean > 0 && vals[i] > mean * t.priceDevRatio) {
        signals.push({
          caseType: RiskCaseType.PRICE_DIVERGENCE,
          score: 30,
          fromId: u[i].a,
          toId: u[i].b,
          detail: { asset, value: vals[i], mean },
        });
        break;
      }
    }
  }

  return { signals };
}

/** 账号评分：按涉事账号累计即时信号分、封顶 score_cap、按 watch/high 评级 */
export function scoreAccount(signals: RiskSignal[], t: RiskThresholds): RiskAccountScore[] {
  const byPlayer = new Map<string, number>();
  for (const s of signals) {
    const add = (pid: string) => byPlayer.set(pid, (byPlayer.get(pid) ?? 0) + s.score);
    add(s.fromId);
    add(s.toId);
  }
  const out: RiskAccountScore[] = [];
  for (const [playerId, raw] of byPlayer) {
    const score = Math.min(raw, t.scoreCap);
    const level = score >= t.highScore ? RiskLevel.HIGH : score >= t.watchScore ? RiskLevel.WATCH : RiskLevel.NORMAL;
    out.push({ playerId, score, level });
  }
  return out;
}