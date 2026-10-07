import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { QuizAdminService } from './quiz-admin.service';
import { QuizQuestion, QuizResult } from './entities';
import { ErrorCodes } from '@constants/error-codes';
import { QuizQuestionKind } from '@constants/enums';
import { COMMON_SCOPE } from '@shared/content-scope';

describe('QuizAdminService', () => {
  let service: QuizAdminService;
  let questionRepo: jest.Mocked<Repository<QuizQuestion>>;
  let resultRepo: jest.Mocked<Repository<QuizResult>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizAdminService,
        {
          provide: getRepositoryToken(QuizQuestion),
          useValue: {
            findOne: jest.fn(),
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
            findAndCount: jest.fn(),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            softRemove: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(QuizAdminService);
    questionRepo = module.get(getRepositoryToken(QuizQuestion));
    resultRepo = module.get(getRepositoryToken(QuizResult));
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
});
