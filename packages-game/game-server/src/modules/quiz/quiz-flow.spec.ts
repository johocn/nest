import {
  FlowItemInput,
  ScoringRuleInput,
  validateAssessmentFlow,
} from './quiz-flow';

/** 便捷构造：覆盖 questionId/sortOrder/question 三要素 */
const itemWithQuestion = (
  id: string,
  code: string,
  sortOrder: number,
  extra: {
    nextQuestionId?: string | null;
    options?: Array<{ text: string; goto?: string }>;
    kind?: string;
    appScope?: string;
  } = {},
): FlowItemInput => ({
  questionId: id,
  sortOrder,
  nextQuestionId: extra.nextQuestionId ?? null,
  dimension: null,
  question: {
    id,
    code,
    kind: extra.kind ?? 'assessment',
    appScope: extra.appScope ?? 'common',
    options: extra.options ?? [{ text: 'A' }],
  },
});

const buildInput = (
  items: FlowItemInput[],
  overrides: {
    startQuestionId?: string | null;
    scoringRule?: ScoringRuleInput;
    assessmentScope?: string;
    knownResultCodes?: Set<string>;
  } = {},
) => ({
  items,
  startQuestionId: null,
  scoringRule: {
    mode: 'total',
    results: [{ min: 0, max: 100, result: 'r1' }],
  } as ScoringRuleInput,
  assessmentScope: 'common',
  knownResultCodes: new Set(['r1']),
  ...overrides,
});

describe('validateAssessmentFlow', () => {
  describe('跳转连通性', () => {
    it('① goto 指向卷外 code → 死链错误', () => {
      const items = [
        itemWithQuestion('1', 'q1', 1, {
          options: [{ text: 'A', goto: 'ghost' }],
        }),
      ];

      const errors = validateAssessmentFlow(buildInput(items));

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join('；')).toContain('ghost');
    });

    it('② A→B→A 互指 → 死循环错误', () => {
      const items = [
        itemWithQuestion('1', 'q1', 1, { nextQuestionId: '2' }),
        itemWithQuestion('2', 'q2', 2, { nextQuestionId: '1' }),
      ];

      const errors = validateAssessmentFlow(buildInput(items));

      expect(errors.join('；')).toContain('循环');
    });

    it('③ 分支选项跳进无终点子图 → 不可达终点错误', () => {
      const items = [
        itemWithQuestion('1', 'q1', 1, {
          options: [{ text: '走主线' }, { text: '进死胡同', goto: 'q4' }],
        }),
        itemWithQuestion('2', 'q2', 2),
        itemWithQuestion('3', 'q3', 3),
        itemWithQuestion('4', 'q4', 4, {
          options: [{ text: '原地打转', goto: 'q4' }],
        }),
      ];

      const errors = validateAssessmentFlow(buildInput(items));

      expect(errors.join('；')).toContain('终点');
    });

    it('④ 合法卷（默认顺序 + goto 跳过中段 + 末题收尾）→ 无错误', () => {
      const items = [
        itemWithQuestion('1', 'q1', 1, {
          options: [{ text: 'A' }, { text: '跳过中段', goto: 'q3' }],
        }),
        itemWithQuestion('2', 'q2', 2),
        itemWithQuestion('3', 'q3', 3),
      ];

      expect(validateAssessmentFlow(buildInput(items))).toEqual([]);
    });
  });

  describe('题目与 scope 规则', () => {
    it('⑤ 卷内混入 knowledge 题 → 错误', () => {
      const items = [
        itemWithQuestion('1', 'q1', 1),
        itemWithQuestion('2', 'q2', 2, { kind: 'knowledge' }),
      ];

      const errors = validateAssessmentFlow(buildInput(items));

      expect(errors.join('；')).toContain('q2');
    });

    it('⑥ 题目 appScope 与卷不同且非 common → 错误', () => {
      const items = [itemWithQuestion('1', 'q1', 1, { appScope: 'app-x' })];

      const errors = validateAssessmentFlow(buildInput(items));

      expect(errors.length).toBeGreaterThan(0);
    });

    it('题目 appScope 与卷相同 → 通过', () => {
      const items = [itemWithQuestion('1', 'q1', 1, { appScope: 'app-x' })];

      expect(
        validateAssessmentFlow(
          buildInput(items, { assessmentScope: 'app-x' }),
        ),
      ).toEqual([]);
    });
  });

  describe('计分规则', () => {
    it('⑦ scoring_rule 引用不存在的 result code → 错误', () => {
      const items = [itemWithQuestion('1', 'q1', 1)];

      const errors = validateAssessmentFlow(
        buildInput(items, { knownResultCodes: new Set(['r-other']) }),
      );

      expect(errors.join('；')).toContain('r1');
    });

    it('⑧ dimension 模式缺 dim 名 → 错误', () => {
      const items = [itemWithQuestion('1', 'q1', 1)];

      const errors = validateAssessmentFlow(
        buildInput(items, {
          scoringRule: {
            mode: 'dimension',
            dims: [{ name: '', results: [{ min: 0, max: 9, result: 'r1' }] }],
          },
        }),
      );

      expect(errors.length).toBeGreaterThan(0);
    });

    it('dimension 模式 dim 名齐全且 result 存在 → 通过', () => {
      const items = [itemWithQuestion('1', 'q1', 1)];

      expect(
        validateAssessmentFlow(
          buildInput(items, {
            scoringRule: {
              mode: 'dimension',
              dims: [{ name: '外向', results: [{ min: 0, max: 9, result: 'r1' }] }],
            },
          }),
        ),
      ).toEqual([]);
    });
  });

  describe('结构规则', () => {
    it('items 为空 → 错误', () => {
      expect(validateAssessmentFlow(buildInput([])).length).toBeGreaterThan(0);
    });

    it('questionId 重复 → 错误', () => {
      const items = [
        itemWithQuestion('1', 'q1', 1),
        itemWithQuestion('1', 'q1-dup', 2),
      ];

      expect(validateAssessmentFlow(buildInput(items)).length).toBeGreaterThan(
        0,
      );
    });

    it('sortOrder 重复 → 错误', () => {
      const items = [
        itemWithQuestion('1', 'q1', 1),
        itemWithQuestion('2', 'q2', 1),
      ];

      expect(validateAssessmentFlow(buildInput(items)).length).toBeGreaterThan(
        0,
      );
    });

    it('start_question_id 不在卷内 → 错误', () => {
      const items = [itemWithQuestion('1', 'q1', 1)];

      const errors = validateAssessmentFlow(
        buildInput(items, { startQuestionId: '99' }),
      );

      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
