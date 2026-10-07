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
  ],
  controllers: [QuizAdminController, QuizController],
  providers: [QuizAdminService, QuizService],
  exports: [TypeOrmModule, QuizService],
})
export class QuizModule {}
