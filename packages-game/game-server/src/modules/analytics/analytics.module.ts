import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { PlayerBehaviorLog, RetentionStat } from './entities';

@Module({
  imports: [TypeOrmModule.forFeature([PlayerBehaviorLog, RetentionStat])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
