import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  QuizQuestion,
  QuizResult,
  QuizAssessment,
  QuizAssessmentItem,
  QuizSession,
  QuizAnswer,
} from './entities';
import { QuizAdminService } from './quiz-admin.service';
import { QuizAdminController } from './quiz-admin.controller';
import { QuizService } from './quiz.service';
import { QuizController } from './quiz.controller';
import { AppsModule } from '@modules/apps/apps.module';
import { EconomyModule } from '@modules/economy/economy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      QuizQuestion,
      QuizResult,
      QuizAssessment,
      QuizAssessmentItem,
      QuizSession,
      QuizAnswer,
    ]),
    AppsModule, // AppScopeGuard 依赖 AppsService（由 AppsModule exports）
    EconomyModule, // QuizService 的奖励发放依赖 EconomyService
  ],
  controllers: [QuizAdminController, QuizController],
  providers: [QuizAdminService, QuizService],
  exports: [TypeOrmModule, QuizService],
})
export class QuizModule {}
