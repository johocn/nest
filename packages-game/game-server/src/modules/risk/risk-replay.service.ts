/**
 * 风控阈值只读回放引擎：用已摄入的 risk_wash_flows 历史重放三类检测 + 账号评分，
 * 输出命中清单与分数档位分布，供运营量化阈值命中量（阈值可 override，不改任何业务表）。
 * 与线上定时批扫共用检测纯函数（risk-detect），保证同一口径。
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { RiskWashFlow } from './entities';
import { RiskLevel } from '@constants/enums';
import {
  detectWindow,
  scoreAccount,
  buildRiskThresholds,
  assertValidThresholdOverrides,
  RiskSignal,
  RiskThresholds,
} from './risk-detect';

export interface RiskReplayOptions {
  since: Date;
  until: Date;
  configOverrides?: Record<string, number>;
}

export interface ReplayHitAccount {
  playerId: string;
  score: number;
  level: RiskLevel;
  signals: RiskSignal[];
}

export interface ScoreBuckets {
  normal: number;
  watch: number;
  high: number;
}

export interface RiskReplayResult {
  iterated: number;
  hitCount: number;
  hitAccounts: ReplayHitAccount[];
  scoreBuckets: ScoreBuckets;
}

@Injectable()
export class RiskReplayService {
  constructor(
    @InjectRepository(RiskWashFlow)
    private readonly washRepo: Repository<RiskWashFlow>,
  ) {}

  /** 只读回放：仅 find risk_wash_flows，不 save 任何表、不触发处置。 */
  async replay({ since, until, configOverrides }: RiskReplayOptions): Promise<RiskReplayResult> {
    // 校验 override 仅允许检测阈值键，非法即 92901（优先于查询）
    assertValidThresholdOverrides(configOverrides);

    const flows = await this.washRepo.find({
      where: { createdAt: Between(since, until) },
      order: { createdAt: 'ASC' },
    });

    const thresholds: RiskThresholds = buildRiskThresholds(configOverrides);
    const { signals } = detectWindow(flows, thresholds);
    const scores = scoreAccount(signals, thresholds);
    const scoreById = new Map(scores.map((s) => [s.playerId, s]));

    const signalsByPlayer = new Map<string, RiskSignal[]>();
    for (const s of signals) {
      for (const pid of [s.fromId, s.toId]) {
        const arr = signalsByPlayer.get(pid) ?? [];
        arr.push(s);
        signalsByPlayer.set(pid, arr);
      }
    }

    const hitAccounts: ReplayHitAccount[] = scores
      .filter((s) => s.score > 0)
      .map((s) => ({
        playerId: s.playerId,
        score: s.score,
        level: s.level,
        signals: signalsByPlayer.get(s.playerId) ?? [],
      }));

    const scoreBuckets: ScoreBuckets = { normal: 0, watch: 0, high: 0 };
    for (const s of scores) {
      if (s.score <= 0) continue;
      if (s.level === RiskLevel.HIGH) scoreBuckets.high++;
      else if (s.level === RiskLevel.WATCH) scoreBuckets.watch++;
      else scoreBuckets.normal++;
    }

    return { iterated: flows.length, hitCount: hitAccounts.length, hitAccounts, scoreBuckets };
  }
}