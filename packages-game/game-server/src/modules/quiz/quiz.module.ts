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
  exports: [TypeOrmModule],
})
export class QuizModule {}
