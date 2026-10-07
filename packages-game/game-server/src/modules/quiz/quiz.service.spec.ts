import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';
import type { Repository } from 'typeorm';
import { QuizService } from './quiz.service';
import {
  QuizAssessment,
  QuizAssessmentItem,
  QuizAnswer,
  QuizQuestion,
  QuizResult,
  QuizSession,
} from './entities';
import { EconomyService } from '@modules/economy/economy.service';
import { ErrorCodes } from '@constants/error-codes';
import {
  CurrencyType,
  QuizAssessmentStatus,
  QuizQuestionKind,
  QuizSessionStatus,
} from '@constants/enums';
import { COMMON_SCOPE } from '@shared/content-scope';
import { expectScopedFind } from '../../testing/content-scope-contract.shared';

describe('QuizService（玩家测评流）', () => {
  let service: QuizService;
  let questionRepo: jest.Mocked<Repository<QuizQuestion>>;
  let resultRepo: jest.Mocked<Repository<QuizResult>>;
  let assessmentRepo: jest.Mocked<Repository<QuizAssessment>>;
  let itemRepo: jest.Mocked<Repository<QuizAssessmentItem>>;
  let sessionRepo: jest.Mocked<Repository<QuizSession>>;
  let quizAnswerRepo: jest.Mocked<Repository<QuizAnswer>>;
  let economyService: jest.Mocked<EconomyService>;

  beforeEach(async () => {
    economyService = {
      addCurrency: jest.fn().mockResolvedValue({ balanceAfter: '10' }),
      getTxByOpTrace: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<EconomyService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizService,
        {
          provide: getRepositoryToken(QuizQuestion),
          useValue: { findOne: jest.fn(), find: jest.fn() },
        },
        {
          provide: getRepositoryToken(QuizResult),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(QuizAssessment),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(QuizAssessmentItem),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(QuizSession),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((data: any) => ({ ...data, id: '100' })),
            save: jest.fn(async (data: any) => data),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(QuizAnswer),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn((data: any) => ({ ...data, id: '300' })),
            save: jest.fn(async (data: any) => data),
          },
        },
        { provide: EconomyService, useValue: economyService },
      ],
    }).compile();

    service = module.get(QuizService);
    questionRepo = module.get(getRepositoryToken(QuizQuestion));
    resultRepo = module.get(getRepositoryToken(QuizResult));
    assessmentRepo = module.get(getRepositoryToken(QuizAssessment));
    itemRepo = module.get(getRepositoryToken(QuizAssessmentItem));
    sessionRepo = module.get(getRepositoryToken(QuizSession));
    quizAnswerRepo = module.get(getRepositoryToken(QuizAnswer));
  });

  const makeAssessment = (
    overrides: Partial<QuizAssessment> = {},
  ): QuizAssessment =>
    ({
      id: '10',
      code: 'assess-1',
      title: '性格测评',
      description: null,
      status: QuizAssessmentStatus.PUBLISHED,
      scoringRule: {
        mode: 'total',
        results: [
          { min: 0, max: 5, result: 'r-low' },
          { min: 6, max: 99, result: 'r-high' },
        ],
      },
      startQuestionId: null,
      appScope: COMMON_SCOPE,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as QuizAssessment;

  const makeItem = (
    overrides: Partial<QuizAssessmentItem> = {},
  ): QuizAssessmentItem =>
    ({
      id: '20',
      assessmentId: '10',
      questionId: '1',
      sortOrder: 1,
      nextQuestionId: null,
      dimension: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as QuizAssessmentItem;

  const makeQuestion = (
    overrides: Partial<QuizQuestion> = {},
  ): QuizQuestion =>
    ({
      id: '1',
      code: 'q1',
      kind: 'assessment',
      content: '你喜欢社交吗？',
      options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }],
      multiSelect: false,
      category: null,
      difficulty: 1,
      tags: [],
      rewardJson: {},
      appScope: COMMON_SCOPE,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as QuizQuestion;

  const makeSession = (
    overrides: Partial<QuizSession> = {},
  ): QuizSession =>
    ({
      id: '100',
      playerId: 'p1',
      assessmentId: '10',
      status: QuizSessionStatus.IN_PROGRESS,
      currentQuestionId: '1',
      totalScore: 0,
      dimScores: {},
      answers: [],
      appCode: 'main',
      startedAt: new Date(),
      updatedAt: new Date(),
      finishedAt: null,
      ...overrides,
    }) as QuizSession;

  const makeResult = (overrides: Partial<QuizResult> = {}): QuizResult =>
    ({
      id: '50',
      code: 'r-high',
      title: '社交达人',
      content: '你非常外向',
      rewardJson: {},
      appScope: COMMON_SCOPE,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as QuizResult;

  const makeAnswer = (overrides: Partial<QuizAnswer> = {}): QuizAnswer =>
    ({
      id: '300',
      playerId: 'p1',
      questionId: '1',
      isCorrect: true,
      appCode: 'main',
      createdAt: new Date(),
      ...overrides,
    }) as QuizAnswer;

  // ===== start =====

  describe('start', () => {
    it('未发布卷 → 46001', async () => {
      assessmentRepo.findOne.mockResolvedValue(null);

      await expect(service.start('p1', 'assess-1', null)).rejects.toMatchObject(
        { response: { code: ErrorCodes.QUIZ_ASSESSMENT_NOT_FOUND } },
      );
      expect(itemRepo.find).not.toHaveBeenCalled();
    });

    it('返回首题且 options 剥离 answer/score/goto/explain；卷查询命中 scope 契约', async () => {
      assessmentRepo.findOne.mockResolvedValue(makeAssessment());
      itemRepo.find.mockResolvedValue([
        makeItem({ questionId: '1', sortOrder: 1 }),
        makeItem({ id: '21', questionId: '2', sortOrder: 2 }),
      ]);
      questionRepo.findOne.mockResolvedValue(
        makeQuestion({
          options: [
            { text: '喜欢', answer: true, score: 1, goto: 'q2', explain: '因为' },
            { text: '一般', score: 2 },
            { text: '不喜欢', score: 0 },
          ],
        }),
      );

      const res = await service.start('p1', 'assess-1', null);

      expectScopedFind(assessmentRepo.findOne, [COMMON_SCOPE]);
      expect(itemRepo.find).toHaveBeenCalledWith({
        where: { assessmentId: '10' },
        order: { sortOrder: 'ASC' },
      });
      expect(questionRepo.findOne).toHaveBeenCalledWith({
        where: { id: '1' },
      });
      expect(sessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          playerId: 'p1',
          assessmentId: '10',
          status: QuizSessionStatus.IN_PROGRESS,
          currentQuestionId: '1',
          totalScore: 0,
          dimScores: {},
          answers: [],
          appCode: 'main',
        }),
      );
      expect(res.sessionId).toBe('100');
      expect(res.question.id).toBe('1');
      expect(res.question.multiSelect).toBe(false);
      expect(res.question.options).toEqual([
        { text: '喜欢' },
        { text: '一般' },
        { text: '不喜欢' },
      ]);
      for (const option of res.question.options) {
        expect(Object.keys(option)).toEqual(['text']);
      }
    });
  });

  // ===== answer 校验链 =====

  describe('answer 校验链', () => {
    it('会话不存在/非本人 → 46002', async () => {
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.answer('p1', '100', '1', [0], null),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_SESSION_NOT_FOUND },
      });
      expect(sessionRepo.findOne).toHaveBeenCalledWith({
        where: { id: '100', playerId: 'p1' },
      });
    });

    it('会话已完成 → 46008', async () => {
      sessionRepo.findOne.mockResolvedValue(
        makeSession({ status: QuizSessionStatus.FINISHED }),
      );

      await expect(
        service.answer('p1', '100', '1', [0], null),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_SESSION_FINISHED },
      });
    });

    it('会话超 24h 未完成 → 46003', async () => {
      sessionRepo.findOne.mockResolvedValue(
        makeSession({
          startedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        }),
      );

      await expect(
        service.answer('p1', '100', '1', [0], null),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_SESSION_EXPIRED },
      });
    });

    it('题目不匹配 → 46004', async () => {
      sessionRepo.findOne.mockResolvedValue(
        makeSession({ currentQuestionId: '2' }),
      );

      await expect(
        service.answer('p1', '100', '1', [0], null),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_QUESTION_MISMATCH },
      });
      expect(questionRepo.findOne).not.toHaveBeenCalled();
    });

    it('selected 为空或越界 → 46005', async () => {
      sessionRepo.findOne.mockResolvedValue(makeSession());
      itemRepo.find.mockResolvedValue([makeItem()]);
      questionRepo.findOne.mockResolvedValue(makeQuestion());

      await expect(
        service.answer('p1', '100', '1', [], null),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_OPTION_INVALID },
      });
      await expect(
        service.answer('p1', '100', '1', [3], null),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_OPTION_INVALID },
      });
      expect(sessionRepo.save).not.toHaveBeenCalled();
    });
  });

  // ===== answer 计分与跳转 =====

  describe('answer 计分与跳转', () => {
    it('正常累分并按第一选中选项 goto 跳转', async () => {
      sessionRepo.findOne.mockResolvedValue(makeSession());
      itemRepo.find.mockResolvedValue([
        makeItem({ questionId: '1', sortOrder: 1 }),
        makeItem({ id: '21', questionId: '2', sortOrder: 2 }),
      ]);
      const q2 = makeQuestion({ id: '2', code: 'q2', content: '第二题' });
      questionRepo.findOne
        .mockResolvedValueOnce(
          makeQuestion({
            options: [
              { text: 'A', score: 1 },
              { text: 'B', score: 2, goto: 'q2' },
              { text: 'C', score: 0 },
            ],
          }),
        )
        .mockResolvedValueOnce(q2) // goto 反查（code 限定卷内 questionId）
        .mockResolvedValueOnce(q2); // 下一题按 id 加载

      const res = await service.answer('p1', '100', '1', [1], null);

      expect(res.finished).toBe(false);
      expect(res.question.id).toBe('2');
      expect(sessionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          totalScore: 2,
          currentQuestionId: '2',
          answers: [{ questionId: '1', selected: [1] }],
          status: QuizSessionStatus.IN_PROGRESS,
        }),
      );
    });
  });

  // ===== 结算 =====

  describe('answer 结果结算', () => {
    const setupFinish = () => {
      sessionRepo.findOne.mockResolvedValue(
        makeSession({ currentQuestionId: '2', totalScore: 3 }),
      );
      itemRepo.find.mockResolvedValue([
        makeItem({ questionId: '1', sortOrder: 1 }),
        makeItem({ id: '21', questionId: '2', sortOrder: 2 }),
      ]);
      questionRepo.findOne.mockResolvedValue(
        makeQuestion({
          id: '2',
          code: 'q2',
          options: [{ text: 'A', score: 4 }],
        }),
      );
      assessmentRepo.findOne.mockResolvedValue(makeAssessment());
    };

    it('末题答完 → total 区间命中 + 奖励发放 + opTrace=quiz_result:{sessionId}', async () => {
      setupFinish();
      resultRepo.findOne.mockResolvedValue(
        makeResult({
          rewardJson: { currencyType: CurrencyType.GOLD, amount: 10 },
        }),
      );

      const res = await service.answer('p1', '100', '2', [0], null);

      expect(res.finished).toBe(true);
      expect(res.result).toEqual({
        code: 'r-high',
        title: '社交达人',
        content: '你非常外向',
      });
      expect(res.reward).toEqual({ currencyType: CurrencyType.GOLD, amount: 10 });
      expect(economyService.getTxByOpTrace).toHaveBeenCalledWith(
        'quiz_result:100',
      );
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.GOLD,
        10,
        'quiz',
        'quiz_result:100',
      );
      expect(sessionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: QuizSessionStatus.FINISHED,
          totalScore: 7,
          currentQuestionId: null,
          finishedAt: expect.any(Date),
        }),
      );
      expectScopedFind(resultRepo.findOne, [COMMON_SCOPE]);
    });

    it('重复结算（opTrace 已存在）不再发奖', async () => {
      setupFinish();
      resultRepo.findOne.mockResolvedValue(
        makeResult({
          rewardJson: { currencyType: CurrencyType.GOLD, amount: 10 },
        }),
      );
      economyService.getTxByOpTrace.mockResolvedValue({ id: 'tx1' } as any);

      const res = await service.answer('p1', '100', '2', [0], null);

      expect(res.finished).toBe(true);
      expect(economyService.addCurrency).not.toHaveBeenCalled();
      expect(res.reward).toBeUndefined();
    });

    it('dimension 模式按 dim 分桶结算', async () => {
      sessionRepo.findOne.mockResolvedValue(
        makeSession({ currentQuestionId: '2', dimScores: { E: 2 } }),
      );
      itemRepo.find.mockResolvedValue([
        makeItem({ questionId: '1', sortOrder: 1, dimension: 'E' }),
        makeItem({ id: '21', questionId: '2', sortOrder: 2, dimension: 'E' }),
      ]);
      questionRepo.findOne.mockResolvedValue(
        makeQuestion({
          id: '2',
          code: 'q2',
          options: [{ text: 'A', score: 1 }],
        }),
      );
      assessmentRepo.findOne.mockResolvedValue(
        makeAssessment({
          scoringRule: {
            mode: 'dimension',
            dims: [
              {
                name: 'E',
                results: [
                  { min: 0, max: 2, result: 'r-e' },
                  { min: 3, max: 9, result: 'r-i' },
                ],
              },
            ],
          },
        }),
      );
      resultRepo.findOne.mockResolvedValue(
        makeResult({ code: 'r-i', title: '内向', content: '你偏内向' }),
      );

      const res = await service.answer('p1', '100', '2', [0], null);

      expect(res.finished).toBe(true);
      expect(res.result.code).toBe('r-i');
      expect(sessionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ dimScores: { E: 3 } }),
      );
      expect(economyService.addCurrency).not.toHaveBeenCalled();
    });

    it('区间无命中 → 46007 且不落库', async () => {
      setupFinish();
      assessmentRepo.findOne.mockResolvedValue(
        makeAssessment({
          scoringRule: {
            mode: 'total',
            results: [{ min: 10, max: 20, result: 'r-x' }],
          },
        }),
      );

      await expect(
        service.answer('p1', '100', '2', [0], null),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_RESULT_NOT_RESOLVED },
      });
      expect(sessionRepo.save).not.toHaveBeenCalled();
      expect(economyService.addCurrency).not.toHaveBeenCalled();
    });
  });

  // ===== draw（知识问答抽题）=====

  describe('draw', () => {
    it('返回剥离 answer/score/goto/explain 的题目；题目查询命中 scope 契约', async () => {
      questionRepo.find.mockResolvedValue([
        makeQuestion({
          kind: QuizQuestionKind.KNOWLEDGE,
          options: [
            { text: 'A', answer: true, explain: '因为A' },
            { text: 'B', score: 3, goto: 'q2' },
          ],
        }),
      ]);
      quizAnswerRepo.find.mockResolvedValue([]);

      const res = await service.draw('p1', null, {});

      expectScopedFind(questionRepo.find, [COMMON_SCOPE]);
      expect(questionRepo.find).toHaveBeenCalledWith({
        where: expect.objectContaining({ kind: QuizQuestionKind.KNOWLEDGE }),
      });
      expect(res.questions).toHaveLength(1);
      expect(res.questions[0].id).toBe('1');
      for (const option of res.questions[0].options) {
        expect(Object.keys(option)).toEqual(['text']);
      }
    });

    it('优先抽未答过的题（按已答流水过滤）', async () => {
      const answered = makeQuestion({ id: '1', code: 'q1', kind: QuizQuestionKind.KNOWLEDGE });
      const fresh = makeQuestion({ id: '2', code: 'q2', kind: QuizQuestionKind.KNOWLEDGE });
      questionRepo.find.mockResolvedValue([answered, fresh]);
      quizAnswerRepo.find.mockResolvedValue([makeAnswer({ questionId: '1' })]);

      const res = await service.draw('p1', null, { count: 1 });

      expect(quizAnswerRepo.find).toHaveBeenCalledWith({
        where: { playerId: 'p1' },
      });
      expect(res.questions.map((q) => q.id)).toEqual(['2']);
    });

    it('未答不足 count 时回退全池', async () => {
      const only = makeQuestion({ id: '1', code: 'q1', kind: QuizQuestionKind.KNOWLEDGE });
      questionRepo.find.mockResolvedValue([only]);
      quizAnswerRepo.find.mockResolvedValue([makeAnswer({ questionId: '1' })]);

      const res = await service.draw('p1', null, { count: 1 });

      expect(res.questions.map((q) => q.id)).toEqual(['1']);
    });

    it('题池为空返回空数组', async () => {
      questionRepo.find.mockResolvedValue([]);

      const res = await service.draw('p1', null, {});

      expect(res.questions).toEqual([]);
      expect(quizAnswerRepo.find).not.toHaveBeenCalled();
    });
  });

  // ===== cleanupExpiredSessions（会话清理）=====

  describe('cleanupExpiredSessions', () => {
    it('删除 in_progress 且 startedAt 超 24h 的会话，返回受影响行数', async () => {
      (sessionRepo.delete as jest.Mock).mockResolvedValue({ affected: 3 });

      const n = await service.cleanupExpiredSessions();

      expect(n).toBe(3);
      expect(sessionRepo.delete).toHaveBeenCalledTimes(1);
      const criteria = (sessionRepo.delete as jest.Mock).mock.calls[0][0];
      expect(criteria.status).toBe(QuizSessionStatus.IN_PROGRESS);
      expect(criteria.startedAt).toBeInstanceOf(FindOperator);
      expect(criteria.startedAt.type).toBe('lessThan');
      const threshold: number = criteria.startedAt.value.getTime();
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      expect(threshold).toBeLessThanOrEqual(dayAgo);
      expect(threshold).toBeGreaterThan(dayAgo - 5000);
    });

    it('无过期会话 → affected 为空返回 0', async () => {
      (sessionRepo.delete as jest.Mock).mockResolvedValue({ affected: null });

      const n = await service.cleanupExpiredSessions();

      expect(n).toBe(0);
    });
  });

  // ===== submit（知识问答判定）=====

  describe('submit', () => {
    const knowledge = (overrides: Partial<QuizQuestion> = {}) =>
      makeQuestion({
        kind: QuizQuestionKind.KNOWLEDGE,
        options: [
          { text: 'A', answer: true, explain: 'A对' },
          { text: 'B' },
          { text: 'C' },
        ],
        ...overrides,
      });

    it('单选答对 → correct + answerIndexes + explain + 首发奖励（opTrace=quiz_q:{qid}:{pid}）+ 流水 app_code 兜底 main', async () => {
      questionRepo.findOne.mockResolvedValue(
        knowledge({ rewardJson: { currencyType: CurrencyType.GOLD, amount: 5 } }),
      );
      quizAnswerRepo.findOne.mockResolvedValue(null);

      const res = await service.submit('p1', '1', [0], null);

      expectScopedFind(questionRepo.findOne, [COMMON_SCOPE]);
      expect(res.correct).toBe(true);
      expect(res.answerIndexes).toEqual([0]);
      expect(res.explain).toBe('A对');
      expect(res.reward).toEqual({ currencyType: CurrencyType.GOLD, amount: 5 });
      expect(economyService.getTxByOpTrace).toHaveBeenCalledWith('quiz_q:1:p1');
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.GOLD,
        5,
        'quiz',
        'quiz_q:1:p1',
      );
      expect(quizAnswerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          playerId: 'p1',
          questionId: '1',
          isCorrect: true,
          appCode: 'main',
        }),
      );
    });

    it('单选答错 → correct:false + 落 isCorrect=false 流水 + 不查历史不发奖', async () => {
      questionRepo.findOne.mockResolvedValue(
        knowledge({ rewardJson: { currencyType: CurrencyType.GOLD, amount: 5 } }),
      );

      const res = await service.submit('p1', '1', [1], null);

      expect(res.correct).toBe(false);
      expect(res.answerIndexes).toEqual([0]);
      expect(res.reward).toBeUndefined();
      expect(quizAnswerRepo.findOne).not.toHaveBeenCalled();
      expect(economyService.addCurrency).not.toHaveBeenCalled();
      expect(quizAnswerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ isCorrect: false }),
      );
    });

    it('多选集合比较顺序无关', async () => {
      questionRepo.findOne.mockResolvedValue(
        knowledge({
          multiSelect: true,
          options: [
            { text: 'A', answer: true },
            { text: 'B' },
            { text: 'C', answer: true },
          ],
        }),
      );

      const res = await service.submit('p1', '1', [2, 0], null);

      expect(res.correct).toBe(true);
      expect(res.answerIndexes).toEqual([0, 2]);
    });

    it('题目不存在 → 46006', async () => {
      questionRepo.findOne.mockResolvedValue(null);

      await expect(service.submit('p1', '99', [0], null)).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_QUESTION_NOT_FOUND },
      });
    });

    it('选项越界 → 46005', async () => {
      questionRepo.findOne.mockResolvedValue(knowledge());

      await expect(service.submit('p1', '1', [3], null)).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_OPTION_INVALID },
      });
    });

    it('非 multiSelect 提交多个下标 → 46005', async () => {
      questionRepo.findOne.mockResolvedValue(knowledge());

      await expect(
        service.submit('p1', '1', [0, 1], null),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_OPTION_INVALID },
      });
    });

    it('已有 correct 历史 → 不再发奖（历史查重在落流水前）', async () => {
      questionRepo.findOne.mockResolvedValue(
        knowledge({ rewardJson: { currencyType: CurrencyType.GOLD, amount: 5 } }),
      );
      quizAnswerRepo.findOne.mockResolvedValue(makeAnswer({ questionId: '1' }));

      const res = await service.submit('p1', '1', [0], null);

      expect(res.correct).toBe(true);
      expect(quizAnswerRepo.findOne).toHaveBeenCalledWith({
        where: { playerId: 'p1', questionId: '1', isCorrect: true },
      });
      expect(economyService.addCurrency).not.toHaveBeenCalled();
      expect(economyService.getTxByOpTrace).not.toHaveBeenCalled();
      expect(res.reward).toBeUndefined();
    });
  });
});
