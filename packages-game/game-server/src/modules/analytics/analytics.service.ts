import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlayerBehaviorLog, RetentionStat } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { BehaviorType, StatPeriod } from '@constants/enums';

export interface BehaviorStat {
  behaviorType: string;
  count: number;
}

export interface DashboardSummary {
  dau: number;
  behaviorStats: BehaviorStat[];
  generatedAt: string;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(PlayerBehaviorLog)
    private readonly logRepo: Repository<PlayerBehaviorLog>,
    @InjectRepository(RetentionStat)
    private readonly retentionRepo: Repository<RetentionStat>,
    private readonly eventBus: EventBusService,
  ) {}

  async logBehavior(
    playerId: string,
    behaviorType: BehaviorType,
    detail?: Record<string, any>,
  ): Promise<PlayerBehaviorLog> {
    const log = this.logRepo.create({
      playerId,
      behaviorType,
      detailJson: detail ?? {},
      ipAddress: null,
    });
    const saved = await this.logRepo.save(log);

    this.eventBus.emit(GameEvents.PLAYER_BEHAVIOR, {
      playerId,
      behaviorType,
      detail,
    });

    return saved;
  }

  async getBehaviorStats(
    startDate: Date,
    endDate: Date,
  ): Promise<BehaviorStat[]> {
    const qb = this.logRepo
      .createQueryBuilder('log')
      .select('log.behaviorType', 'behavior_type')
      .addSelect('COUNT(*)', 'count')
      .where('log.createdAt >= :start', { start: startDate })
      .andWhere('log.createdAt <= :end', { end: endDate })
      .groupBy('log.behaviorType')
      .orderBy('count', 'DESC');

    const raw = await qb.getRawMany();
    return raw.map((r: any) => ({
      behaviorType: r.behavior_type,
      count: parseInt(r.count, 10),
    }));
  }

  async getDailyActiveUsers(date: string): Promise<number> {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);

    const qb = this.logRepo
      .createQueryBuilder('log')
      .select('COUNT(DISTINCT log.playerId)', 'count')
      .where('log.createdAt >= :start', { start: new Date(date) })
      .andWhere('log.createdAt < :end', { end: nextDay });

    const result = await qb.getRawOne();
    return parseInt(result?.count ?? '0', 10);
  }

  async calculateRetention(
    cohortDate: string,
    statDate: string,
    period: StatPeriod,
  ): Promise<RetentionStat> {
    const cohortNext = new Date(cohortDate);
    cohortNext.setDate(cohortNext.getDate() + 1);
    const statNext = new Date(statDate);
    statNext.setDate(statNext.getDate() + 1);

    // Count cohort size (new users on cohort date)
    const cohortQb = this.logRepo
      .createQueryBuilder('log')
      .select('COUNT(DISTINCT log.playerId)', 'count')
      .where('log.behaviorType = :type', { type: BehaviorType.LOGIN })
      .andWhere('log.createdAt >= :start', { start: new Date(cohortDate) })
      .andWhere('log.createdAt < :end', { end: cohortNext });
    const cohortResult = await cohortQb.getRawOne();
    const cohortSize = parseInt(cohortResult?.count ?? '0', 10);

    // Count retained users (logged in on stat date AND on cohort date)
    const retainedQb = this.logRepo
      .createQueryBuilder('log')
      .select('COUNT(DISTINCT log.playerId)', 'count')
      .where('log.behaviorType = :type', { type: BehaviorType.LOGIN })
      .andWhere('log.createdAt >= :start', { start: new Date(statDate) })
      .andWhere('log.createdAt < :end', { end: statNext });
    const retainedResult = await retainedQb.getRawOne();
    const retainedCount = parseInt(retainedResult?.count ?? '0', 10);

    const retentionRate =
      cohortSize > 0
        ? Math.round((retainedCount / cohortSize) * 10000) / 100
        : 0;

    // Upsert retention stat
    let stat = await this.retentionRepo.findOne({
      where: { statDate, cohortDate, period },
    });
    if (!stat) {
      stat = this.retentionRepo.create({ statDate, cohortDate, period });
    }

    stat.cohortSize = cohortSize;
    stat.retainedCount = retainedCount;
    stat.retentionRate = retentionRate;

    return this.retentionRepo.save(stat);
  }

  async getRetentionStats(cohortDate: string): Promise<RetentionStat[]> {
    return this.retentionRepo.find({
      where: { cohortDate },
      order: { statDate: 'ASC' },
    });
  }

  async getDashboard(): Promise<DashboardSummary> {
    const today = new Date().toISOString().slice(0, 10);
    const dau = await this.getDailyActiveUsers(today);

    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const behaviorStats = await this.getBehaviorStats(weekAgo, new Date());

    return {
      dau,
      behaviorStats,
      generatedAt: new Date().toISOString(),
    };
  }
}
