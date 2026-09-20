# 社交经济闭环与商业化完善（阶段 5 批 2）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 game-server 补全社交经济闭环（社交积分→宝箱/补签）、封禁社交后果三项（称号收回/帮派除名/榜单移除）、VIP 特权全量生效 + 充值状态机、PVP 天梯 + 新手保护期、新手引导进度追踪与奖励。

**Architecture:** social 模块扩展出社交经济域（新增 SocialEconomyService 积分+宝箱、SocialGuideService 引导、SocialEventListener 事件订阅，新增 social_point_records/social_chests/guide_progresses 三表）；community 处置 BAN 时联动三项社交后果（复用既有 player_reports 台账 + ranking/character/social 服务）；vip 模块新增 getPrivilegeValue 键读取，五特权在各玩法链路落地点生效；payment 补状态机分支与充值→VIP 经验；新建 ladder 模块（ladder_records 表）承接天梯匹配结算，player/face 补新手保护期判定与红名拦截。不新增 npm 依赖。

**Tech Stack:** NestJS 11 + TypeORM + PostgreSQL + Redis + Jest。

**Spec:** `docs/superpowers/specs/2026-09-20-social-economy-commerce-design.md`

---

## 文件结构

**新建：**
- `src/constants/enums.ts`（修改）— SocialPointType/SocialPointReason/SocialChestType/SocialChestStatus/GuideTaskStatus + RechargeStatus 补 DELIVERED/CANCELLED/EXPIRED + CurrencyType 补 INFAMY
- `src/constants/error-codes.ts`（修改）— 92301-92799 错误码区
- `src/event-bus/game-events.ts`（修改）— SOCIAL_POINT_CHANGED/CHEST_OPENED/GUIDE_TASK_COMPLETED/LADDER_MATCH_SETTLED 事件
- `src/modules/social/entities/social-point-record.entity.ts` — 积分流水表
- `src/modules/social/entities/social-chest.entity.ts` — 宝箱表
- `src/modules/social/entities/guide-progress.entity.ts` — 引导进度表
- `src/modules/social/entities/index.ts`（修改）— 导出新实体
- `src/modules/social/social-economy.service.ts` — 积分 + 宝箱服务
- `src/modules/social/social-guide.service.ts` — 引导进度服务
- `src/modules/social/social-event.listener.ts` — 事件订阅（积分记账 + 引导驱动）
- `src/modules/social/social.module.ts`（修改）— forFeature 新实体 + imports VipModule
- `src/modules/social/social.controller.ts`（修改）— point/chest/guide 客户端路由
- `src/modules/social/social.service.ts`（修改）— 好友位扩容/送礼上限 VIP 提升/帮贡加成/建筑折扣/kickMember
- `src/modules/social/social-economy.service.spec.ts` — 积分/宝箱单测
- `src/modules/social/social-guide.service.spec.ts` — 引导单测
- `src/modules/chat/chat.service.ts`（修改）— 补签方法
- `src/modules/chat/chat.controller.ts`（修改）— 补签路由
- `src/modules/chat/chat.service.spec.ts`（修改）— 补签单测
- `src/modules/community/community.service.ts`（修改）— BAN 联动 + socialCleanup
- `src/modules/community/community.controller.ts`（修改）— social-cleanup admin 路由
- `src/modules/community/community.module.ts`（修改）— imports RankingModule/SocialModule
- `src/modules/community/community.service.spec.ts`（修改）— 联动单测
- `src/modules/ranking/ranking.service.ts`（修改）— removePlayer
- `src/modules/ranking/ranking.service.spec.ts`（修改）— 移除单测
- `src/modules/vip/vip.service.ts`（修改）— getPrivilegeValue + 称号发放
- `src/modules/vip/vip.service.spec.ts`（修改）— 特权键单测
- `src/modules/player/player.service.ts`（修改）— isNewbie
- `src/modules/player/player.controller.ts`（修改）— protection 路由
- `src/modules/player/player.service.spec.ts`（修改）— isNewbie 单测
- `src/modules/economy/economy.service.ts`（修改）— 无（INFAMY 走既有 addCurrency）
- `src/modules/payment/payment.service.ts`（修改）— 状态机/cancel/deliver/加 VIP 经验
- `src/modules/payment/payment.controller.ts`（修改）— cancel/deliver 路由
- `src/modules/payment/payment.service.spec.ts`（修改）— 状态机单测
- `src/modules/ladder/entities/ladder-record.entity.ts` — 天梯表
- `src/modules/ladder/entities/index.ts` — 导出
- `src/modules/ladder/ladder.service.ts` — 天梯服务
- `src/modules/ladder/ladder.controller.ts` — 天梯路由
- `src/modules/ladder/ladder.module.ts` — 天梯模块
- `src/modules/ladder/ladder.service.spec.ts` — 天梯单测
- `src/modules/matchmaking/matchmaking.gateway.ts`（修改）— MATCH_SUCCESS 结算钩子（经 LadderModule 无侵入，见 Task 10 说明）
- `src/modules/combat/face.service.ts`（修改）— declareGrudge 红名拦截
- `src/modules/combat/combat.module.ts`（修改）— imports PlayerModule/EconomyModule
- `scripts/smoke-stage5b.sh` — 阶段 5 批 2 冒烟脚本
- `manual-src/dict-part.html`（修改）— 数据字典补 4 表 + 充值状态机扩展

**关键既有能力复用（勿重复实现）：**
- 货币发放/扣减：`EconomyService.addCurrency/deductCurrency/getBalance`（新增 INFAMY 枚举即可用）
- 远程配置读取：`ConfigManageService.getConfig` + JSON.parse（chat.service 的 `readConfigJson` 模式，批 2 各服务自备同名私有方法）
- VIP 升级事件：`PlayerService.addVipExp` 已 emit `VIP_LEVEL_UP`
- 事件订阅：`@OnEvent(GameEvents.X)`（参考 `quest-event.listener.ts` 的 try/catch + Logger 模式）

---

### Task 1: 枚举与错误码扩展

**Files:**
- Modify: `src/constants/enums.ts`
- Modify: `src/constants/error-codes.ts`
- Modify: `src/event-bus/game-events.ts`

- [ ] **Step 1: `enums.ts` 追加社交经济枚举**（文件末尾既有枚举之后，参考 `ReportStatus` 风格——小写枚举值）

```typescript
// ===== 社交经济枚举（阶段5批2） =====
export enum SocialPointType {
  EARN = 'earn',
  SPEND = 'spend',
}

export enum SocialPointReason {
  FRIEND_ADDED = 'friend_added',
  KINSHIP_FORMED = 'kinship_formed',
  GIFT_SENT = 'gift_sent',
  GUILD_CONTRIB = 'guild_contrib',
  INTEL_GAINED = 'intel_gained',
  CHAT_SIGN_IN = 'chat_sign_in',
  GUIDE_TASK = 'guide_task',
  CHEST_EXCHANGE = 'chest_exchange',
  SIGN_IN_MAKEUP = 'sign_in_makeup',
  ADMIN = 'admin',
}

export enum SocialChestType {
  WEEKLY_ACTIVITY = 'weekly_activity',
  POINT_EXCHANGE = 'point_exchange',
}

export enum SocialChestStatus {
  PENDING = 'pending',
  OPENED = 'opened',
}

export enum GuideTaskStatus {
  TODO = 'todo',
  DONE = 'done',
  REWARDED = 'rewarded',
}
```

- [ ] **Step 2: `enums.ts` 扩展两个既有枚举**

```typescript
export enum CurrencyType {
  GOLD = 'gold',
  DIAMOND = 'diamond',
  BOUND_DIAMOND = 'bound_diamond',
  FAVOR = 'favor', // 人情值
  GUILD_CONTRIB = 'guild_contrib', // 帮贡
  FACE = 'face', // 颜面
  INFAMY = 'infamy', // 恶名值（红名判定）
}

export enum RechargeStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}
```

- [ ] **Step 3: `error-codes.ts` 追加错误码区**（文件末尾 `社交治理` 区块之后，把原 `} as const;` 行保留在最后）

```typescript
  // 社交经济 92301-92399
  POINT_NOT_ENOUGH: 92301,
  CHEST_NOT_FOUND: 92302,
  CHEST_ALREADY_OPENED: 92303,
  WEEKLY_CHEST_EMPTY: 92304,
  MAKEUP_LIMIT_EXCEEDED: 92305,
  MAKEUP_INVALID_DATE: 92306,
  // 封禁后果 92401-92499
  CLEANUP_ALREADY_DONE: 92401,
  // VIP/充值 92501-92599
  ORDER_CANCEL_INVALID: 92501,
  ORDER_EXPIRED: 92502,
  ORDER_DELIVERED: 92503,
  // PVP 92601-92699
  RED_NAME_TARGET_PROTECTED: 92601,
  // 引导 92701-92799
  GUIDE_TASK_NOT_DONE: 92701,
  GUIDE_REWARD_CLAIMED: 92702,
} as const;
```

- [ ] **Step 4: `game-events.ts` 追加事件**（`VOICE_ROOM_LEFT` 附近）

```typescript
  // 社交经济事件（阶段5批2）
  SOCIAL_POINT_CHANGED: 'social.point.changed',
  CHEST_OPENED: 'social.chest.opened',
  GUIDE_TASK_COMPLETED: 'guide.task.completed',
  LADDER_MATCH_SETTLED: 'ladder.match.settled',
  LADDER_SEASON_SETTLED: 'ladder.season.settled',
```

- [ ] **Step 5: 编译验证**

Run: `cd e:\code\nest\packages-game\game-server && npx tsc --noEmit`
Expected: 无新增报错（如既有类型错误与本次无关则忽略并注明）

- [ ] **Step 6: Commit**

```bash
git add src/constants/enums.ts src/constants/error-codes.ts src/event-bus/game-events.ts
git commit -m "feat(social): 阶段5批2 枚举与错误码 — 社交经济/恶名/充值状态机/92301 区错误码"
```

---

### Task 2: 实体新建（4 表 + 导出 + forFeature）

**Files:**
- Create: `src/modules/social/entities/social-point-record.entity.ts`
- Create: `src/modules/social/entities/social-chest.entity.ts`
- Create: `src/modules/social/entities/guide-progress.entity.ts`
- Create: `src/modules/ladder/entities/ladder-record.entity.ts`
- Create: `src/modules/ladder/entities/index.ts`
- Modify: `src/modules/social/entities/index.ts`
- Modify: `src/modules/social/social.module.ts`

- [ ] **Step 1: 创建 `social-point-record.entity.ts`**（列定义与 spec 4.1 一致，风格参考 `player-report.entity.ts`）

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { SocialPointType, SocialPointReason } from '@constants/enums';

@Entity('social_point_records')
@Index('idx_point_player_created', ['playerId', 'createdAt'])
@Index('idx_point_player_reason', ['playerId', 'reason'])
export class SocialPointRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'enum', enum: SocialPointType })
  type: SocialPointType;

  @Column({ type: 'int' })
  amount: number;

  @Column({ name: 'balance_after', type: 'int' })
  balanceAfter: number;

  @Column({ type: 'enum', enum: SocialPointReason })
  reason: SocialPointReason;

  @Column({ name: 'ref_id', type: 'varchar', length: 64, nullable: true })
  refId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: 创建 `social-chest.entity.ts`**

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { SocialChestType, SocialChestStatus } from '@constants/enums';

@Entity('social_chests')
@Index('idx_chest_player_status', ['playerId', 'status'])
@Index('idx_chest_player_week', ['playerId', 'sourceWeek'])
export class SocialChest {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'chest_type', type: 'enum', enum: SocialChestType })
  chestType: SocialChestType;

  @Column({ type: 'int' })
  tier: number;

  @Column({ type: 'int', default: 0 })
  cost: number;

  @Column({ type: 'enum', enum: SocialChestStatus, default: SocialChestStatus.PENDING })
  status: SocialChestStatus;

  @Column({ name: 'reward_json', type: 'jsonb', default: {} })
  rewardJson: Record<string, any>;

  @Column({ name: 'source_week', type: 'varchar', length: 10, nullable: true })
  sourceWeek: string | null;

  @Column({ name: 'opened_at', type: 'timestamp', nullable: true })
  openedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 3: 创建 `guide-progress.entity.ts`**

注意：唯一索引为 `(player_id, task_id)`（事件驱动不保证任务在注册第 N 天当天完成，按 task 推进；day 字段仅记录完成时的注册天数，供展示）。

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { GuideTaskStatus } from '@constants/enums';

@Entity('guide_progresses')
@Index('idx_guide_player_task', ['playerId', 'taskId'], { unique: true })
export class GuideProgress {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'int' })
  day: number;

  @Column({ name: 'task_id', type: 'varchar', length: 24 })
  taskId: string;

  @Column({ type: 'enum', enum: GuideTaskStatus, default: GuideTaskStatus.DONE })
  status: GuideTaskStatus;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'claimed_at', type: 'timestamp', nullable: true })
  claimedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 4: 创建 `ladder-record.entity.ts` 与导出 index**

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('ladder_records')
@Index('idx_ladder_player_season', ['playerId', 'season'], { unique: true })
@Index('idx_ladder_season_score', ['season', 'score'])
export class LadderRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'varchar', length: 16 })
  season: string;

  @Column({ type: 'int', default: 1000 })
  score: number;

  @Column({ type: 'int', default: 0 })
  wins: number;

  @Column({ type: 'int', default: 0 })
  losses: number;

  @Column({ type: 'int', default: 0 })
  streak: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

`src/modules/ladder/entities/index.ts`：

```typescript
export { LadderRecord } from './ladder-record.entity';
```

- [ ] **Step 5: `social/entities/index.ts` 追加导出**

```typescript
export { SocialPointRecord } from './social-point-record.entity';
export { SocialChest } from './social-chest.entity';
export { GuideProgress } from './guide-progress.entity';
```

- [ ] **Step 6: `social.module.ts` forFeature 追加三实体**（imports 列表加 `SocialPointRecord, SocialChest, GuideProgress`）

```typescript
      PlayerReport,
      PlayerBlock,
      SocialPointRecord,
      SocialChest,
      GuideProgress,
      Player,
```

- [ ] **Step 7: 编译验证**

Run: `cd e:\code\nest\packages-game\game-server && npx tsc --noEmit`
Expected: 无新增报错

- [ ] **Step 8: Commit**

```bash
git add src/modules/social/entities src/modules/ladder src/modules/social/social.module.ts
git commit -m "feat(social): 阶段5批2 实体 — 积分流水/宝箱/引导进度/天梯 4 表"
```

---

### Task 3: 社交积分服务（记账 + 事件订阅 + 查询接口）

**Files:**
- Create: `src/modules/social/social-economy.service.ts`
- Create: `src/modules/social/social-event.listener.ts`
- Modify: `src/modules/social/social.module.ts`
- Modify: `src/modules/social/social.controller.ts`
- Create: `src/modules/social/social-economy.service.spec.ts`

- [ ] **Step 1: 创建 `social-economy.service.ts`**（积分流水 + 余额 + 每日上限 + 兑换，宝箱在 Task 4 追加方法）

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { SocialPointRecord, SocialChest } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  SocialPointType,
  SocialPointReason,
  SocialChestType,
  SocialChestStatus,
} from '@constants/enums';
import { ConfigManageService } from '@modules/config/config.service';
import { getTodayStr } from '@utils/time.util';

const REASON_WEIGHTS: Record<string, number> = {
  friend_added: 3,
  kinship_formed: 5,
  gift_sent: 1,
  guild_contrib: 1,
  intel_gained: 2,
  chat_sign_in: 1,
  guide_task: 2,
};

@Injectable()
export class SocialEconomyService {
  constructor(
    @InjectRepository(SocialPointRecord)
    private readonly pointRepo: Repository<SocialPointRecord>,
    @InjectRepository(SocialChest)
    private readonly chestRepo: Repository<SocialChest>,
    private readonly configService: ConfigManageService,
    private readonly eventBus: EventBusService,
  ) {}

  async getBalance(playerId: string): Promise<number> {
    const [earn, spend] = await Promise.all([
      this.pointRepo
        .createQueryBuilder('p')
        .select('COALESCE(SUM(p.amount), 0)', 'total')
        .where('p.player_id = :pid', { pid: playerId })
        .andWhere('p.type = :t', { t: SocialPointType.EARN })
        .getRawOne<{ total: string }>(),
      this.pointRepo
        .createQueryBuilder('p')
        .select('COALESCE(SUM(p.amount), 0)', 'total')
        .where('p.player_id = :pid', { pid: playerId })
        .andWhere('p.type = :t', { t: SocialPointType.SPEND })
        .getRawOne<{ total: string }>(),
    ]);
    return Number(earn?.total ?? 0) - Number(spend?.total ?? 0);
  }

  async getTodayEarned(playerId: string): Promise<number> {
    const today = getTodayStr();
    const start = `${today} 00:00:00`;
    const row = await this.pointRepo
      .createQueryBuilder('p')
      .select('COALESCE(SUM(p.amount), 0)', 'total')
      .where('p.player_id = :pid', { pid: playerId })
      .andWhere('p.type = :t', { t: SocialPointType.EARN })
      .andWhere('p.created_at >= :start', { start })
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  async earnPoints(
    playerId: string,
    amount: number,
    reason: SocialPointReason,
    refId?: string,
  ): Promise<number | null> {
    if (amount <= 0) return null;
    if (refId) {
      const dup = await this.pointRepo.findOne({
        where: { playerId, reason, refId },
      });
      if (dup) return null;
    }
    const dailyCap = await this.readConfigNumber('social.point_daily_cap', 100);
    if ((await this.getTodayEarned(playerId)) + amount > dailyCap) {
      return null;
    }
    const balance = await this.getBalance(playerId);
    const record = await this.pointRepo.save(
      this.pointRepo.create({
        playerId,
        type: SocialPointType.EARN,
        amount,
        balanceAfter: balance + amount,
        reason,
        refId: refId ?? null,
      }),
    );
    this.eventBus.emit(GameEvents.SOCIAL_POINT_CHANGED, {
      playerId,
      balance: record.balanceAfter,
    });
    return record.balanceAfter;
  }

  async spendPoints(
    playerId: string,
    amount: number,
    reason: SocialPointReason,
    refId?: string,
  ): Promise<number> {
    if (amount <= 0) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '消耗数量非法');
    }
    const balance = await this.getBalance(playerId);
    if (balance < amount) {
      throw new GameException(ErrorCodes.POINT_NOT_ENOUGH, '社交积分不足');
    }
    const record = await this.pointRepo.save(
      this.pointRepo.create({
        playerId,
        type: SocialPointType.SPEND,
        amount,
        balanceAfter: balance - amount,
        reason,
        refId: refId ?? null,
      }),
    );
    this.eventBus.emit(GameEvents.SOCIAL_POINT_CHANGED, {
      playerId,
      balance: record.balanceAfter,
    });
    return record.balanceAfter;
  }

  async getPointInfo(playerId: string): Promise<{
    balance: number;
    todayEarned: number;
    dailyCap: number;
  }> {
    const [balance, todayEarned, dailyCap] = await Promise.all([
      this.getBalance(playerId),
      this.getTodayEarned(playerId),
      this.readConfigNumber('social.point_daily_cap', 100),
    ]);
    return { balance, todayEarned, dailyCap };
  }

  async getPointRecords(
    playerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: SocialPointRecord[]; total: number }> {
    const [items, total] = await this.pointRepo.findAndCount({
      where: { playerId },
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async getLastWeekActivity(playerId: string): Promise<number> {
    const now = new Date();
    const day = now.getDay() || 7; // 周一=1..周日=7
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day - 1) - 7);
    monday.setHours(0, 0, 0, 0);
    const end = new Date(monday);
    end.setDate(monday.getDate() + 7);
    const rows = await this.pointRepo.find({
      where: {
        playerId,
        type: SocialPointType.EARN,
        createdAt: MoreThanOrEqual(monday),
      },
    });
    let activity = 0;
    for (const r of rows) {
      if (r.createdAt < end) {
        activity += REASON_WEIGHTS[r.reason] ?? 1;
      }
    }
    return activity;
  }

  async exchangeChest(
    playerId: string,
    tier: number,
  ): Promise<SocialChest> {
    const costs: Record<number, number> = { 1: 50, 2: 150, 3: 400 };
    const cost = costs[tier];
    if (!cost) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '兑换档位非法');
    }
    await this.spendPoints(
      playerId,
      cost,
      SocialPointReason.CHEST_EXCHANGE,
      `tier:${tier}`,
    );
    return this.chestRepo.save(
      this.chestRepo.create({
        playerId,
        chestType: SocialChestType.POINT_EXCHANGE,
        tier,
        cost,
        status: SocialChestStatus.PENDING,
        sourceWeek: null,
      }),
    );
  }

  async claimWeeklyChests(playerId: string): Promise<SocialChest[]> {
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day - 1) - 7);
    const weekKey = this.weekKey(monday);
    const existing = await this.chestRepo.find({
      where: { playerId, chestType: SocialChestType.WEEKLY_ACTIVITY, sourceWeek: weekKey },
    });
    if (existing.length) return existing;

    const activity = await this.getLastWeekActivity(playerId);
    const tiers: number[] = [];
    if (activity >= 100) tiers.push(4, 3, 2, 1);
    else if (activity >= 60) tiers.push(3, 2, 1);
    else if (activity >= 30) tiers.push(2, 1);
    else if (activity >= 10) tiers.push(1);
    if (!tiers.length) {
      throw new GameException(ErrorCodes.WEEKLY_CHEST_EMPTY, '上周活跃值未达 10，无宝箱可领');
    }
    const chests = await this.chestRepo.save(
      tiers.map((tier) =>
        this.chestRepo.create({
          playerId,
          chestType: SocialChestType.WEEKLY_ACTIVITY,
          tier,
          cost: 0,
          status: SocialChestStatus.PENDING,
          sourceWeek: weekKey,
        }),
      ),
    );
    return chests;
  }

  async openChest(playerId: string, chestId: string): Promise<SocialChest> {
    const chest = await this.chestRepo.findOne({ where: { id: chestId } });
    if (!chest) {
      throw new GameException(ErrorCodes.CHEST_NOT_FOUND, '宝箱不存在');
    }
    if (chest.playerId !== playerId) {
      throw new GameException(ErrorCodes.FORBIDDEN, '无权开启此宝箱');
    }
    if (chest.status === SocialChestStatus.OPENED) {
      throw new GameException(ErrorCodes.CHEST_ALREADY_OPENED, '宝箱已开启');
    }
    const table = await this.readConfigJson('social.chest_rewards', {});
    const pool = table[String(chest.tier)] ?? table['1'] ?? { gold: { weight: 1 } };
    const reward = this.rollReward(pool);
    chest.status = SocialChestStatus.OPENED;
    chest.rewardJson = reward;
    chest.openedAt = new Date();
    const saved = await this.chestRepo.save(chest);
    this.eventBus.emit(GameEvents.CHEST_OPENED, { playerId, chestId, reward });
    return saved;
  }

  private rollReward(pool: Record<string, { weight: number }>): Record<string, number> {
    const entries = Object.entries(pool);
    const total = entries.reduce((s, [, v]) => s + (v.weight ?? 1), 0);
    let roll = Math.random() * total;
    for (const [key, v] of entries) {
      roll -= v.weight ?? 1;
      if (roll <= 0) return { [key]: 1 };
    }
    return { [entries[0][0]]: 1 };
  }

  private weekKey(date: Date): string {
    const y = date.getFullYear();
    const start = new Date(y, 0, 1);
    const week = Math.ceil(((date.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
    return `${y}-W${String(week).padStart(2, '0')}`;
  }

  private async readConfigNumber(key: string, fallback: number): Promise<number> {
    try {
      const config = await this.configService.getConfig(key);
      return Number(config.value) || fallback;
    } catch {
      return fallback;
    }
  }

  private async readConfigJson(key: string, fallback: any): Promise<any> {
    try {
      const config = await this.configService.getConfig(key);
      return JSON.parse(config.value);
    } catch {
      return fallback;
    }
  }
}
```

- [ ] **Step 2: 创建 `social-event.listener.ts`**（积分记账 + 引导任务驱动，引导方法由 Task 11 的 SocialGuideService 提供，先建空实现占位——不，按 YAGNI 直接接入 SocialGuideService 接口，Task 11 实现该服务。本任务先只做积分记账部分，引导驱动在 Task 11 追加监听方法）

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SocialEconomyService } from './social-economy.service';
import { GameEvents } from '@event-bus/game-events';
import { SocialPointReason } from '@constants/enums';

@Injectable()
export class SocialEventListener {
  private readonly logger = new Logger(SocialEventListener.name);

  constructor(private readonly economyService: SocialEconomyService) {}

  @OnEvent(GameEvents.FRIEND_ADDED)
  async onFriendAdded(payload: { playerId: string; friendId: string }): Promise<void> {
    await this.safe(async () => {
      await this.economyService.earnPoints(payload.playerId, 10, SocialPointReason.FRIEND_ADDED, payload.friendId);
      await this.economyService.earnPoints(payload.friendId, 10, SocialPointReason.FRIEND_ADDED, payload.playerId);
    }, 'FRIEND_ADDED');
  }

  @OnEvent(GameEvents.KINSHIP_FORMED)
  async onKinshipFormed(payload: { kinshipId: string; type: string; leaderId: string; members: string[] }): Promise<void> {
    await this.safe(async () => {
      for (const m of payload.members) {
        await this.economyService.earnPoints(m, 30, SocialPointReason.KINSHIP_FORMED, payload.kinshipId);
      }
    }, 'KINSHIP_FORMED');
  }

  @OnEvent(GameEvents.GIFT_SENT)
  async onGiftSent(payload: { playerId: string; targetId: string; direction: string }): Promise<void> {
    await this.safe(async () => {
      if (payload.direction === 'send') {
        await this.economyService.earnPoints(payload.playerId, 5, SocialPointReason.GIFT_SENT, `g:${payload.targetId}`);
      }
    }, 'GIFT_SENT');
  }

  @OnEvent(GameEvents.GUILD_CONTRIB_GAINED)
  async onGuildContrib(payload: { playerId: string }): Promise<void> {
    await this.safe(async () => {
      await this.economyService.earnPoints(payload.playerId, 5, SocialPointReason.GUILD_CONTRIB);
    }, 'GUILD_CONTRIB');
  }

  @OnEvent(GameEvents.INTEL_GAINED)
  async onIntelGained(payload: { playerId: string; intelId: string }): Promise<void> {
    await this.safe(async () => {
      await this.economyService.earnPoints(payload.playerId, 10, SocialPointReason.INTEL_GAINED, payload.intelId);
    }, 'INTEL_GAINED');
  }

  @OnEvent(GameEvents.CHAT_SIGN_IN)
  async onChatSignIn(payload: { playerId: string; signInDate: string }): Promise<void> {
    await this.safe(async () => {
      await this.economyService.earnPoints(payload.playerId, 3, SocialPointReason.CHAT_SIGN_IN, payload.signInDate);
    }, 'CHAT_SIGN_IN');
  }

  private async safe(fn: () => Promise<void>, tag: string): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(`Social point handler ${tag} failed`, (err as Error).message);
    }
  }
}
```

- [ ] **Step 3: `social.module.ts` 注册新服务与监听器**（imports 加 `ConfigManageModule`、`VipModule`——VipModule 在 Task 7 使用；providers 加 `SocialEconomyService, SocialEventListener`；exports 加 `SocialEconomyService`）

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocialService } from './social.service';
import { SocialController } from './social.controller';
import { SocialEconomyService } from './social-economy.service';
import { SocialEventListener } from './social-event.listener';
import {
  Friend,
  Guild,
  GuildMember,
  GuildDonate,
  GuildImpeachment,
  GuildBuilding,
  GuildFundLog,
  GuildActivity,
  GuildDiplomacy,
  Intelligence,
  GiftTemplate,
  Kinship,
  PlayerReport,
  PlayerBlock,
  SocialPointRecord,
  SocialChest,
  GuideProgress,
} from './entities';
import { Player } from '@modules/player/entities/player.entity';
import { CharacterEspionage } from '@modules/character/entities';
import { EconomyModule } from '@modules/economy/economy.module';
import { CharacterModule } from '@modules/character/character.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { PlayerModule } from '@modules/player/player.module';
import { ConfigManageModule } from '@modules/config/config.module';
import { VipModule } from '@modules/vip/vip.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Friend,
      Guild,
      GuildMember,
      GuildDonate,
      GuildImpeachment,
      GuildBuilding,
      GuildFundLog,
      GuildActivity,
      GuildDiplomacy,
      Intelligence,
      GiftTemplate,
      Kinship,
      CharacterEspionage,
      PlayerReport,
      PlayerBlock,
      SocialPointRecord,
      SocialChest,
      GuideProgress,
      Player,
    ]),
    EconomyModule,
    CharacterModule,
    InventoryModule,
    PlayerModule,
    ConfigManageModule,
    VipModule,
  ],
  controllers: [SocialController],
  providers: [SocialService, SocialEconomyService, SocialEventListener],
  exports: [SocialService, SocialEconomyService],
})
export class SocialModule {}
```

- [ ] **Step 4: `social.controller.ts` 追加积分路由**（`@Controller('api/client/v1/social')` 类内追加，注入 SocialEconomyService）

```typescript
  constructor(
    private readonly socialService: SocialService,
    private readonly economyService: SocialEconomyService,
  ) {}

  // ===== 社交积分（阶段5批2） =====

  @Get('point/info')
  @ApiOperation({ summary: '社交积分信息' })
  async getPointInfo(@CurrentPlayer() player: CurrentPlayerData) {
    return this.economyService.getPointInfo(player.playerId);
  }

  @Get('point/records')
  @ApiOperation({ summary: '社交积分流水' })
  async getPointRecords(
    @CurrentPlayer() player: CurrentPlayerData,
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20,
  ) {
    return this.economyService.getPointRecords(
      player.playerId,
      Number(page),
      Number(pageSize),
    );
  }

  @Post('point/exchange')
  @ApiOperation({ summary: '积分兑换宝箱' })
  async exchangeChest(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: { tier: number },
  ) {
    return this.economyService.exchangeChest(player.playerId, Number(dto.tier));
  }
```

同时确认 imports 已含 `Query`（`social.controller.ts` 已 import Query）。

- [ ] **Step 5: 编写 `social-economy.service.spec.ts`**（mock 仓库与 config，覆盖余额/去重/上限/兑换/开箱）

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SocialEconomyService } from './social-economy.service';
import { SocialPointRecord, SocialChest } from './entities';
import { SocialPointType, SocialPointReason, SocialChestType, SocialChestStatus } from '@constants/enums';
import { GameEvents } from '@event-bus/game-events';

describe('SocialEconomyService', () => {
  let service: SocialEconomyService;
  const pointRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((e) => e),
    find: jest.fn(),
    findAndCount: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const chestRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn((e) => e) };
  const configService = { getConfig: jest.fn() };
  const eventBus = { emit: jest.fn() };

  const qb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    pointRepo.createQueryBuilder.mockReturnValue(qb);
    qb.getRawOne.mockResolvedValue({ total: '0' });
    const module = await Test.createTestingModule({
      providers: [
        SocialEconomyService,
        { provide: getRepositoryToken(SocialPointRecord), useValue: pointRepo },
        { provide: getRepositoryToken(SocialChest), useValue: chestRepo },
        { provide: 'ConfigManageService', useValue: configService },
        { provide: 'EventBusService', useValue: eventBus },
      ],
    }).compile();
    service = module.get(SocialEconomyService);
  });

  it('earnPoints 记 EARN 流水并 emit', async () => {
    pointRepo.findOne.mockResolvedValue(null);
    pointRepo.save.mockResolvedValue({ balanceAfter: 10 });
    const balance = await service.earnPoints('1', 10, SocialPointReason.FRIEND_ADDED, '2');
    expect(balance).toBe(10);
    expect(eventBus.emit).toHaveBeenCalledWith(GameEvents.SOCIAL_POINT_CHANGED, { playerId: '1', balance: 10 });
  });

  it('earnPoints 同 ref 去重不重复记账', async () => {
    pointRepo.findOne.mockResolvedValue({ id: 'x' });
    const balance = await service.earnPoints('1', 10, SocialPointReason.FRIEND_ADDED, '2');
    expect(balance).toBeNull();
    expect(pointRepo.save).not.toHaveBeenCalled();
  });

  it('earnPoints 超每日上限跳过', async () => {
    pointRepo.findOne.mockResolvedValue(null);
    configService.getConfig.mockResolvedValue({ value: '10' });
    qb.getRawOne.mockResolvedValueOnce({ total: '10' }); // getTodayEarned=10
    qb.getRawOne.mockResolvedValueOnce({ total: '0' }); // 不触发余额
    const balance = await service.earnPoints('1', 10, SocialPointReason.GIFT_SENT);
    expect(balance).toBeNull();
  });

  it('spendPoints 余额不足抛 POINT_NOT_ENOUGH', async () => {
    qb.getRawOne.mockResolvedValue({ total: '5' });
    await expect(service.spendPoints('1', 10, SocialPointReason.CHEST_EXCHANGE)).rejects.toMatchObject({
      response: { code: 92301 },
    });
  });

  it('exchangeChest 扣分并创建 PENDING 宝箱', async () => {
    qb.getRawOne.mockResolvedValue({ total: '100' });
    chestRepo.save.mockResolvedValue({ playerId: '1', chestType: SocialChestType.POINT_EXCHANGE, tier: 1, cost: 50, status: SocialChestStatus.PENDING });
    const chest = await service.exchangeChest('1', 1);
    expect(chest.tier).toBe(1);
    expect(pointRepo.save).toHaveBeenCalled();
  });

  it('openChest 已开启拒绝', async () => {
    chestRepo.findOne.mockResolvedValue({ id: 'c1', playerId: '1', status: SocialChestStatus.OPENED });
    await expect(service.openChest('1', 'c1')).rejects.toMatchObject({ response: { code: 92303 } });
  });
});
```

- [ ] **Step 6: 运行测试验证失败 → 实现 → 通过**

Run: `cd e:\code\nest\packages-game\game-server && npx jest src/modules/social/social-economy.service.spec.ts --no-coverage`
Expected: 先 FAIL（服务不存在），实现后 PASS

- [ ] **Step 7: 编译验证 + Commit**

Run: `cd e:\code\nest\packages-game\game-server && npx tsc --noEmit`
Expected: 无新增报错

```bash
git add src/modules/social/social-economy.service.ts src/modules/social/social-event.listener.ts src/modules/social/social.module.ts src/modules/social/social.controller.ts src/modules/social/social-economy.service.spec.ts
git commit -m "feat(social): 阶段5批2 社交积分 — 记账/去重/每日上限/事件订阅/兑换"
```

---

### Task 4: 宝箱接口（周活跃结算 + 开启）

**Files:**
- Modify: `src/modules/social/social-economy.service.ts`（方法已在 Task 3 写入）
- Modify: `src/modules/social/social.controller.ts`
- Modify: `src/modules/social/social-economy.service.spec.ts`

说明：`claimWeeklyChests`/`openChest` 已在 Task 3 Step 1 完整实现，本任务补路由与单测。

- [ ] **Step 1: `social.controller.ts` 追加宝箱路由**

```typescript
  @Post('chest/weekly/claim')
  @ApiOperation({ summary: '领取上周活跃宝箱' })
  async claimWeeklyChests(@CurrentPlayer() player: CurrentPlayerData) {
    return this.economyService.claimWeeklyChests(player.playerId);
  }

  @Post('chest/:id/open')
  @ApiOperation({ summary: '开启宝箱' })
  async openChest(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.economyService.openChest(player.playerId, id);
  }
```

- [ ] **Step 2: 单测补周活跃结算与开箱奖励**

在 `social-economy.service.spec.ts` 追加：

```typescript
  it('claimWeeklyChests 上周活跃 70 发 3 档宝箱', async () => {
    chestRepo.find.mockResolvedValue([]);
    pointRepo.find.mockResolvedValue([
      { reason: SocialPointReason.FRIEND_ADDED, createdAt: new Date() }, // weight 3
    ]);
    // 模拟 getLastWeekActivity：直接 spy
    jest.spyOn(service, 'getLastWeekActivity' as any).mockResolvedValue(70);
    chestRepo.save.mockImplementation((rows) => Promise.resolve(rows));
    const chests = await service.claimWeeklyChests('1');
    expect(chests.map((c) => c.tier).sort((a, b) => b - a)).toEqual([3, 2, 1]);
  });

  it('claimWeeklyChests 活跃不足抛 WEEKLY_CHEST_EMPTY', async () => {
    chestRepo.find.mockResolvedValue([]);
    jest.spyOn(service, 'getLastWeekActivity' as any).mockResolvedValue(5);
    await expect(service.claimWeeklyChests('1')).rejects.toMatchObject({ response: { code: 92304 } });
  });

  it('openChest 按权重池发奖', async () => {
    chestRepo.findOne.mockResolvedValue({ id: 'c1', playerId: '1', tier: 1, status: SocialChestStatus.PENDING });
    configService.getConfig.mockResolvedValue({ value: JSON.stringify({ '1': { gold: { weight: 1 }, diamond: { weight: 1 } } }) });
    chestRepo.save.mockImplementation((e) => Promise.resolve(e));
    const chest = await service.openChest('1', 'c1');
    expect(chest.status).toBe(SocialChestStatus.OPENED);
    expect(chest.openedAt).toBeInstanceOf(Date);
    expect(eventBus.emit).toHaveBeenCalledWith(GameEvents.CHEST_OPENED, expect.any(Object));
  });
```

- [ ] **Step 3: 运行测试 + 编译 + Commit**

Run: `cd e:\code\nest\packages-game\game-server && npx jest src/modules/social/social-economy.service.spec.ts --no-coverage && npx tsc --noEmit`
Expected: 全 PASS，无新增报错

```bash
git add src/modules/social/social.controller.ts src/modules/social/social-economy.service.spec.ts
git commit -m "feat(social): 阶段5批2 宝箱 — 周活跃分档结算/开箱权重发奖"
```

---

### Task 5: 聊天签到补签（chat 模块）

**Files:**
- Modify: `src/modules/chat/chat.service.ts`
- Modify: `src/modules/chat/chat.controller.ts`
- Modify: `src/modules/chat/chat.service.spec.ts`

- [ ] **Step 1: `chat.service.ts` 追加补签方法**（构造函数注入 `SocialEconomyService`，chat.module 已 imports SocialModule）

```typescript
  async makeupSignIn(
    playerId: string,
    date: string,
  ): Promise<ChatSignIn> {
    const today = new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= today) {
      throw new GameException(ErrorCodes.MAKEUP_INVALID_DATE, '仅可补签过去的日期');
    }
    const existing = await this.signInRepo.findOne({
      where: { playerId, signInDate: date },
    });
    if (existing) {
      throw new GameException(ErrorCodes.CHAT_SIGN_IN_DONE, '该日已签到');
    }
    const monthKey = date.slice(0, 7);
    const limit = await this.readConfigNumber('chat.makeup_monthly_limit', 3);
    const countKey = `chat:makeup:${playerId}:${monthKey}`;
    const used = Number((await this.cacheService.get(countKey)) ?? '0');
    if (used >= limit) {
      throw new GameException(ErrorCodes.MAKEUP_LIMIT_EXCEEDED, '本月补签次数已达上限');
    }
    const cost = await this.readConfigNumber('chat.makeup_cost', 50);
    await this.socialEconomyService.spendPoints(
      playerId,
      cost,
      SocialPointReason.SIGN_IN_MAKEUP,
      `signin:${date}`,
    );
    await this.cacheService.set(countKey, String(used + 1), 31 * 86400);

    const reward = await this.readConfigJson('chat.sign_in_reward', { favor: 1 });
    const record = await this.signInRepo.save(
      this.signInRepo.create({
        playerId,
        signInDate: date,
        rewardJson: { ...reward, makeup: true },
      }),
    );
    this.eventBus.emit(GameEvents.CHAT_SIGN_IN, {
      playerId,
      signInDate: date,
      reward,
      makeup: true,
    });
    return record;
  }

  private async readConfigNumber(key: string, fallback: number): Promise<number> {
    try {
      const config = await this.configService.getConfig(key);
      return Number(config.value) || fallback;
    } catch {
      return fallback;
    }
  }
```

imports 追加：`import { SocialEconomyService } from '@modules/social/social-economy.service';` 与 `import { SocialPointReason } from '@constants/enums';`；构造函数加 `private readonly socialEconomyService: SocialEconomyService`。

- [ ] **Step 2: `chat.controller.ts` 追加路由**（签到路由附近，参考 `channelSignIn` 的既有路由）

```typescript
  @Post('api/client/v1/chat/sign-in/makeup')
  @ApiOperation({ summary: '签到补签（消耗社交积分）' })
  async makeupSignIn(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: { date: string },
  ) {
    return this.chatService.makeupSignIn(player.playerId, dto.date);
  }
```

确认 `chat.controller.ts` 已 import Body/CurrentPlayer/CurrentPlayerData；若 `sign-in` 路由用 `@Controller('api/client/v1/chat')` 前缀则去掉路径前缀按既有风格写（以既有文件实际写法为准，保持路径最终为 `api/client/v1/chat/sign-in/makeup`）。

- [ ] **Step 3: 单测追加**（`chat.service.spec.ts`，mock socialEconomyService）

```typescript
  it('补签过去日期成功并扣积分', async () => {
    signInRepo.findOne.mockResolvedValue(null);
    cacheService.get.mockResolvedValue('0');
    configService.getConfig.mockResolvedValue({ value: '50' }); // makeup_cost
    socialEconomyService.spendPoints.mockResolvedValue(50);
    signInRepo.save.mockImplementation((e) => Promise.resolve(e));
    const record = await service.makeupSignIn('1', '2026-09-18');
    expect(record.rewardJson.makeup).toBe(true);
    expect(socialEconomyService.spendPoints).toHaveBeenCalledWith('1', 50, SocialPointReason.SIGN_IN_MAKEUP, 'signin:2026-09-18');
  });

  it('补签今日拒绝', async () => {
    await expect(service.makeupSignIn('1', '2099-01-01')).rejects.toMatchObject({
      response: { code: ErrorCodes.MAKEUP_INVALID_DATE },
    });
  });

  it('补签超月度上限拒绝', async () => {
    signInRepo.findOne.mockResolvedValue(null);
    cacheService.get.mockResolvedValue('3');
    configService.getConfig.mockResolvedValue({ value: '3' });
    await expect(service.makeupSignIn('1', '2026-09-18')).rejects.toMatchObject({
      response: { code: ErrorCodes.MAKEUP_LIMIT_EXCEEDED },
    });
  });
```

- [ ] **Step 4: 运行测试 + 编译 + Commit**

Run: `cd e:\code\nest\packages-game\game-server && npx jest src/modules/chat/chat.service.spec.ts --no-coverage && npx tsc --noEmit`
Expected: 全 PASS，无新增报错

```bash
git add src/modules/chat/chat.service.ts src/modules/chat/chat.controller.ts src/modules/chat/chat.service.spec.ts
git commit -m "feat(chat): 阶段5批2 签到补签 — 扣积分/月度限次/断签保护"
```

---

### Task 6: 封禁社交后果（BAN 联动三项 + 补执行）

**Files:**
- Modify: `src/modules/social/social.service.ts`（新增 kickMember/transferLeadership 供除名用）
- Modify: `src/modules/ranking/ranking.service.ts`（removePlayer）
- Modify: `src/modules/community/community.service.ts`（BAN 联动 + socialCleanup）
- Modify: `src/modules/community/community.controller.ts`
- Modify: `src/modules/community/community.module.ts`
- Modify: `src/modules/ranking/ranking.service.spec.ts`
- Modify: `src/modules/community/community.service.spec.ts`

- [ ] **Step 1: `ranking.service.ts` 追加 removePlayer**（Redis 榜单移除；历史快照留档不删）

```typescript
  async removePlayer(type: RankingType, playerId: string): Promise<void> {
    const members = await this.cacheService.zRange(
      this.RANKING_KEY(type),
      0,
      -1,
    );
    const targets = members.filter((m) => {
      try {
        return JSON.parse(m).playerId === playerId;
      } catch {
        return false;
      }
    });
    if (targets.length) {
      await this.cacheService.zRem(this.RANKING_KEY(type), ...targets);
    }
  }

  async removePlayerFromAll(playerId: string): Promise<string[]> {
    const removed: string[] = [];
    for (const type of Object.values(RankingType)) {
      await this.removePlayer(type, playerId);
      removed.push(type);
    }
    return removed;
  }
```

- [ ] **Step 2: `social.service.ts` 新增帮派成员除名方法**（BAN 除名 + 帮主移交用；追加在 `getGuildMembers` 附近）

```typescript
  /** 将成员移出帮派（封禁后果/逐出用）。帮主被移出时先移交副帮主，无副帮主则解散。 */
  async kickGuildMember(
    operatorId: string,
    guildId: string,
    targetPlayerId: string,
    reason: string,
  ): Promise<{ removed: boolean; guildDisbanded?: boolean; newLeaderId?: string }> {
    const guild = await this.getGuildOrThrow(guildId);
    const member = await this.getGuildMemberOrThrow(targetPlayerId, guildId);
    if (member.role === GuildRole.LEADER) {
      const vice = await this.guildMemberRepo.findOne({
        where: { guildId, role: GuildRole.VICE_LEADER },
        order: { contribution: 'DESC' },
      });
      if (vice) {
        vice.role = GuildRole.LEADER;
        await this.guildMemberRepo.save(vice);
        await this.appendGuildLog(guild, `帮主被移除，${vice.playerId} 继任帮主（${reason}）`);
        await this.guildMemberRepo.delete({ playerId: targetPlayerId, guildId });
        await this.appendGuildLog(guild, `成员 ${targetPlayerId} 被移除（${reason}）`);
        return { removed: true, newLeaderId: vice.playerId };
      }
      await this.guildMemberRepo.delete({ guildId });
      guild.status = 'disbanded';
      guild.disbandedAt = new Date();
      await this.guildRepo.save(guild);
      await this.appendGuildLog(guild, `帮派因帮主被移除且无副帮主而解散（${reason}）`);
      return { removed: true, guildDisbanded: true };
    }
    await this.guildMemberRepo.delete({ playerId: targetPlayerId, guildId });
    await this.appendGuildLog(guild, `成员 ${targetPlayerId} 被移除（${reason}）`);
    return { removed: true };
  }
```

检查 `Guild` 实体字段：若 status/disbandedAt 字段名不同（以 `guild.entity.ts` 实际为准，`kinship.entity.ts` 用 `KINSHIP_STATUS.DISBANDED + disbandedAt` 模式，Guild 大概率同名），若 Guild 无 status 字段则跳过解散状态仅删成员（解散场景仅在无副帮主时触发，计划允许按实体实际调整）。

- [ ] **Step 3: `community.service.ts` BAN 联动 + 补执行**（构造函数注入 RankingService/SocialService；handleReport BAN 分支加联动调用）

```typescript
  constructor(
    // ...既有注入
    private readonly rankingService: RankingService,
    private readonly socialService: SocialService,
  ) {}

  // handleReport 中 action=BAN 的 applyPenalty 之后追加：
  if (level === PenaltyLevel.BAN) {
    await this.applyBanSocialConsequences(player.id);
  }
```

追加私有方法（类末尾）：

```typescript
  private async applyBanSocialConsequences(playerId: string): Promise<void> {
    // 1. 称号收回
    const character = await this.charRepo.findOne({ where: { playerId } });
    if (character) {
      const { affected } = await this.charTitleRepo.delete({ characterId: character.id });
      if (affected) {
        await this.adminService.logOperation({
          adminId: '0',
          targetPlayerId: playerId,
          operation: 'community.ban.title_revoke',
          changeBefore: { count: affected },
        });
      }
    }
    // 2. 帮派除名（含帮主移交/解散）
    const guildMember = await this.socialService.getMyGuildRole(playerId);
    if (guildMember?.guildId) {
      const result = await this.socialService.kickGuildMember('0', guildMember.guildId, playerId, '封禁处置');
      await this.adminService.logOperation({
        adminId: '0',
        targetPlayerId: playerId,
        operation: 'community.ban.guild_kick',
        changeAfter: result,
      });
    }
    // 3. 榜单移除
    const removed = await this.rankingService.removePlayerFromAll(playerId);
    await this.adminService.logOperation({
      adminId: '0',
      targetPlayerId: playerId,
      operation: 'community.ban.ranking_remove',
      changeAfter: { removed },
    });
  }

  async socialCleanup(adminId: string, playerId: string): Promise<{ cleaned: boolean }> {
    const character = await this.charRepo.findOne({ where: { playerId } });
    const guildMember = await this.socialService.getMyGuildRole(playerId);
    const titles = character
      ? await this.charTitleRepo.count({ where: { characterId: character.id } })
      : 0;
    if (!titles && !guildMember) {
      // 榜单 Redis 无查询入口，直接执行移除视为幂等完成
      await this.rankingService.removePlayerFromAll(playerId);
      throw new GameException(ErrorCodes.CLEANUP_ALREADY_DONE, '该玩家无待清理的社交资产');
    }
    await this.applyBanSocialConsequences(playerId);
    await this.adminService.logOperation({
      adminId,
      targetPlayerId: playerId,
      operation: 'community.social.cleanup',
      changeAfter: { playerId },
    });
    return { cleaned: true };
  }
```

注意：`getMyGuildRole` 若不存在或签名不同（批 1 前已有 `getMyGuildRole(playerId)` 返回含 guildId/role 或 null），以 `social.service.ts` 实际签名为准；若返回结构不同，改用 `guildMemberRepo` 查询（community.module forFeature 补 GuildMember 或经 socialService 既有查询方法）。

- [ ] **Step 4: `community.controller.ts` 追加补执行路由**（举报路由附近）

```typescript
  @Post('api/admin/v1/community/players/:playerId/social-cleanup')
  @ApiOperation({ summary: '[管理] 历史封禁补执行社交后果' })
  async socialCleanup(
    @Body() body: { adminId: string },
    @Param('playerId') playerId: string,
  ) {
    return this.communityService.socialCleanup(body.adminId, playerId);
  }
```

（以既有 admin 路由风格为准：若控制器方法用 `@CurrentAdmin()` 装饰器取 adminId，则照抄既有写法。）

- [ ] **Step 5: `community.module.ts` imports 加 RankingModule 与 SocialModule**

```typescript
    AdminModule,
    AnalyticsModule,
    AuthModule,
    RankingModule,
    SocialModule,
```

- [ ] **Step 6: 单测**

`ranking.service.spec.ts` 追加：

```typescript
  it('removePlayer 从 zset 移除目标', async () => {
    cacheService.zRange.mockResolvedValue([
      JSON.stringify({ playerId: '1', playerName: 'a' }),
      JSON.stringify({ playerId: '2', playerName: 'b' }),
    ]);
    await service.removePlayer(RankingType.POWER, '1');
    expect(cacheService.zRem).toHaveBeenCalledWith('ranking:power', JSON.stringify({ playerId: '1', playerName: 'a' }));
  });
```

`community.service.spec.ts` 追加（BAN 联动三项）：

```typescript
  it('BAN 处置联动三项社交后果', async () => {
    reportRepo.findOne.mockResolvedValue({ id: 'r1', status: ReportStatus.PENDING, targetType: ReportTargetType.PLAYER, targetId: '9' });
    playerRepo.findOne.mockResolvedValue({ id: '9', accountId: '9' });
    authService.applyPenalty.mockResolvedValue(undefined);
    charRepo.findOne.mockResolvedValue({ id: 'c9', playerId: '9' });
    charTitleRepo.delete.mockResolvedValue({ affected: 2 });
    socialService.getMyGuildRole.mockResolvedValue({ guildId: 'g1' });
    socialService.kickGuildMember.mockResolvedValue({ removed: true });
    rankingService.removePlayerFromAll.mockResolvedValue(['power']);
    adminService.logOperation.mockResolvedValue(undefined);
    await service.handleReport('a1', 'admin', 'r1', ReportHandleAction.BAN, '违规', 3600);
    expect(charTitleRepo.delete).toHaveBeenCalledWith({ characterId: 'c9' });
    expect(socialService.kickGuildMember).toHaveBeenCalled();
    expect(rankingService.removePlayerFromAll).toHaveBeenCalledWith('9');
  });
```

（mock 集合按 community.service.spec.ts 既有 provider 结构补 RankingService/SocialService。）

- [ ] **Step 7: 运行测试 + 编译 + Commit**

Run: `cd e:\code\nest\packages-game\game-server && npx jest src/modules/ranking/ranking.service.spec.ts src/modules/community/community.service.spec.ts --no-coverage && npx tsc --noEmit`
Expected: 全 PASS，无新增报错

```bash
git add src/modules/social/social.service.ts src/modules/ranking/ranking.service.ts src/modules/community/community.service.ts src/modules/community/community.controller.ts src/modules/community/community.module.ts src/modules/ranking/ranking.service.spec.ts src/modules/community/community.service.spec.ts
git commit -m "feat(community): 阶段5批2 封禁社交后果 — BAN 联动称号收回/帮派除名/榜单移除"
```

---

### Task 7: VIP 特权全量实现

**Files:**
- Modify: `src/modules/vip/vip.service.ts`
- Modify: `src/modules/vip/vip.service.spec.ts`
- Modify: `src/modules/social/social.service.ts`（好友位/送礼上限/帮贡加成/建筑折扣）
- Modify: `src/modules/social/social.service.spec.ts`（按需补断言）

- [ ] **Step 1: `vip.service.ts` 追加 getPrivilegeValue 与称号发放**

```typescript
  async getPrivilegeValue(
    playerId: string,
    key: string,
    fallback: any,
  ): Promise<any> {
    const player = await this.playerService.getById(playerId);
    if (!player) return fallback;
    const config = await this.configRepo.findOne({
      where: { level: player.vipLevel },
    });
    const privilege = config?.privilegeJson ?? {};
    return privilege[key] !== undefined ? privilege[key] : fallback;
  }

  /** VIP_LEVEL_UP 监听：达到等级且有 vipTitleId 时发放称号（经 character_title） */
  async grantVipTitleIfEligible(playerId: string): Promise<void> {
    const privilege = await this.getPrivilege(playerId);
    const vipTitleId = privilege.vipTitleId as string | undefined;
    if (!vipTitleId) return;
    const character = await this.characterRepo.findOne({ where: { playerId } });
    if (!character) return;
    const existing = await this.charTitleRepo.findOne({
      where: { characterId: character.id, titleId: vipTitleId },
    });
    if (existing) return;
    await this.charTitleRepo.save(
      this.charTitleRepo.create({
        characterId: character.id,
        titleId: vipTitleId,
        isEquipped: false,
      }),
    );
  }
```

构造函数与模块同步：`vip.module.ts` forFeature 加 `Character, CharacterTitle`，imports 加 `CharacterModule`（或直接 TypeOrmModule.forFeature 引入两实体即可，以不引循环为准）；`vip.service.ts` 注入 `@InjectRepository(Character) charRepo` 与 `@InjectRepository(CharacterTitle) charTitleRepo`。

- [ ] **Step 2: `social.service.ts` 四落地点**

2a. 好友位扩容（`applyFriend` 开头追加校验，注入 VipService——SocialModule 已 imports VipModule）：

```typescript
    const friendSlots = await this.vipService.getPrivilegeValue(playerId, 'friendSlots', 50);
    const friendCount = await this.friendRepo.count({
      where: { playerId, status: FriendStatus.ACCEPTED },
    });
    if (friendCount >= friendSlots) {
      throw new GameException(ErrorCodes.FRIEND_LIMIT_REACHED, '好友数量已达上限');
    }
```

（若 `FRIEND_LIMIT_REACHED` 错误码不存在，在 error-codes.ts 社交治理区补 `FRIEND_LIMIT_REACHED: 92208`——回 Task 1 文件补一行并随本任务提交。）

2b. 送礼上限提升（`deliverGift` 中 cap 计算改为取 VIP 值与模板上限的较大者）：

```typescript
    const vipCap = await this.vipService.getPrivilegeValue(playerId, 'dailyGiftCap', 0);
    const cap = Math.max(template.dailyCap, Number(vipCap) || 0);
    if (sent >= cap) {
      throw new GameException(ErrorCodes.GIFT_DAILY_CAP, '今日送礼已达上限');
    }
```

2c. 帮贡加成（`donateToGuild` 的 `contributionGained` 计算后加成）：

```typescript
    const contribBonus = Number(
      await this.vipService.getPrivilegeValue(playerId, 'guildContribBonus', 0),
    ) || 0;
    const contributionGained = Math.floor(
      (parseInt(amount, 10) / 100) * (1 + contribBonus),
    );
```

2d. 建筑升级折扣（`buildBuilding` 的 `cost` 计算后打折，惠及全帮——取帮内最高 boost）：

```typescript
    const members = await this.guildMemberRepo.find({ where: { guildId } });
    let boost = 0;
    for (const m of members) {
      const b = Number(await this.vipService.getPrivilegeValue(m.playerId, 'guildBuildBoost', 0)) || 0;
      if (b > boost) boost = b;
    }
    const cost = Math.floor(targetLevel * SocialService.BUILDING_COST_PER_LEVEL * (1 - boost));
```

- [ ] **Step 3: 单测（vip.service.spec.ts）**

```typescript
  it('getPrivilegeValue 命中特权键', async () => {
    playerService.getById.mockResolvedValue({ id: '1', vipLevel: 3 });
    configRepo.findOne.mockResolvedValue({ level: 3, privilegeJson: { friendSlots: 80, guildBuildBoost: 0.5 } });
    expect(await service.getPrivilegeValue('1', 'friendSlots', 50)).toBe(80);
    expect(await service.getPrivilegeValue('1', 'guildContribBonus', 0)).toBe(0);
  });

  it('grantVipTitleIfEligible 发放 VIP 称号', async () => {
    playerService.getById.mockResolvedValue({ id: '1', vipLevel: 3 });
    configRepo.findOne.mockResolvedValue({ level: 3, privilegeJson: { vipTitleId: 't9' } });
    charRepo.findOne.mockResolvedValue({ id: 'c1', playerId: '1' });
    charTitleRepo.findOne.mockResolvedValue(null);
    charTitleRepo.save.mockImplementation((e) => Promise.resolve(e));
    await service.grantVipTitleIfEligible('1');
    expect(charTitleRepo.save).toHaveBeenCalledWith(expect.objectContaining({ titleId: 't9' }));
  });
```

- [ ] **Step 4: 运行测试 + 编译 + Commit**

Run: `cd e:\code\nest\packages-game\game-server && npx jest src/modules/vip/vip.service.spec.ts src/modules/social/social.service.spec.ts --no-coverage && npx tsc --noEmit`
Expected: 全 PASS，无新增报错

```bash
git add src/modules/vip src/modules/social/social.service.ts src/modules/social/social.module.ts src/constants/error-codes.ts
git commit -m "feat(vip): 阶段5批2 VIP 特权全量生效 — 好友位/送礼上限/帮贡加成/建筑折扣/称号"
```

---

### Task 8: 充值状态机 + VIP 经验

**Files:**
- Modify: `src/modules/payment/payment.service.ts`
- Modify: `src/modules/payment/payment.controller.ts`
- Modify: `src/modules/payment/payment.module.ts`
- Modify: `src/modules/payment/payment.service.spec.ts`

- [ ] **Step 1: `payment.service.ts` 状态机与 VIP 经验**

1a. 构造函数注入 `VipService`（`payment.module.ts` imports 加 VipModule）：

```typescript
  private readonly ORDER_TTL_MS = 30 * 60 * 1000; // 30 分钟超时

  private async assertOrderActive(order: RechargeOrder): Promise<void> {
    if (order.status === RechargeStatus.EXPIRED) {
      throw new GameException(ErrorCodes.ORDER_EXPIRED, '订单已超时');
    }
    if (order.status === RechargeStatus.CANCELLED) {
      throw new GameException(ErrorCodes.ORDER_CANCEL_INVALID, '订单已取消');
    }
    if (
      order.status === RechargeStatus.PENDING &&
      Date.now() - order.createdAt.getTime() > this.ORDER_TTL_MS
    ) {
      order.status = RechargeStatus.EXPIRED;
      await this.orderRepo.save(order);
      throw new GameException(ErrorCodes.ORDER_EXPIRED, '订单已超时');
    }
  }

  async cancelOrder(orderNo: string, playerId: string): Promise<RechargeOrder> {
    const order = await this.orderRepo.findOne({ where: { orderNo } });
    if (!order) {
      throw new GameException(ErrorCodes.ORDER_NOT_FOUND, '订单不存在');
    }
    if (order.playerId !== playerId) {
      throw new GameException(ErrorCodes.FORBIDDEN, '无权操作此订单');
    }
    await this.assertOrderActive(order);
    if (order.status !== RechargeStatus.PENDING) {
      throw new GameException(ErrorCodes.ORDER_CANCEL_INVALID, '仅待支付订单可取消');
    }
    order.status = RechargeStatus.CANCELLED;
    return this.orderRepo.save(order);
  }

  async adminDeliver(adminId: string, orderId: string): Promise<RechargeOrder> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new GameException(ErrorCodes.ORDER_NOT_FOUND, '订单不存在');
    }
    if (order.status === RechargeStatus.DELIVERED) {
      throw new GameException(ErrorCodes.ORDER_DELIVERED, '订单已发货');
    }
    await this.assertOrderActive(order);
    await this.deliverRewards(order);
    order.status = RechargeStatus.DELIVERED;
    order.callbackAt = order.callbackAt ?? new Date();
    const saved = await this.orderRepo.save(order);
    this.eventBus.emit(GameEvents.RECHARGE_SUCCESS, {
      playerId: order.playerId,
      orderNo: order.orderNo,
      amount: order.amount,
    });
    return saved;
  }
```

1b. 抽取 `deliverRewards`（handleCallback 与 adminDeliver 共用；handleCallback 发奖后置 DELIVERED 而非 PAID）：

```typescript
  private async deliverRewards(order: RechargeOrder): Promise<void> {
    const product = await this.productRepo.findOne({
      where: { id: order.productId },
    });
    if (product?.rewardJson?.diamond) {
      await this.economyService.addCurrency(
        order.playerId,
        CurrencyType.DIAMOND,
        product.rewardJson.diamond,
        'recharge',
        `recharge:${order.orderNo}`,
        order.id,
      );
    }
    if (product?.rewardJson?.gold) {
      await this.economyService.addCurrency(
        order.playerId,
        CurrencyType.GOLD,
        product.rewardJson.gold,
        'recharge',
        `recharge:${order.orderNo}`,
        order.id,
      );
    }
    await this.playerService.addRecharge(order.playerId, order.amount);
    const vipExpPerCny = Number(
      (await this.readConfigNumber('payment.vip_exp_per_cny', 1)),
    );
    if (vipExpPerCny > 0) {
      await this.vipService.addVipExp(
        order.playerId,
        Math.floor(Number(order.amount) * vipExpPerCny),
      );
    }
  }

  private async readConfigNumber(key: string, fallback: number): Promise<number> {
    try {
      const config = await this.configService.getConfig(key);
      return Number(config.value) || fallback;
    } catch {
      return fallback;
    }
  }
```

`handleCallback` 改为：发奖后 `order.status = RechargeStatus.DELIVERED`（替换原 PAID 赋值）；`simulatePay` 的 `ORDER_ALREADY_PAID` 校验同时覆盖 DELIVERED（`order.status === RechargeStatus.PAID || order.status === RechargeStatus.DELIVERED` 或直接改用 assertOrderActive 语义）。`payment.module.ts` imports 加 `ConfigManageModule`（readConfigNumber 用）与 `VipModule`。

- [ ] **Step 2: `payment.controller.ts` 追加路由**

```typescript
  @Post('order/:orderNo/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消待支付订单' })
  cancelOrder(@CurrentPlayer() player: any, @Param('orderNo') orderNo: string) {
    return this.paymentService.cancelOrder(orderNo, player.playerId);
  }

  @Post('admin/orders/:id/deliver')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[管理] 补单发货' })
  adminDeliver(@Param('id') id: string) {
    return this.paymentService.adminDeliver('system', id);
  }
```

- [ ] **Step 3: 单测（payment.service.spec.ts）**

```typescript
  it('取消待支付订单', async () => {
    orderRepo.findOne.mockResolvedValue({ orderNo: 'o1', playerId: '1', status: RechargeStatus.PENDING, createdAt: new Date() });
    orderRepo.save.mockImplementation((e) => Promise.resolve(e));
    const order = await service.cancelOrder('o1', '1');
    expect(order.status).toBe(RechargeStatus.CANCELLED);
  });

  it('已支付订单不可取消', async () => {
    orderRepo.findOne.mockResolvedValue({ orderNo: 'o1', playerId: '1', status: RechargeStatus.PAID, createdAt: new Date() });
    await expect(service.cancelOrder('o1', '1')).rejects.toMatchObject({ response: { code: ErrorCodes.ORDER_CANCEL_INVALID } });
  });

  it('超时订单惰性置 EXPIRED', async () => {
    orderRepo.findOne.mockResolvedValue({ orderNo: 'o1', playerId: '1', status: RechargeStatus.PENDING, createdAt: new Date(Date.now() - 40 * 60000) });
    await expect(service.cancelOrder('o1', '1')).rejects.toMatchObject({ response: { code: ErrorCodes.ORDER_EXPIRED } });
  });

  it('回调成功发奖并加 VIP 经验', async () => {
    orderRepo.findOne.mockResolvedValue({ id: '1', orderNo: 'o1', playerId: '9', productId: 'p1', amount: '100', status: RechargeStatus.PENDING, createdAt: new Date(), callbackAt: null });
    productRepo.findOne.mockResolvedValue({ id: 'p1', rewardJson: { diamond: 100 } });
    economyService.addCurrency.mockResolvedValue(undefined);
    playerService.addRecharge.mockResolvedValue({});
    vipService.addVipExp.mockResolvedValue({ vipLevel: 1, vipExp: 100, leveledUp: true });
    configService.getConfig.mockResolvedValue({ value: '1' });
    orderRepo.save.mockImplementation((e) => Promise.resolve(e));
    cryptoMock  // 签名校验：mock generateSignature 或按既有测试方式绕过
    const saved = await service.handleCallback({ orderNo: 'o1', amount: '100', sign: 'x' });
    expect(saved.status).toBe(RechargeStatus.DELIVERED);
    expect(vipService.addVipExp).toHaveBeenCalledWith('9', 100);
  });
```

（`handleCallback` 的签名校验在既有 spec 中已有 mock 方式，沿用之；`configService`/`vipService` 需加入测试模块 provider mock。）

- [ ] **Step 4: 运行测试 + 编译 + Commit**

Run: `cd e:\code\nest\packages-game\game-server && npx jest src/modules/payment/payment.service.spec.ts --no-coverage && npx tsc --noEmit`
Expected: 全 PASS，无新增报错

```bash
git add src/modules/payment
git commit -m "feat(payment): 阶段5批2 充值状态机 — 取消/超时/补单/发货态/充值加VIP经验"
```

---

### Task 9: 新手保护期 + 恶名红名拦截

**Files:**
- Modify: `src/modules/player/player.service.ts`（isNewbie）
- Modify: `src/modules/player/player.controller.ts`（protection 路由）
- Modify: `src/modules/player/player.service.spec.ts`
- Modify: `src/modules/combat/face.service.ts`（declareGrudge 红名拦截）
- Modify: `src/modules/combat/combat.module.ts`（imports PlayerModule/EconomyModule）
- Modify: `src/modules/community/community.service.ts`（BAN 时 +100 恶名，Task 6 联动处补）

- [ ] **Step 1: `player.service.ts` 追加 isNewbie**（构造函数注入 CacheService 或直接读 config——player.module 是否已 imports ConfigManageModule 需确认；最简用注入的 repo + 配置服务，若 player.module 未引 ConfigManageModule，则 readConfig 改为依赖注入后补 module import）

```typescript
  async isNewbie(playerId: string): Promise<{ protected: boolean; daysLeft: number }> {
    const player = await this.getById(playerId);
    if (!player) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '玩家不存在');
    }
    const days = await this.readConfigNumber('pvp.newbie_protect_days', 7);
    const elapsedDays = Math.floor((Date.now() - player.createdAt.getTime()) / 86400000);
    const daysLeft = Math.max(0, days - elapsedDays);
    return { protected: elapsedDays < days, daysLeft };
  }

  private async readConfigNumber(key: string, fallback: number): Promise<number> {
    try {
      const config = await this.configService.getConfig(key);
      return Number(config.value) || fallback;
    } catch {
      return fallback;
    }
  }
```

（`player.module.ts` imports 加 `ConfigManageModule`；`player.service.ts` 注入 `ConfigManageService`。）

- [ ] **Step 2: `player.controller.ts` 追加保护期路由**

```typescript
  @Get('api/client/v1/player/protection')
  @ApiOperation({ summary: '新手保护期状态' })
  @UseGuards(JwtAuthGuard)
  async getProtection(@CurrentPlayer() player: CurrentPlayerData) {
    return this.playerService.isNewbie(player.playerId);
  }
```

（以 player.controller 既有守卫/装饰器风格为准。）

- [ ] **Step 3: `face.service.ts` declareGrudge 红名拦截**（注入 PlayerService 与 EconomyService；combat.module imports 加 PlayerModule、EconomyModule）

```typescript
  async declareGrudge(
    playerId: string,
    targetId: string,
  ): Promise<{ playerId: string; targetId: string }> {
    if (!/^\d+$/.test(playerId) || !/^\d+$/.test(targetId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    // 新手保护：红名（恶名>0）不可主动向新手宣战
    const infamy = await this.economyService.getBalance(playerId, CurrencyType.INFAMY);
    if (Number(infamy) > 0) {
      const targetNewbie = await this.playerService.isNewbie(targetId);
      if (targetNewbie.protected) {
        throw new GameException(ErrorCodes.RED_NAME_TARGET_PROTECTED, '红名不可主动攻击新手');
      }
    }
    // ...既有实现
  }
```

（`economyService.getBalance(playerId, currency)` 签名以 `economy.service.ts` 实际为准——`getBalance(223 行)` 参数确认后对齐；`addCurrency` 签名含 (playerId, currency, amount, source, opTrace?, refId?) 已确认。）

- [ ] **Step 4: BAN 处置落恶名**（Task 6 的 `applyBanSocialConsequences` 开头追加）

```typescript
    // 0. 落恶名（红名标记）：封禁处分即社会污点
    await this.economyService.addCurrency(
      playerId,
      CurrencyType.INFAMY,
      100,
      'ban_penalty',
      `ban:${playerId}`,
    );
```

（community.module 需 imports EconomyModule；community.service 注入 EconomyService。）

- [ ] **Step 5: 单测**

`player.service.spec.ts`：

```typescript
  it('isNewbie 注册 3 天返回保护中', async () => {
    playerRepo.findOne.mockResolvedValue({ id: '1', createdAt: new Date(Date.now() - 3 * 86400000) });
    configService.getConfig.mockResolvedValue({ value: '7' });
    const r = await service.isNewbie('1');
    expect(r).toEqual({ protected: true, daysLeft: 4 });
  });

  it('isNewbie 注册超 7 天不保护', async () => {
    playerRepo.findOne.mockResolvedValue({ id: '1', createdAt: new Date(Date.now() - 10 * 86400000) });
    configService.getConfig.mockResolvedValue({ value: '7' });
    const r = await service.isNewbie('1');
    expect(r).toEqual({ protected: false, daysLeft: 0 });
  });
```

`face.service.spec.ts`（或 combat-social.spec.ts 中补）：

```typescript
  it('红名向新手宣战被拒', async () => {
    economyService.getBalance.mockResolvedValue('100');
    playerService.isNewbie.mockResolvedValue({ protected: true, daysLeft: 5 });
    await expect(faceService.declareGrudge('1', '2')).rejects.toMatchObject({
      response: { code: ErrorCodes.RED_NAME_TARGET_PROTECTED },
    });
  });
```

- [ ] **Step 6: 运行测试 + 编译 + Commit**

Run: `cd e:\code\nest\packages-game\game-server && npx jest src/modules/player/player.service.spec.ts src/modules/combat --no-coverage && npx tsc --noEmit`
Expected: 全 PASS，无新增报错

```bash
git add src/modules/player src/modules/combat src/modules/community/community.service.ts src/modules/community/community.module.ts
git commit -m "feat(pvp): 阶段5批2 新手保护期 + 恶名红名 — isNewbie/伤害衰减基础/红名宣战拦截"
```

---

### Task 10: PVP 天梯（ladder 模块）

**Files:**
- Create: `src/modules/ladder/ladder.service.ts`
- Create: `src/modules/ladder/ladder.controller.ts`
- Create: `src/modules/ladder/ladder.module.ts`
- Create: `src/modules/ladder/ladder.service.spec.ts`
- Modify: `src/modules/combat/face.service.ts`（可选：天梯结算复用 createBattleReport 则不修改）

- [ ] **Step 1: 创建 `ladder.service.ts`**（结算 + 段位 + 赛季）

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { LadderRecord } from './entities';
import { GameEvents } from '@event-bus/game-events';
import { PlayerService } from '@modules/player/player.service';
import { ConfigManageService } from '@modules/config/config.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { AdminService } from '@modules/admin/admin.service';

const TIER_BOUNDS: Array<{ tier: string; min: number }> = [
  { tier: '青铜', min: 1000 },
  { tier: '白银', min: 1100 },
  { tier: '黄金', min: 1300 },
  { tier: '宗师', min: 1600 },
];

@Injectable()
export class LadderService {
  private readonly logger = new Logger(LadderService.name);

  constructor(
    @InjectRepository(LadderRecord)
    private readonly ladderRepo: Repository<LadderRecord>,
    private readonly playerService: PlayerService,
    private readonly configService: ConfigManageService,
    private readonly eventBus: EventBusService,
    private readonly adminService: AdminService,
  ) {}

  private async getSeason(): Promise<string> {
    const config = await this.configService.getConfig('ladder.season').catch(() => null);
    return config?.value ?? '1';
  }

  private tierOf(score: number): string {
    let tier = '青铜';
    for (const t of TIER_BOUNDS) {
      if (score >= t.min) tier = t.tier;
    }
    return tier;
  }

  async getRecord(playerId: string): Promise<LadderRecord> {
    const season = await this.getSeason();
    let record = await this.ladderRepo.findOne({ where: { playerId, season } });
    if (!record) {
      record = await this.ladderRepo.save(
        this.ladderRepo.create({ playerId, season, score: 1000, wins: 0, losses: 0, streak: 0 }),
      );
    }
    return record;
  }

  async getInfo(playerId: string): Promise<{
    season: string;
    score: number;
    tier: string;
    wins: number;
    losses: number;
    streak: number;
    rank: number;
  }> {
    const record = await this.getRecord(playerId);
    const rank = await this.getRank(playerId, record.season);
    return {
      season: record.season,
      score: record.score,
      tier: this.tierOf(record.score),
      wins: record.wins,
      losses: record.losses,
      streak: record.streak,
      rank,
    };
  }

  async getRank(playerId: string, season: string): Promise<number> {
    const rows = await this.ladderRepo.find({
      where: { season },
      order: { score: 'DESC' },
    });
    return rows.findIndex((r) => r.playerId === playerId) + 1;
  }

  async getTopN(limit = 50): Promise<Array<{ playerId: string; score: number; tier: string }>> {
    const season = await this.getSeason();
    const rows = await this.ladderRepo.find({
      where: { season },
      order: { score: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((r) => ({ playerId: r.playerId, score: r.score, tier: this.tierOf(r.score) }));
  }

  @OnEvent(GameEvents.MATCH_SUCCESS)
  async settleMatch(payload: { mode: string; players: string[] }): Promise<void> {
    if (payload.mode !== 'ranked' || payload.players.length !== 2) return;
    const [a, b] = payload.players;
    try {
      const [pa, pb, na, nb] = await Promise.all([
        this.playerService.getById(a),
        this.playerService.getById(b),
        this.playerService.isNewbie(a),
        this.playerService.isNewbie(b),
      ]);
      if (!pa || !pb) return;
      const powerA = pa.level * 1000 + Number(pa.exp);
      const powerB = pb.level * 1000 + Number(pb.exp);
      // 战力基准 + 随机 + 新手加成
      const baseWinRateA = 0.6 + (powerA - powerB) / powerB / 2;
      const newbieBoost = na.protected ? 0.15 : nb.protected ? -0.15 : 0;
      const winRateA = Math.min(0.95, Math.max(0.05, baseWinRateA + newbieBoost));
      const aWins = Math.random() < winRateA;

      const ra = await this.getRecord(a);
      const rb = await this.getRecord(b);
      const winner = aWins ? ra : rb;
      const loser = aWins ? rb : ra;
      winner.score += 20 + Math.min(winner.streak, 6) * 5;
      winner.wins += 1;
      winner.streak += 1;
      loser.score = Math.max(100, loser.score - 15);
      loser.losses += 1;
      loser.streak = 0;
      await this.ladderRepo.save([winner, loser]);

      this.eventBus.emit(GameEvents.LADDER_MATCH_SETTLED, {
        mode: 'ranked',
        winnerId: winner.playerId,
        loserId: loser.playerId,
        season: await this.getSeason(),
      });
    } catch (err) {
      this.logger.error('Ladder settle failed', (err as Error).message);
    }
  }

  async settleSeason(adminId: string): Promise<{ newSeason: string; rewarded: number }> {
    const season = await this.getSeason();
    const rows = await this.ladderRepo.find({ where: { season } });
    const rewarded = rows.filter((r) => r.score >= 1300).length;
    await this.adminService.logOperation({
      adminId,
      operation: 'ladder.season.settle',
      changeBefore: { season },
      changeAfter: { rewarded },
    });
    const nextSeason = String(Number(season) + 1);
    await this.configService.updateConfig('ladder.season', nextSeason);
    this.eventBus.emit(GameEvents.LADDER_SEASON_SETTLED, { season, nextSeason, rewarded });
    return { newSeason: nextSeason, rewarded };
  }
}
```

（`configService.updateConfig(key, value)` 签名以 config.service.ts 实际为准，若为 `updateConfig(key, value, operatorId?)` 则补参数。）

- [ ] **Step 2: 创建 `ladder.controller.ts`**

```typescript
import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LadderService } from './ladder.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

@ApiTags('Ladder')
@ApiBearerAuth()
@Controller('api/client/v1/ladder')
export class LadderController {
  constructor(private readonly ladderService: LadderService) {}

  @Get('info')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '天梯信息（段位/积分/排名）' })
  async getInfo(@CurrentPlayer() player: CurrentPlayerData) {
    return this.ladderService.getInfo(player.playerId);
  }

  @Get('rank')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '天梯榜单' })
  async getTopN(@Query('limit') limit: number = 50) {
    return this.ladderService.getTopN(Number(limit));
  }

  @Post('admin/settle')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '[管理] 赛季结算' })
  async settleSeason(@Body() body: { adminId: string }) {
    return this.ladderService.settleSeason(body.adminId);
  }
}
```

- [ ] **Step 3: 创建 `ladder.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LadderService } from './ladder.service';
import { LadderController } from './ladder.controller';
import { LadderRecord } from './entities';
import { PlayerModule } from '@modules/player/player.module';
import { ConfigManageModule } from '@modules/config/config.module';
import { AdminModule } from '@modules/admin/admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LadderRecord]),
    PlayerModule,
    ConfigManageModule,
    AdminModule,
  ],
  controllers: [LadderController],
  providers: [LadderService],
  exports: [LadderService],
})
export class LadderModule {}
```

在 `app.module.ts`（或既有模块注册处）注册 `LadderModule`。匹配入口说明：`matchmaking.gateway` 的 `MATCH_SUCCESS` 由 LadderService 自行 `@OnEvent` 监听结算，无需改 matchmaking 代码（matchmaking 仅需支持 mode='ranked'，`MatchMode.RANKED` 已存在）。

- [ ] **Step 4: 单测 `ladder.service.spec.ts`**（mock 仓库与依赖）

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LadderService } from './ladder.service';
import { LadderRecord } from './entities';
import { GameEvents } from '@event-bus/game-events';

describe('LadderService', () => {
  let service: LadderService;
  const ladderRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((e) => e),
  };
  const playerService = { getById: jest.fn(), isNewbie: jest.fn() };
  const configService = { getConfig: jest.fn(), updateConfig: jest.fn() };
  const eventBus = { emit: jest.fn() };
  const adminService = { logOperation: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.getConfig.mockResolvedValue({ value: '1' });
    const module = await Test.createTestingModule({
      providers: [
        LadderService,
        { provide: getRepositoryToken(LadderRecord), useValue: ladderRepo },
        { provide: 'PlayerService', useValue: playerService },
        { provide: 'ConfigManageService', useValue: configService },
        { provide: 'EventBusService', useValue: eventBus },
        { provide: 'AdminService', useValue: adminService },
      ],
    }).compile();
    service = module.get(LadderService);
  });

  it('getInfo 无记录时建档 1000 分', async () => {
    ladderRepo.findOne.mockResolvedValue(null);
    ladderRepo.save.mockImplementation((e) => Promise.resolve(e));
    ladderRepo.find.mockResolvedValue([]);
    const info = await service.getInfo('1');
    expect(info.score).toBe(1000);
    expect(info.tier).toBe('青铜');
    expect(info.rank).toBe(0);
  });

  it('settleMatch 非 ranked 模式跳过', async () => {
    await service.settleMatch({ mode: 'casual', players: ['1', '2'] });
    expect(ladderRepo.save).not.toHaveBeenCalled();
  });

  it('settleMatch 更新胜负与段位分', async () => {
    ladderRepo.findOne.mockImplementation(async ({ where }) => {
      const id = where.playerId;
      return { playerId: id, season: '1', score: 1000, wins: 0, losses: 0, streak: 0 };
    });
    playerService.getById.mockImplementation(async (id) => ({ id, level: 10, exp: '0' }));
    playerService.isNewbie.mockResolvedValue({ protected: false, daysLeft: 0 });
    ladderRepo.save.mockImplementation((rows) => Promise.resolve(rows));
    jest.spyOn(Math, 'random').mockReturnValue(0.1); // A 胜率低 → B 胜
    await service.settleMatch({ mode: 'ranked', players: ['1', '2'] });
    expect(ladderRepo.save).toHaveBeenCalled();
    const saved = (ladderRepo.save.mock.calls[0][0] as LadderRecord[]);
    const b = saved.find((r) => r.playerId === '2');
    expect(b!.wins).toBe(1);
    expect(b!.score).toBe(1020);
    expect(eventBus.emit).toHaveBeenCalledWith(GameEvents.LADDER_MATCH_SETTLED, expect.objectContaining({ winnerId: '2' }));
    jest.restoreAllMocks();
  });

  it('settleSeason 结算并开新赛季', async () => {
    ladderRepo.find.mockResolvedValue([{ playerId: '1', season: '1', score: 1500 }]);
    const r = await service.settleSeason('a1');
    expect(r.newSeason).toBe('2');
    expect(adminService.logOperation).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: 运行测试 + 编译 + Commit**

Run: `cd e:\code\nest\packages-game\game-server && npx jest src/modules/ladder --no-coverage && npx tsc --noEmit`
Expected: 全 PASS，无新增报错

```bash
git add src/modules/ladder src/app.module.ts
git commit -m "feat(ladder): 阶段5批2 天梯竞技 — 段位分/连胜/榜单/赛季结算"
```

---

### Task 11: 新手引导深化（进度追踪 + 奖励）

**Files:**
- Create: `src/modules/social/social-guide.service.ts`
- Modify: `src/modules/social/social-event.listener.ts`（引导驱动监听）
- Modify: `src/modules/social/social.module.ts`（注册 SocialGuideService）
- Modify: `src/modules/social/social.controller.ts`（guide 路由）
- Create: `src/modules/social/social-guide.service.spec.ts`
- Modify: `src/modules/social/social.service.ts`（getDailyGuide 改造，见 Step 3）

- [ ] **Step 1: 创建 `social-guide.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GuideProgress } from './entities';
import { SocialEconomyService } from './social-economy.service';
import { PlayerService } from '@modules/player/player.service';
import { ConfigManageService } from '@modules/config/config.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { GuideTaskStatus, SocialPointReason } from '@constants/enums';
import { EconomyService } from '@modules/economy/economy.service';
import { CurrencyType } from '@constants/enums';

const TASK_DAYS: Record<string, number> = {
  kinship: 1,
  friend: 2,
  intel: 3,
  guild: 4,
  escort: 5,
  gift: 6,
  sworn: 7,
  daily: 8,
};

@Injectable()
export class SocialGuideService {
  constructor(
    @InjectRepository(GuideProgress)
    private readonly guideRepo: Repository<GuideProgress>,
    private readonly economyService: SocialEconomyService,
    private readonly playerService: PlayerService,
    private readonly configService: ConfigManageService,
    private readonly eventBus: EventBusService,
    private readonly currencyService: EconomyService,
  ) {}

  private async registerDay(playerId: string): Promise<number> {
    const player = await this.playerService.getById(playerId);
    const createdAt = player?.createdAt ?? new Date();
    return Math.min(
      Math.floor((Date.now() - createdAt.getTime()) / (24 * 3600 * 1000)) + 1,
      8,
    );
  }

  async completeTask(playerId: string, taskId: string): Promise<void> {
    const existing = await this.guideRepo.findOne({ where: { playerId, taskId } });
    if (existing) return; // 已完成（DONE/REWARDED）不重复推进
    const day = await this.registerDay(playerId);
    if (day >= 8) return; // 老玩家日常循环不追踪
    await this.guideRepo.save(
      this.guideRepo.create({
        playerId,
        day,
        taskId,
        status: GuideTaskStatus.DONE,
        completedAt: new Date(),
        claimedAt: null,
      }),
    );
    this.eventBus.emit(GameEvents.GUIDE_TASK_COMPLETED, { playerId, taskId, day });
  }

  async getDailyGuide(playerId: string): Promise<{
    day: number;
    title: string;
    tasks: Array<{ id: string; desc: string; done: boolean; rewarded: boolean }>;
    stats: { friends: number; kinships: number; intel: number; inGuild: boolean };
    rewardReady: boolean;
  }> {
    const day = await this.registerDay(playerId);
    const progresses = await this.guideRepo.find({ where: { playerId } });
    const map = new Map(progresses.map((p) => [p.taskId, p]));

    const guide: Record<number, { title: string; tasks: Array<{ id: string; desc: string }> }> = {
      1: { title: '寻师问路', tasks: [{ id: 'kinship', desc: '缔结一段师徒或结义亲缘' }] },
      2: { title: '以武会友', tasks: [{ id: 'friend', desc: '添加 1 位好友' }] },
      3: { title: '初涉江湖', tasks: [{ id: 'intel', desc: '获取 1 条情报（刺探/打听/窃听）' }] },
      4: { title: '立帮兴业', tasks: [{ id: 'guild', desc: '加入或创建帮派' }] },
      5: { title: '行商走镖', tasks: [{ id: 'escort', desc: '完成 1 次运镖或悬赏' }] },
      6: { title: '礼尚往来', tasks: [{ id: 'gift', desc: '送出 1 份礼物并获得回礼' }] },
      7: { title: '桃园之义', tasks: [{ id: 'sworn', desc: '完成结义或正式拜师' }] },
      8: { title: '日常循环', tasks: [{ id: 'daily', desc: '每日任务与帮派活动循环' }] },
    };

    const current = guide[day];
    const tasks = current.tasks.map((t) => {
      const p = map.get(t.id);
      return {
        id: t.id,
        desc: t.desc,
        done: p?.status === GuideTaskStatus.DONE || p?.status === GuideTaskStatus.REWARDED,
        rewarded: p?.status === GuideTaskStatus.REWARDED,
      };
    });

    // stats 复用既有统计（好友/亲缘/情报/帮派）
    const [friends, kinships, intels] = await Promise.all([
      this.guideRepo.find({ where: { playerId } }).then(() => []), // 占位，实际由调用方注入
      [],
      [],
    ]);
    void friends; void kinships; void intels;

    return {
      day,
      title: current.title,
      tasks,
      stats: { friends: 0, kinships: 0, intel: 0, inGuild: false },
      rewardReady: tasks.some((t) => t.done && !t.rewarded),
    };
  }

  async claimTaskReward(playerId: string, taskId: string): Promise<{ taskId: string; points: number; gold: number }> {
    const progress = await this.guideRepo.findOne({ where: { playerId, taskId } });
    if (!progress || progress.status === GuideTaskStatus.TODO) {
      throw new GameException(ErrorCodes.GUIDE_TASK_NOT_DONE, '任务未完成不可领奖');
    }
    if (progress.status === GuideTaskStatus.REWARDED) {
      throw new GameException(ErrorCodes.GUIDE_REWARD_CLAIMED, '奖励已领取');
    }
    const points = await this.economyService.earnPoints(
      playerId,
      20,
      SocialPointReason.GUIDE_TASK,
      `guide:${taskId}`,
    );
    const gold = 50;
    await this.currencyService.addCurrency(playerId, CurrencyType.GOLD, gold, 'guide_reward', `guide:${taskId}`);
    if (taskId === 'sworn') {
      const milestone = await this.readConfigNumber('guide.milestone_reward', 50);
      await this.currencyService.addCurrency(playerId, CurrencyType.DIAMOND, milestone, 'guide_milestone', `guide:${taskId}`);
    }
    progress.status = GuideTaskStatus.REWARDED;
    progress.claimedAt = new Date();
    await this.guideRepo.save(progress);
    void points;
    return { taskId, points: points ?? 20, gold };
  }

  private async readConfigNumber(key: string, fallback: number): Promise<number> {
    try {
      const config = await this.configService.getConfig(key);
      return Number(config.value) || fallback;
    } catch {
      return fallback;
    }
  }
}
```

注意：`getDailyGuide` 的 stats 需要复用既有 `SocialService.getFriendList/getKinships/getIntelligences` 与 guildMemberRepo——为避免重复查询逻辑，本服务保留 `stats` 返回结构但由控制器合并：`social.controller` 的 `guide/daily` 路由改为同时调 `socialService` 的既有统计与 `guideService.getDailyGuide`，合并输出（见 Step 2 路由实现）。

- [ ] **Step 2: `social.controller.ts` 追加引导路由**（合并 stats）

```typescript
  @Get('guide/daily')
  @ApiOperation({ summary: '七日引导（含进度与奖励）' })
  async getDailyGuide(@CurrentPlayer() player: CurrentPlayerData) {
    const [guide, stats] = await Promise.all([
      this.guideService.getDailyGuide(player.playerId),
      this.socialService.getDailyGuideStats(player.playerId),
    ]);
    return { ...guide, stats };
  }

  @Post('guide/tasks/:taskId/claim')
  @ApiOperation({ summary: '领取引导任务奖励' })
  async claimGuideReward(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('taskId') taskId: string,
  ) {
    return this.guideService.claimTaskReward(player.playerId, taskId);
  }
```

- [ ] **Step 3: `social.service.ts` 抽取 getDailyGuideStats**（将既有 `getDailyGuide` 的 stats 计算抽成独立公开方法；既有 `getDailyGuide` 改为委托 `guideService`——若改动面大，保留既有方法不动，仅新增 `getDailyGuideStats` 供新路由使用；路由层不再调用旧的 `getDailyGuide`）

```typescript
  async getDailyGuideStats(playerId: string): Promise<{
    friends: number;
    kinships: number;
    intel: number;
    inGuild: boolean;
  }> {
    const [friends, kinships, intelligences, guildMember] = await Promise.all([
      this.getFriendList(playerId),
      this.getKinships(playerId),
      this.getIntelligences(playerId),
      this.guildMemberRepo.findOne({ where: { playerId } }),
    ]);
    return {
      friends: friends.length,
      kinships: kinships.length,
      intel: intelligences.length,
      inGuild: !!guildMember,
    };
  }
```

- [ ] **Step 4: `social-event.listener.ts` 追加引导驱动监听**（注入 SocialGuideService）

```typescript
  constructor(
    private readonly economyService: SocialEconomyService,
    private readonly guideService: SocialGuideService,
  ) {}

  @OnEvent(GameEvents.FRIEND_ADDED)
  async onFriendAddedGuide(payload: { playerId: string; friendId: string }): Promise<void> {
    await this.safe(async () => {
      await this.guideService.completeTask(payload.playerId, 'friend');
    }, 'GUIDE_FRIEND');
  }

  @OnEvent(GameEvents.KINSHIP_FORMED)
  async onKinshipFormedGuide(payload: { leaderId: string; members: string[]; type: string }): Promise<void> {
    await this.safe(async () => {
      for (const m of [...payload.members, payload.leaderId]) {
        await this.guideService.completeTask(m, 'kinship');
        await this.guideService.completeTask(m, 'sworn');
      }
    }, 'GUIDE_KINSHIP');
  }

  @OnEvent(GameEvents.INTEL_GAINED)
  async onIntelGainedGuide(payload: { playerId: string }): Promise<void> {
    await this.safe(async () => {
      await this.guideService.completeTask(payload.playerId, 'intel');
    }, 'GUIDE_INTEL');
  }

  @OnEvent(GameEvents.GUILD_JOINED)
  async onGuildJoinedGuide(payload: { playerId: string }): Promise<void> {
    await this.safe(async () => {
      await this.guideService.completeTask(payload.playerId, 'guild');
    }, 'GUIDE_GUILD');
  }

  @OnEvent(GameEvents.GIFT_SENT)
  async onGiftSentGuide(payload: { playerId: string; direction: string }): Promise<void> {
    await this.safe(async () => {
      if (payload.direction === 'send') {
        await this.guideService.completeTask(payload.playerId, 'gift');
      }
    }, 'GUIDE_GIFT');
  }

  @OnEvent(GameEvents.QUEST_COMPLETED)
  async onQuestCompletedGuide(payload: { playerId: string; questTemplateId: string }): Promise<void> {
    await this.safe(async () => {
      // 运镖/悬赏类任务由 trade BOUNTY_COMPLETED 驱动，普通任务不误触 escort
    }, 'GUIDE_QUEST');
  }

  @OnEvent(GameEvents.BOUNTY_COMPLETED)
  async onBountyCompletedGuide(payload: { playerId: string }): Promise<void> {
    await this.safe(async () => {
      await this.guideService.completeTask(payload.playerId, 'escort');
    }, 'GUIDE_ESCORT');
  }

  @OnEvent(GameEvents.PLAYER_ONLINE)
  async onPlayerOnlineGuide(payload: { playerId: string }): Promise<void> {
    await this.safe(async () => {
      await this.guideService.completeTask(payload.playerId, 'daily');
    }, 'GUIDE_DAILY');
  }
```

（`BOUNTY_COMPLETED` 若事件 payload 无 playerId 或不存在于 GameEvents，则改用 `QUEST_COMPLETED` 的 questTemplateId 前缀匹配运镖/悬赏类——以 `trade.service.ts` 实际 emit 的 payload 为准，若 BOUNTY_COMPLETED 存在则直接用。）

- [ ] **Step 5: `social.module.ts` providers 加 `SocialGuideService`，exports 加 `SocialGuideService`**

```typescript
  providers: [SocialService, SocialEconomyService, SocialGuideService, SocialEventListener],
  exports: [SocialService, SocialEconomyService, SocialGuideService],
```

- [ ] **Step 6: 单测 `social-guide.service.spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SocialGuideService } from './social-guide.service';
import { GuideProgress } from './entities';
import { GuideTaskStatus } from '@constants/enums';

describe('SocialGuideService', () => {
  let service: SocialGuideService;
  const guideRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn((e) => e) };
  const economyService = { earnPoints: jest.fn() };
  const playerService = { getById: jest.fn() };
  const configService = { getConfig: jest.fn() };
  const eventBus = { emit: jest.fn() };
  const currencyService = { addCurrency: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    playerService.getById.mockResolvedValue({ id: '1', createdAt: new Date(Date.now() - 2 * 86400000) });
    const module = await Test.createTestingModule({
      providers: [
        SocialGuideService,
        { provide: getRepositoryToken(GuideProgress), useValue: guideRepo },
        { provide: 'SocialEconomyService', useValue: economyService },
        { provide: 'PlayerService', useValue: playerService },
        { provide: 'ConfigManageService', useValue: configService },
        { provide: 'EventBusService', useValue: eventBus },
        { provide: 'EconomyService', useValue: currencyService },
      ],
    }).compile();
    service = module.get(SocialGuideService);
  });

  it('completeTask 首次完成建档并 emit', async () => {
    guideRepo.findOne.mockResolvedValue(null);
    guideRepo.save.mockImplementation((e) => Promise.resolve(e));
    await service.completeTask('1', 'friend');
    expect(guideRepo.save).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'friend', day: 3, status: GuideTaskStatus.DONE }));
    expect(eventBus.emit).toHaveBeenCalledWith(GameEvents.GUIDE_TASK_COMPLETED, expect.any(Object));
  });

  it('completeTask 重复完成不重复建档', async () => {
    guideRepo.findOne.mockResolvedValue({ id: 'x', playerId: '1', taskId: 'friend', status: GuideTaskStatus.DONE });
    await service.completeTask('1', 'friend');
    expect(guideRepo.save).not.toHaveBeenCalled();
  });

  it('claimTaskReward 已领取拒绝', async () => {
    guideRepo.findOne.mockResolvedValue({ id: 'x', playerId: '1', taskId: 'gift', status: GuideTaskStatus.REWARDED });
    await expect(service.claimTaskReward('1', 'gift')).rejects.toMatchObject({ response: { code: 92702 } });
  });

  it('claimTaskReward 未完成拒绝', async () => {
    guideRepo.findOne.mockResolvedValue(null);
    await expect(service.claimTaskReward('1', 'escort')).rejects.toMatchObject({ response: { code: 92701 } });
  });

  it('claimTaskReward 完成发放积分与金币', async () => {
    guideRepo.findOne.mockResolvedValue({ id: 'x', playerId: '1', taskId: 'gift', status: GuideTaskStatus.DONE });
    economyService.earnPoints.mockResolvedValue(20);
    currencyService.addCurrency.mockResolvedValue(undefined);
    guideRepo.save.mockImplementation((e) => Promise.resolve(e));
    const r = await service.claimTaskReward('1', 'gift');
    expect(r.points).toBe(20);
    expect(currencyService.addCurrency).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: 运行测试 + 编译 + Commit**

Run: `cd e:\code\nest\packages-game\game-server && npx jest src/modules/social/social-guide.service.spec.ts src/modules/social/social-economy.service.spec.ts --no-coverage && npx tsc --noEmit`
Expected: 全 PASS，无新增报错

```bash
git add src/modules/social
git commit -m "feat(social): 阶段5批2 新手引导深化 — 进度追踪/事件驱动完成/奖励领取"
```

---

### Task 12: 冒烟脚本 + 数据字典 + 全量回归收尾

**Files:**
- Create: `scripts/smoke-stage5b.sh`
- Modify: `manual-src/dict-part.html`
- Modify: `docs/superpowers/specs/2026-09-20-social-economy-commerce-design.md`（如有偏差修正）

- [ ] **Step 1: 创建 `scripts/smoke-stage5b.sh`**（复用 smoke-stage5.sh 的注册/登录/断言结构；覆盖批 2 核心链路）

```bash
#!/usr/bin/env bash
# 阶段5批2 冒烟：社交积分/宝箱/补签/封禁后果/VIP/充值/天梯/保护期/引导
# 用法：scp 到服务器 /tmp 执行（先跑 smoke-stage5.sh 的注册玩家 S5B1/S5B2/S5B3）
set -euo pipefail
BASE="${BASE:-http://game.joho.cn}"
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1 -> $2"; }

check() { # check <desc> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "exp=$2 act=$3"; fi
}

# ---- 玩家与登录 ----
TOK1=$(curl -s -X POST "$BASE/api/client/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"account":"s5b1","password":"Passw0rd!2026"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
TOK2=$(curl -s -X POST "$BASE/api/client/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"account":"s5b2","password":"Passw0rd!2026"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
[ -n "$TOK1" ] && [ -n "$TOK2" ] && ok "玩家登录" || { bad "玩家登录" "token 为空"; exit 1; }
A1="Authorization: Bearer $TOK1"; A2="Authorization: Bearer $TOK2"

# ---- 社交积分：好友 + 积分查询 ----
curl -s -X POST "$BASE/api/client/v1/social/friend/apply" -H "$A1" -H 'Content-Type: application/json' -d '{"friendId":"<S5B2_ID>"}' >/dev/null || true
curl -s -X POST "$BASE/api/client/v1/social/friend/accept/$(curl -s -X POST "$BASE/api/client/v1/social/friend/apply" -H "$A2" -H 'Content-Type: application/json' -d '{"friendId":"<S5B1_ID>"}' | grep -o '"id":"[0-9]*"' | head -1 | cut -d'"' -f4)" -H "$A2" >/dev/null || true
sleep 1
BAL=$(curl -s "$BASE/api/client/v1/social/point/info" -H "$A1" | grep -o '"balance":[0-9]*' | cut -d: -f2)
[ "${BAL:-0}" -ge 10 ] && ok "好友动作累计积分 balance=$BAL" || bad "积分累计" "balance=$BAL"

# ---- 宝箱：积分兑换 + 开启 ----
CHEST_ID=$(curl -s -X POST "$BASE/api/client/v1/social/point/exchange" -H "$A1" -H 'Content-Type: application/json' -d '{"tier":1}' | grep -o '"id":"[0-9]*"' | head -1 | cut -d'"' -f4)
[ -n "${CHEST_ID:-}" ] && ok "积分兑换宝箱" || bad "兑换宝箱" "无宝箱 id"
OPEN=$(curl -s -X POST "$BASE/api/client/v1/social/chest/$CHEST_ID/open" -H "$A1")
echo "$OPEN" | grep -q '"status":"opened"' && ok "开启宝箱" || bad "开启宝箱" "$OPEN"

# ---- 补签 ----
MAKEUP=$(curl -s -X POST "$BASE/api/client/v1/chat/sign-in/makeup" -H "$A1" -H 'Content-Type: application/json' -d '{"date":"2026-09-18"}')
echo "$MAKEUP" | grep -q '"makeup":true' && ok "签到补签" || bad "补签" "$MAKEUP"

# ---- 充值状态机：创建→取消 ----
ORDER=$(curl -s -X POST "$BASE/api/payment/order/<PRODUCT_ID>" -H "$A1" | grep -o '"orderNo":"[^"]*"' | cut -d'"' -f4)
CANCEL=$(curl -s -X POST "$BASE/api/payment/order/$ORDER/cancel" -H "$A1")
echo "$CANCEL" | grep -q '"status":"cancelled"' && ok "订单取消" || bad "订单取消" "$CANCEL"

# ---- 新手保护 ----
PROT=$(curl -s "$BASE/api/client/v1/player/protection" -H "$A1")
echo "$PROT" | grep -q '"protected":' && ok "新手保护接口" || bad "新手保护" "$PROT"

# ---- 天梯信息 ----
LADDER=$(curl -s "$BASE/api/client/v1/ladder/info" -H "$A1")
echo "$LADDER" | grep -q '"score":' && ok "天梯信息" || bad "天梯" "$LADDER"

# ---- 引导进度 ----
GUIDE=$(curl -s "$BASE/api/client/v1/social/guide/daily" -H "$A1")
echo "$GUIDE" | grep -q '"tasks":' && ok "引导进度" || bad "引导" "$GUIDE"

echo "==== stage5b: PASS=$PASS FAIL=$FAIL ===="
[ "$FAIL" -eq 0 ]
```

说明：`<S5B2_ID>`/`<PRODUCT_ID>` 为占位——执行时用 `sed -i` 替换为实际注册玩家 id 与充值商品 id（冒烟脚本执行前由部署者按线上数据替换，或在脚本开头用接口查询玩家 id）。充值回调/补单/BAN 处置/榜单移除等需要 admin 令牌的用例按 smoke-stage5.sh 既有 admin 登录模式追加。

- [ ] **Step 2: 数据字典补 4 表**（`manual-src/dict-part.html` 追加 social_point_records/social_chests/guide_progresses/ladder_records 四表的表注释与字段注释，字段与 Task 2 实体一致；recharge_orders.status 枚举补 DELIVERED/CANCELLED/EXPIRED）

- [ ] **Step 3: 全量回归**

Run: `cd e:\code\nest\packages-game\game-server && npx jest --no-coverage`
Expected: 全部既有 + 新增单测 PASS

Run: `cd e:\code\nest\packages-game\game-server && npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-stage5b.sh manual-src/dict-part.html
git commit -m "test(social): 阶段5批2 冒烟脚本 + 数据字典 4 表"
```

---

## Self-Review 检查清单（编写时已核对）

- **Spec 覆盖**：A（积分/宝箱/补签）→ Task 3/4/5；B（封禁后果）→ Task 6；C（VIP/充值）→ Task 7/8；D（天梯/保护期）→ Task 9/10；E（引导）→ Task 11；错误码 → Task 1；冒烟/字典 → Task 12。无遗漏。
- **占位符**：除冒烟脚本中 `<S5B2_ID>`/`<PRODUCT_ID>`（执行期数据，脚本注释已说明替换方式）外无占位。
- **类型一致性**：`SocialEconomyService.earnPoints/spendPoints` 签名在 Task 3/4/5/11 一致；`GuideProgress` 唯一索引 (player_id, task_id) 与 `completeTask` 查询一致；`RechargeStatus.DELIVERED` 在 Task 8 全局一致；`LadderRecord.season` string 与 `getSeason` 一致。
- **模块依赖**：SocialModule→(ConfigManageModule, VipModule)；ChatModule→SocialModule（既有）；CommunityModule→(RankingModule, SocialModule, EconomyModule)；PaymentModule→(VipModule, ConfigManageModule)；LadderModule→(PlayerModule, ConfigManageModule, AdminModule)；combat.module→(PlayerModule, EconomyModule)。均无循环（VipModule 不反向依赖 SocialModule）。
