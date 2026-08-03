import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AchievementService } from './achievement.service';
import { AchievementController } from './achievement.controller';
import { AchievementTemplate, PlayerAchievement } from './entities';

@Module({
  imports: [TypeOrmModule.forFeature([AchievementTemplate, PlayerAchievement])],
  controllers: [AchievementController],
  providers: [AchievementService],
  exports: [AchievementService],
})
export class AchievementModule {}
