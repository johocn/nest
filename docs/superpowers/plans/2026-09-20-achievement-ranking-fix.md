# 成就与排行修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复盘点报告 P0-1/P0-2/P0-3 —— 成就进度不推进、成就领奖不发奖、排行榜 score 恒 0。

**Architecture:** 三处独立缺陷，两类修法：①排行 `getTopN` 改用带分值的 Redis 反向区间查询（新增 `CacheService.zRangeWithScores`），使榜单与快照拿到真实分值；②成就补上「条件 → 进度」映射（`AchievementService.advanceByCondition`，按模板 condition 批量推进）与「领奖 → 实际发放」（复用 `EconomyService.addCurrency`），并在事件总线接线 6 类既有事件。

**Tech Stack:** NestJS 11 · TypeORM · PostgreSQL · Redis（node-redis v6 ZSet）· Jest 30 + ts-jest

**Repo:** `E:/code/nest`，工程根 `packages-game/game-server`（下述命令 cwd 均为该目录）
**规则:** 无新 npm 依赖；严格 TDD（先写失败用例）；逐任务 commit

---

## 设计

### 缺陷与根因

| # | 现象 | 根因 | 证据 |
|---|---|---|---|
| P0-1 | 成就永久停在 0 | `CURRENCY_CHANGED`/`ITEM_ACQUIRED` 监听体是空注释占位，且**无任何「condition → 模板」映射逻辑** | `event-bus/event-listeners.service.ts:106-125` |
| P0-2 | 领奖拿不到东西 | `claimReward` 置 `isRewardClaimed=true` 后只把 `rewardJson` 回显 | `achievement/achievement.service.ts:97-105` |
| P0-3 | 榜单分值全 0 | `getTopN` 用 `zRange`（不带分值、升序）再 `reverse()`，`score` 硬编码 0；快照据此写 `rankValue='0'` | `ranking/ranking.service.ts:38-55,73-86` |

### 关键设计决策

1. **成就进度按 condition 批量推进，不做 achievementId 单个映射。** 模板自带 `condition` 字段（`AchievementCondition` 7 值），一条事件应对应「所有 condition 匹配的模板」，逐个推进。新增 `advanceByCondition(playerId, condition, value, mode)` 承担该职责；`updateProgress` 保留原语义（绝对赋值，按 ID 单条）不动。
2. **两种推进语义**：累计型（`KILL_COUNT`/`QUEST_COMPLETE`/`EARN_CURRENCY`/`JOIN_GUILD`/`ADD_FRIEND`/`WIN_COMBAT`）用 `mode='increment'`；绝对值型（`REACH_LEVEL`，等级是快照值不是累加）用 `mode='set'`。
3. **`EARN_CURRENCY` 只累计正向变化**（`change > 0`），含义是「累计获得」而非「当前余额」。
4. **`ITEM_ACQUIRED` 本次不接线**：`AchievementCondition` 无对应条件枚举，接线需新增枚举值（业务决策），本次仅把注释改成显式说明，不做投机实现。
5. **奖励发放支持扁平货币键**（`rewardJson: { gold: 500, diamond: 10 }`，与 `payment`/`activity` 的既有约定及现有单测一致）；未识别的键写 `logger.warn` 留痕，不静默丢弃（正是要修的失效模式）。
6. **领奖先原子占位再发放，失败回滚占位**：`update({id, isRewardClaimed:false}, {isRewardClaimed:true})` 是并发/连点的唯一守门人（`affected=0` 即判重复领取），发放抛错则把标记改回 false，避免「标了没发、不可挽回」。
7. **排行不出新榜**：只修分值真实性。社交榜/荣誉榜/发奖播报属 P1「排行与荣誉」域，不在本计划。
8. **快照入库取整**：`rank_records.rank_value` 是 `bigint`，分值可能是浮点或 NaN，入库前 `Math.trunc` + 有限性校验（沿用本仓 NaN 污染教训）。

### 事件 → 条件 接线表

| 事件 | 发射点（已有） | payload | condition | mode |
|---|---|---|---|---|
| `MONSTER_KILLED` | `combat/combat.service.ts:100`（仅 WIN 时发） | `{attackerId: characterId, defenderId, sceneId}` | `KILL_COUNT` + `WIN_COMBAT` | increment ×1 |
| `LEVEL_UP` | `player/player.service.ts:160` | `{playerId, newLevel}` | `REACH_LEVEL` | set = newLevel |
| `CURRENCY_CHANGED` | `economy/economy.service.ts:89,158` | `{playerId, currencyType, change, source}` | `EARN_CURRENCY` | increment = +change |
| `QUEST_COMPLETED` | `quest/quest.service.ts:253,395,492` | `{playerId, questTemplateId, reward}` | `COMPLETE_QUEST` | increment ×1 |
| `GUILD_JOINED` | `social/social.service.ts:449,482` | `{guildId, playerId, role}` | `JOIN_GUILD` | increment ×1 |
| `FRIEND_ADDED` | `social/social.service.ts:184` | `{playerId, friendId}` | `ADD_FRIEND` | increment ×1 |

`MONSTER_KILLED` 的 `attackerId` 是 characterId，现有 `onMonsterKilled` 已通过 `characterService.getById` 解析出 playerId，成就推进挂在该解析之后复用，无需新增解析。`WIN_COMBAT` 取自同一事件：当前全仓唯一的「胜场」信号就是 PvE 击杀（无 PvP 结算入口），先按此接线，PvP 落地后再补独立事件。

### 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/cache/cache.service.ts` | 改 | 新增 `zRangeWithScores`（带分值区间查询，支持 REV） |
| `src/cache/cache.service.spec.ts` | 改 | mock 增 `zRangeWithScores`，加 1 例 |
| `src/modules/ranking/ranking.service.ts` | 改 | `getTopN` 取真实分值；`createSnapshot` 入库取整 |
| `src/modules/ranking/ranking.service.spec.ts` | 改 | 重写 `getTopN` 用例、`createSnapshot` 用例 |
| `src/modules/achievement/achievement.service.ts` | 改 | 新增 `advanceByCondition`/`applyProgress`/`deliverReward`；`claimReward` 实际发奖 |
| `src/modules/achievement/achievement.module.ts` | 改 | imports 增 `EconomyModule` |
| `src/modules/achievement/achievement.service.spec.ts` | 改 | 注入 `EconomyService` mock；新增 7 例 |
| `src/event-bus/event-listeners.service.ts` | 改 | 注入 `AchievementService`；接线 6 事件 |
| `src/event-bus/event-listeners.module.ts` | 改 | imports 增 `AchievementModule` |
| `src/event-bus/event-listeners.service.spec.ts` | 改 | 注入 `AchievementService` mock；新增 5 例 |

---

## 任务

### Task 1: CacheService.zRangeWithScores（带分值区间查询）

**Files:**
- Modify: `src/cache/cache.service.ts:105-111`
- Test: `src/cache/cache.service.spec.ts`

- [ ] **Step 1: 写失败用例**

在 `src/cache/cache.service.spec.ts` 的 `mockRedis` 对象里，`zRange: jest.fn(),` 下一行加：

```ts
  zRangeWithScores: jest.fn(),
```

在文件末尾 `it('should execute withLock callback', ...)` 用例之后、`});` 之前追加：

```ts
  it('should return members with scores in reverse order', async () => {
    mockRedis.zRangeWithScores.mockResolvedValue([
      { value: '{"playerId":"p2"}', score: 900 },
      { value: '{"playerId":"p1"}', score: 500 },
    ]);

    const result = await service.zRangeWithScores('ranking:power', 0, 9, true);

    expect(mockRedis.zRangeWithScores).toHaveBeenCalledWith(
      'ranking:power',
      0,
      9,
      { REV: true },
    );
    expect(result).toEqual([
      { value: '{"playerId":"p2"}', score: 900 },
      { value: '{"playerId":"p1"}', score: 500 },
    ]);
  });

  it('should query ascending when rev is false', async () => {
    mockRedis.zRangeWithScores.mockResolvedValue([]);

    await service.zRangeWithScores('ranking:power', 0, 9);

    expect(mockRedis.zRangeWithScores).toHaveBeenCalledWith(
      'ranking:power',
      0,
      9,
    );
  });
```

- [ ] **Step 2: 跑用例确认失败**

Run: `npm test -- cache.service.spec`
Expected: FAIL，报 `service.zRangeWithScores is not a function`（新增两例失败，其余通过）

- [ ] **Step 3: 实现**

在 `src/cache/cache.service.ts` 的 `zRange` 方法之后（`zRem` 之前）插入：

```ts
  async zRangeWithScores(
    key: string,
    start: number,
    stop: number,
    rev = false,
  ): Promise<Array<{ value: string; score: number }>> {
    if (rev) {
      return this.client.zRangeWithScores(key, start, stop, { REV: true });
    }
    return this.client.zRangeWithScores(key, start, stop);
  }
```

- [ ] **Step 4: 跑用例确认通过**

Run: `npm test -- cache.service.spec`
Expected: PASS（原 7 例 + 新 2 例全绿）

- [ ] **Step 5: 提交**

```bash
git add packages-game/game-server/src/cache/cache.service.ts packages-game/game-server/src/cache/cache.service.spec.ts
git commit -m "fix(cache): P0-A T1 新增 zRangeWithScores 带分值区间查询"
```

---

### Task 2: 排行榜真实分值（getTopN + 快照入库取整）

**Files:**
- Modify: `src/modules/ranking/ranking.service.ts:38-55`（getTopN）、`src/modules/ranking/ranking.service.ts:73-86`（createSnapshot）
- Test: `src/modules/ranking/ranking.service.spec.ts`

- [ ] **Step 1: 改造 mock 并重写用例（失败用例）**

`src/modules/ranking/ranking.service.spec.ts` 中 `CacheService` 的 mock 对象里，把 `zAdd: jest.fn(),` 行后补一行 `zRangeWithScores: jest.fn(),`，使该 mock 变为：

```ts
        {
          provide: CacheService,
          useValue: {
            zAdd: jest.fn(),
            zRange: jest.fn(),
            zRangeWithScores: jest.fn(),
            zRem: jest.fn(),
            get: jest.fn(),
            set: jest.fn(),
          },
        },
```

把整个 `describe('getTopN', ...)` 块（第 57-77 行）替换为：

```ts
  describe('getTopN', () => {
    it('should return top N players with real scores, highest first', async () => {
      cacheService.zRangeWithScores.mockResolvedValue([
        {
          value: JSON.stringify({ playerId: 'p2', playerName: '李四' }),
          score: 900,
        },
        {
          value: JSON.stringify({ playerId: 'p1', playerName: '张三' }),
          score: 500,
        },
      ]);

      const result = await service.getTopN(RankingType.POWER, 10);

      expect(cacheService.zRangeWithScores).toHaveBeenCalledWith(
        'ranking:power',
        0,
        9,
        true,
      );
      expect(result).toEqual([
        { playerId: 'p2', playerName: '李四', rank: 1, score: 900 },
        { playerId: 'p1', playerName: '张三', rank: 2, score: 500 },
      ]);
    });

    it('should return empty array when no rankings', async () => {
      cacheService.zRangeWithScores.mockResolvedValue([]);

      await expect(service.getTopN(RankingType.POWER, 10)).resolves.toEqual(
        [],
      );
    });

    it('should skip malformed members and keep rank contiguous', async () => {
      cacheService.zRangeWithScores.mockResolvedValue([
        { value: 'not-json', score: 900 },
        {
          value: JSON.stringify({ playerId: 'p1', playerName: '张三' }),
          score: 500,
        },
      ]);

      const result = await service.getTopN(RankingType.POWER, 10);

      expect(result).toEqual([
        { playerId: 'p1', playerName: '张三', rank: 1, score: 500 },
      ]);
    });
  });
```

把 `describe('createSnapshot', ...)` 块（第 141-151 行）替换为：

```ts
  describe('createSnapshot', () => {
    it('should persist real integer scores to DB', async () => {
      cacheService.zRangeWithScores.mockResolvedValue([
        {
          value: JSON.stringify({ playerId: 'p1', playerName: '张三' }),
          score: 5000.7,
        },
      ]);

      await service.createSnapshot(RankingType.POWER);

      expect(rankingRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          rankingType: RankingType.POWER,
          playerId: 'p1',
          rankValue: '5000',
          rankOrder: 1,
        }),
      );
    });
  });
```

- [ ] **Step 2: 跑用例确认失败**

Run: `npm test -- ranking.service.spec`
Expected: FAIL —— `getTopN` 返回 `score: 0`（期望 900/500），且 `zRangeWithScores` 未被调用

- [ ] **Step 3: 实现 getTopN**

把 `src/modules/ranking/ranking.service.ts` 的 `getTopN` 整体替换为：

```ts
  async getTopN(type: RankingType, n: number): Promise<RankEntry[]> {
    const members = await this.cacheService.zRangeWithScores(
      this.RANKING_KEY(type),
      0,
      n - 1,
      true,
    );

    const entries: RankEntry[] = [];
    for (const member of members) {
      let parsed: { playerId?: string; playerName?: string };
      try {
        parsed = JSON.parse(member.value);
      } catch {
        continue;
      }
      if (!parsed.playerId) continue;
      entries.push({
        playerId: parsed.playerId,
        playerName: parsed.playerName ?? '',
        rank: entries.length + 1,
        score: Number(member.score),
      });
    }
    return entries;
  }
```

- [ ] **Step 4: 实现 createSnapshot 取整入库**

把 `src/modules/ranking/ranking.service.ts` 中 `createSnapshot` 的 for 循环体（`const record = this.rankingRepo.create({...})` 整个字面量）替换为：

```ts
      const record = this.rankingRepo.create({
        rankingType: type,
        playerId: entry.playerId,
        playerName: entry.playerName,
        rankValue: Number.isFinite(entry.score)
          ? String(Math.trunc(entry.score))
          : '0',
        rankOrder: entry.rank,
      });
```

- [ ] **Step 5: 跑用例确认通过**

Run: `npm test -- ranking.service.spec`
Expected: PASS（`getTopN`/`createSnapshot`/`getPlayerRank`/`removePlayer*` 全绿）

- [ ] **Step 6: 提交**

```bash
git add packages-game/game-server/src/modules/ranking/ranking.service.ts packages-game/game-server/src/modules/ranking/ranking.service.spec.ts
git commit -m "fix(ranking): P0-A T2 榜单与快照返回真实分值"
```

---

### Task 3: AchievementService.advanceByCondition（按条件推进进度）

**Files:**
- Modify: `src/modules/achievement/achievement.service.ts`
- Modify: `src/modules/achievement/achievement.module.ts`
- Test: `src/modules/achievement/achievement.service.spec.ts`

- [ ] **Step 1: 补依赖注入（EconomyService 供 Task 4 用）并写失败用例**

`src/modules/achievement/achievement.module.ts` 整体替换为：

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AchievementService } from './achievement.service';
import { AchievementController } from './achievement.controller';
import { AchievementTemplate, PlayerAchievement } from './entities';
import { EconomyModule } from '@modules/economy/economy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AchievementTemplate, PlayerAchievement]),
    EconomyModule,
  ],
  controllers: [AchievementController],
  providers: [AchievementService],
  exports: [AchievementService],
})
export class AchievementModule {}
```

`src/modules/achievement/achievement.service.spec.ts` 顶部 import 区追加：

```ts
import { EconomyService } from '@modules/economy/economy.service';
import { GameEvents } from '@event-bus/game-events';
```

变量声明区（`let eventBus: ...` 之后）追加：

```ts
  let economyService: jest.Mocked<EconomyService>;
```

`PlayerAchievement` 的 mock provider 追加 `update` 方法，变为：

```ts
        {
          provide: getRepositoryToken(PlayerAchievement),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn((data: any) => ({ ...data })),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
          },
        },
```

`EventBusService` 的 mock provider 之后追加：

```ts
        {
          provide: EconomyService,
          useValue: { addCurrency: jest.fn().mockResolvedValue({}) },
        },
```

`eventBus = module.get(EventBusService);` 之后追加：

```ts
    economyService = module.get(EconomyService);
```

在 `describe('claimReward', ...)` 之前插入新块：

```ts
  describe('advanceByCondition', () => {
    it('should increment every template matching the condition and unlock on target', async () => {
      templateRepo.find.mockResolvedValue([
        {
          id: 'a1',
          name: '百战之王',
          condition: AchievementCondition.KILL_COUNT,
          targetValue: 100,
        },
        {
          id: 'a2',
          name: '小试牛刀',
          condition: AchievementCondition.KILL_COUNT,
          targetValue: 5,
        },
      ] as any);
      playerAchievementRepo.findOne
        .mockResolvedValueOnce({
          id: 'pa1',
          playerId: 'p1',
          achievementId: 'a1',
          currentValue: 10,
          isUnlocked: false,
        } as any)
        .mockResolvedValueOnce({
          id: 'pa2',
          playerId: 'p1',
          achievementId: 'a2',
          currentValue: 4,
          isUnlocked: false,
        } as any);

      await service.advanceByCondition(
        'p1',
        AchievementCondition.KILL_COUNT,
        1,
      );

      expect(templateRepo.find).toHaveBeenCalledWith({
        where: { condition: AchievementCondition.KILL_COUNT },
      });
      expect(playerAchievementRepo.save).toHaveBeenCalledTimes(2);
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.ACHIEVEMENT_UNLOCKED,
        expect.objectContaining({ playerId: 'p1', achievementId: 'a2' }),
      );
    });

    it('should set absolute value when mode is set', async () => {
      templateRepo.find.mockResolvedValue([
        {
          id: 'a3',
          name: '登堂入室',
          condition: AchievementCondition.REACH_LEVEL,
          targetValue: 30,
        },
      ] as any);
      playerAchievementRepo.findOne.mockResolvedValue(null);

      await service.advanceByCondition(
        'p1',
        AchievementCondition.REACH_LEVEL,
        30,
        'set',
      );

      expect(playerAchievementRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ currentValue: 30, isUnlocked: true }),
      );
    });

    it('should ignore non-positive values without querying templates', async () => {
      await service.advanceByCondition(
        'p1',
        AchievementCondition.EARN_CURRENCY,
        0,
      );

      expect(templateRepo.find).not.toHaveBeenCalled();
    });

    it('should skip templates already unlocked', async () => {
      templateRepo.find.mockResolvedValue([
        {
          id: 'a1',
          name: '百战之王',
          condition: AchievementCondition.KILL_COUNT,
          targetValue: 1,
        },
      ] as any);
      playerAchievementRepo.findOne.mockResolvedValue({
        id: 'pa1',
        currentValue: 99,
        isUnlocked: true,
      } as any);

      await service.advanceByCondition(
        'p1',
        AchievementCondition.KILL_COUNT,
        5,
      );

      expect(playerAchievementRepo.save).not.toHaveBeenCalled();
    });

    it('should continue with other templates when one fails', async () => {
      templateRepo.find.mockResolvedValue([
        { id: 'a1', name: 'x', condition: AchievementCondition.KILL_COUNT, targetValue: 9 },
        { id: 'a2', name: 'y', condition: AchievementCondition.KILL_COUNT, targetValue: 9 },
      ] as any);
      playerAchievementRepo.findOne.mockResolvedValue(null);
      playerAchievementRepo.save
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce({} as any);

      await expect(
        service.advanceByCondition('p1', AchievementCondition.KILL_COUNT, 1),
      ).resolves.toBeUndefined();
      expect(playerAchievementRepo.save).toHaveBeenCalledTimes(2);
    });
  });
```

- [ ] **Step 2: 跑用例确认失败**

Run: `npm test -- achievement.service.spec`
Expected: FAIL，报 `service.advanceByCondition is not a function`

- [ ] **Step 3: 实现**

`src/modules/achievement/achievement.service.ts` 顶部 import 改为：

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AchievementTemplate, PlayerAchievement } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  AchievementCategory,
  AchievementCondition,
  CurrencyType,
} from '@constants/enums';
import { EconomyService } from '@modules/economy/economy.service';

export interface ClaimAchievementResult {
  reward: Record<string, any>;
  isRewardClaimed: boolean;
}

/** increment: 在既有进度上累加；set: 直接写为绝对值（等级类快照条件） */
export type ProgressMode = 'increment' | 'set';
```

类体开头（`export class AchievementService {` 之后第一行）加日志器：

```ts
  private readonly logger = new Logger(AchievementService.name);
```

构造函数参数末尾（`private readonly eventBus: EventBusService,` 之后）追加：

```ts
    private readonly economyService: EconomyService,
```

在 `updateProgress` 方法之后、`claimReward` 之前插入两个方法：

```ts
  /**
   * 按成就条件推进进度：命中同一 condition 的所有模板逐一推进。
   * 单条模板失败只记日志，不阻断其余模板与调用方主流程。
   */
  async advanceByCondition(
    playerId: string,
    condition: AchievementCondition,
    value: number,
    mode: ProgressMode = 'increment',
  ): Promise<void> {
    if (!Number.isFinite(value) || value <= 0) return;

    const templates = await this.templateRepo.find({ where: { condition } });
    for (const template of templates) {
      try {
        await this.applyProgress(playerId, template, value, mode);
      } catch (err) {
        this.logger.error(
          `Achievement progress failed: player=${playerId} achievement=${template.id}`,
          (err as Error).message,
        );
      }
    }
  }

  private async applyProgress(
    playerId: string,
    template: AchievementTemplate,
    value: number,
    mode: ProgressMode,
  ): Promise<void> {
    let record = await this.playerAchievementRepo.findOne({
      where: { playerId, achievementId: template.id },
    });
    if (record?.isUnlocked) {
      return;
    }

    if (!record) {
      record = this.playerAchievementRepo.create({
        playerId,
        achievementId: template.id,
        currentValue: 0,
        isUnlocked: false,
        isRewardClaimed: false,
      });
    }

    const nextValue =
      mode === 'increment' ? record.currentValue + value : value;
    record.currentValue = nextValue;

    if (nextValue >= template.targetValue && !record.isUnlocked) {
      record.isUnlocked = true;
      record.unlockedAt = new Date();
      this.eventBus.emit(GameEvents.ACHIEVEMENT_UNLOCKED, {
        playerId,
        achievementId: template.id,
        achievementName: template.name,
      });
    }

    await this.playerAchievementRepo.save(record);
  }
```

- [ ] **Step 4: 跑用例确认通过**

Run: `npm test -- achievement.service.spec`
Expected: PASS（原 12 例 + 新 5 例全绿）

- [ ] **Step 5: 提交**

```bash
git add packages-game/game-server/src/modules/achievement/achievement.service.ts packages-game/game-server/src/modules/achievement/achievement.service.spec.ts packages-game/game-server/src/modules/achievement/achievement.module.ts
git commit -m "fix(achievement): P0-A T3 按条件推进成就进度"
```

---

### Task 4: 成就领奖实际发放

**Files:**
- Modify: `src/modules/achievement/achievement.service.ts`（claimReward + 新增 deliverReward）
- Test: `src/modules/achievement/achievement.service.spec.ts`

- [ ] **Step 1: 写失败用例**

在 `describe('claimReward', ...)` 块内、最后一个 `it('should throw when reward already claimed', ...)` 之后追加：

```ts
    it('should deliver currencies from flat rewardJson keys', async () => {
      templateRepo.findOne.mockResolvedValue({
        id: 'a1',
        rewardJson: { gold: 500, diamond: 10, unknownKey: 1 },
      } as any);
      playerAchievementRepo.findOne.mockResolvedValue({
        id: 'pa1',
        playerId: 'p1',
        achievementId: 'a1',
        isUnlocked: true,
        isRewardClaimed: false,
      } as any);

      const result = await service.claimReward('p1', 'a1');

      expect(economyService.addCurrency).toHaveBeenCalledTimes(2);
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.GOLD,
        500,
        'achievement_reward',
        'achievement_reward:p1:a1',
        'a1',
      );
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.DIAMOND,
        10,
        'achievement_reward',
        'achievement_reward:p1:a1',
        'a1',
      );
      expect(result.isRewardClaimed).toBe(true);
    });

    it('should reject when the atomic claim loses the race', async () => {
      templateRepo.findOne.mockResolvedValue({
        id: 'a1',
        rewardJson: { gold: 1 },
      } as any);
      playerAchievementRepo.findOne.mockResolvedValue({
        id: 'pa1',
        playerId: 'p1',
        achievementId: 'a1',
        isUnlocked: true,
        isRewardClaimed: false,
      } as any);
      playerAchievementRepo.update.mockResolvedValue({ affected: 0 } as any);

      await expect(service.claimReward('p1', 'a1')).rejects.toThrow(
        GameException,
      );
      expect(economyService.addCurrency).not.toHaveBeenCalled();
    });

    it('should roll back the claim flag when delivery fails', async () => {
      templateRepo.findOne.mockResolvedValue({
        id: 'a1',
        rewardJson: { gold: 1 },
      } as any);
      playerAchievementRepo.findOne.mockResolvedValue({
        id: 'pa1',
        playerId: 'p1',
        achievementId: 'a1',
        isUnlocked: true,
        isRewardClaimed: false,
      } as any);
      economyService.addCurrency.mockRejectedValue(new Error('db down'));

      await expect(service.claimReward('p1', 'a1')).rejects.toThrow('db down');
      expect(playerAchievementRepo.update).toHaveBeenLastCalledWith(
        { id: 'pa1' },
        { isRewardClaimed: false },
      );
    });
```

补充 import：

```ts
import { CurrencyType } from '@constants/enums';
```

（并入已有的 `@constants/enums` 具名导入行即可。）

- [ ] **Step 2: 跑用例确认失败**

Run: `npm test -- achievement.service.spec`
Expected: FAIL —— 新 3 例中「发放货币」「原子占位」「回滚」失败（`addCurrency` 未被调用 / `claimReward` 未抛错）

- [ ] **Step 3: 实现**

把 `src/modules/achievement/achievement.service.ts` 的 `claimReward` 整体替换为：

```ts
  async claimReward(
    playerId: string,
    achievementId: string,
  ): Promise<ClaimAchievementResult> {
    const record = await this.playerAchievementRepo.findOne({
      where: { playerId, achievementId },
    });
    if (!record) {
      throw new GameException(
        ErrorCodes.ACHIEVEMENT_NOT_FOUND,
        '成就记录不存在',
      );
    }
    if (!record.isUnlocked) {
      throw new GameException(
        ErrorCodes.ACHIEVEMENT_CONDITION_NOT_MET,
        '成就未解锁',
      );
    }
    if (record.isRewardClaimed) {
      throw new GameException(
        ErrorCodes.ACHIEVEMENT_ALREADY_UNLOCKED,
        '奖励已领取',
      );
    }

    const template = await this.templateRepo.findOne({
      where: { id: achievementId },
    });
    const reward = template?.rewardJson ?? {};

    // 原子占位：并发/连点时只有一个请求能把标记从 false 改成 true
    const claimed = await this.playerAchievementRepo.update(
      { id: record.id, isRewardClaimed: false },
      { isRewardClaimed: true },
    );
    if (!claimed.affected) {
      throw new GameException(
        ErrorCodes.ACHIEVEMENT_ALREADY_UNLOCKED,
        '奖励已领取',
      );
    }

    try {
      await this.deliverReward(playerId, achievementId, reward);
    } catch (err) {
      await this.playerAchievementRepo.update(
        { id: record.id },
        { isRewardClaimed: false },
      );
      throw err;
    }

    return { reward, isRewardClaimed: true };
  }
```

在同文件 `claimReward` 之后插入私有发放方法：

```ts
  /**
   * 发放成就奖励。rewardJson 采用扁平货币键约定（如 { gold: 500, diamond: 10 }），
   * 未识别的键记 warning，避免配置静默失效。
   */
  private async deliverReward(
    playerId: string,
    achievementId: string,
    reward: Record<string, any>,
  ): Promise<void> {
    const supported = Object.values(CurrencyType) as string[];

    for (const [key, raw] of Object.entries(reward ?? {})) {
      if (!supported.includes(key)) {
        this.logger.warn(
          `Unsupported achievement reward key: ${key} (achievement=${achievementId})`,
        );
        continue;
      }
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      await this.economyService.addCurrency(
        playerId,
        key as CurrencyType,
        amount,
        'achievement_reward',
        `achievement_reward:${playerId}:${achievementId}`,
        achievementId,
      );
    }
  }
```

- [ ] **Step 4: 跑用例确认通过**

Run: `npm test -- achievement.service.spec`
Expected: PASS（含原有 `should claim reward for unlocked achievement` 仍绿）

- [ ] **Step 5: 提交**

```bash
git add packages-game/game-server/src/modules/achievement/achievement.service.ts packages-game/game-server/src/modules/achievement/achievement.service.spec.ts
git commit -m "fix(achievement): P0-A T4 领奖实际发放货币"
```

---

### Task 5: 事件总线接线

**Files:**
- Modify: `src/event-bus/event-listeners.service.ts`
- Modify: `src/event-bus/event-listeners.module.ts`
- Test: `src/event-bus/event-listeners.service.spec.ts`

- [ ] **Step 1: 注册模块依赖**

`src/event-bus/event-listeners.module.ts` 整体替换为：

```ts
import { Module } from '@nestjs/common';
import { GameEventListeners } from './event-listeners.service';
import { QuestModule } from '@modules/quest/quest.module';
import { PlayerModule } from '@modules/player/player.module';
import { RankingModule } from '@modules/ranking/ranking.module';
import { CharacterModule } from '@modules/character/character.module';
import { WorldModule } from '@modules/world/world.module';
import { ItemDropModule } from '@modules/item-drop/item-drop.module';
import { AchievementModule } from '@modules/achievement/achievement.module';

@Module({
  imports: [
    QuestModule,
    PlayerModule,
    RankingModule,
    CharacterModule,
    WorldModule,
    ItemDropModule,
    AchievementModule,
  ],
  providers: [GameEventListeners],
})
export class EventListenersModule {}
```

- [ ] **Step 2: 写失败用例**

`src/event-bus/event-listeners.service.spec.ts` 顶部 import 区追加：

```ts
import { AchievementService } from '@modules/achievement/achievement.service';
import { AchievementCondition } from '@constants/enums';
```

变量声明区追加：

```ts
  let achievementService: jest.Mocked<any>;
```

providers 里 `{ provide: DropService, useValue: { rollDrop: jest.fn() } },` 之后追加：

```ts
        {
          provide: AchievementService,
          useValue: { advanceByCondition: jest.fn().mockResolvedValue(undefined) },
        },
```

`dropService = moduleRef.get(DropService);` 之后追加：

```ts
    achievementService = moduleRef.get(AchievementService);
```

在 `describe('onMonsterKilled', ...)` 块内、`it('should return early if character not found', ...)` 之前插入：

```ts
    it('should advance KILL_COUNT and WIN_COMBAT achievements for the parsed player', async () => {
      characterService.getById.mockResolvedValue({ playerId: 'p1' });
      worldService.getMonsterTemplate.mockResolvedValue(null);
      playerService.addExp.mockResolvedValue({ player: {}, leveledUp: false });

      await listeners.onMonsterKilled({
        attackerId: 'c1',
        defenderId: 'm1',
        sceneId: 's1',
      });

      expect(achievementService.advanceByCondition).toHaveBeenCalledWith(
        'p1',
        AchievementCondition.KILL_COUNT,
        1,
      );
      expect(achievementService.advanceByCondition).toHaveBeenCalledWith(
        'p1',
        AchievementCondition.WIN_COMBAT,
        1,
      );
    });
```

在 `it('should return early if character not found', ...)` 断言区追加一行：

```ts
      expect(achievementService.advanceByCondition).not.toHaveBeenCalled();
```

把 `describe('onLevelUp', ...)` 的第一个用例替换为：

```ts
    it('should update ranking and set REACH_LEVEL achievement progress', async () => {
      playerService.getById.mockResolvedValue({ nickname: 'hero' });

      await listeners.onLevelUp({ playerId: 'p1', newLevel: 5 });

      expect(rankingService.updateScore).toHaveBeenCalledWith(
        RankingType.LEVEL,
        'p1',
        'hero',
        5,
      );
      expect(achievementService.advanceByCondition).toHaveBeenCalledWith(
        'p1',
        AchievementCondition.REACH_LEVEL,
        5,
        'set',
      );
    });
```

把 `describe('onCurrencyChanged', ...)` 块替换为：

```ts
  describe('onCurrencyChanged', () => {
    it('should advance EARN_CURRENCY for positive changes', async () => {
      await listeners.onCurrencyChanged({
        playerId: 'p1',
        currencyType: 'gold',
        change: '100',
        source: 'recharge',
      });

      expect(achievementService.advanceByCondition).toHaveBeenCalledWith(
        'p1',
        AchievementCondition.EARN_CURRENCY,
        100,
      );
    });

    it('should ignore non-positive changes', async () => {
      await listeners.onCurrencyChanged({
        playerId: 'p1',
        currencyType: 'gold',
        change: '-50',
        source: 'trade',
      });

      expect(achievementService.advanceByCondition).not.toHaveBeenCalled();
    });

    it('should ignore malformed change values', async () => {
      await listeners.onCurrencyChanged({
        playerId: 'p1',
        currencyType: 'gold',
        change: 'abc',
        source: 'trade',
      });

      expect(achievementService.advanceByCondition).not.toHaveBeenCalled();
    });
  });
```

在文件末尾 `describe('onItemAcquired', ...)` 块之后追加：

```ts
  describe('onQuestCompleted', () => {
    it('should advance COMPLETE_QUEST', async () => {
      await listeners.onQuestCompleted({ playerId: 'p1' });

      expect(achievementService.advanceByCondition).toHaveBeenCalledWith(
        'p1',
        AchievementCondition.COMPLETE_QUEST,
        1,
      );
    });
  });

  describe('onGuildJoined', () => {
    it('should advance JOIN_GUILD', async () => {
      await listeners.onGuildJoined({ guildId: 'g1', playerId: 'p1' });

      expect(achievementService.advanceByCondition).toHaveBeenCalledWith(
        'p1',
        AchievementCondition.JOIN_GUILD,
        1,
      );
    });
  });

  describe('onFriendAdded', () => {
    it('should advance ADD_FRIEND', async () => {
      await listeners.onFriendAdded({ playerId: 'p1', friendId: 'p2' });

      expect(achievementService.advanceByCondition).toHaveBeenCalledWith(
        'p1',
        AchievementCondition.ADD_FRIEND,
        1,
      );
    });
  });
```

- [ ] **Step 3: 跑用例确认失败**

Run: `npm test -- event-listeners.service.spec`
Expected: FAIL —— `advanceByCondition` 从未被调用；`listeners.onQuestCompleted` 等为 undefined 抛 TypeError

- [ ] **Step 4: 实现接线**

`src/event-bus/event-listeners.service.ts` 顶部 import 区追加：

```ts
import { AchievementService } from '@modules/achievement/achievement.service';
import { AchievementCondition } from '@constants/enums';
```

构造函数参数 `private readonly dropService: DropService,` 之后追加：

```ts
    private readonly achievementService: AchievementService,
```

在 `onMonsterKilled` 的 `await this.playerService.addExp(playerId, 100);` try/catch 块之后、`} catch (err) {` 之前插入：

```ts
      // 成就进度：PvE 击杀同时计入杀敌数与胜场
      try {
        await this.achievementService.advanceByCondition(
          playerId,
          AchievementCondition.KILL_COUNT,
          1,
        );
        await this.achievementService.advanceByCondition(
          playerId,
          AchievementCondition.WIN_COMBAT,
          1,
        );
      } catch (err) {
        this.logger.error(
          'Achievement progress failed',
          (err as Error).message,
        );
      }
```

`onLevelUp` 的 `await this.rankingService.updateScore(...)` 之后、`} catch (err) {` 之前插入：

```ts
      await this.achievementService.advanceByCondition(
        payload.playerId,
        AchievementCondition.REACH_LEVEL,
        payload.newLevel,
        'set',
      );
```

把 `onCurrencyChanged` 整体替换为：

```ts
  @OnEvent(GameEvents.CURRENCY_CHANGED)
  async onCurrencyChanged(payload: {
    playerId: string;
    currencyType: string;
    change: string;
    source: string;
  }) {
    this.logger.debug(
      `Currency changed: ${payload.playerId} ${payload.currencyType} ${payload.change} source=${payload.source}`,
    );

    const amount = Number(payload.change);
    if (!Number.isFinite(amount) || amount <= 0) return;

    try {
      await this.achievementService.advanceByCondition(
        payload.playerId,
        AchievementCondition.EARN_CURRENCY,
        amount,
      );
    } catch (err) {
      this.logger.error(
        'Achievement progress failed',
        (err as Error).message,
      );
    }
  }
```

把 `onItemAcquired` 的注释改为显式说明（逻辑不变）：

```ts
  @OnEvent(GameEvents.ITEM_ACQUIRED)
  async onItemAcquired(payload: { playerId: string; itemTemplateId: string }) {
    this.logger.debug(
      `Item acquired: ${payload.playerId} item=${payload.itemTemplateId}`,
    );
    // AchievementCondition 暂无道具类条件，接入需先新增枚举值与玩法口径（见盘点报告 P1）
  }
```

在 `onItemAcquired` 之后追加三个监听器：

```ts
  @OnEvent(GameEvents.QUEST_COMPLETED)
  async onQuestCompleted(payload: { playerId: string }) {
    try {
      await this.achievementService.advanceByCondition(
        payload.playerId,
        AchievementCondition.COMPLETE_QUEST,
        1,
      );
    } catch (err) {
      this.logger.error(
        'Achievement progress failed',
        (err as Error).message,
      );
    }
  }

  @OnEvent(GameEvents.GUILD_JOINED)
  async onGuildJoined(payload: { guildId: string; playerId: string }) {
    try {
      await this.achievementService.advanceByCondition(
        payload.playerId,
        AchievementCondition.JOIN_GUILD,
        1,
      );
    } catch (err) {
      this.logger.error(
        'Achievement progress failed',
        (err as Error).message,
      );
    }
  }

  @OnEvent(GameEvents.FRIEND_ADDED)
  async onFriendAdded(payload: { playerId: string; friendId: string }) {
    try {
      await this.achievementService.advanceByCondition(
        payload.playerId,
        AchievementCondition.ADD_FRIEND,
        1,
      );
    } catch (err) {
      this.logger.error(
        'Achievement progress failed',
        (err as Error).message,
      );
    }
  }
```

- [ ] **Step 5: 跑用例确认通过**

Run: `npm test -- event-listeners.service.spec`
Expected: PASS（原 11 例 + 新 6 例全绿）

- [ ] **Step 6: 类型检查 + 全量回归**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无输出（0 error）

Run: `npm test`
Expected: 全部 spec PASS，无 failed

- [ ] **Step 7: 提交**

```bash
git add packages-game/game-server/src/event-bus/event-listeners.service.ts packages-game/game-server/src/event-bus/event-listeners.service.spec.ts packages-game/game-server/src/event-bus/event-listeners.module.ts
git commit -m "fix(achievement): P0-A T5 成就事件接线（6 类事件）"
```

---

### Task 6: 线上冒烟与收尾

**Files:** 无代码改动（仅验证与推送）

- [ ] **Step 1: 部署**

服务器严禁 `npm run build`（2G 内存约束），构建在本地做。应用目录 `/opt/game-server`，systemd 服务 `game-server`，入口 `node dist/src/main`：

```bash
# 本地构建与打包（cwd: packages-game/game-server）
npm run build
tar -czf dist-p0a.tar.gz -C dist .

# 上传（目标机 39.106.99.9）
scp dist-p0a.tar.gz root@39.106.99.9:/tmp/

# 服务器：备份旧 dist → 解包新 dist → 重启
ssh root@39.106.99.9 "cd /opt/game-server && cp -r dist dist_prev_\$(date +%Y%m%d_%H%M%S) && rm -rf dist && mkdir dist && tar -xzf /tmp/dist-p0a.tar.gz -C dist && systemctl restart game-server"

# 验证启动（期望出现 "Nest application successfully started"）
ssh root@39.106.99.9 "sleep 5 && journalctl -u game-server --since '-1 min' | tail -n 30"
```

- [ ] **Step 2: 冒烟（建 1 条成就模板 → 触发 → 查进度 → 领奖查余额）**

```bash
# 1) admin 建模板：杀敌 1 次即解锁，奖 100 金（需先取 GM token）
curl -s -X POST http://127.0.0.1:3000/api/admin/v1/achievement/template \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"冒烟杀敌","category":"combat","condition":"kill_count","targetValue":1,"rewardJson":{"gold":100}}'
# 记录返回的模板 id 为 $ACH_ID

# 2) 客户端查成就进度（应含 $ACH_ID 记录，currentValue 随击杀增长）
curl -s http://127.0.0.1:3000/api/client/v1/achievement/my -H "Authorization: Bearer $PLAYER_TOKEN"

# 3) 触发一次 PvE 战斗胜利后，再查进度：期望 isUnlocked=true

# 4) 领奖
curl -s -X POST http://127.0.0.1:3000/api/client/v1/achievement/$ACH_ID/claim \
  -H "Authorization: Bearer $PLAYER_TOKEN"
# 期望返回 reward 且 isRewardClaimed=true

# 5) 查余额：金币应 +100（economy 余额接口）
curl -s http://127.0.0.1:3000/api/client/v1/economy/balance -H "Authorization: Bearer $PLAYER_TOKEN"

# 6) 排行榜分值非 0
curl -s "http://127.0.0.1:3000/api/client/v1/ranking/level?n=10" -H "Authorization: Bearer $PLAYER_TOKEN"
# 期望每条 score 为真实等级值（不再是 0）

# 7) GM 触发一次快照后查快照列表，rankValue 非 '0'
curl -s -X POST http://127.0.0.1:3000/api/admin/v1/ranking/level/snapshot -H "Authorization: Bearer $ADMIN_TOKEN"
curl -s "http://127.0.0.1:3000/api/admin/v1/ranking/snapshot/list?page=1&limit=10" -H "Authorization: Bearer $ADMIN_TOKEN"
```

注意：接口路径以实际路由为准（控制器里是 `api/client/v1/...`）；冒烟时若发现路径不符，以 `achievement.controller.ts` / `ranking.controller.ts` 的 `@Get/@Post` 为准，不要改代码去迁就脚本。

- [ ] **Step 3: 文档与收尾**

- 手册：本次**无新表、无新接口、无字段变更**，`dict-part.html` / `api-part.html` 均不需更新（如确有枚举值新增再同步）。
- 盘点报告同步：把 `docs/superpowers/specs/2026-09-20-game-server-completeness-inventory-design.md` 中 P0-1/P0-2/P0-3 三行标注为「已修复（本计划）」，并在第 7 节结论的风险条目上标注进度。
- 推送：

```bash
git add docs/superpowers/specs/2026-09-20-game-server-completeness-inventory-design.md docs/superpowers/plans/2026-09-20-achievement-ranking-fix.md
git commit -m "docs: P0-A 成就与排行修复计划 + 盘点报告进度标注"
git push origin main
```

---

## 完成验收

1. `zRangeWithScores` 可用，`getTopN` 返回真实分值且按分值降序，畸形成员被跳过且 rank 连续。
2. `createSnapshot` 写入的 `rank_value` 为真实分值整数，不再是 `'0'`。
3. 6 类事件均能推进对应 condition 的成就进度；`REACH_LEVEL` 走绝对值语义。
4. 成就领奖真实发放货币，并发/连点只发一次，发放失败标记回滚。
5. `npm test` 全绿、`tsc --noEmit` 无错、线上冒烟 6 步全部符合预期。
6. 盘点报告 P0-1/P0-2/P0-3 已标注修复，改动已推送。

## 风险与回滚

- **发奖重复风险**：依赖 `update({id, isRewardClaimed:false})` 的 `affected` 判定；若 TypeORM 对同值更新返回 `affected=1` 的行为在不同版本有差异，需在冒烟第 4 步连点两次验证第二次返回「奖励已领取」。若判定失效，回滚 Task 4 的原子占位与发放（`git revert`），退回"仅回显"不引入新风险。
- **`EARN_CURRENCY` 口径**：累计「获得」而非余额，运营配 `targetValue` 时须按累计值设定，冒烟后同步给策划。
- **`WIN_COMBAT` 语义**：当前仅有 PvE 胜场信号，PvP 落地后需改为独立事件；在 PvP 未上时该成就会偏容易达成。
- **回滚**：本计划 5 个 commit 相互独立，任一任务异常可单独 `git revert`；无表结构变更，无数据迁移负担。