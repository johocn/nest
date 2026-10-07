import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  QuizAssessment,
  QuizAssessmentItem,
  QuizQuestion,
  QuizResult,
} from './entities';
import { FlowItemInput, validateAssessmentFlow } from './quiz-flow';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { QuizAssessmentStatus } from '@constants/enums';
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
    @InjectRepository(QuizAssessment)
    private readonly assessmentRepo: Repository<QuizAssessment>,
    @InjectRepository(QuizAssessmentItem)
    private readonly itemRepo: Repository<QuizAssessmentItem>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
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

  // ===== 测评卷 =====

  async listAssessments(
    page: number,
    limit: number,
  ): Promise<{ items: QuizAssessment[]; total: number }> {
    const [items, total] = await this.assessmentRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async getAssessment(id: string): Promise<any> {
    const assessment = await this.assessmentRepo.findOne({ where: { id } });
    if (!assessment) {
      throw new GameException(ErrorCodes.QUIZ_ASSESSMENT_NOT_FOUND, '测评卷不存在');
    }
    const items = await this.itemRepo.find({
      where: { assessmentId: id },
      order: { sortOrder: 'ASC' },
    });
    const questionIds = [...new Set(items.map((i) => i.questionId))];
    const questions = questionIds.length
      ? await this.questionRepo.find({ where: { id: In(questionIds) } })
      : [];
    const qMap = new Map(questions.map((q) => [q.id, q]));
    return {
      ...assessment,
      items: items.map((item) => {
        const q = qMap.get(item.questionId);
        return {
          ...item,
          question: q
            ? { id: q.id, code: q.code, kind: q.kind, content: q.content }
            : null,
        };
      }),
    };
  }

  async createAssessment(body: any): Promise<QuizAssessment> {
    return this.saveAssessment(null, body);
  }

  async updateAssessment(id: string, body: any): Promise<QuizAssessment> {
    const assessment = await this.assessmentRepo.findOne({ where: { id } });
    if (!assessment) {
      throw new GameException(ErrorCodes.QUIZ_ASSESSMENT_NOT_FOUND, '测评卷不存在');
    }
    return this.saveAssessment(assessment, body);
  }

  async deleteAssessment(id: string): Promise<void> {
    const assessment = await this.assessmentRepo.findOne({ where: { id } });
    if (!assessment) {
      throw new GameException(ErrorCodes.QUIZ_ASSESSMENT_NOT_FOUND, '测评卷不存在');
    }
    await this.assessmentRepo.softRemove(assessment);
  }

  async publishAssessment(id: string): Promise<QuizAssessment> {
    const assessment = await this.assessmentRepo.findOne({ where: { id } });
    if (!assessment) {
      throw new GameException(ErrorCodes.QUIZ_ASSESSMENT_NOT_FOUND, '测评卷不存在');
    }
    // 已发布再 publish 幂等成功
    if (assessment.status === QuizAssessmentStatus.PUBLISHED) {
      return assessment;
    }
    // 题可能在存卷后被改/删，发布前重跑一次校验
    const items = await this.itemRepo.find({
      where: { assessmentId: id },
      order: { sortOrder: 'ASC' },
    });
    const flowItems = await this.buildFlowItems(items);
    const errors = validateAssessmentFlow({
      items: flowItems,
      startQuestionId: assessment.startQuestionId,
      scoringRule: assessment.scoringRule as any,
      assessmentScope: assessment.appScope,
      knownResultCodes: await this.getKnownResultCodes(assessment.appScope),
    });
    if (errors.length > 0) {
      throw new GameException(ErrorCodes.QUIZ_FLOW_INVALID, errors.join('；'));
    }
    assessment.status = QuizAssessmentStatus.PUBLISHED;
    return this.assessmentRepo.save(assessment);
  }

  /**
   * 结果库 admin 全量可见（阶段 1「admin 不加过滤」惯例）；
   * result scope 规则（common 或 = 卷 scope）在组装 Set 时完成过滤。
   */
  private async getKnownResultCodes(
    assessmentScope: string,
  ): Promise<Set<string>> {
    const results = await this.resultRepo.find();
    return new Set(
      results
        .filter(
          (r) => r.appScope === COMMON_SCOPE || r.appScope === assessmentScope,
        )
        .map((r) => r.code),
    );
  }

  /** item 行 + 批量题目 → 校验器输入；题目缺失（已删）→ QUIZ_FLOW_INVALID */
  private async buildFlowItems(
    items: QuizAssessmentItem[],
  ): Promise<FlowItemInput[]> {
    const questionIds = [...new Set(items.map((i) => i.questionId))];
    const questions = questionIds.length
      ? await this.questionRepo.find({ where: { id: In(questionIds) } })
      : [];
    const qMap = new Map(questions.map((q) => [q.id, q]));
    return items.map((item) => {
      const q = qMap.get(item.questionId);
      if (!q) {
        throw new GameException(
          ErrorCodes.QUIZ_FLOW_INVALID,
          `卷内题目不存在或已删除: ${item.questionId}`,
        );
      }
      return {
        questionId: item.questionId,
        sortOrder: item.sortOrder,
        nextQuestionId: item.nextQuestionId,
        dimension: item.dimension,
        question: {
          id: q.id,
          code: q.code,
          kind: q.kind,
          appScope: q.appScope,
          options: q.options ?? [],
        },
      };
    });
  }

  /** 保存体校验 + 事务落库（create/update 共用；items 全量替换） */
  private async saveAssessment(
    existing: QuizAssessment | null,
    body: any,
  ): Promise<QuizAssessment> {
    const appScope = body.appScope ?? COMMON_SCOPE;
    const rawItems: any[] = Array.isArray(body.items) ? body.items : [];

    // ① 按 questionId 批量查题（withDeleted 默认 false）
    const questionIds = [...new Set(rawItems.map((i) => String(i.questionId)))];
    const questions = questionIds.length
      ? await this.questionRepo.find({ where: { id: In(questionIds) } })
      : [];
    if (questions.length !== questionIds.length) {
      throw new GameException(
        ErrorCodes.QUIZ_QUESTION_NOT_FOUND,
        '卷内存在不存在的题目',
      );
    }
    const qMap = new Map(questions.map((q) => [q.id, q]));

    // ② 组装 FlowItemInput 并做流程连通性校验
    const flowItems: FlowItemInput[] = rawItems.map((i) => {
      const q = qMap.get(String(i.questionId));
      if (!q) {
        throw new GameException(
          ErrorCodes.QUIZ_QUESTION_NOT_FOUND,
          '卷内存在不存在的题目',
        );
      }
      return {
        questionId: String(i.questionId),
        sortOrder: Number(i.sortOrder ?? 0),
        nextQuestionId:
          i.nextQuestionId != null ? String(i.nextQuestionId) : null,
        dimension: i.dimension ?? null,
        question: {
          id: q.id,
          code: q.code,
          kind: q.kind,
          appScope: q.appScope,
          options: q.options ?? [],
        },
      };
    });
    const errors = validateAssessmentFlow({
      items: flowItems,
      startQuestionId: null,
      scoringRule: body.scoringRule ?? {},
      assessmentScope: appScope,
      knownResultCodes: await this.getKnownResultCodes(appScope),
    });
    if (errors.length > 0) {
      throw new GameException(ErrorCodes.QUIZ_FLOW_INVALID, errors.join('；'));
    }

    // ③ startQuestionCode → id（须命中卷内题目）
    let startQuestionId: string | null = null;
    if (body.startQuestionCode) {
      const found = flowItems.find(
        (fi) => fi.question.code === body.startQuestionCode,
      );
      if (!found) {
        throw new GameException(
          ErrorCodes.QUIZ_FLOW_INVALID,
          `startQuestionCode 不在卷内题目中: ${body.startQuestionCode}`,
        );
      }
      startQuestionId = found.questionId;
    }

    // ④ 保存卷（code 冲突沿用 withDeleted 模式）+ 全量替换 items
    return this.dataSource.transaction(async (em) => {
      const assessmentRepo = em.getRepository(QuizAssessment);
      const itemRepo = em.getRepository(QuizAssessmentItem);
      await this.assertCodeAvailable(
        assessmentRepo,
        body.code ?? existing?.code,
        appScope,
        existing?.id,
      );
      const assessment = existing ?? assessmentRepo.create();
      assessment.code = body.code ?? assessment.code;
      assessment.title = body.title ?? assessment.title;
      assessment.description = body.description ?? null;
      assessment.scoringRule = body.scoringRule ?? {};
      assessment.startQuestionId = startQuestionId;
      assessment.appScope = appScope;
      const saved = await assessmentRepo.save(assessment);

      await itemRepo.delete({ assessmentId: saved.id });
      if (rawItems.length > 0) {
        await itemRepo.save(
          rawItems.map((i) =>
            itemRepo.create({
              assessmentId: saved.id,
              questionId: String(i.questionId),
              sortOrder: Number(i.sortOrder ?? 0),
              nextQuestionId:
                i.nextQuestionId != null ? String(i.nextQuestionId) : null,
              dimension: i.dimension ?? null,
            }),
          ),
        );
      }
      return saved;
    });
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
