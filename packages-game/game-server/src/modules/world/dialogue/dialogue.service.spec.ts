import { DialogueActionType, QuestStatus } from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import {
  GameException,
  GameExceptionResponse,
} from '@common/exceptions/game.exception';
import { DialogueService } from './dialogue.service';

/**
 * 单测直接 new 出服务（mocked repository / 各依赖服务），不连真实数据库或 redis。
 * 风格参照 npc-presence.service.spec.ts 的 mock 约定。
 */

const PLAYER_ID = '1001';

interface ServiceMocks {
  service: DialogueService;
  dialogueRepo: { findOne: jest.Mock };
  playerQuestRepo: { find: jest.Mock };
  inventoryItemRepo: { find: jest.Mock };
  playerService: { getById: jest.Mock };
  cacheService: { exists: jest.Mock; set: jest.Mock };
  questService: { acceptQuest: jest.Mock; submitQuest: jest.Mock };
  inventoryService: { addItem: jest.Mock; removeItem: jest.Mock };
  economyService: { addCurrency: jest.Mock };
}

function createService(): ServiceMocks {
  const dialogueRepo = { findOne: jest.fn() };
  const playerQuestRepo = { find: jest.fn().mockResolvedValue([]) };
  const inventoryItemRepo = { find: jest.fn().mockResolvedValue([]) };
  const playerService = {
    getById: jest.fn().mockResolvedValue({ id: PLAYER_ID, level: 12 }),
  };
  const cacheService = {
    exists: jest.fn().mockResolvedValue(false),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const questService = {
    acceptQuest: jest.fn().mockResolvedValue({}),
    submitQuest: jest.fn().mockResolvedValue({}),
  };
  const inventoryService = {
    addItem: jest.fn().mockResolvedValue({}),
    removeItem: jest.fn().mockResolvedValue({}),
  };
  const economyService = { addCurrency: jest.fn().mockResolvedValue({}) };

  const service = new DialogueService(
    playerQuestRepo as any,
    inventoryItemRepo as any,
    dialogueRepo as any,
    playerService as any,
    cacheService as any,
    questService as any,
    inventoryService as any,
    economyService as any,
  );

  return {
    service,
    dialogueRepo,
    playerQuestRepo,
    inventoryItemRepo,
    playerService,
    cacheService,
    questService,
    inventoryService,
    economyService,
  };
}

/** 捕获 GameException 并返回其响应体（code/msg），调用成功则视为失败 */
async function catchGameException(
  fn: () => Promise<unknown>,
): Promise<GameExceptionResponse> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof GameException) {
      return err.getResponse() as GameExceptionResponse;
    }
    throw err;
  }
  throw new Error('期望抛出 GameException，但调用成功返回');
}

describe('DialogueService.buildContext', () => {
  let mocks: ServiceMocks;
  let service: DialogueService;

  beforeEach(() => {
    mocks = createService();
    service = mocks.service;
  });

  it('并发读取等级/任务态/背包并组装成 Map（同模板数量累加）', async () => {
    mocks.playerQuestRepo.find.mockResolvedValue([
      {
        playerId: PLAYER_ID,
        questTemplateId: '77',
        status: QuestStatus.IN_PROGRESS,
      },
      { playerId: PLAYER_ID, questTemplateId: '78', status: QuestStatus.CLAIMED },
    ]);
    mocks.inventoryItemRepo.find.mockResolvedValue([
      { playerId: PLAYER_ID, itemTemplateId: '5', quantity: 3 },
      { playerId: PLAYER_ID, itemTemplateId: '5', quantity: 2 },
      { playerId: PLAYER_ID, itemTemplateId: '6', quantity: 0 },
    ]);

    const ctx = await service.buildContext(PLAYER_ID);

    expect(ctx.level).toBe(12);
    expect(ctx.questStatus.get('77')).toBe(QuestStatus.IN_PROGRESS);
    expect(ctx.questStatus.get('78')).toBe(QuestStatus.CLAIMED);
    expect(ctx.itemCount.get('5')).toBe(5);
    expect(ctx.itemCount.get('6')).toBe(0);
    expect(ctx.flags.size).toBe(0);

    expect(mocks.playerService.getById).toHaveBeenCalledWith(PLAYER_ID);
    expect(mocks.playerQuestRepo.find).toHaveBeenCalledWith({
      where: { playerId: PLAYER_ID },
    });
    expect(mocks.inventoryItemRepo.find).toHaveBeenCalledWith({
      where: { playerId: PLAYER_ID },
    });
  });

  it('无数据时返回空 Map，不抛异常', async () => {
    const ctx = await service.buildContext(PLAYER_ID);
    expect(ctx.questStatus.size).toBe(0);
    expect(ctx.itemCount.size).toBe(0);
    expect(ctx.flags.size).toBe(0);
    expect(ctx.level).toBe(12);
  });

  it('旗标：只放入存在的旗标，键为 dialogue:flag:<playerId>:<flag>，且去重探测', async () => {
    mocks.cacheService.exists.mockImplementation(
      async (key: string) =>
        key === `dialogue:flag:${PLAYER_ID}:saw_secret`,
    );

    const ctx = await service.buildContext(PLAYER_ID, [
      'saw_secret',
      'other',
      'saw_secret',
    ]);

    expect(ctx.flags.has('saw_secret')).toBe(true);
    expect(ctx.flags.has('other')).toBe(false);
    expect(ctx.flags.size).toBe(1);
    expect(mocks.cacheService.exists).toHaveBeenCalledTimes(2); // 去重后只探测两个
    expect(mocks.cacheService.exists).toHaveBeenCalledWith(
      `dialogue:flag:${PLAYER_ID}:saw_secret`,
    );
    expect(mocks.cacheService.exists).toHaveBeenCalledWith(
      `dialogue:flag:${PLAYER_ID}:other`,
    );
  });

  it('未传 neededFlags 时不访问 redis', async () => {
    await service.buildContext(PLAYER_ID);
    expect(mocks.cacheService.exists).not.toHaveBeenCalled();
  });

  it('玩家不存在或读取失败时等级按 0 处理', async () => {
    mocks.playerService.getById.mockResolvedValue(null);
    expect((await service.buildContext(PLAYER_ID)).level).toBe(0);

    mocks.playerService.getById.mockRejectedValue(new Error('db down'));
    expect((await service.buildContext(PLAYER_ID)).level).toBe(0);
  });
});

describe('DialogueService.executeAction / choose / start', () => {
  let mocks: ServiceMocks;
  let service: DialogueService;

  /** 基础三分支对话树：接任务 / 给道具 / 闲聊结束 */
  const BASE_NODES = [
    {
      key: 'root',
      speaker: '铁匠',
      text: '客官要打点什么？',
      options: [
        {
          text: '有什么活儿给我？',
          next: 'after_accept',
          action: DialogueActionType.ACCEPT_QUEST,
          actionArgs: { questTemplateId: '77' },
        },
        {
          text: '给我一块矿石',
          next: 'after_item',
          action: DialogueActionType.GIVE_ITEM,
          actionArgs: { itemTemplateId: '5', quantity: 3 },
        },
        { text: '随便看看' },
      ],
    },
    {
      key: 'after_accept',
      text: '去把野狼清了。',
      options: [{ text: '好' }],
    },
    {
      key: 'after_item',
      text: '拿好。',
      options: [{ text: '多谢' }],
    },
  ];

  function mockDialogue(nodes: any[] = BASE_NODES) {
    mocks.dialogueRepo.findOne.mockResolvedValue({
      id: '1',
      code: 'npc_blacksmith_main',
      title: '铁匠',
      nodes,
      isActive: true,
    });
  }

  beforeEach(() => {
    mocks = createService();
    service = mocks.service;
    mockDialogue();
  });

  it('accept_quest 成功 → 推进到 next 节点', async () => {
    const view = await service.choose(PLAYER_ID, {
      code: 'npc_blacksmith_main',
      nodeKey: 'root',
      optionIndex: 0,
    });

    expect(mocks.questService.acceptQuest).toHaveBeenCalledWith(PLAYER_ID, '77');
    expect(view.finished).toBe(false);
    expect(view.nodeKey).toBe('after_accept');
    expect(view.node?.text).toBe('去把野狼清了。');
    expect(view.code).toBe('npc_blacksmith_main');
  });

  it('give_item 失败（背包满）→ 异常上抛且不推进节点', async () => {
    mocks.inventoryService.addItem.mockRejectedValue(
      new GameException(ErrorCodes.BAG_FULL, '背包已满'),
    );

    const res = await catchGameException(() =>
      service.choose(PLAYER_ID, {
        code: 'npc_blacksmith_main',
        nodeKey: 'root',
        optionIndex: 1,
      }),
    );

    expect(res.code).toBe(ErrorCodes.BAG_FULL);
    expect(mocks.inventoryService.addItem).toHaveBeenCalledTimes(1);
    // 未推进：不返回任何节点视图（异常路径），服务端不会下发 next
    expect(mocks.questService.acceptQuest).not.toHaveBeenCalled();
  });

  it('give_item 调用 InventoryService.addItem，opTrace 非空且形如 dialogue:choose:<code>:<nodeKey>', async () => {
    const view = await service.choose(PLAYER_ID, {
      code: 'npc_blacksmith_main',
      nodeKey: 'root',
      optionIndex: 1,
    });

    expect(mocks.inventoryService.addItem).toHaveBeenCalledTimes(1);
    const [playerId, itemTemplateId, quantity, opTrace] =
      mocks.inventoryService.addItem.mock.calls[0];
    expect(playerId).toBe(PLAYER_ID);
    expect(itemTemplateId).toBe('5');
    expect(quantity).toBe(3);
    expect(opTrace).toBe('dialogue:choose:npc_blacksmith_main:root');
    expect(view.nodeKey).toBe('after_item');
  });

  it('give_item 未配 quantity 时缺省为 1', async () => {
    mockDialogue([
      {
        key: 'root',
        text: '给你',
        options: [
          {
            text: '收下',
            next: 'after',
            action: DialogueActionType.GIVE_ITEM,
            actionArgs: { itemTemplateId: '9' },
          },
        ],
      },
      { key: 'after', text: '好', options: [{ text: '嗯' }] },
    ]);

    await service.choose(PLAYER_ID, {
      code: 'npc_blacksmith_main',
      nodeKey: 'root',
      optionIndex: 0,
    });

    expect(mocks.inventoryService.addItem).toHaveBeenCalledWith(
      PLAYER_ID,
      '9',
      1,
      'dialogue:choose:npc_blacksmith_main:root',
    );
  });

  it('add_currency 走 EconomyService.addCurrency 且有 opTrace', async () => {
    mockDialogue([
      {
        key: 'root',
        text: '赏你的',
        options: [
          {
            text: '收下',
            action: DialogueActionType.ADD_CURRENCY,
            actionArgs: { currencyType: 'gold', amount: 100 },
          },
        ],
      },
    ]);

    const view = await service.choose(PLAYER_ID, {
      code: 'npc_blacksmith_main',
      nodeKey: 'root',
      optionIndex: 0,
    });

    expect(mocks.economyService.addCurrency).toHaveBeenCalledWith(
      PLAYER_ID,
      'gold',
      100,
      'dialogue',
      'dialogue:choose:npc_blacksmith_main:root',
    );
    expect(view.finished).toBe(true);
    expect(view.node).toBeNull();
  });

  it('set_flag 写 redis 旗标键 dialogue:flag:<playerId>:<flag>', async () => {
    mockDialogue([
      {
        key: 'root',
        text: '记住我',
        options: [
          {
            text: '好',
            action: DialogueActionType.SET_FLAG,
            actionArgs: { flag: 'met_blacksmith' },
          },
        ],
      },
    ]);

    await service.choose(PLAYER_ID, {
      code: 'npc_blacksmith_main',
      nodeKey: 'root',
      optionIndex: 0,
    });

    expect(mocks.cacheService.set).toHaveBeenCalledWith(
      `dialogue:flag:${PLAYER_ID}:met_blacksmith`,
      '1',
    );
  });

  it('executeAction：未知动作 → DIALOGUE_NODE_INVALID', async () => {
    const res = await catchGameException(() =>
      service.executeAction(PLAYER_ID, 'teleport' as any, {}, 'trace'),
    );
    expect(res.code).toBe(ErrorCodes.DIALOGUE_NODE_INVALID);
  });

  it('executeAction：give_item 缺 itemTemplateId → PARAM_INVALID（不静默跳过）', async () => {
    const res = await catchGameException(() =>
      service.executeAction(
        PLAYER_ID,
        DialogueActionType.GIVE_ITEM,
        {},
        'dialogue:test',
      ),
    );
    expect(res.code).toBe(ErrorCodes.PARAM_INVALID);
    expect(mocks.inventoryService.addItem).not.toHaveBeenCalled();
  });

  it('optionIndex 越界 → DIALOGUE_NODE_INVALID', async () => {
    const res = await catchGameException(() =>
      service.choose(PLAYER_ID, {
        code: 'npc_blacksmith_main',
        nodeKey: 'root',
        optionIndex: 99,
      }),
    );
    expect(res.code).toBe(ErrorCodes.DIALOGUE_NODE_INVALID);
  });

  it('nodeKey 不属于该树 → DIALOGUE_NODE_INVALID（D7：无持久会话）', async () => {
    const res = await catchGameException(() =>
      service.choose(PLAYER_ID, {
        code: 'npc_blacksmith_main',
        nodeKey: 'not_in_tree',
        optionIndex: 0,
      }),
    );
    expect(res.code).toBe(ErrorCodes.DIALOGUE_NODE_INVALID);
  });

  it('对话不存在或 is_active=false → DIALOGUE_NOT_FOUND', async () => {
    mocks.dialogueRepo.findOne.mockResolvedValue(null);

    const res = await catchGameException(() =>
      service.choose(PLAYER_ID, {
        code: 'missing_dialogue',
        nodeKey: 'root',
        optionIndex: 0,
      }),
    );
    expect(res.code).toBe(ErrorCodes.DIALOGUE_NOT_FOUND);
    // 查询条件必须带上 isActive:true（停用即不可选）
    expect(mocks.dialogueRepo.findOne).toHaveBeenCalledWith({
      where: { code: 'missing_dialogue', isActive: true },
    });
  });

  it('选项条件不满足（重放被隐藏选项）→ DIALOGUE_CONDITION_NOT_MET', async () => {
    mockDialogue([
      {
        key: 'root',
        text: '...',
        options: [
          { text: '隐藏选项', condition: { minLevel: 50 }, next: 'secret' },
          { text: '普通选项' },
        ],
      },
      { key: 'secret', text: '...', options: [{ text: '嗯' }] },
    ]);

    const res = await catchGameException(() =>
      service.choose(PLAYER_ID, {
        code: 'npc_blacksmith_main',
        nodeKey: 'root',
        optionIndex: 0,
      }),
    );
    expect(res.code).toBe(ErrorCodes.DIALOGUE_CONDITION_NOT_MET);
  });

  it('节点级条件不满足 → DIALOGUE_CONDITION_NOT_MET', async () => {
    mockDialogue([
      {
        key: 'root',
        text: '...',
        condition: { minLevel: 50 },
        options: [{ text: '嗯' }],
      },
    ]);

    const res = await catchGameException(() =>
      service.choose(PLAYER_ID, {
        code: 'npc_blacksmith_main',
        nodeKey: 'root',
        optionIndex: 0,
      }),
    );
    expect(res.code).toBe(ErrorCodes.DIALOGUE_CONDITION_NOT_MET);
  });

  it('option.next 为空 → finished:true 且不下发节点', async () => {
    const view = await service.choose(PLAYER_ID, {
      code: 'npc_blacksmith_main',
      nodeKey: 'root',
      optionIndex: 2,
    });

    expect(view.finished).toBe(true);
    expect(view.node).toBeNull();
    expect(view.nodeKey).toBeNull();
  });

  it('next 节点条件仍不满足 → DIALOGUE_CONDITION_NOT_MET（不伪装成 finished）', async () => {
    mockDialogue([
      {
        key: 'root',
        text: '...',
        options: [{ text: '去', next: 'locked' }],
      },
      {
        key: 'locked',
        text: '...',
        condition: { minLevel: 50 },
        options: [{ text: '嗯' }],
      },
    ]);

    const res = await catchGameException(() =>
      service.choose(PLAYER_ID, {
        code: 'npc_blacksmith_main',
        nodeKey: 'root',
        optionIndex: 0,
      }),
    );
    expect(res.code).toBe(ErrorCodes.DIALOGUE_CONDITION_NOT_MET);
  });

  it('动作执行后重新求值：accept_quest 使 next 节点的 questId 条件由不满足变满足', async () => {
    mockDialogue([
      {
        key: 'root',
        text: '接个活儿？',
        options: [
          {
            text: '好',
            next: 'after',
            action: DialogueActionType.ACCEPT_QUEST,
            actionArgs: { questTemplateId: '77' },
          },
        ],
      },
      {
        key: 'after',
        text: '任务已接取。',
        condition: { questId: '77' },
        options: [{ text: '出发' }],
      },
    ]);

    // 接任务前无记录；acceptQuest 被调用后才出现 IN_PROGRESS 记录
    let accepted = false;
    mocks.playerQuestRepo.find.mockImplementation(async () =>
      accepted
        ? [{ questTemplateId: '77', status: QuestStatus.IN_PROGRESS }]
        : [],
    );
    mocks.questService.acceptQuest.mockImplementation(async () => {
      accepted = true;
      return {};
    });

    const view = await service.choose(PLAYER_ID, {
      code: 'npc_blacksmith_main',
      nodeKey: 'root',
      optionIndex: 0,
    });

    expect(view.nodeKey).toBe('after');
    expect(view.node?.text).toBe('任务已接取。');
    // buildContext 至少调用两次（动作前判定 + 动作后重新求值）
    expect(mocks.playerQuestRepo.find.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('结构非法（next 指向不存在的 key）→ DIALOGUE_NODE_INVALID', async () => {
    mockDialogue([
      {
        key: 'root',
        text: '...',
        options: [{ text: '去', next: 'ghost' }],
      },
    ]);

    const res = await catchGameException(() =>
      service.choose(PLAYER_ID, {
        code: 'npc_blacksmith_main',
        nodeKey: 'root',
        optionIndex: 0,
      }),
    );
    expect(res.code).toBe(ErrorCodes.DIALOGUE_NODE_INVALID);
    expect(String(res.msg)).toContain('ghost');
  });

  it('start 返回首节点视图（含选项过滤）', async () => {
    const view = await service.start(PLAYER_ID, 'npc_blacksmith_main');

    expect(view.code).toBe('npc_blacksmith_main');
    expect(view.nodeKey).toBe('root');
    expect(view.finished).toBe(false);
    expect(view.node?.speaker).toBe('铁匠');
    expect(view.node?.options.map((o) => o.index)).toEqual([0, 1, 2]);
  });

  it('start：对话不存在 → DIALOGUE_NOT_FOUND', async () => {
    mocks.dialogueRepo.findOne.mockResolvedValue(null);
    const res = await catchGameException(() =>
      service.start(PLAYER_ID, 'missing_dialogue'),
    );
    expect(res.code).toBe(ErrorCodes.DIALOGUE_NOT_FOUND);
  });
});
