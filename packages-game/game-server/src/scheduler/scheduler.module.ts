import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { ActivityModule } from '@modules/activity/activity.module';
import { RankingModule } from '@modules/ranking/ranking.module';
import { GatewayModule } from '@modules/gateway/gateway.module';
import { MatchmakingModule } from '@modules/matchmaking/matchmaking.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ActivityModule,
    RankingModule,
    GatewayModule,
    MatchmakingModule,
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
