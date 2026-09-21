import { DialogueActionType, QuestStatus } from '@constants/enums';
import { assertDialogueNodes, DialogueNode } from './dialogue.types';
import {
  collectFlagKeys,
  DialogueContext,
  matchCondition,
  resolveNode,
} from './dialogue.resolver';

/**
 * 纯函数单测：不连数据库 / redis，零 IO。
 * 覆盖计划 §1.6 要求的「同输入同输出」与「隐藏选项不出现在结果中」。
 */
describe('dialogue.resolver', () => {
  const makeCtx = (over: Partial<DialogueContext> = {}): DialogueContext => ({
    level: 1,
    questStatus: new Map<string, QuestStatus>(),
    itemCount: new Map<string, number>(),
    flags: new Set<string>(),
    ...over,
  });

  describe('resolveNode', () => {
    it('等级不足时隐藏选项，且 index 保持原始下标', () => {
      const nodes: DialogueNode[] = [
        {
          key: 'root',
          text: '你好',
          options: [
            { text: '高级', condition: { minLevel: 10 } },
            { text: '普通' },
            { text: '中级', condition: { minLevel: 5 } },
          ],
        },
      ];

      const low = resolveNode(nodes, 'root', makeCtx({ level: 3 }));
      expect(low).not.toBeNull();
      expect(low!.options.map((o) => o.text)).toEqual(['普通']);
      expect(low!.options[0].index).toBe(1); // 原始下标，不是过滤后下标

      const high = resolveNode(nodes, 'root', makeCtx({ level: 10 }));
      expect(high!.options.map((o) => o.index)).toEqual([0, 1, 2]);
      expect(high!.options.map((o) => o.text)).toEqual(['高级', '普通', '中级']);
    });

    it('notQuestId：任务已接时隐藏「接取」选项', () => {
      const nodes: DialogueNode[] = [
        {
          key: 'root',
          text: '你好',
          options: [
            {
              text: '接取',
              action: DialogueActionType.ACCEPT_QUEST,
              condition: { notQuestId: '77' },
            },
            { text: '离开' },
          ],
        },
      ];

      const before = resolveNode(nodes, 'root', makeCtx());
      expect(before!.options.map((o) => o.text)).toEqual(['接取', '离开']);

      const after = resolveNode(
        nodes,
        'root',
        makeCtx({ questStatus: new Map([['77', QuestStatus.IN_PROGRESS]]) }),
      );
      expect(after!.options.map((o) => o.text)).toEqual(['离开']);
      expect(after!.options[0].index).toBe(1);
    });

    it('questId：未接任务时隐藏「提交」选项', () => {
      const nodes: DialogueNode[] = [
        {
          key: 'root',
          text: '你好',
          options: [
            {
              text: '提交',
              action: DialogueActionType.SUBMIT_QUEST,
              condition: { questId: '77' },
            },
            { text: '离开' },
          ],
        },
      ];

      const notAccepted = resolveNode(nodes, 'root', makeCtx());
      expect(notAccepted!.options.map((o) => o.text)).toEqual(['离开']);
      expect(notAccepted!.options[0].index).toBe(1);

      const accepted = resolveNode(
        nodes,
        'root',
        makeCtx({ questStatus: new Map([['77', QuestStatus.IN_PROGRESS]]) }),
      );
      expect(accepted!.options.map((o) => o.text)).toEqual(['提交', '离开']);
    });

    it('questStatus：与 questId 配合时按精确状态过滤', () => {
      const nodes: DialogueNode[] = [
        {
          key: 'root',
          text: '你好',
          options: [
            { text: '领奖', condition: { questId: '77', questStatus: 'completed' } },
            { text: '离开' },
          ],
        },
      ];

      const inProgress = resolveNode(
        nodes,
        'root',
        makeCtx({ questStatus: new Map([['77', QuestStatus.IN_PROGRESS]]) }),
      );
      expect(inProgress!.options.map((o) => o.text)).toEqual(['离开']);

      const completed = resolveNode(
        nodes,
        'root',
        makeCtx({ questStatus: new Map([['77', QuestStatus.COMPLETED]]) }),
      );
      expect(completed!.options.map((o) => o.text)).toEqual(['领奖', '离开']);
    });

    it('hasItemId：道具不足时隐藏该选项', () => {
      const nodes: DialogueNode[] = [
        {
          key: 'root',
          text: '你好',
          options: [
            { text: '交矿石', condition: { hasItemId: '5' } },
            { text: '离开' },
          ],
        },
      ];

      const none = resolveNode(nodes, 'root', makeCtx());
      expect(none!.options.map((o) => o.text)).toEqual(['离开']);

      const owned = resolveNode(
        nodes,
        'root',
        makeCtx({ itemCount: new Map([['5', 2]]) }),
      );
      expect(owned!.options.map((o) => o.text)).toEqual(['交矿石', '离开']);

      const zero = resolveNode(
        nodes,
        'root',
        makeCtx({ itemCount: new Map([['5', 0]]) }),
      );
      expect(zero!.options.map((o) => o.text)).toEqual(['离开']);
    });

    it('flag：旗标存在与否决定选项可见性', () => {
      const nodes: DialogueNode[] = [
        {
          key: 'root',
          text: '你好',
          options: [
            { text: '密道', condition: { flag: 'saw_secret' } },
            { text: '离开' },
          ],
        },
      ];

      const absent = resolveNode(nodes, 'root', makeCtx());
      expect(absent!.options.map((o) => o.text)).toEqual(['离开']);

      const present = resolveNode(
        nodes,
        'root',
        makeCtx({ flags: new Set(['saw_secret']) }),
      );
      expect(present!.options.map((o) => o.text)).toEqual(['密道', '离开']);
    });

    it('节点级 condition 不满足时返回 null；满足时正常返回', () => {
      const nodes: DialogueNode[] = [
        {
          key: 'secret',
          text: '秘密',
          condition: { minLevel: 10 },
          options: [{ text: '继续' }],
        },
      ];

      expect(resolveNode(nodes, 'secret', makeCtx({ level: 5 }))).toBeNull();
      expect(resolveNode(nodes, 'secret', makeCtx({ level: 10 }))).not.toBeNull();
    });

    it('nodeKey 不存在时返回 null', () => {
      const nodes: DialogueNode[] = [
        { key: 'root', text: '你好', options: [{ text: '离开' }] },
      ];
      expect(resolveNode(nodes, 'nope', makeCtx())).toBeNull();
    });

    it('纯函数：同输入两次调用结果 deep-equal', () => {
      const nodes: DialogueNode[] = [
        {
          key: 'root',
          speaker: '铁匠',
          text: '你好',
          options: [
            {
              text: '接取',
              next: 'end',
              action: DialogueActionType.ACCEPT_QUEST,
              condition: { notQuestId: '77' },
            },
            { text: '离开' },
          ],
        },
        { key: 'end', text: '再见', options: [{ text: '结束' }] },
      ];
      const ctx = makeCtx({ level: 5, itemCount: new Map([['5', 1]]) });

      const first = resolveNode(nodes, 'root', ctx);
      const second = resolveNode(nodes, 'root', ctx);
      expect(second).toEqual(first);
      expect(second).not.toBe(first);
      // 结果携带 next / action，供 Task 3 choose 使用
      expect(first!.options[0].next).toBe('end');
      expect(first!.options[0].action).toBe(DialogueActionType.ACCEPT_QUEST);
      expect(first!.speaker).toBe('铁匠');
    });
  });

  describe('matchCondition', () => {
    it('undefined / 空对象恒为 true；未识别的键被忽略', () => {
      const ctx = makeCtx({ level: 1 });
      expect(matchCondition(undefined, ctx)).toBe(true);
      expect(matchCondition({}, ctx)).toBe(true);
      expect(matchCondition({ unknownKey: 'whatever' } as any, ctx)).toBe(true);
      // 非法 minLevel 忽略
      expect(matchCondition({ minLevel: NaN }, ctx)).toBe(true);
      // 未识别的 questStatus 值忽略
      expect(matchCondition({ questStatus: 'weird' } as any, ctx)).toBe(true);
    });

    it('多个条件为 AND 语义', () => {
      const nodes: DialogueNode[] = [
        {
          key: 'root',
          text: '你好',
          options: [
            {
              text: '全满足',
              condition: { minLevel: 5, questId: '77', hasItemId: '5', flag: 'f1' },
            },
            { text: '离开' },
          ],
        },
      ];

      const partial = resolveNode(
        nodes,
        'root',
        makeCtx({
          level: 9,
          questStatus: new Map([['77', QuestStatus.IN_PROGRESS]]),
          itemCount: new Map([['5', 1]]),
          // 缺 flag
        }),
      );
      expect(partial!.options.map((o) => o.text)).toEqual(['离开']);

      const full = resolveNode(
        nodes,
        'root',
        makeCtx({
          level: 9,
          questStatus: new Map([['77', QuestStatus.IN_PROGRESS]]),
          itemCount: new Map([['5', 1]]),
          flags: new Set(['f1']),
        }),
      );
      expect(full!.options.map((o) => o.text)).toEqual(['全满足', '离开']);
    });
  });

  describe('collectFlagKeys', () => {
    it('收集节点级与选项级 flag 并去重', () => {
      const nodes: DialogueNode[] = [
        {
          key: 'root',
          text: '你好',
          condition: { flag: 'node_flag' },
          options: [
            { text: 'a', condition: { flag: 'opt_flag' } },
            { text: 'b', condition: { flag: 'opt_flag' } },
            { text: 'c' },
          ],
        },
        { key: 'end', text: '再见', options: [{ text: '结束' }] },
      ];
      expect(collectFlagKeys(nodes).sort()).toEqual(['node_flag', 'opt_flag']);
      expect(collectFlagKeys([])).toEqual([]);
    });
  });

  describe('assertDialogueNodes（结构校验）', () => {
    it('next 指向不存在的 key 时返回结构化错误', () => {
      const bad = [
        {
          key: 'root',
          text: '你好',
          options: [{ text: '去某处', next: 'nope' }],
        },
      ];
      const result = assertDialogueNodes(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('nope');
        expect(result.errors[0]).toContain('节点[root].options[0]');
      }
    });

    it('每个节点至少一个无条件选项（风险 #3）：全条件反例报错，含节点 key', () => {
      const bad = [
        {
          key: 'root',
          text: '你好',
          options: [
            { text: 'a', condition: { minLevel: 10 } },
            { text: 'b', condition: { questId: '1' } },
          ],
        },
      ];
      const result = assertDialogueNodes(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.errors.some(
            (e) => e.includes('节点[root]') && e.includes('不带 condition'),
          ),
        ).toBe(true);
      }
    });

    it('至少一个无条件选项：普通选项或空对象 condition 均视为无条件', () => {
      const withPlain = [
        {
          key: 'root',
          text: '你好',
          options: [{ text: 'a', condition: { minLevel: 10 } }, { text: 'b' }],
        },
      ];
      expect(assertDialogueNodes(withPlain).ok).toBe(true);

      const withEmptyCondition = [
        {
          key: 'root',
          text: '你好',
          options: [{ text: 'a', condition: { minLevel: 10 } }, { text: 'b', condition: {} }],
        },
      ];
      expect(assertDialogueNodes(withEmptyCondition).ok).toBe(true);
    });

    it('合法对话树通过校验', () => {
      const good = [
        {
          key: 'root',
          text: '你好',
          options: [
            { text: '接取', next: 'accepted', action: 'accept_quest' },
            { text: '离开' },
          ],
        },
        { key: 'accepted', text: '好', options: [{ text: '结束' }] },
      ];
      const result = assertDialogueNodes(good);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.nodes).toHaveLength(2);
    });
  });
});
