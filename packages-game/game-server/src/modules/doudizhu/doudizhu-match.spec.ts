import { DoudizhuMatchService } from './doudizhu-match.service';
import { GameEvents } from '@event-bus/game-events';

/** 内存版 CacheService：只实现匹配服务用到的 zset/hash 操作 */
class FakeCache {
  private zset = new Map<string, number>();
  private hashes = new Map<string, Record<string, string>>();

  async exists(key: string): Promise<boolean> {
    return this.hashes.has(key);
  }
  async zAdd(_key: string, score: number, member: string): Promise<number> {
    this.zset.set(member, score);
    return 1;
  }
  async zRange(_key: string, _start: number, _stop: number): Promise<string[]> {
    return [...this.zset.entries()]
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .map(([member]) => member);
  }
  async zRem(_key: string, ...members: string[]): Promise<number> {
    let removed = 0;
    for (const m of members) if (this.zset.delete(m)) removed += 1;
    return removed;
  }
  async hSet(key: string, field: string, value: string): Promise<number> {
    this.hashes.set(key, { ...(this.hashes.get(key) ?? {}), [field]: value });
    return 1;
  }
  async hGet(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.[field] ?? null;
  }
  async expire(): Promise<boolean> {
    return true;
  }
  async del(key: string): Promise<number> {
    return this.hashes.delete(key) ? 1 : 0;
  }
}

function setup() {
  const cache = new FakeCache();
  const table = {
    createMatchTable: jest.fn(async (ids: string[]) => `t-${ids.join('-')}`),
  };
  const eventBus = { emit: jest.fn() };
  const service = new DoudizhuMatchService(
    cache as any,
    eventBus as any,
    table as any,
  );
  return { service, table, eventBus, cache };
}

describe('DoudizhuMatchService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('3 人齐立即撮合，不等超时', async () => {
    const { service, table, eventBus } = setup();
    await service.join('1', 1000);
    await service.join('2', 1000);
    expect(table.createMatchTable).not.toHaveBeenCalled();
    await service.join('3', 1000);

    expect(table.createMatchTable).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith(
      GameEvents.DOUDIZHU_MATCHED,
      expect.objectContaining({
        players: expect.arrayContaining(['1', '2', '3']),
      }),
    );
    // 已撮合的人不应再被超时补齐重复建桌
    await jest.advanceTimersByTimeAsync(10_000);
    expect(table.createMatchTable).toHaveBeenCalledTimes(1);
  });

  it('单人等待 10s 后用 bot 补齐开局', async () => {
    const { service, table, eventBus } = setup();
    await service.join('1', 1000);
    await jest.advanceTimersByTimeAsync(9_000);
    expect(table.createMatchTable).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1_000);
    expect(table.createMatchTable).toHaveBeenCalledTimes(1);
    expect(table.createMatchTable).toHaveBeenCalledWith(['1'], 'normal');
    expect(eventBus.emit).toHaveBeenCalledWith(
      GameEvents.DOUDIZHU_MATCHED,
      expect.objectContaining({ tableId: 't-1', players: ['1'] }),
    );
  });

  it('两人等待超时后一起开局（第三人由 bot 补位）', async () => {
    const { service, table } = setup();
    await service.join('1', 1000);
    await jest.advanceTimersByTimeAsync(3_000);
    await service.join('2', 1000);
    await jest.advanceTimersByTimeAsync(7_000);

    expect(table.createMatchTable).toHaveBeenCalledTimes(1);
    expect(table.createMatchTable).toHaveBeenCalledWith(['1', '2'], 'normal');
    // 第一个人的定时器已把两人一起带走，第二人定时器到点不应重复建桌
    await jest.advanceTimersByTimeAsync(10_000);
    expect(table.createMatchTable).toHaveBeenCalledTimes(1);
  });

  it('取消匹配后超时不建桌', async () => {
    const { service, table } = setup();
    await service.join('1', 1000);
    await service.cancel('1');
    await jest.advanceTimersByTimeAsync(10_000);
    expect(table.createMatchTable).not.toHaveBeenCalled();
  });
});
