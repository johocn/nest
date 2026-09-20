# P0-4 配置字段生效（活动条件/人数上限、任务前置/限次/发奖、公告时间窗）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让运营在 GM 后台配置的活动参与条件/人数上限、任务前置链/接取次数/自动发奖、公告时间窗真正生效——目前这些字段「能配、能存库、不生效」，运营会误判。

**Architecture:** 三块彼此独立，各自在既有 service 的入口处补校验与发放：任务侧把「接取门槛」收进 `acceptQuest`（等级自取库值，不再依赖调用方传参）、把「发奖」拆成 `submitQuest`（autoReward=true 直发，否则置 COMPLETED）与新增 `claimQuestReward`（手动领）；活动侧抽 `assertConditions` 在 `joinActivity`/`signIn` 统一校验，人数上限用简单 count；公告侧补 DTO 字段与查询时间窗过滤。档位表（好感/帮派/情报）从 `QuestService` 私有静态抽到 `@constants/ranks`，供活动侧复用同一套判定。

**Tech Stack:** NestJS 11 + TypeScript、TypeORM + PostgreSQL、class-validator、Jest 30 + ts-jest。

---

## 设计

### 缺陷根因

| 缺陷 | 根因 | 证据 |
|---|---|---|
| 活动参与条件不生效 | `conditionJson` 只被写入/透传（`snapshot`、`rollback`），`joinActivity`/`signIn` 从不读取 | [activity.service.ts:130-225](file:///e:/code/nest/packages-game/game-server/src/modules/activity/activity.service.ts#L130-L225) |
| 活动人数上限不生效 | `maxParticipants` 全库仅出现在实体与 DTO，无任何业务读取 | [activity-template.entity.ts:48-49](file:///e:/code/nest/packages-game/game-server/src/modules/activity/entities/activity-template.entity.ts#L48-L49) |
| 任务等级门槛形同虚设 | `acceptQuest` 的 `playerLevel` 为可选入参，控制器从不传 → 校验恒被跳过 | [quest.controller.ts:52](file:///e:/code/nest/packages-game/game-server/src/modules/quest/quest.controller.ts#L52) |
| 任务接取次数不生效 | `acceptLimit` 无任何校验；错误码 `QUEST_ACCEPT_LIMIT_REACHED: 40003` 已定义但全库未使用 | [error-codes.ts:41](file:///e:/code/nest/packages-game/game-server/src/constants/error-codes.ts#L41) |
| 任务前置链不生效 | `prerequisiteIds` 能存库（`createTemplate` 直落），`acceptQuest` 不校验 | [quest.service.ts:530-533](file:///e:/code/nest/packages-game/game-server/src/modules/quest/quest.service.ts#L530-L533) |
| 任务主奖励不发 | `submitQuest` 只对 `rewardSocial.currencyType` 真发货币，`rewardJson`（exp/gold/道具）仅作返回值吐出；且无领奖接口，直接置 CLAIMED | [quest.service.ts:259-283](file:///e:/code/nest/packages-game/game-server/src/modules/quest/quest.service.ts#L259-L283) |
| 公告时间窗不生效 | DTO 无 `startAt`/`endAt`（运营配不了），查询只看 `isActive` | [create-notice.dto.ts](file:///e:/code/nest/packages-game/game-server/src/modules/notice/dto/create-notice.dto.ts)、[notice.service.ts:79-91](file:///e:/code/nest/packages-game/game-server/src/modules/notice/notice.service.ts#L79-L91) |

### 关键设计决策

1. **任务发奖分两段**（对齐手册 7.2 状态机 `completed 可提交 → claimed 已领奖`）：`autoReward=true` → `submitQuest` 内直接发奖并置 `CLAIMED`；`autoReward=false` → 置 `COMPLETED`，由新增的 `POST api/client/v1/quest/claim` 手动领取。
2. **`completeTimes` 在发奖时 +1，不在 submit 时 +1**。这样「幂等键 = `quest_reward:${playerId}:${questTemplateId}:${completeTimes}`」在发奖瞬间稳定，重复调用不会二次发放。
3. **手动领奖用状态原子占位防并发**：`update({ id, status: COMPLETED }, { status: CLAIMED })`，`affected=0` 即视为已领取；发奖抛错则回滚 `status=COMPLETED`（复用成就 `claimReward` 的既有模式）。
4. **奖励键契约沿用成就的扁平货币键约定**：`rewardJson` 的 key 命中 `CurrencyType` → `economyService.addCurrency`；`exp` → `playerService.addExp`；未识别键 `logger.warn` 而非静默失败。道具类键（背包道具）**不在本次范围**（归 P0-7 交易经济批次）。
5. **`acceptQuest` 删除 `playerLevel` 入参，改为内部查 `PlayerService`**。当前「可选入参 + 控制器不传」使校验恒失效；保留双来源只会制造不一致，故直接收敛为库值单一来源（同步改 3 处 spec 调用）。
6. **`prerequisiteIds` 语义 = 全部完成**（前置任务**链**），判定标准为该模板的 `PlayerQuest.status === CLAIMED`。
7. **`acceptLimit` 计数口径 = `playerQuestRepo.count({ playerId, questTemplateId })`**（可重复任务每次接取新增一条记录，故 count 即累计接取次数）。
8. **`conditionJson` 的 key 契约定为 4 项**：`level`（最低等级）、`questIds`（须已完成的前置任务，全部完成）、`favorLevel`（最高好感档，取 `RelationshipLevel` 枚举值）、`guildRole`（帮派职位，取 `GuildRole` 枚举值）。不做「组队人数」（需组队上下文，另立）。空对象 / 缺失键 = 不限制。
9. **档位表抽到 `@constants/ranks`**：`FAVOR_RANKS` / `GUILD_ROLE_RANKS` / `INTEL_GRADE_RANKS` 原为 `QuestService` 私有静态，活动侧需要同一套判定，重复定义会产生偏差，故抽为公共常量（纯搬移，无行为变化）。
10. **活动人数上限只在 `joinActivity` 校验**（报名是唯一入口），`signIn` 不校验人数——签到型活动不走报名，且手册 `max_participants` 语义是「参与人数上限」（报名口径）。
11. **人数上限用简单 count，不加锁**：`maxParticipants > 0` 时 `count({ activityId }) >= max` 即拒。极端并发下有极小超发窗口，GM 配置场景可接受。
12. **公告时间窗语义**：`startAt` 为 null 视为立即生效，`endAt` 为 null 视为永久；过滤条件为 `(startAt IS NULL OR startAt <= now) AND (endAt IS NULL OR endAt >= now)`，在 `getActiveNotices` 与 `getNoticesByType` 两处生效（`getLoginNotices` 走后者自动继承）。
13. **不做的**：活动条件/任务门槛的 GM 面板可视化（归 P0-8）、组队人数门槛、道具奖励发放、任务奖励的邮件补发。

### 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/constants/ranks.ts` | 好感/帮派/情报档位表（公共常量） | 建 |
| `src/modules/quest/quest.service.ts` | 接取门槛（等级/前置/限次）+ 发奖拆分 + 领奖 | 改 |
| `src/modules/quest/quest.module.ts` | 新增 `PlayerModule` 依赖 | 改 |
| `src/modules/quest/quest.controller.ts` | 新增 `POST api/client/v1/quest/claim` | 改 |
| `src/modules/activity/activity.service.ts` | `assertConditions` + 人数上限 | 改 |
| `src/modules/activity/activity.module.ts` | 新增 `CharacterModule`/`SocialModule`/`PlayerQuest` | 改 |
| `src/modules/notice/dto/create-notice.dto.ts` | 新增 `startAt`/`endAt` | 改 |
| `src/modules/notice/notice.service.ts` | 查询时间窗过滤 | 改 |
| `src/constants/error-codes.ts` | 新增 `ACTIVITY_CONDITION_NOT_MET` / `ACTIVITY_FULL` | 改 |
| `scripts/smoke-p0d-config.sh` | 线上冒烟脚本（部署批次使用） | 建 |

### 测试基线

改动前：**80 suites / 939 tests 全绿**。单测命令统一在 `e:\code\nest\packages-game\game-server` 下执行：

```bash
npm test -- <文件或关键字>
```

---

## Task 1: 抽档位常量到 `@constants/ranks`

**Files:**
- Create: `packages-game/game-server/src/constants/ranks.ts`
- Modify: `packages-game/game-server/src/modules/quest/quest.service.ts:37-61`

- [ ] **Step 1: 创建公共档位常量**

创建 `packages-game/game-server/src/constants/ranks.ts`：

```ts
import { GuildRole, IntelligenceGrade, RelationshipLevel } from './enums';

/** 情报等级档位（用于「情报等级 ≥ X」类门槛比较） */
export const INTEL_GRADE_RANKS: Record<string, number> = {
  [IntelligenceGrade.E]: 0,
  [IntelligenceGrade.D]: 1,
  [IntelligenceGrade.C]: 2,
  [IntelligenceGrade.B]: 3,
  [IntelligenceGrade.A]: 4,
};

/** 好感档位（用于「好感 ≥ X 档」类门槛比较） */
export const FAVOR_RANKS: Record<string, number> = {
  [RelationshipLevel.STRANGER]: 0,
  [RelationshipLevel.ACQUAINTANCE]: 1,
  [RelationshipLevel.FRIEND]: 2,
  [RelationshipLevel.CONFIDANT]: 3,
  [RelationshipLevel.SWORN]: 4,
};

/** 帮派职位档位（用于「帮派职位 ≥ X」类门槛比较） */
export const GUILD_ROLE_RANKS: Record<string, number> = {
  [GuildRole.MEMBER]: 0,
  [GuildRole.OFFICER]: 0,
  [GuildRole.ELITE]: 0,
  [GuildRole.INCENSE_MASTER]: 1,
  [GuildRole.HALL_MASTER]: 2,
  [GuildRole.VICE_LEADER]: 3,
  [GuildRole.LEADER]: 4,
};

/** 好感原始值 → 档位（关系表无 level 列时的兜底换算） */
export function favorRankOf(favorability: number): number {
  if (favorability >= 500) return 4;
  if (favorability >= 300) return 3;
  if (favorability >= 150) return 2;
  if (favorability >= 50) return 1;
  return 0;
}
```

- [ ] **Step 2: QuestService 改为引用公共常量**

编辑 `packages-game/game-server/src/modules/quest/quest.service.ts`：

（1）删除类内 `INTEL_GRADE_RANKS` / `FAVOR_RANKS` / `GUILD_ROLE_RANKS` 三个 `private static readonly` 定义（第 37-61 行），`SOCIAL_CURRENCIES` 保留；
（2）import 区加：

```ts
import {
  FAVOR_RANKS,
  GUILD_ROLE_RANKS,
  INTEL_GRADE_RANKS,
  favorRankOf,
} from '@constants/ranks';
```

（3）全文替换引用：`QuestService.INTEL_GRADE_RANKS` → `INTEL_GRADE_RANKS`、`QuestService.FAVOR_RANKS` → `FAVOR_RANKS`、`QuestService.GUILD_ROLE_RANKS` → `GUILD_ROLE_RANKS`；
（4）`checkPrerequisiteSocial` 中 `favorLevel` 分支的原始值换算改用 `favorRankOf(f)`：

```ts
        } else {
          rank = favorRankOf(rel.favorability);
        }
```

- [ ] **Step 3: 回归确认无行为变化**

```bash
npm test -- quest
npx tsc --noEmit
```

Expected: quest 相关 suite 全绿（含 `quest-social.spec`），0 error。**本任务是纯搬移，不新增用例**。

- [ ] **Step 4: 提交**

```bash
git add packages-game/game-server/src/constants/ranks.ts packages-game/game-server/src/modules/quest/quest.service.ts
git commit -m "refactor(constants): 档位表抽到 @constants/ranks 供任务与活动复用"
```

---

## Task 2: 任务接取门槛生效（等级 / 前置链 / 接取次数）

**Files:**
- Modify: `packages-game/game-server/src/modules/quest/quest.service.ts`（`acceptQuest`、新增两个私有方法、构造函数）
- Modify: `packages-game/game-server/src/modules/quest/quest.module.ts`
- Test: `packages-game/game-server/src/modules/quest/quest.service.spec.ts`

- [ ] **Step 1: 写失败的测试**

在 `quest.service.spec.ts` 的 `describe('acceptQuest')` 块内追加（并在 providers 中补 `PlayerService` mock）：

providers 追加：

```ts
        {
          provide: PlayerService,
          useValue: {
            getById: jest.fn(),
            addExp: jest.fn().mockResolvedValue({ leveledUp: false }),
          },
        },
```

顶部 import 加：

```ts
import { PlayerService } from '@modules/player/player.service';
```

新增用例：

```ts
    it('等级不足时按库中玩家等级拒绝（不依赖调用方传参）', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ minLevel: 10 }),
      );
      playerService.getById.mockResolvedValue({ id: 'p1', level: 3 } as any);

      await expect(service.acceptQuest('p1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.QUEST_PREREQUISITE_NOT_MET },
      });
      expect(playerQuestRepo.save).not.toHaveBeenCalled();
    });

    it('前置任务未全部完成时拒绝', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ minLevel: 1, prerequisiteIds: [11, 12], acceptLimit: 99 }),
      );
      playerService.getById.mockResolvedValue({ id: 'p1', level: 20 } as any);
      // 只完成 1 个前置
      playerQuestRepo.count.mockResolvedValue(1);

      await expect(service.acceptQuest('p1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.QUEST_PREREQUISITE_NOT_MET },
      });
    });

    it('前置任务全部完成时放行', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ minLevel: 1, prerequisiteIds: [11, 12], acceptLimit: 99 }),
      );
      playerService.getById.mockResolvedValue({ id: 'p1', level: 20 } as any);
      playerQuestRepo.count.mockResolvedValue(2);
      playerQuestRepo.findOne.mockResolvedValue(null);

      const result = await service.acceptQuest('p1', '1');
      expect(result.status).toBe(QuestStatus.IN_PROGRESS);
    });

    it('接取次数达上限时抛 40003', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ minLevel: 1, acceptLimit: 2, repeatable: true }),
      );
      playerService.getById.mockResolvedValue({ id: 'p1', level: 20 } as any);
      playerQuestRepo.count.mockResolvedValue(2);

      await expect(service.acceptQuest('p1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.QUEST_ACCEPT_LIMIT_REACHED },
      });
    });
```

> 前置链用例显式设 `acceptLimit: 99`：`playerQuestRepo.count` 同时被前置链与限次读取，不显式放开会让默认 `acceptLimit=1` 误触发 `40003`，使用例依赖实现顺序。

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- quest.service.spec
```

Expected: FAIL —— `service.acceptQuest` 传参不匹配 / `playerService` 未定义 / 断言未通过。

- [ ] **Step 3: 实现门槛校验**

编辑 `packages-game/game-server/src/modules/quest/quest.service.ts`：

（1）构造函数末尾加：

```ts
    private readonly playerService: PlayerService,
```

（2）import 加：

```ts
import { PlayerService } from '@modules/player/player.service';
import { In } from 'typeorm';
```

（3）`acceptQuest` 改为：

```ts
  async acceptQuest(
    playerId: string,
    questTemplateId: string,
  ): Promise<PlayerQuest> {
    const template = await this.templateRepo.findOne({
      where: { id: questTemplateId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.QUEST_NOT_ACCEPTED, '任务模板不存在');
    }

    const player = await this.playerService.getById(playerId);
    if (!player) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '玩家不存在');
    }
    if (player.level < template.minLevel) {
      throw new GameException(
        ErrorCodes.QUEST_PREREQUISITE_NOT_MET,
        '等级不足',
      );
    }

    await this.assertPrerequisiteQuests(playerId, template);

    if (template.prerequisiteSocial) {
      await this.checkPrerequisiteSocial(playerId, template.prerequisiteSocial);
    }

    await this.assertAcceptLimit(playerId, template);

    const existing = await this.playerQuestRepo.findOne({
      where: { playerId, questTemplateId },
    });
    if (existing && !template.repeatable) {
      throw new GameException(
        ErrorCodes.QUEST_ALREADY_COMPLETED,
        '任务已接取且不可重复',
      );
    }

    const playerQuest = this.playerQuestRepo.create({
      playerId,
      questTemplateId,
      progress: 0,
      status: QuestStatus.IN_PROGRESS,
      acceptedAt: new Date(),
    });
    const saved = await this.playerQuestRepo.save(playerQuest);

    this.eventBus.emit(GameEvents.QUEST_ACCEPTED, {
      playerId,
      questTemplateId,
    });

    return saved;
  }

  /** 前置任务链：prerequisiteIds 必须全部处于已领奖（CLAIMED）状态 */
  private async assertPrerequisiteQuests(
    playerId: string,
    template: QuestTemplate,
  ): Promise<void> {
    const required = template.prerequisiteIds ?? [];
    if (required.length === 0) return;
    const done = await this.playerQuestRepo.count({
      where: {
        playerId,
        questTemplateId: In(required.map(String)),
        status: QuestStatus.CLAIMED,
      },
    });
    if (done < required.length) {
      throw new GameException(
        ErrorCodes.QUEST_PREREQUISITE_NOT_MET,
        '前置任务未完成',
      );
    }
  }

  /** 接取次数上限：acceptLimit <= 0 视为不限 */
  private async assertAcceptLimit(
    playerId: string,
    template: QuestTemplate,
  ): Promise<void> {
    if (!template.acceptLimit || template.acceptLimit <= 0) return;
    const accepted = await this.playerQuestRepo.count({
      where: { playerId, questTemplateId: template.id },
    });
    if (accepted >= template.acceptLimit) {
      throw new GameException(
        ErrorCodes.QUEST_ACCEPT_LIMIT_REACHED,
        '接取次数已达上限',
      );
    }
  }
```

（4）`quest.module.ts` 的 imports 加 `PlayerModule`：

```ts
import { PlayerModule } from '@modules/player/player.module';
// ...
    EconomyModule,
    CharacterModule,
    SocialModule,
    PlayerModule,
```

（5）同步修改 `quest.service.spec.ts` 中 3 处旧调用（删除第三参）：`service.acceptQuest('p1', '1', 5)` → `service.acceptQuest('p1', '1')`，并在这些用例内补 `playerService.getById.mockResolvedValue({ id: 'p1', level: 99 } as any)`。

> `PlayerService.getById(playerId)` 已存在（[player.service.ts:87-89](file:///e:/code/nest/packages-game/game-server/src/modules/player/player.service.ts#L87-L89)），无需另注入仓库。

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -- quest.service.spec
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages-game/game-server/src/modules/quest/quest.service.ts packages-game/game-server/src/modules/quest/quest.module.ts packages-game/game-server/src/modules/quest/quest.service.spec.ts
git commit -m "feat(quest): P0-4 T2 任务接取门槛生效（等级自取/前置链/次数上限）"
```

---

## Task 3: 任务奖励真发（自动发 + 手动领）

**Files:**
- Modify: `packages-game/game-server/src/modules/quest/quest.service.ts`（`submitQuest`、新增 `claimQuestReward` / `deliverReward`）
- Modify: `packages-game/game-server/src/modules/quest/quest.controller.ts`
- Test: `packages-game/game-server/src/modules/quest/quest.service.spec.ts`

- [ ] **Step 1: 写失败的测试**

在 `quest.service.spec.ts` 新增 `describe('任务奖励发放')` 块：

```ts
  describe('任务奖励发放', () => {
    it('autoReward=true 提交即发奖并置 CLAIMED', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ autoReward: true, rewardJson: { gold: 50, exp: 100 } }),
      );
      playerQuestRepo.findOne.mockResolvedValue(
        makePlayerQuest({ progress: 10, status: QuestStatus.IN_PROGRESS }),
      );

      const result = await service.submitQuest('p1', '1');

      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.GOLD,
        50,
        'quest_reward',
        expect.any(String),
        '1',
      );
      expect(playerService.addExp).toHaveBeenCalledWith('p1', 100);
      expect(result.status).toBe(QuestStatus.CLAIMED);
    });

    it('autoReward=false 提交仅置 COMPLETED 不发奖', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ autoReward: false, rewardJson: { gold: 50 } }),
      );
      playerQuestRepo.findOne.mockResolvedValue(
        makePlayerQuest({ progress: 10, status: QuestStatus.IN_PROGRESS }),
      );

      const result = await service.submitQuest('p1', '1');

      expect(economyService.addCurrency).not.toHaveBeenCalled();
      expect(result.status).toBe(QuestStatus.COMPLETED);
    });

    it('claimQuestReward 对 COMPLETED 任务发奖并置 CLAIMED', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ rewardJson: { gold: 50 } }),
      );
      playerQuestRepo.findOne.mockResolvedValue(
        makePlayerQuest({ status: QuestStatus.COMPLETED }),
      );
      playerQuestRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.claimQuestReward('p1', '1');

      expect(playerQuestRepo.update).toHaveBeenCalledWith(
        { id: '1', status: QuestStatus.COMPLETED },
        expect.objectContaining({ status: QuestStatus.CLAIMED }),
      );
      expect(economyService.addCurrency).toHaveBeenCalled();
      expect(result.reward).toEqual({ gold: 50 });
    });

    it('claimQuestReward 重复领取（affected=0）拒绝', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ rewardJson: { gold: 50 } }),
      );
      playerQuestRepo.findOne.mockResolvedValue(
        makePlayerQuest({ status: QuestStatus.COMPLETED }),
      );
      playerQuestRepo.update.mockResolvedValue({ affected: 0 });

      await expect(service.claimQuestReward('p1', '1')).rejects.toThrow(
        GameException,
      );
      expect(economyService.addCurrency).not.toHaveBeenCalled();
    });

    it('未识别的奖励键记 warning 且不影响已识别键发放', async () => {
      questTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ rewardJson: { gold: 50, mysteryItem: 1 } }),
      );
      playerQuestRepo.findOne.mockResolvedValue(
        makePlayerQuest({ status: QuestStatus.COMPLETED }),
      );
      playerQuestRepo.update.mockResolvedValue({ affected: 1 });

      await service.claimQuestReward('p1', '1');

      expect(economyService.addCurrency).toHaveBeenCalledTimes(1);
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- quest.service.spec
```

Expected: FAIL —— `service.claimQuestReward is not a function`；autoReward=false 用例期望 COMPLETED 但实得 CLAIMED。

- [ ] **Step 3: 实现发奖拆分**

编辑 `packages-game/game-server/src/modules/quest/quest.service.ts`：

（1）类顶部加 logger：

```ts
import { Injectable, Logger } from '@nestjs/common';
// ...
  private readonly logger = new Logger(QuestService.name);
```

（2）`submitQuest` 的「进度校验之后」段落改为：

```ts
    if (playerQuest.status !== QuestStatus.IN_PROGRESS) {
      throw new GameException(
        ErrorCodes.QUEST_NOT_ACCEPTED,
        '任务未接取或已领取',
      );
    }

    const template = await this.templateRepo.findOne({
      where: { id: questTemplateId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.QUEST_NOT_ACCEPTED, '任务模板不存在');
    }

    const targetCount = Number(template.targetJson?.count ?? 0);
    if (targetCount > 0 && playerQuest.progress < targetCount) {
      throw new GameException(
        ErrorCodes.QUEST_PREREQUISITE_NOT_MET,
        '任务目标未达成',
      );
    }

    this.eventBus.emit(GameEvents.QUEST_COMPLETED, {
      playerId,
      questTemplateId,
      reward: template.rewardJson,
    });

    const socialReward: Record<string, any> = {};
    if (template.rewardSocial?.currencyType) {
      const currencyType = template.rewardSocial.currencyType as CurrencyType;
      if (!QuestService.SOCIAL_CURRENCIES.includes(currencyType)) {
        throw new GameException(ErrorCodes.PARAM_INVALID, '社交奖励货币类型不合法');
      }
      const { balanceAfter } = await this.economyService.addCurrency(
        playerId,
        currencyType,
        template.rewardSocial.amount,
        'quest_reward',
        'quest.submitQuest',
      );
      socialReward[currencyType] = {
        amount: template.rewardSocial.amount,
        balanceAfter,
      };
    }

    // autoReward=true：提交即发主奖励并直接置 CLAIMED；否则置 COMPLETED 待手动领取
    if (template.autoReward) {
      playerQuest.status = QuestStatus.CLAIMED;
      playerQuest.completedAt = new Date();
      playerQuest.completeTimes += 1;
      await this.playerQuestRepo.save(playerQuest);
      await this.deliverReward(playerId, template, playerQuest);
    } else {
      playerQuest.status = QuestStatus.COMPLETED;
      playerQuest.completedAt = new Date();
      await this.playerQuestRepo.save(playerQuest);
    }

    return {
      questId: playerQuest.id,
      reward: template.rewardJson,
      socialReward,
      status: playerQuest.status,
    };
  }

  /** 手动领取（autoReward=false 的任务）：状态原子占位防并发重复领取 */
  async claimQuestReward(
    playerId: string,
    questTemplateId: string,
  ): Promise<SubmitQuestResult> {
    const playerQuest = await this.playerQuestRepo.findOne({
      where: { playerId, questTemplateId },
    });
    if (!playerQuest || playerQuest.status !== QuestStatus.COMPLETED) {
      throw new GameException(
        ErrorCodes.QUEST_NOT_ACCEPTED,
        '任务未完成或已领奖',
      );
    }

    const template = await this.templateRepo.findOne({
      where: { id: questTemplateId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.QUEST_NOT_ACCEPTED, '任务模板不存在');
    }

    const claimed = await this.playerQuestRepo.update(
      { id: playerQuest.id, status: QuestStatus.COMPLETED },
      {
        status: QuestStatus.CLAIMED,
        completeTimes: playerQuest.completeTimes + 1,
      },
    );
    if (!claimed.affected) {
      throw new GameException(
        ErrorCodes.QUEST_ALREADY_COMPLETED,
        '奖励已领取',
      );
    }

    try {
      await this.deliverReward(playerId, template, {
        ...playerQuest,
        completeTimes: playerQuest.completeTimes + 1,
      } as PlayerQuest);
    } catch (err) {
      await this.playerQuestRepo.update(
        { id: playerQuest.id },
        { status: QuestStatus.COMPLETED },
      );
      throw err;
    }

    return {
      questId: playerQuest.id,
      reward: template.rewardJson,
      socialReward: {},
      status: QuestStatus.CLAIMED,
    };
  }

  /**
   * 发放任务主奖励。rewardJson 采用扁平键约定：命中 CurrencyType 走经济模块，
   * exp 走玩家经验，未识别键记 warning，避免配置静默失效。
   */
  private async deliverReward(
    playerId: string,
    template: QuestTemplate,
    playerQuest: PlayerQuest,
  ): Promise<void> {
    const reward = template.rewardJson ?? {};
    const supported = Object.values(CurrencyType) as string[];
    const idempotencyKey = `quest_reward:${playerId}:${template.id}:${playerQuest.completeTimes}`;

    for (const [key, raw] of Object.entries(reward)) {
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      if (key === 'exp') {
        await this.playerService.addExp(playerId, amount);
        continue;
      }
      if (supported.includes(key)) {
        await this.economyService.addCurrency(
          playerId,
          key as CurrencyType,
          amount,
          'quest_reward',
          idempotencyKey,
          template.id,
        );
        continue;
      }
      this.logger.warn(
        `Unsupported quest reward key: ${key} (quest=${template.id})`,
      );
    }
  }
```

> `SubmitQuestResult.status` 已是 `QuestStatus`（[quest.service.ts:28-33](file:///e:/code/nest/packages-game/game-server/src/modules/quest/quest.service.ts#L28-L33)），无需调整类型定义。

（3）`quest.controller.ts` 在 `submitQuest` 路由之后新增：

```ts
  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/quest/claim')
  @ApiOperation({ summary: '领取任务奖励（auto_reward=false 的任务）' })
  async claimQuestReward(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: AcceptQuestDto,
  ) {
    return this.questService.claimQuestReward(
      player.playerId,
      dto.questTemplateId,
    );
  }
```

（4）`quest.service.spec.ts` 中 providers 补 `playerService` mock（若 Task 2 已加则复用），并确认原 `submitQuest` 用例仍通过（其 template 为 `autoReward: true`，期望 `CLAIMED` + `completeTimes: 1` 仍成立）。

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -- quest
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages-game/game-server/src/modules/quest/quest.service.ts packages-game/game-server/src/modules/quest/quest.controller.ts packages-game/game-server/src/modules/quest/quest.service.spec.ts
git commit -m "feat(quest): P0-4 T3 任务主奖励真发（auto_reward 自动发 + 手动领取）"
```

---

## Task 4: 活动参与条件生效（conditionJson）

**Files:**
- Modify: `packages-game/game-server/src/constants/error-codes.ts`
- Modify: `packages-game/game-server/src/modules/activity/activity.service.ts`
- Modify: `packages-game/game-server/src/modules/activity/activity.module.ts`
- Test: `packages-game/game-server/src/modules/activity/activity.service.spec.ts`

- [ ] **Step 1: 写失败的测试**

在 `activity.service.spec.ts` 的 providers 补：

```ts
        {
          provide: CharacterService,
          useValue: { getRelationships: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: SocialService,
          useValue: { getMyGuildRole: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: getRepositoryToken(PlayerQuest),
          useValue: { count: jest.fn().mockResolvedValue(0) },
        },
```

import 加：

```ts
import { CharacterService } from '@modules/character/character.service';
import { SocialService } from '@modules/social/social.service';
import { PlayerQuest } from '@modules/quest/entities';
import { QuestStatus, RelationshipLevel, GuildRole } from '@constants/enums';
```

新增用例：

```ts
  describe('参与条件（condition_json）', () => {
    it('等级不足拒绝报名', async () => {
      templateRepo.findOne.mockResolvedValue(
        makeTemplate({ conditionJson: { level: 10 } }),
      );
      playerRepo.findOne.mockResolvedValue({ id: 'p1', level: 3 } as any);

      await expect(service.joinActivity('p1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.ACTIVITY_CONDITION_NOT_MET },
      });
    });

    it('前置任务未全部完成拒绝报名', async () => {
      templateRepo.findOne.mockResolvedValue(
        makeTemplate({ conditionJson: { questIds: [11, 12] } }),
      );
      playerRepo.findOne.mockResolvedValue({ id: 'p1', level: 99 } as any);
      playerQuestRepo.count.mockResolvedValue(1);

      await expect(service.joinActivity('p1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.ACTIVITY_CONDITION_NOT_MET },
      });
      expect(playerQuestRepo.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: QuestStatus.CLAIMED }),
        }),
      );
    });

    it('好感档位不足拒绝报名', async () => {
      templateRepo.findOne.mockResolvedValue(
        makeTemplate({
          conditionJson: { favorLevel: RelationshipLevel.CONFIDANT },
        }),
      );
      playerRepo.findOne.mockResolvedValue({ id: 'p1', level: 99 } as any);
      characterService.getRelationships.mockResolvedValue([
        { level: RelationshipLevel.ACQUAINTANCE, favorability: 100 },
      ] as any);

      await expect(service.joinActivity('p1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.ACTIVITY_CONDITION_NOT_MET },
      });
    });

    it('帮派职位不足拒绝报名', async () => {
      templateRepo.findOne.mockResolvedValue(
        makeTemplate({ conditionJson: { guildRole: GuildRole.HALL_MASTER } }),
      );
      playerRepo.findOne.mockResolvedValue({ id: 'p1', level: 99 } as any);
      socialService.getMyGuildRole.mockResolvedValue({
        role: GuildRole.MEMBER,
      } as any);

      await expect(service.joinActivity('p1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.ACTIVITY_CONDITION_NOT_MET },
      });
    });

    it('空 condition_json 不限制', async () => {
      templateRepo.findOne.mockResolvedValue(
        makeTemplate({ conditionJson: {} }),
      );
      playerRepo.findOne.mockResolvedValue({ id: 'p1', level: 1 } as any);
      playerActivityRepo.findOne.mockResolvedValue(null);

      const result = await service.joinActivity('p1', '1');
      expect(result.progress).toBe(0);
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- activity.service.spec
```

Expected: FAIL —— 4 个拒绝用例未抛错（条件未读取）。

- [ ] **Step 3: 实现条件校验**

（1）`error-codes.ts` 活动段（`ACTIVITY_REWARD_CLAIMED: 60004,` 之后）加：

```ts
  ACTIVITY_CONDITION_NOT_MET: 60005,
  ACTIVITY_FULL: 60006,
```

（2）`activity.service.ts` import 加：

```ts
import { CharacterService } from '@modules/character/character.service';
import { SocialService } from '@modules/social/social.service';
import { PlayerQuest } from '@modules/quest/entities';
import { QuestStatus, RelationshipLevel } from '@constants/enums';
import { FAVOR_RANKS, GUILD_ROLE_RANKS, favorRankOf } from '@constants/ranks';
```

（3）构造函数加 3 个依赖：

```ts
    @InjectRepository(PlayerQuest)
    private readonly playerQuestRepo: Repository<PlayerQuest>,
    private readonly characterService: CharacterService,
    private readonly socialService: SocialService,
```

（4）新增私有方法并在 `joinActivity` / `signIn` 的 `assertPlayable` 之后调用：

```ts
  /** 参与条件（condition_json）：level / questIds / favorLevel / guildRole，缺失即不限制 */
  private async assertConditions(
    template: ActivityTemplate,
    playerId: string,
  ): Promise<void> {
    const cond = template.conditionJson ?? {};

    if (cond.level !== undefined) {
      const player = await this.playerRepo.findOne({ where: { id: playerId } });
      if (!player) {
        throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '玩家不存在');
      }
      if (player.level < Number(cond.level)) {
        throw new GameException(
          ErrorCodes.ACTIVITY_CONDITION_NOT_MET,
          '等级不足，无法参与',
        );
      }
    }

    if (Array.isArray(cond.questIds) && cond.questIds.length > 0) {
      const done = await this.playerQuestRepo.count({
        where: {
          playerId,
          questTemplateId: In(cond.questIds.map(String)),
          status: QuestStatus.CLAIMED,
        },
      });
      if (done < cond.questIds.length) {
        throw new GameException(
          ErrorCodes.ACTIVITY_CONDITION_NOT_MET,
          '前置任务未完成',
        );
      }
    }

    if (cond.favorLevel !== undefined) {
      const relationships = await this.characterService.getRelationships(playerId);
      const required = FAVOR_RANKS[cond.favorLevel] ?? 0;
      const maxRank = relationships.reduce((max, rel) => {
        const rank = rel.level
          ? FAVOR_RANKS[rel.level] ?? 0
          : favorRankOf(rel.favorability);
        return Math.max(max, rank);
      }, 0);
      if (maxRank < required) {
        throw new GameException(
          ErrorCodes.ACTIVITY_CONDITION_NOT_MET,
          '好感档位不足',
        );
      }
    }

    if (cond.guildRole !== undefined) {
      const myRole = await this.socialService.getMyGuildRole(playerId);
      const required = GUILD_ROLE_RANKS[cond.guildRole] ?? 0;
      const rank = myRole ? GUILD_ROLE_RANKS[myRole.role] ?? 0 : 0;
      if (rank < required) {
        throw new GameException(
          ErrorCodes.ACTIVITY_CONDITION_NOT_MET,
          '帮派职位不足',
        );
      }
    }
  }
```

（5）`activity.module.ts`：

```ts
import { PlayerQuest } from '@modules/quest/entities';
import { CharacterModule } from '@modules/character/character.module';
import { SocialModule } from '@modules/social/social.module';
// ...
    TypeOrmModule.forFeature([
      ActivityTemplate,
      PlayerActivity,
      SignInRecord,
      Player,
      PlayerBehaviorLog,
      PlayerQuest,
    ]),
    AdminModule,
    CharacterModule,
    SocialModule,
```

> `CharacterModule` / `SocialModule` 均已导出对应 service（`QuestModule` 已在用同一组合），且二者都不 import `ActivityModule`（已确认全库无引用），无循环依赖。

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -- activity
npx tsc --noEmit
```

Expected: PASS，0 error。

- [ ] **Step 5: 提交**

```bash
git add packages-game/game-server/src/constants/error-codes.ts packages-game/game-server/src/modules/activity/
git commit -m "feat(activity): P0-4 T4 活动参与条件生效（等级/前置任务/好感/帮派）"
```

---

## Task 5: 活动人数上限生效（maxParticipants）

**Files:**
- Modify: `packages-game/game-server/src/modules/activity/activity.service.ts`
- Test: `packages-game/game-server/src/modules/activity/activity.service.spec.ts`

- [ ] **Step 1: 写失败的测试**

```ts
    it('报名人数达上限拒绝（max_participants > 0）', async () => {
      templateRepo.findOne.mockResolvedValue(
        makeTemplate({ maxParticipants: 2 }),
      );
      playerRepo.findOne.mockResolvedValue({ id: 'p1', level: 99 } as any);
      playerActivityRepo.count.mockResolvedValue(2);

      await expect(service.joinActivity('p1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.ACTIVITY_FULL },
      });
      expect(playerActivityRepo.save).not.toHaveBeenCalled();
    });

    it('max_participants=0 视为不限人数', async () => {
      templateRepo.findOne.mockResolvedValue(
        makeTemplate({ maxParticipants: 0 }),
      );
      playerRepo.findOne.mockResolvedValue({ id: 'p1', level: 99 } as any);
      playerActivityRepo.findOne.mockResolvedValue(null);

      const result = await service.joinActivity('p1', '1');
      expect(result.progress).toBe(0);
      expect(playerActivityRepo.count).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- activity.service.spec
```

Expected: FAIL —— 上限用例未抛错。

- [ ] **Step 3: 实现上限校验**

在 `joinActivity` 中，「已参加」校验之后、`create` 之前插入：

```ts
    if (template.maxParticipants > 0) {
      const joined = await this.playerActivityRepo.count({
        where: { activityId },
      });
      if (joined >= template.maxParticipants) {
        throw new GameException(
          ErrorCodes.ACTIVITY_FULL,
          '活动参与人数已满',
        );
      }
    }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -- activity
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages-game/game-server/src/modules/activity/
git commit -m "feat(activity): P0-4 T5 活动人数上限生效（max_participants）"
```

---

## Task 6: 公告时间窗生效（start_at / end_at）

**Files:**
- Modify: `packages-game/game-server/src/modules/notice/dto/create-notice.dto.ts`
- Modify: `packages-game/game-server/src/modules/notice/notice.service.ts`
- Test: `packages-game/game-server/src/modules/notice/notice.service.spec.ts`

- [ ] **Step 1: 写失败的测试**

```ts
  it('getActiveNotices 按四个时间窗分支过滤且都要求 isActive', async () => {
    noticeRepo.find.mockResolvedValue([]);

    await service.getActiveNotices();

    const where = noticeRepo.find.mock.calls[0][0].where as any[];
    expect(Array.isArray(where)).toBe(true);
    expect(where).toHaveLength(4);
    expect(where.every((w) => w.isActive === true)).toBe(true);
    expect(where.every((w) => 'startAt' in w && 'endAt' in w)).toBe(true);
  });

  it('getNoticesByType 同样应用时间窗与类型过滤', async () => {
    noticeRepo.find.mockResolvedValue([]);

    await service.getNoticesByType(NoticeType.LOGIN);

    const where = noticeRepo.find.mock.calls[0][0].where as any[];
    expect(where).toHaveLength(4);
    expect(where.every((w) => w.noticeType === NoticeType.LOGIN)).toBe(true);
    expect(where.every((w) => w.isActive === true)).toBe(true);
    expect(where.every((w) => 'startAt' in w && 'endAt' in w)).toBe(true);
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- notice.service.spec
```

Expected: FAIL —— `where` 中无 `startAt` / `endAt`。

- [ ] **Step 3: 实现时间窗**

（1）`create-notice.dto.ts` 加字段与 import：

```ts
import { IsString, IsEnum, IsBoolean, IsInt, IsOptional, IsDate, Min, MinLength, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
// ...
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  startAt?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  endAt?: Date;
```

（2）`notice.service.ts` 加私有 helper 并在两个查询方法使用：

```ts
import { LessThanOrEqual, MoreThanOrEqual, IsNull, FindOptionsWhere } from 'typeorm';
// ...
  /** 时间窗：未配 start_at 视为立即生效，未配 end_at 视为永久 */
  private timeWindow(): FindOptionsWhere<Notice>[] {
    const now = new Date();
    return [
      { startAt: IsNull(), endAt: IsNull() },
      { startAt: IsNull(), endAt: MoreThanOrEqual(now) },
      { startAt: LessThanOrEqual(now), endAt: IsNull() },
      { startAt: LessThanOrEqual(now), endAt: MoreThanOrEqual(now) },
    ];
  }

  async getActiveNotices(): Promise<Notice[]> {
    const base = this.timeWindow();
    return this.noticeRepo.find({
      where: base.map((w) => ({ ...w, isActive: true })),
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
  }

  async getNoticesByType(type: NoticeType): Promise<Notice[]> {
    const base = this.timeWindow();
    return this.noticeRepo.find({
      where: base.map((w) => ({ ...w, noticeType: type, isActive: true })),
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
  }
```

> `where` 由对象改为「四个时间窗分支」数组是本次实现的核心，断言即按此形态编写；`getLoginNotices` 委托 `getNoticesByType` 自动继承时间窗，无需单独改。

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -- notice
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages-game/game-server/src/modules/notice/
git commit -m "feat(notice): P0-4 T6 公告时间窗生效（start_at/end_at DTO + 查询过滤）"
```

---

## Task 7: 全量回归与文档同步

- [x] **Step 1: 全量测试与编译**

```bash
npm test
npx tsc --noEmit
```

Expected: 全部 suite 绿（预期 ≥ 80 suites / ≥ 950 tests），0 error。

- [x] **Step 2: 同步盘点报告**

编辑 `docs/superpowers/specs/2026-09-20-game-server-completeness-inventory-design.md`：

（1）P0 表中 `P0-4` 行的「项」列追加「（已修复）」；
（2）P0 表下方新增「修复进度（2026-09-21，第三批）」段落：P0-4 已修复（代码层，未部署），计划文件名、提交列表、测试账目；
（3）§7 风险条目 1 的已修复计数更新为 6/8。

```bash
git add docs/superpowers/specs/2026-09-20-game-server-completeness-inventory-design.md
git commit -m "docs: P0-4 完成后同步盘点报告进度"
```

- [x] **Step 3: 冒烟脚本（随部署批次执行，本批只落脚本）**

创建 `scripts/smoke-p0d-config.sh`，覆盖：
- 任务：配 `prerequisite_ids` 的任务在未完成前置时 `accept` 返回 `40001`；`accept_limit=1` 的任务二次接取返回 `40003`；`auto_reward=false` 的任务 `submit` 返回 `completed`，`claim` 后余额增加
- 活动：配 `condition_json.level` 的活动对低等级号返回 `60005`；`max_participants=1` 的活动第二个号报名返回 `60006`
- 公告：配 `start_at` 为未来的公告不出现在 `api/client/v1/notice/list`

```bash
git add packages-game/game-server/scripts/smoke-p0d-config.sh
git commit -m "chore(quest): P0-4 配置字段生效冒烟脚本"
```

---

## 完成验收

1. `npm test` 全绿；`npx tsc --noEmit` 0 error。
2. 任务：低等级玩家 `accept` 被拒（无需前端传等级）；`prerequisite_ids` 未完成被拒；`accept_limit` 达上限返回 `40003`。
3. 任务：`auto_reward=true` 的任务 `submit` 后金币/经验真实到账且状态 `claimed`；`auto_reward=false` 的任务 `submit` 后状态 `completed`、奖励未发，`claim` 后到账且状态 `claimed`，重复 `claim` 被拒。
4. 活动：`condition_json` 四项门槛（等级/前置任务/好感/帮派）任一不满足即 `60005`；`max_participants` 满员返回 `60006`；`condition_json={}` 与 `max_participants=0` 时行为与改动前一致。
5. 公告：未到 `start_at` 或已过 `end_at` 的公告不出现在 C 端列表；两者为 null 的公告行为不变。

## 风险与回滚

| 风险 | 影响 | 处置 |
|---|---|---|
| 存量任务模板 `acceptLimit` 默认 1 | 可重复任务若未显式配大 `acceptLimit`，第二次接取被 `40003` 拦截 | 上线前用 `SELECT id,name,repeatable,accept_limit FROM quest_templates WHERE repeatable = true AND accept_limit <= 1;` 排查并调整；也可临时把 `acceptLimit<=0` 视为不限 |
| 存量任务模板 `prerequisiteIds` 已配但历史数据不满足 | 玩家接取被拒 | 前置链语义为「全部 CLAIMED」，若运营原意是「任一完成」需调整配置；上线前 `SELECT id,name,prerequisite_ids FROM quest_templates WHERE prerequisite_ids <> '{}';` 核对 |
| `autoReward` 默认 false | 存量任务由「提交即得」变为「需再点领取」 | 前端需支持 `claim` 接口；过渡期可把存量模板批量置 `auto_reward = true` 保持旧体验 |
| 任务主奖励开始真发 | 金币/经验存量增长 | 首次发放前核对 `reward_json` 配置量级；`quest_reward` 幂等键可防重复，但无法回收已发，必要时走风控回收（P0-7 已具备） |
| `condition_json` 中 `questIds` 引用不存在的任务 id | 该活动永远无法参与 | `assertConditions` 对未完成的引用一律拒绝，属预期；上线前核对 `questIds` |
| 公告 `where` 由对象改数组 | 若有其他调用方断言 `where` 形态会失败 | 仅 `notice.service.ts` 内部使用，spec 断言同步调整 |
| `acceptQuest` 删除 `playerLevel` 入参 | 外部若依赖传参编译失败 | 全库仅 `quest.controller.ts` 调用且从未传参，无外部影响 |

## 不在本次范围

- 道具类任务奖励发放（需背包服务，归 P0-7 交易经济批次）
- 「组队人数」活动门槛（需组队上下文）
- GM 后台面板可视化（P0-8）
- 任务奖励的邮件/离线补发
- 其余 P0：P0-7 交易经济、P0-8 GM 后台面板

## 执行记录（2026-09-21）

| Task | 提交 | 文件 | 说明 |
|---|---|---|---|
| 1 | `68aa9a99a` | 2 files, +52 −41 | 档位表抽到 `@constants/ranks`（纯搬移） |
| 2 | `b1ea91cca` | 3 files, +135 −18 | 等级改查库、前置链、接取限次；`acceptQuest` 删 `playerLevel` 入参 |
| 3 | `24caabbee` | 3 files, +211 −11 | 主奖励真发 + `POST api/client/v1/quest/claim` |
| 4 | `c806e0fbd` | 4 files, +212 −2 | 活动 `conditionJson`（level/questIds/favorLevel/guildRole）+ 新增错误码 60005/60006 |
| 5 | `63dd84d13` | 2 files, +37 | 活动人数上限 count 校验 |
| — | `cd9b781bb` | 2 files, +44 −3 | 好感门槛 id 语义修复（见下）+ 3 例单测 |
| 6 | `4b706724a` | 3 files, +62 −3 | 公告时间窗 DTO + 查询过滤（四分支 where） |
| 7 | 见提交 | — | 冒烟脚本 `scripts/smoke-p0d-config.sh` + 盘点报告同步 |

**测试账目**：全量 `npm test` = **80 suites / 959 tests 全绿**；`npx tsc --noEmit` exit 0。

**执行偏离（3 项）**

1. **`targetJson` 取数保留原表达式**：计划写 `targetJson?.count`，实现保留 `targetJson?.kill_count ?? targetJson?.count ?? 0`——后者是既有正确逻辑，改回会丢 `kill_count` 任务的目标判定。
2. **`acceptQuest` 旧调用点实为 15 处**（计划记 3 处）：`quest.service.spec.ts` 改为在 `beforeEach` 设 `playerService.getById` 默认返回 `level: 99`，仅「等级不足」2 例覆写为低等级。
3. **好感门槛 id 语义 bug（核对时发现并修复）**：`character_relationships` 按 `character_id` 存储（`character.service.ts:437`），计划中的 `getRelationships(playerId)` 会查空 → `maxRank=0` → 配了 `favorLevel` 的活动恒拒绝所有玩家。修复为 `characterService.getByPlayerId(playerId)` 换算角色 id，无角色时按空关系处理。

**未完成 / 待办**

- 生产部署（用户选择「先做代码，部署后议」）：需先跑存量配置排查 SQL，再替换 dist 重启。
- 冒烟脚本 `scripts/smoke-p0d-config.sh` 未执行。
- 同源缺陷已追加修复：`QuestService.checkPrerequisiteSocial` 的好感分支（`quest.service.ts:177-186`）原把 `playerId` 传给按 `characterId` 查的 `getRelationships`，已改为 `getByPlayerId` 换算 + 无角色按空关系处理，并补 1 例单测（无角色 → `40001`/`QUEST_SOCIAL_PRE_REQ`）。
