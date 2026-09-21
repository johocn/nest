import { QuestStatus } from '@constants/enums';
import { DialogueService } from './dialogue.service';

/**
 * 单测直接 new 出服务（mocked repository / PlayerService / CacheService），不连真实数据库或 redis。
 * 风格参照 npc-presence.service.spec.ts 的 mock 约定。
 */
describe('DialogueService.buildContext', () => {
  let service: DialogueService;
  let playerQuestRepo: { find: jest.Mock };
  let inventoryItemRepo: { find: jest.Mock };
  let playerService: { getById: jest.Mock };
  let cacheService: { exists: jest.Mock };

  const PLAYER_ID = '1001';

  beforeEach(() => {
    playerQuestRepo = { find: jest.fn().mockResolvedValue([]) };
    inventoryItemRepo = { find: jest.fn().mockResolvedValue([]) };
    playerService = {
      getById: jest.fn().mockResolvedValue({ id: PLAYER_ID, level: 12 }),
    };
    cacheService = { exists: jest.fn().mockResolvedValue(false) };

    service = new DialogueService(
      playerQuestRepo as any,
      inventoryItemRepo as any,
      playerService as any,
      cacheService as any,
    );
  });

  it('并发读取等级/任务态/背包并组装成 Map（同模板数量累加）', async () => {
    playerQuestRepo.find.mockResolvedValue([
      { playerId: PLAYER_ID, questTemplateId: '77', status: QuestStatus.IN_PROGRESS },
      { playerId: PLAYER_ID, questTemplateId: '78', status: QuestStatus.CLAIMED },
    ]);
    inventoryItemRepo.find.mockResolvedValue([
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

    expect(playerService.getById).toHaveBeenCalledWith(PLAYER_ID);
    expect(playerQuestRepo.find).toHaveBeenCalledWith({
      where: { playerId: PLAYER_ID },
    });
    expect(inventoryItemRepo.find).toHaveBeenCalledWith({
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
    cacheService.exists.mockImplementation(
      async (key: string) => key === `dialogue:flag:${PLAYER_ID}:saw_secret`,
    );

    const ctx = await service.buildContext(PLAYER_ID, [
      'saw_secret',
      'other',
      'saw_secret',
    ]);

    expect(ctx.flags.has('saw_secret')).toBe(true);
    expect(ctx.flags.has('other')).toBe(false);
    expect(ctx.flags.size).toBe(1);
    expect(cacheService.exists).toHaveBeenCalledTimes(2); // 去重后只探测两个
    expect(cacheService.exists).toHaveBeenCalledWith(
      `dialogue:flag:${PLAYER_ID}:saw_secret`,
    );
    expect(cacheService.exists).toHaveBeenCalledWith(
      `dialogue:flag:${PLAYER_ID}:other`,
    );
  });

  it('未传 neededFlags 时不访问 redis', async () => {
    await service.buildContext(PLAYER_ID);
    expect(cacheService.exists).not.toHaveBeenCalled();
  });

  it('玩家不存在或读取失败时等级按 0 处理', async () => {
    playerService.getById.mockResolvedValue(null);
    expect((await service.buildContext(PLAYER_ID)).level).toBe(0);

    playerService.getById.mockRejectedValue(new Error('db down'));
    expect((await service.buildContext(PLAYER_ID)).level).toBe(0);
  });
});
