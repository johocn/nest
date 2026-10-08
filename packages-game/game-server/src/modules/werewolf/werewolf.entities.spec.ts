import { getMetadataArgsStorage } from 'typeorm';
import {
  WerewolfMatch,
  WerewolfMatchStatus,
} from './entities/werewolf-match.entity';
import { WerewolfPlayerStat } from './entities/werewolf-player-stat.entity';

/**
 * 实体元数据校验：无需数据库连接即可确认 @Entity / @Column 已正确注册，
 * 避免启动期才发现表或列缺失。
 */
describe('狼人杀实体元数据', () => {
  const storage = getMetadataArgsStorage();

  const columnNames = (target: Function): string[] =>
    storage.columns
      .filter((c) => c.target === target)
      .map((c) => (c as any).options?.name ?? c.propertyName);

  it('werewolf_matches 表已注册且列齐全', () => {
    const table = storage.tables.find((t) => t.target === WerewolfMatch);
    expect(table).toBeDefined();
    expect((table as any).name).toBe('werewolf_matches');

    expect(columnNames(WerewolfMatch)).toEqual(
      expect.arrayContaining([
        'room_id',
        'host_player_id',
        'status',
        'roles',
        'winner_camp',
        'player_count',
        'cycles',
        'finished_at',
      ]),
    );
  });

  it('werewolf_player_stats 表已注册且列齐全', () => {
    const table = storage.tables.find((t) => t.target === WerewolfPlayerStat);
    expect(table).toBeDefined();
    expect((table as any).name).toBe('werewolf_player_stats');

    expect(columnNames(WerewolfPlayerStat)).toEqual(
      expect.arrayContaining([
        'player_id',
        'games',
        'wins',
        'losses',
        'wolf_wins',
        'good_wins',
        'mvp',
      ]),
    );
  });

  it('room_id / player_id 建有唯一索引', () => {
    const matchIdx = storage.indices.filter((i) => i.target === WerewolfMatch);
    const statIdx = storage.indices.filter(
      (i) => i.target === WerewolfPlayerStat,
    );
    // 唯一标志在元数据上是顶层 unique 字段（非 options.unique）
    expect(matchIdx.some((i) => (i as any).unique === true)).toBe(true);
    expect(statIdx.some((i) => (i as any).unique === true)).toBe(true);
  });

  it('WerewolfMatchStatus 枚举值符合预期', () => {
    expect(WerewolfMatchStatus.LOBBY).toBe('lobby');
    expect(WerewolfMatchStatus.PLAYING).toBe('playing');
    expect(WerewolfMatchStatus.FINISHED).toBe('finished');
  });
});
