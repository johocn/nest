import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuizQuestion, QuizResult } from './entities';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { COMMON_SCOPE } from '@shared/content-scope';

/**
 * quiz 题目池 / 结果库 admin CRUD。
 * 注：结果库资源缺失复用 QUIZ_ASSESSMENT_NOT_FOUND（46001）——
 * 语义为「测评内容（结果）不存在」，不再单设近似错误码。
 */
@Injectable()
export class QuizAdminService {
  constructor(
    @InjectRepository(QuizQuestion)
    private readonly questionRepo: Repository<QuizQuestion>,
    @InjectRepository(QuizResult)
    private readonly resultRepo: Repository<QuizResult>,
  ) {}

  // ===== 题目池 =====

  async listQuestions(
    page: number,
    limit: number,
    kind?: string,
    category?: string,
  ): Promise<{ items: QuizQuestion[]; total: number }> {
    const where: Record<string, any> = {};
    if (kind) where.kind = kind;
    if (category) where.category = category;
    const [items, total] = await this.questionRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      where,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async getQuestion(id: string): Promise<QuizQuestion | null> {
    return this.questionRepo.findOne({ where: { id } });
  }

  async createQuestion(body: any): Promise<QuizQuestion> {
    const appScope = body.appScope ?? COMMON_SCOPE;
    await this.assertCodeAvailable(this.questionRepo, body.code, appScope);
    this.stripAssessmentAnswers(body.kind, body.options);
    return this.questionRepo.save(
      this.questionRepo.create({ ...body, appScope } as Partial<QuizQuestion>),
    );
  }

  async updateQuestion(id: string, body: any): Promise<QuizQuestion> {
    const question = await this.questionRepo.findOne({ where: { id } });
    if (!question) {
      throw new GameException(ErrorCodes.QUIZ_QUESTION_NOT_FOUND, '题目不存在');
    }
    await this.assertCodeAvailable(
      this.questionRepo,
      body.code ?? question.code,
      body.appScope ?? COMMON_SCOPE,
      id,
    );
    this.stripAssessmentAnswers(body.kind ?? question.kind, body.options);
    Object.assign(question, body);
    return this.questionRepo.save(question);
  }

  async deleteQuestion(id: string): Promise<void> {
    const question = await this.questionRepo.findOne({ where: { id } });
    if (!question) {
      throw new GameException(ErrorCodes.QUIZ_QUESTION_NOT_FOUND, '题目不存在');
    }
    await this.questionRepo.softRemove(question);
  }

  // ===== 结果库 =====

  async listResults(
    page: number,
    limit: number,
  ): Promise<{ items: QuizResult[]; total: number }> {
    const [items, total] = await this.resultRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async getResult(id: string): Promise<QuizResult | null> {
    return this.resultRepo.findOne({ where: { id } });
  }

  async createResult(body: any): Promise<QuizResult> {
    const appScope = body.appScope ?? COMMON_SCOPE;
    await this.assertCodeAvailable(this.resultRepo, body.code, appScope);
    return this.resultRepo.save(
      this.resultRepo.create({ ...body, appScope } as Partial<QuizResult>),
    );
  }

  async updateResult(id: string, body: any): Promise<QuizResult> {
    const result = await this.resultRepo.findOne({ where: { id } });
    if (!result) {
      throw new GameException(ErrorCodes.QUIZ_ASSESSMENT_NOT_FOUND, '结果不存在');
    }
    await this.assertCodeAvailable(
      this.resultRepo,
      body.code ?? result.code,
      body.appScope ?? COMMON_SCOPE,
      id,
    );
    Object.assign(result, body);
    return this.resultRepo.save(result);
  }

  async deleteResult(id: string): Promise<void> {
    const result = await this.resultRepo.findOne({ where: { id } });
    if (!result) {
      throw new GameException(ErrorCodes.QUIZ_ASSESSMENT_NOT_FOUND, '结果不存在');
    }
    await this.resultRepo.softRemove(result);
  }

  /**
   * 同 scope 下 code 唯一校验（withDeleted 连软删行一并查，避免复活后撞
   * 唯一索引 uq_quiz_*_code）；excludeId 供 update 排除自身。
   */
  private async assertCodeAvailable(
    repo: Repository<any>,
    code: string,
    appScope: string,
    excludeId?: string,
  ): Promise<void> {
    const exists = await repo.findOne({
      where: { code, appScope },
      withDeleted: true,
    });
    if (exists && exists.id !== excludeId) {
      throw new GameException(ErrorCodes.QUIZ_CODE_EXISTS, `code 已存在: ${code}`);
    }
  }

  /** assessment 题无对错语义：剥离 options 混入的 answer 字段，防脏数据入库 */
  private stripAssessmentAnswers(kind: string | undefined, options: any): void {
    if (kind !== 'assessment' || !Array.isArray(options)) return;
    for (const option of options) {
      if (option && typeof option === 'object' && 'answer' in option) {
        delete option.answer;
      }
    }
  }
}
