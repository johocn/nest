import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { ActivityModule } from '@modules/activity/activity.module';
import { RankingModule } from '@modules/ranking/ranking.module';
import { ConnectionModule } from '@modules/gateway/connection.module';
import { MatchmakingModule } from '@modules/matchmaking/matchmaking.module';
import { RiskModule } from '@modules/risk/risk.module';
import { ReconcileModule } from '@modules/reconcile/reconcile.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ActivityModule,
    RankingModule,
    ConnectionModule,
    MatchmakingModule,
    RiskModule,
    ReconcileModule,
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
