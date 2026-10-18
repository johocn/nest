import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { QuizService } from './quiz.service';
import { AnswerSessionDto } from './dto/answer-session.dto';
import { DrawQuizDto } from './dto/quiz-draw.dto';
import { SubmitQuizDto } from './dto/quiz-submit.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { AppScopeGuard } from '@modules/apps/app-scope.guard';
import { CurrentAppCode } from '@modules/apps/current-app-code.decorator';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

/** quiz 玩家测评流（阶段 3 已接真实解析：x-api-key → AppScopeGuard → req.appCode，无凭证回退 DEFAULT_APP_CODE） */
@ApiTags('Quiz')
@ApiBearerAuth()
@Controller()
export class QuizController {
  constructor(private readonly quizService: QuizService) {}

  private assertId(id: string): string {
    if (!/^\d+$/.test(id)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    return id;
  }

  @UseGuards(JwtAuthGuard, AppScopeGuard)
  @Post('api/client/v1/quiz/assessments/:code/start')
  @ApiOperation({ summary: '开始测评' })
  async startAssessment(
    @CurrentPlayer() player: CurrentPlayerData,
    @CurrentAppCode() appCode: string,
    @Param('code') code: string,
  ) {
    return this.quizService.start(player.playerId, code, appCode);
  }

  @UseGuards(JwtAuthGuard, AppScopeGuard)
  @Post('api/client/v1/quiz/sessions/:id/answer')
  @ApiOperation({ summary: '测评答题' })
  async answerSession(
    @CurrentPlayer() player: CurrentPlayerData,
    @CurrentAppCode() appCode: string,
    @Param('id') id: string,
    @Body() dto: AnswerSessionDto,
  ) {
    return this.quizService.answer(
      player.playerId,
      this.assertId(id),
      dto.questionId,
      dto.selected,
      appCode,
    );
  }

  @UseGuards(JwtAuthGuard, AppScopeGuard)
  @Post('api/client/v1/quiz/draw')
  @ApiOperation({ summary: '抽知识题' })
  async drawQuestions(
    @CurrentPlayer() player: CurrentPlayerData,
    @CurrentAppCode() appCode: string,
    @Body() dto: DrawQuizDto,
  ) {
    return this.quizService.draw(player.playerId, appCode, dto);
  }

  @UseGuards(JwtAuthGuard, AppScopeGuard)
  @Post('api/client/v1/quiz/submit')
  @ApiOperation({ summary: '知识题作答' })
  async submitAnswer(
    @CurrentPlayer() player: CurrentPlayerData,
    @CurrentAppCode() appCode: string,
    @Body() dto: SubmitQuizDto,
  ) {
    return this.quizService.submit(
      player.playerId,
      this.assertId(dto.questionId),
      dto.selected,
      appCode,
    );
  }
}
