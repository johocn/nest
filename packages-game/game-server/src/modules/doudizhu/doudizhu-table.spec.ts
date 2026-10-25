import { DoudizhuTableService } from './doudizhu-table.service';
import { DoudizhuMode, DoudizhuTableStatus } from '@constants/enums';

/** 内存版缓存，仅覆盖桌态用到的 get/set */
class FakeCache {
  private readonly store = new Map<string, string>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.store.set(key, value);
  }
}

function buildService() {
  const cache = new FakeCache();
  const repo = {
    create: (x: any) => x,
    save: async (x: any) => x,
    findOne: async () => null,
    find: async () => [],
  };
  const eventBus = { emit: () => undefined };
  const playerService = {
    getById: async (id: string) => ({ nickname: `P-${id}` }),
  };
  const svc = new DoudizhuTableService(
    cache as any,
    repo as any,
    repo as any,
    repo as any,
    eventBus as any,
    playerService as any,
  );
  return { svc, cache };
}

const keyOf = (tableId: string) => `doudizhu:table:${tableId}`;

describe('DoudizhuTableService 匹配桌开局闸门', () => {
  it('建桌后不推进：真人未入座时手牌仍是 17 张且未结算', async () => {
    const { svc } = buildService();
    const tableId = await svc.createMatchTable(['a', 'b', 'c']);
    const view = await svc.viewBySeat(tableId, 0);
    expect(view.state.phase).toBe('bidding');
    expect(view.players.map((p) => p.handCount)).toEqual([17, 17, 17]);
  });

  it('部分真人入座仍不推进，最后一人入座后才放行首个回合', async () => {
    const { svc, cache } = buildService();
    const tableId = await svc.createMatchTable(['a', 'b', 'c']);

    await svc.joinTable(tableId, 'a', 'sock-a');
    await svc.joinTable(tableId, 'b', 'sock-b');
    let raw = JSON.parse((await cache.get(keyOf(tableId))) as string);
    expect(raw.kickOffPending).toBe(true);
    let view = await svc.viewBySeat(tableId, 0);
    expect(view.state.phase).toBe('bidding');
    expect(view.players.map((p) => p.handCount)).toEqual([17, 17, 17]);

    await svc.joinTable(tableId, 'c', 'sock-c');
    raw = JSON.parse((await cache.get(keyOf(tableId))) as string);
    expect(raw.kickOffPending).toBe(false);
    view = await svc.viewBySeat(tableId, 0);
    // 放行后停在真人回合等待抢地主，绝不能被 AI 直接打到结算
    expect(view.state.phase).toBe('bidding');
    expect(view.players.map((p) => p.handCount)).toEqual([17, 17, 17]);
  });

  it('超时兜底：无人入座时整桌按 AI 托管推进到结算', async () => {
    const { svc, cache } = buildService();
    const tableId = await svc.createMatchTable(['a', 'b', 'c']);

    await (svc as any).forceKickOff(tableId);
    const raw = JSON.parse((await cache.get(keyOf(tableId))) as string);
    expect(raw.kickOffPending).toBe(false);
    const view = await svc.viewBySeat(tableId, 0);
    expect(view.state.phase).toBe('over');
  });

  it('超时兜底：已入座真人仍保留手动回合', async () => {
    const { svc } = buildService();
    const tableId = await svc.createMatchTable(['a', 'b', 'c']);
    await svc.joinTable(tableId, 'a', 'sock-a');

    await (svc as any).forceKickOff(tableId);
    const view = await svc.viewBySeat(tableId, 0);
    // 缺失的 b/c 由 AI 代打，但轮到已入座的 a 时必须停下来等其操作
    expect(view.state.phase).not.toBe('over');
    expect(view.players[0].hand).toHaveLength(view.players[0].handCount);
  });

  it('三家依次抢地主后进入出牌阶段，地主 20 张', async () => {
    const { svc } = buildService();
    const tableId = await svc.createMatchTable(['a', 'b', 'c']);
    for (const pid of ['a', 'b', 'c'])
      await svc.joinTable(tableId, pid, `sock-${pid}`);

    for (let i = 0; i < 3; i++) {
      const v = await svc.viewBySeat(tableId, 0);
      expect(v.state.phase).toBe('bidding');
      const pid = ['a', 'b', 'c'][v.state.current];
      await svc.applyAction(tableId, pid, { type: 'bid', choice: 'grab' });
    }

    const view = await svc.viewBySeat(tableId, 0);
    expect(view.state.phase).toBe('playing');
    expect(view.players.filter((p) => p.isLandlord)).toHaveLength(1);
    expect(view.players[view.state.landlord].handCount).toBe(20);
  });

  it('非当前回合的抢地主请求被拒绝', async () => {
    const { svc } = buildService();
    const tableId = await svc.createMatchTable(['a', 'b', 'c']);
    for (const pid of ['a', 'b', 'c'])
      await svc.joinTable(tableId, pid, `sock-${pid}`);

    const v = await svc.viewBySeat(tableId, 0);
    const wrongSeat = (v.state.current + 1) % 3;
    await expect(
      svc.applyAction(tableId, ['a', 'b', 'c'][wrongSeat], {
        type: 'bid',
        choice: 'grab',
      }),
    ).rejects.toThrow();
  });
});

describe('DoudizhuTableService 好友房自动开局', () => {
  it('3 名真人入座后无需房主点开始，自动开局', async () => {
    const { svc, cache } = buildService();
    const { tableId } = await svc.createTable(
      'host',
      DoudizhuMode.NET,
      'sock-host',
    );
    await svc.joinTable(tableId, 'f1', 'sock-f1');
    await svc.joinTable(tableId, 'f2', 'sock-f2');

    const raw = JSON.parse((await cache.get(keyOf(tableId))) as string);
    expect(raw.status).toBe(DoudizhuTableStatus.PLAYING);
    const view = await svc.viewBySeat(tableId, 0);
    expect(view.state.phase).toBe('bidding');
    expect(view.players.map((p) => p.handCount)).toEqual([17, 17, 17]);
  });

  it('1 分钟未满员：自动补 AI 开局', async () => {
    const { svc, cache } = buildService();
    const { tableId } = await svc.createTable(
      'host',
      DoudizhuMode.NET,
      'sock-host',
    );
    await svc.joinTable(tableId, 'f1', 'sock-f1');

    await (svc as any).autoStartRoom(tableId);
    const raw = JSON.parse((await cache.get(keyOf(tableId))) as string);
    expect(raw.status).toBe(DoudizhuTableStatus.PLAYING);
    expect(raw.members.filter((m: string) => m.startsWith('bot'))).toHaveLength(
      1,
    );
    const view = await svc.viewBySeat(tableId, 0);
    expect(view.state.phase).toBe('bidding');
  });
});
