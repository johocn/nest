import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RankingService } from './ranking.service';
import { RankingController } from './ranking.controller';
import { RankingAdminController } from './ranking-admin.controller';
import { RankingRecord } from './entities';

@Module({
  imports: [TypeOrmModule.forFeature([RankingRecord])],
  controllers: [RankingController, RankingAdminController],
  providers: [RankingService],
  exports: [RankingService],
})
export class RankingModule {}
