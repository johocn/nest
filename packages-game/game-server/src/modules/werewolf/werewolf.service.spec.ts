import { WerewolfService } from './werewolf.service';
import { WerewolfRole } from './werewolf.constants';
import { GameEvents } from '@event-bus/game-events';

/** 内存假 Repository：create/save 落数组；findOne 返回 undefined（模拟新建） */
function fakeRepo(initial: any[] = []) {
  const store = initial;
  return {
    create: (d: any) => ({ ...d }),
    save: async (e: any) => {
      store.push(e);
      return e;
    },
    find: async () => store,
    findOne: async () => undefined,
    createQueryBuilder: () => ({
      leftJoinAndSelect: () => ({
        leftJoinAndSelect: () => ({ getMany: async () => [] }),
      }),
    }),
    _store: store,
  };
}

function makeService() {
  const matchRepo = fakeRepo();
  const statRepo = fakeRepo();
  const events: { name: string; payload: any }[] = [];
  const eventBus = {
    emit: (name: string, payload: any) => events.push({ name, payload }),
  };
  const svc = new WerewolfService(
    matchRepo as any,
    statRepo as any,
    eventBus as any,
  );
  return { svc, matchRepo, statRepo, events };
}

const NINE_ROLES: WerewolfRole[] = [
  WerewolfRole.WEREWOLF,
  WerewolfRole.WEREWOLF,
  WerewolfRole.WEREWOLF,
  WerewolfRole.SEER,
  WerewolfRole.WITCH,
  WerewolfRole.HUNTER,
  WerewolfRole.GUARD,
  WerewolfRole.VILLAGER,
  WerewolfRole.VILLAGER,
];

describe('WerewolfService（集成）', () => {
  it('create → join → start → 广播事件已发出 → 狼人行动被接受', () => {
    const { svc, events } = makeService();
    svc.createRoom({
      roomId: 'r1',
      hostPlayerId: 'P0',
      hostName: 'P0',
      roles: NINE_ROLES,
    });
    for (let i = 1; i < 9; i++) svc.joinRoom('r1', `P${i}`, `P${i}`);
    svc.startRoom('r1', 'P0');

    // createRoom 不广播；join/start 会广播
    expect(events.some((e) => e.name === GameEvents.WEREWOLF_BROADCAST)).toBe(
      true,
    );

    const room: any = (svc as any).rooms.get('r1');
    // 直接推进公告阶段到夜晚狼人行动
    let guard = 0;
    while (room.step !== 'night_wolf' && guard++ < 10) room.timeout(Date.now());
    expect(room.step).toBe('night_wolf');

    // 按真实角色动态找一只存活狼
    const wolf = room.players.find(
      (p: any) => p.role === WerewolfRole.WEREWOLF && p.alive,
    );
    const view = room.getPrivateView(wolf.playerId);
    expect(view.legalTargets.length).toBeGreaterThan(0);

    const before = events.filter(
      (e) => e.name === GameEvents.WEREWOLF_BROADCAST,
    ).length;
    const snap = svc.submitAction('r1', wolf.playerId, {
      targetSeat: view.legalTargets[0],
    });
    expect(snap).toBeDefined();
    // 行动再次触发广播
    expect(
      events.filter((e) => e.name === GameEvents.WEREWOLF_BROADCAST).length,
    ).toBeGreaterThan(before);
  });

  it('devFillRoom 房主可填充机器人，开局后角色齐全', () => {
    const { svc } = makeService();
    svc.createRoom({
      roomId: 'r2',
      hostPlayerId: 'H',
      hostName: 'H',
      roles: NINE_ROLES,
    });
    svc.devFillRoom('r2', 'H', 8);
    const room: any = (svc as any).rooms.get('r2');
    expect(room.players.length).toBe(9);
    svc.startRoom('r2', 'H'); // 角色在开局时分配
    const roles = room.players.map((p: any) => p.role).sort();
    expect(roles).toEqual([...NINE_ROLES].sort());
  });

  it('非房主调用受保护操作应抛错', () => {
    const { svc } = makeService();
    svc.createRoom({
      roomId: 'r3',
      hostPlayerId: 'H',
      hostName: 'H',
      roles: NINE_ROLES,
    });
    expect(() => svc.devFillRoom('r3', 'notHost', 1)).toThrow();
  });

  it('createRoom 会写入 werewolf_matches 战绩（status=lobby）', async () => {
    const { svc, matchRepo } = makeService();
    svc.createRoom({
      roomId: 'r4',
      hostPlayerId: 'H',
      hostName: 'H',
      roles: NINE_ROLES,
    });
    // 等待 persistMatch（createRoom 内 fire-and-forget）落库
    await new Promise((r) => setTimeout(r, 10));
    expect(matchRepo._store.length).toBeGreaterThanOrEqual(1);
    expect(matchRepo._store[0].status).toBe('lobby');
  });
});
