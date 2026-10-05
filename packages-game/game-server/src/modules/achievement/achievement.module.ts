import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AchievementService } from './achievement.service';
import { AchievementController } from './achievement.controller';
import { AchievementAdminController } from './achievement-admin.controller';
import { AchievementTemplate, PlayerAchievement } from './entities';
import { EconomyModule } from '@modules/economy/economy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AchievementTemplate, PlayerAchievement]),
    EconomyModule,
  ],
  controllers: [AchievementController, AchievementAdminController],
  providers: [AchievementService],
  exports: [AchievementService],
})
export class AchievementModule {}