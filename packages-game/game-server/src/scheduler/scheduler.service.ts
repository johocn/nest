import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ActivityService } from '@modules/activity/activity.service';
import { RankingService } from '@modules/ranking/ranking.service';
import { ConnectionService } from '@modules/gateway/connection.service';
import { MatchmakingService } from '@modules/matchmaking/matchmaking.service';
import { RankingType } from '@constants/enums';
import { MatchMode } from '@constants/enums';
import { RiskWashService } from '@modules/risk/risk-wash.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly rankingService: RankingService,
    private readonly activityService: ActivityService,
    private readonly connectionService: ConnectionService,
    private readonly matchmakingService: MatchmakingService,
    private readonly riskWashService: RiskWashService,
  ) {}

  @Cron('0 0 * * *')
  async dailyReset() {
    this.logger.log('Running daily reset...');
    try {
      await this.rankingService.createSnapshot(RankingType.POWER);
      this.logger.log('Daily ranking snapshot completed');
    } catch (err) {
      this.logger.error(
        'Daily ranking snapshot failed',
        (err as Error).message,
      );
    }
  }

  @Cron('0 * * * *')
  async hourlyCheck() {
    this.logger.debug('Running hourly check...');
    try {
      const activities = await this.activityService.getActiveActivities();
      this.logger.debug(`Active activities: ${activities.length}`);
    } catch (err) {
      this.logger.error('Hourly activity check failed', (err as Error).message);
    }
  }

  @Cron('*/5 * * * *')
  async everyFiveMinutes() {
    try {
      const onlineCount = await this.connectionService.getOnlineCount();
      this.logger.debug(`Online count: ${onlineCount}`);
    } catch (err) {
      this.logger.error('Online count check failed', (err as Error).message);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async everyMinute() {
    this.logger.debug('Running minute tick...');
  }

  @Cron('*/5 * * * * *')
  async matchTick() {
    for (const mode of Object.values(MatchMode)) {
      try {
        await this.matchmakingService.tryMatch(mode);
      } catch (err) {
        this.logger.error(
          `Matchmaking tick failed for ${mode}`,
          (err as Error).message,
        );
      }
    }
  }

  @Cron('*/10 * * * *')
  async riskScan() {
    try {
      const r = await this.riskWashService.scan();
      if (r.ingested || r.cases) {
        this.logger.log(`Risk scan: ingested=${r.ingested} cases=${r.cases}`);
      }
    } catch (err) {
      this.logger.error('Risk scan failed', (err as Error).message);
    }
  }
}
