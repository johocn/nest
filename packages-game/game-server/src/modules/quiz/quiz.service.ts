import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  QuizAnswer,
  QuizAssessment,
  QuizAssessmentItem,
  QuizQuestion,
  QuizResult,
  QuizSession,
} from './entities';
import { DrawQuizDto } from './dto/quiz-draw.dto';
import { EconomyService } from '@modules/economy/economy.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  CurrencyType,
  QuizAssessmentStatus,
  QuizQuestionKind,
  QuizSessionStatus,
} from '@constants/enums';
import { DEFAULT_APP_CODE, visibleTo } from '@shared/content-scope';

/** 测评会话有效期 */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** 单次抽题上限 */
const QUIZ_DRAW_MAX = 20;

/** Fisher-Yates 洗牌（Math.random，不引库） */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * quiz 玩家侧测评流（start / answer / 结果结算）。
 * appCode 阶段 2 调用点显式传 null（只见 common），真实解析留阶段 3。
 */
@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);

  constructor(
    @InjectRepository(QuizQuestion)
    private readonly questionRepo: Repository<QuizQuestion>,
    @InjectRepository(QuizResult)
    private readonly resultRepo: Repository<QuizResult>,
    @InjectRepository(QuizAssessment)
    private readonly assessmentRepo: Repository<QuizAssessment>,
    @InjectRepository(QuizAssessmentItem)
    private readonly itemRepo: Repository<QuizAssessmentItem>,
    @InjectRepository(QuizSession)
    private readonly sessionRepo: Repository<QuizSession>,
    @InjectRepository(QuizAnswer)
    private readonly quizAnswerRepo: Repository<QuizAnswer>,
    private readonly economyService: EconomyService,
  ) {}

  // ===== 开始测评 =====

  async start(playerId: string, code: string, appCode: string | null = null) {
    const assessment = await this.assessmentRepo.findOne({
      where: {
        code,
        status: QuizAssessmentStatus.PUBLISHED,
        ...visibleTo(appCode),
      },
    });
    if (!assessment) {
      throw new GameException(
        ErrorCodes.QUIZ_ASSESSMENT_NOT_FOUND,
        '测评卷不存在或未发布',
      );
    }
    const items = await this.itemRepo.find({
      where: { assessmentId: assessment.id },
      order: { sortOrder: 'ASC' },
    });
    const firstQuestionId = assessment.startQuestionId ?? items[0]?.questionId;
    if (!firstQuestionId) {
      // 空卷不应存在——admin 流程校验器已拦截，防御性兜底
      throw new GameException(ErrorCodes.QUIZ_FLOW_INVALID, '测评卷流程无效');
    }
    // 会话入口题按 id 加载不加 scope 过滤：卷的 scope 合法性已在上面的卷查询锁定，
    // 卷内题目范围由 admin 流程校验器保证
    const question = await this.questionRepo.findOne({
      where: { id: firstQuestionId },
    });
    if (!question) {
      throw new GameException(ErrorCodes.QUIZ_QUESTION_NOT_FOUND, '题目不存在');
    }
    const session = await this.sessionRepo.save(
      this.sessionRepo.create({
        playerId,
        assessmentId: assessment.id,
        status: QuizSessionStatus.IN_PROGRESS,
        currentQuestionId: question.id,
        totalScore: 0,
        dimScores: {},
        answers: [],
        appCode: appCode ?? DEFAULT_APP_CODE,
      } as Partial<QuizSession>),
    );
    return { sessionId: session.id, question: this.sanitizeQuestion(question) };
  }

  // ===== 答题 =====

  async answer(
    playerId: string,
    sessionId: string,
    questionId: string,
    selected: number[],
    appCode: string | null = null,
  ) {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, playerId },
    });
    if (!session) {
      throw new GameException(
        ErrorCodes.QUIZ_SESSION_NOT_FOUND,
        '会话不存在或非本人',
      );
    }
    if (session.status === QuizSessionStatus.FINISHED) {
      throw new GameException(ErrorCodes.QUIZ_SESSION_FINISHED, '会话已完成');
    }
    if (new Date(session.startedAt).getTime() < Date.now() - SESSION_TTL_MS) {
      throw new GameException(ErrorCodes.QUIZ_SESSION_EXPIRED, '会话已过期');
    }
    if (session.currentQuestionId !== questionId) {
      throw new GameException(
        ErrorCodes.QUIZ_QUESTION_MISMATCH,
        '提交的不是当前题目',
      );
    }

    const items = await this.itemRepo.find({
      where: { assessmentId: session.assessmentId },
      order: { sortOrder: 'ASC' },
    });
    const item = items.find((i) => i.questionId === questionId) ?? null;
    // 会话内按 id 加载题目不加 scope 过滤：会话合法性由 playerId+currentQuestionId
    // 保证，卷内题目范围已被 admin 流程校验器锁定
    const question = await this.questionRepo.findOne({
      where: { id: questionId },
    });
    if (!question) {
      throw new GameException(ErrorCodes.QUIZ_QUESTION_NOT_FOUND, '题目不存在');
    }
    if (!Array.isArray(selected) || selected.length === 0) {
      throw new GameException(ErrorCodes.QUIZ_OPTION_INVALID, '选项序号非法');
    }
    for (const idx of selected) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= question.options.length) {
        throw new GameException(ErrorCodes.QUIZ_OPTION_INVALID, '选项序号非法');
      }
    }

    const gained = selected.reduce(
      (sum, idx) => sum + (question.options[idx]?.score ?? 0),
      0,
    );
    session.totalScore += gained;
    if (item?.dimension) {
      session.dimScores = {
        ...session.dimScores,
        [item.dimension]: (session.dimScores?.[item.dimension] ?? 0) + gained,
      };
    }
    session.answers = [...(session.answers ?? []), { questionId, selected }];

    const nextQuestionId = await this.pickNextQuestionId(
      question,
      item,
      items,
      selected,
    );

    if (nextQuestionId) {
      const nextQuestion = await this.questionRepo.findOne({
        where: { id: nextQuestionId },
      });
      if (!nextQuestion) {
        throw new GameException(
          ErrorCodes.QUIZ_QUESTION_NOT_FOUND,
          '题目不存在',
        );
      }
      session.currentQuestionId = nextQuestionId;
      await this.sessionRepo.save(session);
      return {
        finished: false,
        question: this.sanitizeQuestion(nextQuestion),
      };
    }

    // 末题 → 结算（先解析结果再落库：区间未命中时可重答末题，避免会话卡死）
    const assessment = await this.assessmentRepo.findOne({
      where: { id: session.assessmentId },
    });
    const result = await this.resolveResult(
      assessment?.scoringRule ?? {},
      session.totalScore,
      session.dimScores,
      appCode,
    );
    session.status = QuizSessionStatus.FINISHED;
    session.currentQuestionId = null;
    session.finishedAt = new Date();
    await this.sessionRepo.save(session);

    const reward = await this.grantResultReward(
      playerId,
      session.id,
      result.rewardJson,
    );
    return {
      finished: true,
      result: { code: result.code, title: result.title, content: result.content },
      ...(reward ? { reward } : {}),
    };
  }

  // ===== 知识问答 =====

  /** 抽题：knowledge 池按 scope 过滤（+category 可选），优先未答过的题，不足回退全池 */
  async draw(
    playerId: string,
    appCode: string | null = null,
    dto: DrawQuizDto = {} as DrawQuizDto,
  ) {
    const raw = Number(dto?.count);
    const count =
      Number.isInteger(raw) && raw >= 1 ? Math.min(raw, QUIZ_DRAW_MAX) : 1;
    const questions = await this.questionRepo.find({
      where: {
        kind: QuizQuestionKind.KNOWLEDGE,
        ...(dto?.category ? { category: dto.category } : {}),
        ...visibleTo(appCode),
      },
    });
    if (questions.length === 0) {
      return { questions: [] };
    }
    const answers = await this.quizAnswerRepo.find({
      where: { playerId },
    });
    const answeredIds = new Set(answers.map((a) => a.questionId));
    const fresh = questions.filter((q) => !answeredIds.has(q.id));
    const pool = fresh.length >= count ? fresh : questions;
    return {
      questions: shuffle(pool)
        .slice(0, count)
        .map((q) => this.sanitizeQuestion(q)),
    };
  }

  /** 知识答题：服务端判定对错、落答题流水、答对首发发奖 */
  async submit(
    playerId: string,
    questionId: string,
    selected: number[],
    appCode: string | null = null,
  ) {
    const question = await this.questionRepo.findOne({
      where: {
        id: questionId,
        kind: QuizQuestionKind.KNOWLEDGE,
        ...visibleTo(appCode),
      },
    });
    if (!question) {
      throw new GameException(ErrorCodes.QUIZ_QUESTION_NOT_FOUND, '题目不存在');
    }
    if (!Array.isArray(selected) || selected.length === 0) {
      throw new GameException(ErrorCodes.QUIZ_OPTION_INVALID, '选项序号非法');
    }
    for (const idx of selected) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= question.options.length) {
        throw new GameException(ErrorCodes.QUIZ_OPTION_INVALID, '选项序号非法');
      }
    }
    if (!question.multiSelect && selected.length !== 1) {
      throw new GameException(ErrorCodes.QUIZ_OPTION_INVALID, '选项序号非法');
    }

    const answerIndexes = (question.options ?? []).reduce<number[]>(
      (acc, opt, idx) => {
        if (opt?.answer === true) {
          acc.push(idx);
        }
        return acc;
      },
      [],
    );

    let isCorrect: boolean;
    if (question.multiSelect) {
      // multiSelect：集合相等（排序后比较，顺序无关）
      const picked = [...selected].sort((a, b) => a - b);
      const answer = [...answerIndexes].sort((a, b) => a - b);
      isCorrect =
        picked.length === answer.length &&
        picked.every((v, i) => v === answer[i]);
    } else {
      isCorrect = selected[0] === answerIndexes[0];
    }

    // 历史查重须在落流水前：本次答对的流水行不能算进历史
    const hasCorrectHistory = isCorrect
      ? (await this.quizAnswerRepo.findOne({
          where: { playerId, questionId, isCorrect: true },
        })) !== null
      : false;
    const reward =
      isCorrect && !hasCorrectHistory
        ? await this.grantQuestionReward(
            playerId,
            questionId,
            question.rewardJson,
          )
        : undefined;

    await this.quizAnswerRepo.save(
      this.quizAnswerRepo.create({
        playerId,
        questionId,
        isCorrect,
        appCode: appCode ?? DEFAULT_APP_CODE,
      } as Partial<QuizAnswer>),
    );

    const explain = (question.options ?? []).find((o) => o?.answer === true)
      ?.explain;
    return {
      correct: isCorrect,
      answerIndexes,
      ...(explain ? { explain } : {}),
      ...(reward ? { reward } : {}),
    };
  }

  // ===== 内部 =====

  /** 跳转优先级：第一选中选项 goto（题目 code 卷内反查）> item.nextQuestionId > sortOrder 下一题 */
  private async pickNextQuestionId(
    question: QuizQuestion,
    item: QuizAssessmentItem | null,
    items: QuizAssessmentItem[],
    selected: number[],
  ): Promise<string | null> {
    const gotoCode = question.options[selected[0]]?.goto;
    if (gotoCode) {
      const target = await this.questionRepo.findOne({
        where: { code: gotoCode, id: In(items.map((i) => i.questionId)) },
      });
      if (!target) {
        // goto 指向卷外题目——admin 流程校验器已拦截，防御性兜底
        throw new GameException(ErrorCodes.QUIZ_FLOW_INVALID, '测评卷流程无效');
      }
      return target.id;
    }
    if (item?.nextQuestionId) {
      return item.nextQuestionId;
    }
    const idx = items.findIndex((i) => i.questionId === question.id);
    return items[idx + 1]?.questionId ?? null;
  }

  /** total 模式找区间；dimension 模式逐 dim 找区间；result 按 code + scope 查 */
  private async resolveResult(
    scoringRule: Record<string, any>,
    totalScore: number,
    dimScores: Record<string, number>,
    appCode: string | null,
  ): Promise<QuizResult> {
    let resultCode: string | null = null;
    if (scoringRule?.mode === 'dimension' && Array.isArray(scoringRule.dims)) {
      for (const dim of scoringRule.dims) {
        const score = dimScores?.[dim.name] ?? 0;
        const hit = (dim.results ?? []).find(
          (r: any) => r.min <= score && score <= r.max,
        );
        if (hit) {
          resultCode = hit.result;
          break;
        }
      }
    } else {
      const hit = (scoringRule?.results ?? []).find(
        (r: any) => r.min <= totalScore && totalScore <= r.max,
      );
      resultCode = hit?.result ?? null;
    }
    if (!resultCode) {
      // 区间覆盖已由 admin 流程校验器保证，防御性兜底
      throw new GameException(
        ErrorCodes.QUIZ_RESULT_NOT_RESOLVED,
        '得分未命中任何结果区间',
      );
    }
    const result = await this.resultRepo.findOne({
      where: { code: resultCode, ...visibleTo(appCode) },
    });
    if (!result) {
      throw new GameException(
        ErrorCodes.QUIZ_RESULT_NOT_RESOLVED,
        '得分未命中任何结果区间',
      );
    }
    return result;
  }

  /** 结果奖励：形状合法才发，opTrace 幂等防重复 */
  private async grantResultReward(
    playerId: string,
    sessionId: string,
    rewardJson: Record<string, any>,
  ): Promise<{ currencyType: string; amount: number } | undefined> {
    if (!rewardJson || Object.keys(rewardJson).length === 0) {
      return undefined;
    }
    const currencyType = rewardJson.currencyType;
    const amount = rewardJson.amount;
    if (
      typeof currencyType !== 'string' ||
      !Object.values(CurrencyType).includes(currencyType as CurrencyType) ||
      typeof amount !== 'number' ||
      amount <= 0
    ) {
      this.logger.warn(
        `Quiz result reward skipped (invalid shape): session=${sessionId} rewardJson=${JSON.stringify(rewardJson)}`,
      );
      return undefined;
    }
    const opTrace = `quiz_result:${sessionId}`;
    const existing = await this.economyService.getTxByOpTrace(opTrace);
    if (existing) {
      return undefined;
    }
    await this.economyService.addCurrency(
      playerId,
      currencyType as CurrencyType,
      amount,
      'quiz',
      opTrace,
    );
    return { currencyType, amount };
  }

  /** 知识题奖励：形状校验逻辑同 grantResultReward，opTrace=quiz_q:{questionId}:{playerId} */
  private async grantQuestionReward(
    playerId: string,
    questionId: string,
    rewardJson: Record<string, any>,
  ): Promise<{ currencyType: string; amount: number } | undefined> {
    if (!rewardJson || Object.keys(rewardJson).length === 0) {
      return undefined;
    }
    const currencyType = rewardJson.currencyType;
    const amount = rewardJson.amount;
    if (
      typeof currencyType !== 'string' ||
      !Object.values(CurrencyType).includes(currencyType as CurrencyType) ||
      typeof amount !== 'number' ||
      amount <= 0
    ) {
      this.logger.warn(
        `Quiz question reward skipped (invalid shape): question=${questionId} rewardJson=${JSON.stringify(rewardJson)}`,
      );
      return undefined;
    }
    const opTrace = `quiz_q:${questionId}:${playerId}`;
    const existing = await this.economyService.getTxByOpTrace(opTrace);
    if (existing) {
      return undefined;
    }
    await this.economyService.addCurrency(
      playerId,
      currencyType as CurrencyType,
      amount,
      'quiz',
      opTrace,
    );
    return { currencyType, amount };
  }

  /** 下发题目剥离 answer/score/goto/explain */
  private sanitizeQuestion(q: QuizQuestion) {
    return {
      id: q.id,
      code: q.code,
      kind: q.kind,
      content: q.content,
      multiSelect: q.multiSelect,
      options: (q.options ?? []).map((o) => ({ text: o.text })),
    };
  }
}
