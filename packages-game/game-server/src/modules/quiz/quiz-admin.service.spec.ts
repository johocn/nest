import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { QuizAdminService } from './quiz-admin.service';
import {
  QuizAssessment,
  QuizAssessmentItem,
  QuizQuestion,
  QuizResult,
} from './entities';
import { ErrorCodes } from '@constants/error-codes';
import { QuizAssessmentStatus, QuizQuestionKind } from '@constants/enums';
import { COMMON_SCOPE } from '@shared/content-scope';

describe('QuizAdminService', () => {
  let service: QuizAdminService;
  let questionRepo: jest.Mocked<Repository<QuizQuestion>>;
  let resultRepo: jest.Mocked<Repository<QuizResult>>;
  let assessmentRepo: jest.Mocked<Repository<QuizAssessment>>;
  let itemRepo: jest.Mocked<Repository<QuizAssessmentItem>>;
  let dataSource: { transaction: jest.Mock };
  let txAssessmentRepo: any;
  let txItemRepo: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizAdminService,
        {
          provide: getRepositoryToken(QuizQuestion),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            findAndCount: jest.fn(),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            softRemove: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: getRepositoryToken(QuizResult),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            findAndCount: jest.fn(),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            softRemove: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: getRepositoryToken(QuizAssessment),
          useValue: {
            findOne: jest.fn(),
            findAndCount: jest.fn(),
            create: jest.fn((data: any) => ({ ...data, id: '10' })),
            save: jest.fn(async (data: any) => data),
            softRemove: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: getRepositoryToken(QuizAssessmentItem),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            create: jest.fn((data: any) => ({ ...data, id: '20' })),
            save: jest.fn(async (data: any) => data),
            delete: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: getDataSourceToken(),
          useValue: { transaction: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(QuizAdminService);
    questionRepo = module.get(getRepositoryToken(QuizQuestion));
    resultRepo = module.get(getRepositoryToken(QuizResult));
    assessmentRepo = module.get(getRepositoryToken(QuizAssessment));
    itemRepo = module.get(getRepositoryToken(QuizAssessmentItem));
    dataSource = module.get(getDataSourceToken());

    txAssessmentRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: any) => ({ ...data, id: '10' })),
      save: jest.fn(async (data: any) => data),
    };
    txItemRepo = {
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((data: any) => ({ ...data, id: '20' })),
      save: jest.fn(async (data: any) => data),
    };
    dataSource.transaction.mockImplementation(async (cb: any) =>
      cb({
        getRepository: (e: any) =>
          e === QuizAssessment ? txAssessmentRepo : txItemRepo,
      }),
    );
  });

  const makeQuestion = (
    overrides: Partial<QuizQuestion> = {},
  ): QuizQuestion =>
    ({
      id: '1',
      code: 'q1',
      kind: QuizQuestionKind.KNOWLEDGE,
      content: '1+1=?',
      options: [],
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

  const makeResult = (overrides: Partial<QuizResult> = {}): QuizResult =>
    ({
      id: '1',
      code: 'r1',
      title: '结果A',
      content: '你是行动派',
      rewardJson: {},
      appScope: COMMON_SCOPE,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as QuizResult;

  const makeAssessment = (
    overrides: Partial<QuizAssessment> = {},
  ): QuizAssessment =>
    ({
      id: '10',
      code: 'as1',
      title: '性格测评',
      description: null,
      status: QuizAssessmentStatus.DRAFT,
      scoringRule: {},
      startQuestionId: null,
      appScope: COMMON_SCOPE,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as QuizAssessment;

  const assessmentBody = (overrides: any = {}) => ({
    code: 'as1',
    title: '性格测评',
    scoringRule: { mode: 'total', results: [{ min: 0, max: 10, result: 'r1' }] },
    startQuestionCode: 'q1',
    items: [{ questionId: '1', sortOrder: 1 }],
    ...overrides,
  });

  const mockAssessmentQuestion = () =>
    makeQuestion({
      id: '1',
      code: 'q1',
      kind: QuizQuestionKind.ASSESSMENT,
      content: '你喜欢独处吗？',
      options: [{ text: 'A', score: 2 }],
    });

  describe('listQuestions', () => {
    it('分页返回 {items,total} 且 kind/category 过滤进 where', async () => {
      questionRepo.findAndCount.mockResolvedValue([[makeQuestion()], 1]);

      const result = await service.listQuestions(
        2,
        10,
        QuizQuestionKind.KNOWLEDGE,
        'math',
      );

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(questionRepo.findAndCount).toHaveBeenCalledWith({
        skip: 10,
        take: 10,
        where: { kind: QuizQuestionKind.KNOWLEDGE, category: 'math' },
        order: { createdAt: 'DESC' },
      });
    });

    it('appScope 过滤进 where（trim 后空串视为未传）', async () => {
      questionRepo.findAndCount.mockResolvedValue([[makeQuestion()], 1]);

      await service.listQuestions(1, 20, undefined, undefined, '  gameB ');

      expect(questionRepo.findAndCount).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        where: { appScope: 'gameB' },
        order: { createdAt: 'DESC' },
      });

      await service.listQuestions(1, 20, undefined, undefined, '   ');

      expect(questionRepo.findAndCount).toHaveBeenLastCalledWith({
        skip: 0,
        take: 20,
        where: {},
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('createQuestion', () => {
    it('body 未传 appScope 时默认 common', async () => {
      questionRepo.findOne.mockResolvedValue(null);

      const saved = await service.createQuestion({
        code: 'q1',
        kind: QuizQuestionKind.KNOWLEDGE,
        content: '1+1=?',
        options: [{ text: '2', answer: true }],
      });

      expect(saved.appScope).toBe(COMMON_SCOPE);
      expect(questionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'q1', appScope: COMMON_SCOPE }),
      );
      expect(questionRepo.save).toHaveBeenCalled();
    });

    it('同 scope code 已存在（含软删行）→ 46010', async () => {
      questionRepo.findOne.mockResolvedValue(
        makeQuestion({ deletedAt: new Date() }),
      );

      await expect(
        service.createQuestion({
          code: 'q1',
          kind: QuizQuestionKind.KNOWLEDGE,
          content: 'x',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_CODE_EXISTS },
      });
      expect(questionRepo.findOne).toHaveBeenCalledWith({
        where: { code: 'q1', appScope: COMMON_SCOPE },
        withDeleted: true,
      });
      expect(questionRepo.save).not.toHaveBeenCalled();
    });

    it('kind=assessment 时剥离 options 中的 answer 字段', async () => {
      questionRepo.findOne.mockResolvedValue(null);

      await service.createQuestion({
        code: 'q2',
        kind: QuizQuestionKind.ASSESSMENT,
        content: '性格测试',
        options: [
          { text: 'A', score: 3, answer: true },
          { text: 'B', score: 1, answer: false },
        ],
      });

      const created = (questionRepo.create as jest.Mock).mock.calls[0][0];
      expect(created.options).toEqual([
        { text: 'A', score: 3 },
        { text: 'B', score: 1 },
      ]);
    });

    it('kind=knowledge 时保留 answer 字段', async () => {
      questionRepo.findOne.mockResolvedValue(null);

      await service.createQuestion({
        code: 'q3',
        kind: QuizQuestionKind.KNOWLEDGE,
        content: '1+1=?',
        options: [{ text: '2', answer: true }],
      });

      const created = (questionRepo.create as jest.Mock).mock.calls[0][0];
      expect(created.options).toEqual([{ text: '2', answer: true }]);
    });
  });

  describe('updateQuestion', () => {
    it('目标不存在 → 46006', async () => {
      questionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateQuestion('99', { content: 'x' }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_QUESTION_NOT_FOUND },
      });
      expect(questionRepo.save).not.toHaveBeenCalled();
    });

    it('存在则合并 body 保存', async () => {
      questionRepo.findOne.mockResolvedValue(makeQuestion());

      const updated = await service.updateQuestion('1', { content: 'new' });

      expect(updated.content).toBe('new');
      expect(questionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1', content: 'new' }),
      );
    });
  });

  describe('deleteQuestion', () => {
    it('软删目标行', async () => {
      questionRepo.findOne.mockResolvedValue(makeQuestion());

      await service.deleteQuestion('1');

      expect(questionRepo.softRemove).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1' }),
      );
    });

    it('目标不存在 → 46006', async () => {
      questionRepo.findOne.mockResolvedValue(null);

      await expect(service.deleteQuestion('99')).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_QUESTION_NOT_FOUND },
      });
    });
  });

  describe('listResults', () => {
    it('分页返回 {items,total}', async () => {
      resultRepo.findAndCount.mockResolvedValue([[makeResult()], 1]);

      const result = await service.listResults(1, 20);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(resultRepo.findAndCount).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('createResult', () => {
    it('body 未传 appScope 时默认 common', async () => {
      resultRepo.findOne.mockResolvedValue(null);

      const saved = await service.createResult({
        code: 'r1',
        title: '结果A',
        content: '你是行动派',
      });

      expect(saved.appScope).toBe(COMMON_SCOPE);
    });

    it('同 scope code 已存在 → 46010', async () => {
      resultRepo.findOne.mockResolvedValue(makeResult());

      await expect(
        service.createResult({ code: 'r1', title: 'x', content: 'y' }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_CODE_EXISTS },
      });
      expect(resultRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateResult', () => {
    it('目标不存在 → 46001（复用测评内容缺失语义）', async () => {
      resultRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateResult('99', { title: 'x' }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_ASSESSMENT_NOT_FOUND },
      });
      expect(resultRepo.save).not.toHaveBeenCalled();
    });

    it('存在则合并 body 保存', async () => {
      resultRepo.findOne.mockResolvedValue(makeResult());

      const updated = await service.updateResult('1', { title: '新结果' });

      expect(updated.title).toBe('新结果');
      expect(resultRepo.save).toHaveBeenCalled();
    });
  });

  describe('deleteResult', () => {
    it('软删目标行', async () => {
      resultRepo.findOne.mockResolvedValue(makeResult());

      await service.deleteResult('1');

      expect(resultRepo.softRemove).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1' }),
      );
    });

    it('目标不存在 → 46001', async () => {
      resultRepo.findOne.mockResolvedValue(null);

      await expect(service.deleteResult('99')).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_ASSESSMENT_NOT_FOUND },
      });
    });
  });

  // ===== 测评卷 =====

  describe('listAssessments', () => {
    it('分页返回 {items,total}', async () => {
      assessmentRepo.findAndCount.mockResolvedValue([[makeAssessment()], 1]);

      const result = await service.listAssessments(1, 20);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(assessmentRepo.findAndCount).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('getAssessment', () => {
    it('返回卷 + items 按 sortOrder 排序 + 每项带 question 摘要', async () => {
      assessmentRepo.findOne.mockResolvedValue(makeAssessment());
      itemRepo.find.mockResolvedValue([
        {
          id: '20',
          assessmentId: '10',
          questionId: '1',
          sortOrder: 1,
          nextQuestionId: null,
          dimension: null,
        } as QuizAssessmentItem,
      ]);
      questionRepo.find.mockResolvedValue([mockAssessmentQuestion()]);

      const detail = await service.getAssessment('10');

      expect(detail.items[0].question).toEqual({
        id: '1',
        code: 'q1',
        kind: QuizQuestionKind.ASSESSMENT,
        content: '你喜欢独处吗？',
      });
      expect(itemRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assessmentId: '10' },
          order: { sortOrder: 'ASC' },
        }),
      );
    });

    it('卷不存在 → 46001', async () => {
      assessmentRepo.findOne.mockResolvedValue(null);

      await expect(service.getAssessment('99')).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_ASSESSMENT_NOT_FOUND },
      });
    });
  });

  describe('createAssessment', () => {
    it('合法保存体 → 事务内保存卷 + 全量替换 items，startQuestionCode 转 id', async () => {
      questionRepo.find.mockResolvedValue([mockAssessmentQuestion()]);
      resultRepo.find.mockResolvedValue([makeResult({ code: 'r1' })]);

      const saved = await service.createAssessment(assessmentBody());

      expect(saved).toMatchObject({
        code: 'as1',
        title: '性格测评',
        startQuestionId: '1',
        appScope: COMMON_SCOPE,
      });
      expect(txAssessmentRepo.save).toHaveBeenCalled();
      expect(txItemRepo.delete).toHaveBeenCalledWith({ assessmentId: '10' });
      expect(txItemRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({
          assessmentId: '10',
          questionId: '1',
          sortOrder: 1,
          nextQuestionId: null,
          dimension: null,
        }),
      ]);
    });

    it('questionId 查不足 → 46006', async () => {
      questionRepo.find.mockResolvedValue([]);
      resultRepo.find.mockResolvedValue([]);

      await expect(
        service.createAssessment(assessmentBody()),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_QUESTION_NOT_FOUND },
      });
      expect(txAssessmentRepo.save).not.toHaveBeenCalled();
    });

    it('流程校验失败（goto 死链）→ 46009 且消息合并错误列表', async () => {
      questionRepo.find.mockResolvedValue([
        makeQuestion({
          id: '1',
          code: 'q1',
          kind: QuizQuestionKind.ASSESSMENT,
          options: [{ text: 'A', goto: 'ghost' }],
        }),
      ]);
      resultRepo.find.mockResolvedValue([makeResult({ code: 'r1' })]);

      await expect(
        service.createAssessment(assessmentBody()),
      ).rejects.toMatchObject({
        response: {
          code: ErrorCodes.QUIZ_FLOW_INVALID,
          msg: expect.stringContaining('ghost'),
        },
      });
      expect(txAssessmentRepo.save).not.toHaveBeenCalled();
    });

    it('startQuestionCode 不在卷内 → 46009', async () => {
      questionRepo.find.mockResolvedValue([mockAssessmentQuestion()]);
      resultRepo.find.mockResolvedValue([makeResult({ code: 'r1' })]);

      await expect(
        service.createAssessment(assessmentBody({ startQuestionCode: 'nope' })),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_FLOW_INVALID },
      });
    });

    it('code 冲突（含软删行）→ 46010', async () => {
      questionRepo.find.mockResolvedValue([mockAssessmentQuestion()]);
      resultRepo.find.mockResolvedValue([makeResult({ code: 'r1' })]);
      txAssessmentRepo.findOne.mockResolvedValue(makeAssessment());

      await expect(
        service.createAssessment(assessmentBody()),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_CODE_EXISTS },
      });
      expect(txAssessmentRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ withDeleted: true }),
      );
    });

    it('结果引用按 scope 过滤：非 common 且非卷 scope 的结果视为不存在 → 46009', async () => {
      questionRepo.find.mockResolvedValue([mockAssessmentQuestion()]);
      resultRepo.find.mockResolvedValue([
        makeResult({ code: 'r1', appScope: COMMON_SCOPE }),
        makeResult({ id: '2', code: 'r2', appScope: 'other-app' }),
      ]);

      await expect(
        service.createAssessment(
          assessmentBody({
            scoringRule: {
              mode: 'total',
              results: [{ min: 0, max: 9, result: 'r2' }],
            },
          }),
        ),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_FLOW_INVALID },
      });
    });
  });

  describe('updateAssessment', () => {
    it('卷不存在 → 46001', async () => {
      assessmentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateAssessment('99', assessmentBody()),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_ASSESSMENT_NOT_FOUND },
      });
    });

    it('存在则事务内更新并全量替换 items', async () => {
      assessmentRepo.findOne.mockResolvedValue(makeAssessment());
      questionRepo.find.mockResolvedValue([mockAssessmentQuestion()]);
      resultRepo.find.mockResolvedValue([makeResult({ code: 'r1' })]);

      const saved = await service.updateAssessment(
        '10',
        assessmentBody({ title: '新卷名' }),
      );

      expect(saved.title).toBe('新卷名');
      expect(txAssessmentRepo.save).toHaveBeenCalled();
      expect(txItemRepo.delete).toHaveBeenCalledWith({ assessmentId: '10' });
      expect(txItemRepo.save).toHaveBeenCalled();
    });
  });

  describe('deleteAssessment', () => {
    it('软删目标卷', async () => {
      assessmentRepo.findOne.mockResolvedValue(makeAssessment());

      await service.deleteAssessment('10');

      expect(assessmentRepo.softRemove).toHaveBeenCalledWith(
        expect.objectContaining({ id: '10' }),
      );
    });

    it('卷不存在 → 46001', async () => {
      assessmentRepo.findOne.mockResolvedValue(null);

      await expect(service.deleteAssessment('99')).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_ASSESSMENT_NOT_FOUND },
      });
    });
  });

  describe('publishAssessment', () => {
    it('重跑校验通过 → status 置 PUBLISHED', async () => {
      assessmentRepo.findOne.mockResolvedValue(makeAssessment());
      itemRepo.find.mockResolvedValue([
        {
          id: '20',
          assessmentId: '10',
          questionId: '1',
          sortOrder: 1,
          nextQuestionId: null,
          dimension: null,
        } as QuizAssessmentItem,
      ]);
      questionRepo.find.mockResolvedValue([mockAssessmentQuestion()]);
      resultRepo.find.mockResolvedValue([makeResult({ code: 'r1' })]);

      const saved = await service.publishAssessment('10');

      expect(saved.status).toBe(QuizAssessmentStatus.PUBLISHED);
      expect(assessmentRepo.save).toHaveBeenCalled();
    });

    it('已发布再 publish → 幂等成功（不再加载题目校验）', async () => {
      assessmentRepo.findOne.mockResolvedValue(
        makeAssessment({ status: QuizAssessmentStatus.PUBLISHED }),
      );

      const saved = await service.publishAssessment('10');

      expect(saved.status).toBe(QuizAssessmentStatus.PUBLISHED);
      expect(itemRepo.find).not.toHaveBeenCalled();
      expect(questionRepo.find).not.toHaveBeenCalled();
    });

    it('卷不存在 → 46001', async () => {
      assessmentRepo.findOne.mockResolvedValue(null);

      await expect(service.publishAssessment('99')).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_ASSESSMENT_NOT_FOUND },
      });
    });

    it('题目已被改动导致校验失败（goto 死链）→ 46009 且不落 status', async () => {
      assessmentRepo.findOne.mockResolvedValue(makeAssessment());
      itemRepo.find.mockResolvedValue([
        {
          id: '20',
          assessmentId: '10',
          questionId: '1',
          sortOrder: 1,
          nextQuestionId: null,
          dimension: null,
        } as QuizAssessmentItem,
      ]);
      questionRepo.find.mockResolvedValue([
        makeQuestion({
          id: '1',
          code: 'q1',
          kind: QuizQuestionKind.ASSESSMENT,
          options: [{ text: 'A', goto: 'ghost' }],
        }),
      ]);
      resultRepo.find.mockResolvedValue([]);

      await expect(service.publishAssessment('10')).rejects.toMatchObject({
        response: { code: ErrorCodes.QUIZ_FLOW_INVALID },
      });
      expect(assessmentRepo.save).not.toHaveBeenCalled();
    });
  });
});
