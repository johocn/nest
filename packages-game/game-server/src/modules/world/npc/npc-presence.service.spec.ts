import {
  EntityType,
  NpcPatrolLoopMode,
  NpcSpawnRuleType,
  QuestStatus,
} from '@constants/enums';
import { NpcPresenceService } from './npc-presence.service';

/**
 * 单测直接 new 出服务（mocked repository），不连真实数据库。
 * 风格参照 world.service.spec.ts 的 mock 约定。
 */
describe('NpcPresenceService', () => {
  let service: NpcPresenceService;
  let spawnRuleRepo: { find: jest.Mock; findOne: jest.Mock };
  let patrolRouteRepo: { find: jest.Mock; findOne: jest.Mock };
  let spawnRepo: { find: jest.Mock; findOne: jest.Mock };
  let npcRepo: { find: jest.Mock; findOne: jest.Mock };
  let playerQuestRepo: { find: jest.Mock; findOne: jest.Mock };
  let playerService: { getById: jest.Mock };

  const SCENE_ID = '7';
  const PLAYER_ID = '1001';

  const makeRule = (overrides: Record<string, any> = {}): any => ({
    id: '9',
    sceneId: SCENE_ID,
    npcTemplateId: '5',
    ruleType: NpcSpawnRuleType.RANDOM,
    spawnX: 500,
    spawnY: 500,
    spawnRadius: 100,
    spawnCount: 1,
    condition: null,
    patrolRouteId: null,
    name: 'rule',
    isActive: true,
    ...overrides,
  });

  const makeSpawn = (overrides: Record<string, any> = {}): any => ({
    id: '1',
    sceneId: SCENE_ID,
    entityType: EntityType.NPC,
    templateId: '5',
    spawnX: 10,
    spawnY: 20,
    spawnCount: 1,
    spawnRadius: 0,
    isActive: true,
    ...overrides,
  });

  const makeRoute = (overrides: Record<string, any> = {}): any => ({
    id: '3',
    sceneId: SCENE_ID,
    npcTemplateId: '5',
    name: 'route',
    loopMode: NpcPatrolLoopMode.LOOP,
    speed: 60,
    points: [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ],
    isActive: true,
    ...overrides,
  });

  const makeTemplate = (overrides: Record<string, any> = {}): any => ({
    id: '5',
    name: '守卫',
    resKey: 'npc_guard',
    scale: 1,
    defaultAnim: 'idle',
    ...overrides,
  });

  beforeEach(() => {
    spawnRuleRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() };
    patrolRouteRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    spawnRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() };
    npcRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    playerQuestRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    playerService = { getById: jest.fn().mockResolvedValue(null) };

    service = new NpcPresenceService(
      spawnRuleRepo as any,
      patrolRouteRepo as any,
      spawnRepo as any,
      npcRepo as any,
      playerQuestRepo as any,
      playerService as any,
    );
  });

  it('fixed 分支：直接取 scene_entity_spawns 的 NPC 行，寻址 npc:<spawnId>', async () => {
    spawnRuleRepo.find.mockResolvedValue([]);
    spawnRepo.find.mockResolvedValue([makeSpawn()]);
    npcRepo.findOne.mockResolvedValue(makeTemplate());

    const list = await service.listNpcsForPlayer(SCENE_ID, PLAYER_ID);

    expect(list).toHaveLength(1);
    expect(list[0].npcId).toBe('npc:1');
    expect(list[0].npcTemplateId).toBe('5');
    expect(list[0].x).toBe(10);
    expect(list[0].y).toBe(20);
    expect(list[0].resKey).toBe('npc_guard');
    expect(list[0].anim).toBe('idle');
    expect(list[0].route).toBeUndefined();
    // 不携带内部字段
    expect((list[0] as any).condition).toBeUndefined();
    expect((list[0] as any).isFixed).toBeUndefined();
  });

  it('random 分支：按 spawn_count 生成实例，寻址 npcs:<ruleId>:<slot>', async () => {
    spawnRuleRepo.find.mockResolvedValue([
      makeRule({ ruleType: NpcSpawnRuleType.RANDOM, spawnCount: 2 }),
    ]);
    npcRepo.findOne.mockResolvedValue(makeTemplate());

    const list = await service.listNpcsForPlayer(SCENE_ID, PLAYER_ID);

    expect(list).toHaveLength(2);
    expect(list.map((n) => n.npcId).sort()).toEqual([
      'npcs:9:0',
      'npcs:9:1',
    ]);
    expect(list.every((n) => n.route === undefined)).toBe(true);
  });

  it('patrol 分支：初始位置 = 第一个路点，带 route.points/cursor=0', async () => {
    spawnRuleRepo.find.mockResolvedValue([
      makeRule({
        ruleType: NpcSpawnRuleType.PATROL,
        patrolRouteId: '3',
      }),
    ]);
    patrolRouteRepo.findOne.mockResolvedValue(makeRoute());
    npcRepo.findOne.mockResolvedValue(makeTemplate());

    const list = await service.listNpcsForPlayer(SCENE_ID, PLAYER_ID);

    expect(list).toHaveLength(1);
    expect(list[0].npcId).toBe('npcs:9:0');
    expect(list[0].x).toBe(1);
    expect(list[0].y).toBe(2);
    expect(list[0].route?.points).toHaveLength(2);
    expect(list[0].route?.cursor).toBe(0);
    expect(list[0].route?.loopMode).toBe(NpcPatrolLoopMode.LOOP);
    expect(list[0].route?.speed).toBe(60);
  });

  it('condition.minLevel：等级不足不可见，等级足够可见', async () => {
    spawnRuleRepo.find.mockResolvedValue([
      makeRule({ condition: { minLevel: 10 } }),
    ]);
    npcRepo.findOne.mockResolvedValue(makeTemplate());

    playerService.getById.mockResolvedValue({ id: PLAYER_ID, level: 5 });
    expect(await service.listNpcsForPlayer(SCENE_ID, PLAYER_ID)).toHaveLength(0);

    playerService.getById.mockResolvedValue({ id: PLAYER_ID, level: 15 });
    expect(await service.listNpcsForPlayer(SCENE_ID, PLAYER_ID)).toHaveLength(1);
  });

  it('condition.questId：任务已开始才可见（未开始/无记录不可见）', async () => {
    spawnRuleRepo.find.mockResolvedValue([
      makeRule({ condition: { questId: '77' } }),
    ]);
    npcRepo.findOne.mockResolvedValue(makeTemplate());

    playerQuestRepo.findOne.mockResolvedValueOnce({
      playerId: PLAYER_ID,
      questTemplateId: '77',
      status: QuestStatus.IN_PROGRESS,
    });
    expect(await service.listNpcsForPlayer(SCENE_ID, PLAYER_ID)).toHaveLength(1);

    playerQuestRepo.findOne.mockResolvedValueOnce(null);
    expect(await service.listNpcsForPlayer(SCENE_ID, PLAYER_ID)).toHaveLength(0);
  });

  it('random 实例坐标落在 spawn_radius 范围内', async () => {
    spawnRuleRepo.find.mockResolvedValue([
      makeRule({
        spawnX: 500,
        spawnY: 500,
        spawnRadius: 100,
        spawnCount: 3,
      }),
    ]);
    npcRepo.findOne.mockResolvedValue(makeTemplate());

    const list = await service.listNpcsForPlayer(SCENE_ID, PLAYER_ID);

    expect(list).toHaveLength(3);
    for (const npc of list) {
      expect(Math.abs(npc.x - 500)).toBeLessThanOrEqual(100);
      expect(Math.abs(npc.y - 500)).toBeLessThanOrEqual(100);
    }
  });

  it('random 第二次调用位置保持稳定（D6）', async () => {
    spawnRuleRepo.find.mockResolvedValue([
      makeRule({ spawnCount: 2, spawnRadius: 120 }),
    ]);
    npcRepo.findOne.mockResolvedValue(makeTemplate());

    const first = await service.listNpcsForPlayer(SCENE_ID, PLAYER_ID);
    const second = await service.listNpcsForPlayer(SCENE_ID, PLAYER_ID);

    expect(second.map((n) => [n.npcId, n.x, n.y])).toEqual(
      first.map((n) => [n.npcId, n.x, n.y]),
    );
  });

  it('pingpong：到端点后折返', async () => {
    spawnRuleRepo.find.mockResolvedValue([
      makeRule({ ruleType: NpcSpawnRuleType.PATROL, patrolRouteId: '3' }),
    ]);
    patrolRouteRepo.findOne.mockResolvedValue(
      makeRoute({
        loopMode: NpcPatrolLoopMode.PINGPONG,
        speed: 100,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      }),
    );
    npcRepo.findOne.mockResolvedValue(makeTemplate());

    // 1.5s × 100px/s = 150px：先到 (100,0) 再折返 50px
    const tick1 = await service.advanceTick([SCENE_ID], 1500);
    expect(tick1[0].npcs).toHaveLength(1);
    expect(tick1[0].npcs[0].x).toBeCloseTo(50, 5);
    expect(tick1[0].npcs[0].y).toBeCloseTo(0, 5);

    // 再 1.5s：回到 (0,0) 后再次折返到 (100,0)
    const tick2 = await service.advanceTick([SCENE_ID], 1500);
    expect(tick2[0].npcs[0].x).toBeCloseTo(100, 5);
    expect(tick2[0].npcs[0].y).toBeCloseTo(0, 5);
  });

  it('points 为空或单点：不崩、原地静止、无 NaN', async () => {
    spawnRuleRepo.find.mockResolvedValue([
      makeRule({
        id: '11',
        ruleType: NpcSpawnRuleType.PATROL,
        patrolRouteId: '31',
        spawnX: 300,
        spawnY: 400,
      }),
      makeRule({
        id: '12',
        ruleType: NpcSpawnRuleType.PATROL,
        patrolRouteId: '32',
      }),
    ]);
    patrolRouteRepo.findOne.mockImplementation(async ({ where }: any) => {
      if (where.id === '31') return makeRoute({ id: '31', points: [] });
      return makeRoute({ id: '32', points: [{ x: 10, y: 20 }] });
    });
    npcRepo.findOne.mockResolvedValue(makeTemplate());

    const list = await service.listNpcsForPlayer(SCENE_ID, PLAYER_ID);
    expect(list).toHaveLength(2);
    const empty = list.find((n) => n.npcId === 'npcs:11:0');
    const single = list.find((n) => n.npcId === 'npcs:12:0');
    expect(empty?.x).toBe(300);
    expect(empty?.y).toBe(400);
    expect(single?.x).toBe(10);
    expect(single?.y).toBe(20);
    expect(Number.isFinite(single?.x ?? NaN)).toBe(true);

    const tick = await service.advanceTick([SCENE_ID], 2000);
    expect(tick[0].npcs).toHaveLength(0);

    const after = await service.listNpcsForPlayer(SCENE_ID, PLAYER_ID);
    expect(after.find((n) => n.npcId === 'npcs:12:0')?.x).toBe(10);
  });

  it('advanceTick 对 fixed/random 实例无副作用', async () => {
    spawnRuleRepo.find.mockResolvedValue([makeRule({ spawnCount: 1 })]);
    spawnRepo.find.mockResolvedValue([makeSpawn()]);
    npcRepo.findOne.mockResolvedValue(makeTemplate());

    const before = await service.listNpcsForPlayer(SCENE_ID, PLAYER_ID);
    const tick1 = await service.advanceTick([SCENE_ID], 2000);
    const tick2 = await service.advanceTick([SCENE_ID], 2000);
    const after = await service.listNpcsForPlayer(SCENE_ID, PLAYER_ID);

    expect(tick1[0].npcs).toHaveLength(0);
    expect(tick2[0].npcs).toHaveLength(0);
    expect(after.map((n) => [n.npcId, n.x, n.y])).toEqual(
      before.map((n) => [n.npcId, n.x, n.y]),
    );
  });
});
