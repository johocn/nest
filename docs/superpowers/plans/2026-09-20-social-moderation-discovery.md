# 社交治理与发现（阶段 5 批 1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 game-server 补齐社区治理（举报→admin 台账处理→禁言生效）与社交发现（图谱协同好友推荐），形成"发现→建立→治理"完整社交闭环。

**Architecture:** 扩展 social 模块承载举报/拉黑/推荐（新增 player_reports、player_blocks 两张表 + isBlocked 门面），chat 发言链路补禁言（复用 AuthService.getAccountRestrictions 与预留错误码 ACCOUNT_MUTED）与私聊拉黑校验，community 模块复用阶段 4 台账模式新增举报台账与处置（调 AuthService.applyPenalty）。所有模块改动均验证无循环依赖。

**Tech Stack:** NestJS 11 + TypeORM + PostgreSQL + Redis + Jest。不新增 npm 依赖。

**Spec:** `docs/superpowers/specs/2026-09-20-social-moderation-discovery-design.md`

---

## 文件结构

**新建：**
- `src/modules/social/entities/player-report.entity.ts` — 举报表实体
- `src/modules/social/entities/player-block.entity.ts` — 拉黑表实体
- `scripts/smoke-stage5.sh` — 阶段 5 冒烟脚本

**修改：**
- `src/constants/enums.ts` — 新增 ReportTargetType/ReportReason/ReportStatus 枚举
- `src/constants/error-codes.ts` — 新增 92201-92207 错误码区
- `src/event-bus/game-events.ts` — 新增 REPORT_SUBMITTED/PLAYER_BLOCKED 事件
- `src/modules/social/entities/index.ts` — 导出新实体
- `src/modules/social/social.module.ts` — forFeature 加 PlayerReport/PlayerBlock/Player
- `src/modules/social/social.service.ts` — 举报/拉黑/isBlocked/推荐方法
- `src/modules/social/social.controller.ts` — 举报/拉黑/推荐客户端路由
- `src/modules/social/social.service.spec.ts` — 新方法单测
- `src/modules/social/social.controller.spec.ts` — 新路由单测（如存在）
- `src/modules/chat/chat.module.ts` — imports 加 AuthModule/SocialModule
- `src/modules/chat/chat.service.ts` — 发言链路禁言+拉黑校验
- `src/modules/chat/chat.service.spec.ts` — 新校验单测
- `src/modules/community/community.module.ts` — forFeature 加 PlayerReport/Player，imports 加 AuthModule
- `src/modules/community/community.service.ts` — 举报台账/处置
- `src/modules/community/community.controller.ts` — admin 举报路由
- `src/modules/community/community.service.spec.ts` — 台账单测
- `manual-src/dict-part.html` — 数据字典补 2 表

---

### Task 1: 枚举与错误码扩展

**Files:**
- Modify: `src/constants/enums.ts`
- Modify: `src/constants/error-codes.ts`
- Modify: `src/event-bus/game-events.ts`

- [ ] **Step 1: 在 `enums.ts` 追加三个枚举**（放在文件末尾既有枚举之后，参考 `FeedbackStatus` 风格——小写枚举值）

```typescript
export enum ReportTargetType {
  PLAYER = 'player',
  CHAT_MESSAGE = 'chat_message',
  GUILD = 'guild',
}

export enum ReportReason {
  ABUSE = 'abuse',
  AD = 'ad',
  FRAUD = 'fraud',
  CHEAT = 'cheat',
  OTHER = 'other',
}

export enum ReportStatus {
  PENDING = 'pending',
  PROCESSED = 'processed',
  IGNORED = 'ignored',
}
```

- [ ] **Step 2: 在 `error-codes.ts` 追加错误码区**（文件末尾 `聊天深化` 区块之后）

```typescript
  // 社交治理 92201-92299
  BLOCK_SELF: 92201,
  BLOCK_LIMIT: 92202,
  TARGET_BLOCKED_YOU: 92203,
  REPORT_COOLDOWN: 92204,
  REPORT_INVALID_TARGET: 92205,
  REPORT_NOT_FOUND: 92206,
  REPORT_ALREADY_HANDLED: 92207,
} as const;
```

注意：把原来的 `} as const;` 行删除，换成上面的 `}` + `} as const;`（即最后一个枚举后紧跟新错误码再闭合）。

- [ ] **Step 3: 在 `game-events.ts` 追加两个事件**（`AMBASSADOR_APPOINTED` 附近）

```typescript
  REPORT_SUBMITTED: 'community.report.submitted',
  PLAYER_BLOCKED: 'social.player.blocked',
```

- [ ] **Step 4: 编译验证**

Run: `cd e:\code\nest\packages-game\game-server && npx tsc --noEmit`
Expected: 无报错（如既有类型错误与本次无关则忽略并注明）

- [ ] **Step 5: Commit**

```bash
git add src/constants/enums.ts src/constants/error-codes.ts src/event-bus/game-events.ts
git commit -m "feat(social): 阶段5批1 枚举与错误码 — 举报/拉黑类型、92201 区错误码、治理事件"
```

---

### Task 2: 实体 PlayerReport + PlayerBlock

**Files:**
- Create: `src/modules/social/entities/player-report.entity.ts`
- Create: `src/modules/social/entities/player-block.entity.ts`
- Modify: `src/modules/social/entities/index.ts`

- [ ] **Step 1: 创建 `player-report.entity.ts`**（列定义与 spec 4.1 一致，风格参考 `feedback-suggestion.entity.ts`）

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ReportTargetType, ReportReason, ReportStatus } from '@constants/enums';

@Entity('player_reports')
@Index('idx_report_target', ['targetType', 'targetId'])
@Index('idx_report_status', ['status'])
@Index('idx_report_reporter', ['reporterId'])
export class PlayerReport {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'reporter_id', type: 'bigint' })
  reporterId: string;

  @Column({ name: 'target_type', type: 'enum', enum: ReportTargetType })
  targetType: ReportTargetType;

  @Column({ name: 'target_id', type: 'varchar', length: 64 })
  targetId: string;

  @Column({ type: 'enum', enum: ReportReason })
  reason: ReportReason;

  @Column({ type: 'varchar', length: 500, nullable: true })
  content: string | null;

  @Column({ type: 'enum', enum: ReportStatus, default: ReportStatus.PENDING })
  status: ReportStatus;

  @Column({ name: 'handler_admin_id', type: 'bigint', nullable: true })
  handlerAdminId: string | null;

  @Column({ name: 'handle_action', type: 'varchar', length: 32, nullable: true })
  handleAction: string | null;

  @Column({ name: 'handle_remark', type: 'varchar', length: 255, nullable: true })
  handleRemark: string | null;

  @Column({ name: 'handled_at', type: 'timestamp', nullable: true })
  handledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: 创建 `player-block.entity.ts`**

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('player_blocks')
@Index('idx_block_pair', ['playerId', 'blockedId'], { unique: true })
@Index('idx_block_blocked', ['blockedId'])
export class PlayerBlock {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'blocked_id', type: 'bigint' })
  blockedId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 3: 在 `entities/index.ts` 追加导出**

```typescript
export { PlayerReport } from './player-report.entity';
export { PlayerBlock } from './player-block.entity';
```

- [ ] **Step 4: 编译验证**

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 5: Commit**

```bash
git add src/modules/social/entities/
git commit -m "feat(social): 阶段5批1 实体 — player_reports/player_blocks 表结构"
```

---

### Task 3: SocialService 举报 + 拉黑方法（含 isBlocked 门面）

**Files:**
- Modify: `src/modules/social/social.service.ts`
- Modify: `src/modules/social/social.module.ts`
- Test: `src/modules/social/social.service.spec.ts`

前置说明：social.service 现有 DI 尾部为 `private readonly playerService: PlayerService, private readonly eventBus: EventBusService, @Optional() private readonly random: () => number = Math.random`。本任务新增两个 repo 注入。

- [ ] **Step 1: 更新 `social.module.ts`**：TypeOrmModule.forFeature 数组加 `PlayerReport, PlayerBlock, Player`

```typescript
import { PlayerReport, PlayerBlock } from './entities';
import { Player } from '@modules/player/entities/player.entity';
// forFeature 数组中追加：
      PlayerReport,
      PlayerBlock,
      Player,
```

- [ ] **Step 2: 更新 `social.service.ts` 构造器**（imports 加 `PlayerReport, PlayerBlock`、`MoreThan`、`In`、三个新枚举；构造器注入两个 repo）

```typescript
import { MoreThan, In, Repository } from 'typeorm';
// 既有 entities import 中补充：
  PlayerReport,
  PlayerBlock,
// enums import 中补充：
  ReportTargetType,
  ReportReason,
  ReportStatus,
// 构造器参数（GiftTemplate/Kinship 之后、cacheService 之前）追加：
    @InjectRepository(PlayerReport)
    private readonly reportRepo: Repository<PlayerReport>,
    @InjectRepository(PlayerBlock)
    private readonly blockRepo: Repository<PlayerBlock>,
```

- [ ] **Step 3: 写失败测试**：在 `social.service.spec.ts` 的 providers 数组加两个 mock repo（`getRepositoryToken(PlayerReport)` / `getRepositoryToken(PlayerBlock)`），并在文件末尾追加 describe 块

```typescript
// providers 数组追加（与既有 repo mock 同风格）：
        {
          provide: getRepositoryToken(PlayerReport),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            count: jest.fn(),
            delete: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(PlayerBlock),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            count: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Player),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
```

```typescript
describe('举报与拉黑', () => {
  let service: SocialService;
  let reportRepo: any;
  let blockRepo: any;
  let playerRepo: any;

  beforeEach(() => {
    service = moduleRef.get<SocialService>(SocialService);
    reportRepo = moduleRef.get(getRepositoryToken(PlayerReport));
    blockRepo = moduleRef.get(getRepositoryToken(PlayerBlock));
    playerRepo = moduleRef.get(getRepositoryToken(Player));
    jest.clearAllMocks();
  });

  it('提交举报成功并触发事件', async () => {
    reportRepo.findOne.mockResolvedValueOnce(null); // 无重复
    reportRepo.create.mockReturnValue({});
    reportRepo.save.mockResolvedValue({
      id: '1', reporterId: '100', targetType: ReportTargetType.PLAYER,
      targetId: '200', reason: ReportReason.ABUSE, status: ReportStatus.PENDING,
    });
    const events: string[] = [];
    jest.spyOn(service as any, 'eventBus').mockReturnValue({
      emit: (e: string) => events.push(e),
    });
    playerRepo.findOne.mockResolvedValue({ id: '200' });

    const result = await service.submitReport(
      '100', ReportTargetType.PLAYER, '200', ReportReason.ABUSE, '测试',
    );
    expect(result.status).toBe(ReportStatus.PENDING);
  });

  it('24h 内重复举报同一目标被拒', async () => {
    reportRepo.findOne.mockResolvedValueOnce({ id: '1' }); // 命中重复
    await expect(
      service.submitReport('100', ReportTargetType.PLAYER, '200', ReportReason.AD),
    ).rejects.toMatchObject({ response: { code: ErrorCodes.REPORT_COOLDOWN } });
  });

  it('拉黑自己被拒', async () => {
    await expect(
      service.blockPlayer('100', '100'),
    ).rejects.toMatchObject({ response: { code: ErrorCodes.BLOCK_SELF } });
  });

  it('拉黑超上限被拒', async () => {
    blockRepo.count.mockResolvedValueOnce(200);
    await expect(
      service.blockPlayer('100', '200'),
    ).rejects.toMatchObject({ response: { code: ErrorCodes.BLOCK_LIMIT } });
  });

  it('重复拉黑幂等成功', async () => {
    blockRepo.count.mockResolvedValueOnce(0);
    blockRepo.findOne.mockResolvedValueOnce({ id: '1', playerId: '100', blockedId: '200' });
    const result = await service.blockPlayer('100', '200');
    expect(result.id).toBe('1');
  });

  it('isBlocked 双向命中', async () => {
    blockRepo.findOne.mockResolvedValueOnce({ id: '1' });
    expect(await service.isBlocked('100', '200')).toBe(true);
    blockRepo.findOne.mockResolvedValueOnce(null);
    expect(await service.isBlocked('100', '200')).toBe(false);
  });

  it('取消拉黑删除双向记录', async () => {
    blockRepo.delete.mockResolvedValue({ affected: 1 });
    await service.unblockPlayer('100', '200');
    expect(blockRepo.delete).toHaveBeenCalledTimes(1);
  });
});
```

注意：`moduleRef` 与 `beforeEach` 沿用本文件既有 describe 块中的约定（若既有 beforeEach 已定义 service/moduleRef，则复用；请阅读 spec 文件顶部结构后按既有模式放置新 describe 块的获取代码）。

- [ ] **Step 4: 运行测试确认失败**

Run: `npx jest src/modules/social/social.service.spec.ts -t "举报与拉黑"`
Expected: FAIL（`submitReport`/`blockPlayer`/`isBlocked`/`unblockPlayer` 方法不存在）

- [ ] **Step 5: 实现方法**（追加到 social.service.ts，`// ===== Friends =====` 区块之前的 `removeFriend` 方法之后）

```typescript
  // ===== 举报与拉黑（阶段5批1） =====

  async submitReport(
    playerId: string,
    targetType: ReportTargetType,
    targetId: string,
    reason: ReportReason,
    content?: string,
  ): Promise<PlayerReport> {
    if (
      !Object.values(ReportTargetType).includes(targetType) ||
      !Object.values(ReportReason).includes(reason)
    ) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '举报类型或原因非法');
    }
    if (targetType === ReportTargetType.PLAYER && targetId === playerId) {
      throw new GameException(ErrorCodes.REPORT_INVALID_TARGET, '不能举报自己');
    }
    if (targetType === ReportTargetType.PLAYER) {
      const target = await this.playerService.getById(targetId);
      if (!target) {
        throw new GameException(ErrorCodes.REPORT_INVALID_TARGET, '举报目标不存在');
      }
    }
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const dup = await this.reportRepo.findOne({
      where: { reporterId: playerId, targetType, targetId, createdAt: MoreThan(since) },
    });
    if (dup) {
      throw new GameException(ErrorCodes.REPORT_COOLDOWN, '24小时内已举报该目标');
    }
    const record = await this.reportRepo.save(
      this.reportRepo.create({
        reporterId: playerId,
        targetType,
        targetId,
        reason,
        content: content?.trim() || null,
        status: ReportStatus.PENDING,
      }),
    );
    this.eventBus.emit(GameEvents.REPORT_SUBMITTED, {
      reportId: record.id,
      reporterId: playerId,
      targetType,
      targetId,
    });
    return record;
  }

  async blockPlayer(playerId: string, targetId: string): Promise<PlayerBlock> {
    if (playerId === targetId) {
      throw new GameException(ErrorCodes.BLOCK_SELF, '不能拉黑自己');
    }
    const count = await this.blockRepo.count({ where: { playerId } });
    if (count >= 200) {
      throw new GameException(ErrorCodes.BLOCK_LIMIT, '拉黑数量已达上限');
    }
    const existing = await this.blockRepo.findOne({
      where: { playerId, blockedId: targetId },
    });
    if (existing) return existing;
    const record = await this.blockRepo.save(
      this.blockRepo.create({ playerId, blockedId: targetId }),
    );
    this.eventBus.emit(GameEvents.PLAYER_BLOCKED, {
      playerId,
      blockedId: targetId,
    });
    return record;
  }

  async unblockPlayer(playerId: string, targetId: string): Promise<void> {
    await this.blockRepo.delete({ playerId, blockedId: targetId });
  }

  async listBlocks(
    playerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: PlayerBlock[]; total: number }> {
    const [items, total] = await Promise.all([
      this.blockRepo.find({
        where: { playerId },
        order: { createdAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.blockRepo.count({ where: { playerId } }),
    ]);
    return { items, total };
  }

  async isBlocked(a: string, b: string): Promise<boolean> {
    const found = await this.blockRepo.findOne({
      where: [
        { playerId: a, blockedId: b },
        { playerId: b, blockedId: a },
      ],
    });
    return Boolean(found);
  }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx jest src/modules/social/social.service.spec.ts -t "举报与拉黑"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/social/social.service.ts src/modules/social/social.module.ts src/modules/social/social.service.spec.ts
git commit -m "feat(social): 阶段5批1 举报提交/拉黑管理/isBlocked 门面"
```

---

### Task 4: SocialController 客户端路由（举报/拉黑/推荐）

**Files:**
- Modify: `src/modules/social/social.controller.ts`
- Test: `src/modules/social/social.controller.spec.ts`

- [ ] **Step 1: 写失败测试**（若 `social.controller.spec.ts` 存在，在末尾追加 describe；若不存在则新建——先 `Test.createTestingModule` 提供 `SocialService` mock + controller）

```typescript
describe('举报/拉黑/推荐路由', () => {
  it('POST /social/report 提交举报', async () => {
    const result = await controller.submitReport(
      { playerId: '100' } as any,
      { targetType: ReportTargetType.PLAYER, targetId: '200', reason: ReportReason.ABUSE, content: 'x' },
    );
    expect(service.submitReport).toHaveBeenCalledWith(
      '100', ReportTargetType.PLAYER, '200', ReportReason.ABUSE, 'x',
    );
    expect(result).toBeDefined();
  });
  it('POST /social/block 拉黑', async () => {
    await controller.blockPlayer({ playerId: '100' } as any, { playerId: '200' });
    expect(service.blockPlayer).toHaveBeenCalledWith('100', '200');
  });
  it('GET /social/recommend/friends 返回推荐', async () => {
    await controller.recommendFriends({ playerId: '100' } as any, 5);
    expect(service.recommendFriends).toHaveBeenCalledWith('100', 5);
  });
});
```

（controller/route 命名以本文件既有命名风格为准；若 service 未 mock 请按本文件既有 mock 方式补充。）

- [ ] **Step 2: 运行确认失败**

Run: `npx jest src/modules/social/social.controller.spec.ts`
Expected: FAIL（路由不存在）

- [ ] **Step 3: 实现路由**（在 `social.controller.ts` 末尾追加，`@UseGuards(JwtAuthGuard)`，路由前缀 `api/client/v1/social/`）

```typescript
  // ===== 举报与拉黑（阶段5批1） =====

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/social/report')
  @ApiOperation({ summary: '提交举报' })
  async submitReport(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() body: {
      targetType: ReportTargetType;
      targetId: string;
      reason: ReportReason;
      content?: string;
    },
  ) {
    return this.socialService.submitReport(
      player.playerId,
      body.targetType,
      body.targetId,
      body.reason,
      body.content,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/social/block')
  @ApiOperation({ summary: '拉黑玩家' })
  async blockPlayer(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() body: { playerId: string },
  ) {
    return this.socialService.blockPlayer(player.playerId, body.playerId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('api/client/v1/social/block/:playerId')
  @ApiOperation({ summary: '取消拉黑' })
  async unblockPlayer(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('playerId') playerId: string,
  ) {
    await this.socialService.unblockPlayer(player.playerId, playerId);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/social/block/list')
  @ApiOperation({ summary: '我的拉黑列表' })
  async listBlocks(
    @CurrentPlayer() player: CurrentPlayerData,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.socialService.listBlocks(
      player.playerId,
      Number(page),
      Number(limit),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/social/recommend/friends')
  @ApiOperation({ summary: '好友推荐（图谱协同）' })
  async recommendFriends(
    @CurrentPlayer() player: CurrentPlayerData,
    @Query('limit') limit = 10,
  ) {
    return this.socialService.recommendFriends(player.playerId, Number(limit));
  }
```

（imports 需补充 `Delete`、`Param`、`Query`、三个新枚举；若 `social.controller.ts` 已引入这些装饰器则复用。）

- [ ] **Step 4: 运行确认通过**

Run: `npx jest src/modules/social/social.controller.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/social/social.controller.ts src/modules/social/social.controller.spec.ts
git commit -m "feat(social): 阶段5批1 客户端路由 — 举报/拉黑/好友推荐"
```

---

### Task 5: SocialService 图谱协同推荐

**Files:**
- Modify: `src/modules/social/social.service.ts`
- Test: `src/modules/social/social.service.spec.ts`

- [ ] **Step 1: 写失败测试**（追加到 `social.service.spec.ts`，`举报与拉黑` describe 之后）

```typescript
describe('好友推荐', () => {
  let service: SocialService;
  let friendRepo: any;
  let blockRepo: any;
  let playerRepo: any;

  beforeEach(() => {
    service = moduleRef.get<SocialService>(SocialService);
    friendRepo = moduleRef.get(getRepositoryToken(Friend));
    blockRepo = moduleRef.get(getRepositoryToken(PlayerBlock));
    playerRepo = moduleRef.get(getRepositoryToken(Player));
    jest.clearAllMocks();
  });

  it('推荐排除好友/自己/拉黑，按共同好友打分并附理由', async () => {
    // 我的好友：200（共同好友桥梁）
    friendRepo.find.mockResolvedValueOnce([
      { playerId: '100', friendId: '200', status: FriendStatus.ACCEPTED },
      { playerId: '200', friendId: '100', status: FriendStatus.ACCEPTED },
    ]);
    // 亲缘：无
    // kinshipRepo 与 guildMemberRepo 按既有 mock 返回空数组
    // 全量玩家：100(自己)、200(好友，排除)、300(候选：与200是好友)
    playerRepo.find.mockResolvedValueOnce([
      { id: '100', nickname: '我', level: 5, lastActivityAt: new Date() },
      { id: '200', nickname: '好友', level: 6, lastActivityAt: new Date() },
      { id: '300', nickname: '候选', level: 6, lastActivityAt: new Date() },
    ]);
    // 200 的好友关系：与 300 是好友 → 300 与 100 的共同好友 = 1
    friendRepo.find.mockResolvedValueOnce([
      { playerId: '200', friendId: '300', status: FriendStatus.ACCEPTED },
    ]);
    // 拉黑：无
    blockRepo.find.mockResolvedValueOnce([]);

    const result = await service.recommendFriends('100', 10);
    expect(result.length).toBe(1);
    expect(result[0].playerId).toBe('300');
    expect(result[0].score).toBeGreaterThan(0);
    expect(result[0].reason).toContain('共同好友');
  });
});
```

注意：`recommendFriends` 内部查询顺序需与测试 mock 顺序一致——实现时按「好友全量 → 亲缘全量 → 帮派成员全量 → 玩家全量 → 我的好友 → 候选的好友 → 拉黑全量」顺序，测试 mock 按该顺序 `mockResolvedValueOnce`。若实现顺序调整，测试须同步。若 `kinshipRepo`/`guildMemberRepo` 已在既有 spec 有默认 mock，请用 `mockResolvedValue` 覆盖为 `[]`（或用 `mockResolvedValueOnce([])` 按顺序）。

- [ ] **Step 2: 运行确认失败**

Run: `npx jest src/modules/social/social.service.spec.ts -t "好友推荐"`
Expected: FAIL（`recommendFriends` 不存在）

- [ ] **Step 3: 实现 `recommendFriends`**（追加到 `isBlocked` 之后；需在 imports 加 `FriendRecommendation` 接口用到的类型；`GuildMember` 已在 DI 中）

```typescript
  async recommendFriends(
    playerId: string,
    limit = 10,
  ): Promise<FriendRecommendation[]> {
    const n = Math.min(Math.max(Math.floor(limit) || 10, 1), 20);
    const now = Date.now();
    const day7 = new Date(now - 7 * 86400000);

    const [allFriends, allKinships, allGuildMembers, allPlayers, blocks] =
      await Promise.all([
        this.friendRepo.find({ where: { status: FriendStatus.ACCEPTED } }),
        this.kinshipRepo.find({ where: { status: KinshipStatus.ACTIVE } }),
        this.guildMemberRepo.find(),
        this.playerRepo.find(),
        this.blockRepo.find(),
      ]);

    const myId = playerId;
    const me = allPlayers.find((p) => p.id === myId);
    if (!me) return [];

    // 我的好友集合（双向）
    const myFriendIds = new Set<string>();
    for (const f of allFriends) {
      if (f.playerId === myId) myFriendIds.add(f.friendId);
      if (f.friendId === myId) myFriendIds.add(f.playerId);
    }
    // 我的帮派集合
    const myGuildIds = new Set(
      allGuildMembers.filter((g) => g.playerId === myId).map((g) => g.guildId),
    );
    // 我的亲缘成员集合
    const myKinshipIds = new Set<string>();
    for (const k of allKinships) {
      if (k.leaderId === myId) {
        const members = Array.isArray(k.members) ? k.members : [];
        members.forEach((m) => m !== myId && myKinshipIds.add(m));
      }
    }
    // 候选排除集
    const blockedSet = new Set<string>();
    for (const b of blocks) {
      if (b.playerId === myId) blockedSet.add(b.blockedId);
      if (b.blockedId === myId) blockedSet.add(b.playerId);
    }
    const exclude = new Set<string>([myId, ...myFriendIds, ...blockedSet]);

    // 全量好友邻接（playerId -> accepted 好友集合）
    const adjacency = new Map<string, Set<string>>();
    for (const f of allFriends) {
      if (!adjacency.has(f.playerId)) adjacency.set(f.playerId, new Set());
      if (!adjacency.has(f.friendId)) adjacency.set(f.friendId, new Set());
      adjacency.get(f.playerId)!.add(f.friendId);
      adjacency.get(f.friendId)!.add(f.playerId);
    }
    // 玩家的帮派
    const playerGuild = new Map<string, Set<string>>();
    for (const g of allGuildMembers) {
      if (!playerGuild.has(g.playerId)) playerGuild.set(g.playerId, new Set());
      playerGuild.get(g.playerId)!.add(g.guildId);
    }

    const scored: FriendRecommendation[] = [];
    for (const c of allPlayers) {
      if (exclude.has(c.id)) continue;
      const cFriends = adjacency.get(c.id);
      let common = 0;
      if (cFriends) {
        for (const f of cFriends) if (myFriendIds.has(f)) common++;
      }
      let score = 0;
      const reasons: string[] = [];
      if (common > 0) {
        score += common * 3;
        reasons.push(`共同好友${common}人`);
      }
      const guilds = playerGuild.get(c.id);
      if (guilds && [...guilds].some((g) => myGuildIds.has(g))) {
        score += 2;
        reasons.push('同帮派');
      }
      let kinshipCommon = 0;
      if (cFriends) {
        for (const f of cFriends) if (myKinshipIds.has(f)) kinshipCommon++;
      }
      if (kinshipCommon > 0) {
        score += kinshipCommon * 1.5;
        reasons.push('亲缘网络');
      }
      if (c.lastActivityAt && c.lastActivityAt >= day7) {
        score += 1;
        reasons.push('活跃玩家');
      }
      if (Math.abs(c.level - me.level) <= 5) score += 0.5;
      if (score > 0) {
        scored.push({
          playerId: c.id,
          name: c.nickname,
          level: c.level,
          score: Math.round(score * 10) / 10,
          reason: reasons.join('、'),
        });
      }
    }

    scored.sort(
      (a, b) => b.score - a.score || this.random() - this.random(),
    );
    return scored.slice(0, n);
  }
```

在 `social.service.ts` 顶部（或文件内接口区）定义返回类型：

```typescript
export interface FriendRecommendation {
  playerId: string;
  name: string;
  level: number;
  score: number;
  reason: string;
}
```

注意：`Player.lastActivityAt` / `level` / `nickname` 字段名以 `player.entity.ts` 实际为准（已有 `last_activity_at` 列）。`guildId` 字段名以 `guild-member.entity.ts` 为准。若字段名不同，按实体实际字段调整。

- [ ] **Step 4: 运行确认通过**

Run: `npx jest src/modules/social/social.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/social/social.service.ts src/modules/social/social.service.spec.ts
git commit -m "feat(social): 阶段5批1 图谱协同好友推荐 — 共同好友/帮派/亲缘打分+理由"
```

---

### Task 6: ChatService 禁言 + 私聊拉黑校验

**Files:**
- Modify: `src/modules/chat/chat.module.ts`
- Modify: `src/modules/chat/chat.service.ts`
- Test: `src/modules/chat/chat.service.spec.ts`

- [ ] **Step 1: 更新 `chat.module.ts`**：imports 追加 `AuthModule`、`SocialModule`（`AuthModule` 从 `@modules/auth/auth.module`、`SocialModule` 从 `@modules/social/social.module` 引入）

```typescript
import { AuthModule } from '@modules/auth/auth.module';
import { SocialModule } from '@modules/social/social.module';
// imports 数组中追加：
    AuthModule,
    SocialModule,
```

循环依赖验证：SocialModule imports [Economy, Character, Inventory, Player]，均不依赖 ChatModule；AuthModule 独立。无循环。

- [ ] **Step 2: 写失败测试**（在 `chat.service.spec.ts` 补 `AuthService`、`SocialService` mock provider，并追加 describe）

```typescript
// providers 追加：
        {
          provide: AuthService,
          useValue: {
            getAccountRestrictions: jest.fn(),
          },
        },
        {
          provide: SocialService,
          useValue: {
            isBlocked: jest.fn(),
          },
        },
```

```typescript
describe('发言限制（禁言/拉黑）', () => {
  let service: ChatService;
  let authService: any;
  let socialService: any;
  let playerRepo: any;

  beforeEach(() => {
    service = moduleRef.get<ChatService>(ChatService);
    authService = moduleRef.get(AuthService);
    socialService = moduleRef.get(SocialService);
    playerRepo = moduleRef.get(getRepositoryToken(Player));
    jest.clearAllMocks();
  });

  it('禁言未过期拒绝发言', async () => {
    playerRepo.findOne.mockResolvedValueOnce({ id: '100', accountId: '1' });
    authService.getAccountRestrictions.mockResolvedValueOnce({
      mutedUntil: new Date(Date.now() + 3600_000),
      tradeLockedUntil: null,
    });
    socialService.isBlocked.mockResolvedValueOnce(false);
    await expect(
      service.sendChannelMessage({
        senderId: '100',
        senderName: 'A',
        channel: ChatChannel.WORLD,
        content: 'hello',
      }),
    ).rejects.toMatchObject({ response: { code: ErrorCodes.ACCOUNT_MUTED } });
  });

  it('禁言已过期放行', async () => {
    playerRepo.findOne.mockResolvedValueOnce({ id: '100', accountId: '1' });
    authService.getAccountRestrictions.mockResolvedValueOnce({
      mutedUntil: null,
      tradeLockedUntil: null,
    });
    socialService.isBlocked.mockResolvedValueOnce(false);
    // 既有链路 mock：filter/chatRepo.save 等按现有测试的返回配置
    const result = await service.sendChannelMessage({
      senderId: '100', senderName: 'A', channel: ChatChannel.WORLD, content: 'hello',
    });
    expect(result.message).toBeDefined();
  });

  it('私聊被对方拉黑拒绝', async () => {
    playerRepo.findOne.mockResolvedValueOnce({ id: '100', accountId: '1' });
    authService.getAccountRestrictions.mockResolvedValueOnce({
      mutedUntil: null, tradeLockedUntil: null,
    });
    socialService.isBlocked.mockResolvedValueOnce(true);
    await expect(
      service.sendChannelMessage({
        senderId: '100', senderName: 'A', channel: ChatChannel.PRIVATE,
        content: 'hi', recipientId: '200',
      }),
    ).rejects.toMatchObject({ response: { code: ErrorCodes.TARGET_BLOCKED_YOU } });
  });
});
```

（`sendChannelMessage` 现有测试中 filter/rateLimit 的 mock 配置请沿用本文件既有 `sendChannelMessage` 相关 describe 的配置——先读 `chat.service.spec.ts` 中 sendChannelMessage 现有用例，照其 mock 补齐依赖。）

- [ ] **Step 3: 运行确认失败**

Run: `npx jest src/modules/chat/chat.service.spec.ts -t "发言限制"`
Expected: FAIL（缺 AuthService/SocialService provider 或校验逻辑）

- [ ] **Step 4: 实现校验**（`chat.service.ts`：imports 加 `AuthService`、`SocialService`、`ErrorCodes` 若未引入；构造器注入；在 `sendChannelMessage` 的 `checkChannelPermission` 之后、`checkRateLimit` 之前插入校验调用，并新增私有方法）

```typescript
  constructor(
    // ...既有依赖不变，末尾追加：
    private readonly authService: AuthService,
    private readonly socialService: SocialService,
  ) {
```

在 `sendChannelMessage` 中：

```typescript
          await this.checkChannelPermission(senderId, channel, recipientId, guildId);
          await this.enforceChatRestrictions(senderId, channel, recipientId);
          await this.checkRateLimit(senderId);
```

新增私有方法（放在 `sendChannelMessage` 方法之后）：

```typescript
  private async enforceChatRestrictions(
    senderId: string,
    channel: ChatChannel,
    recipientId?: string,
  ): Promise<void> {
    const player = await this.playerRepo.findOne({ where: { id: senderId } });
    if (player) {
      const restrictions = await this.authService.getAccountRestrictions(
        player.accountId,
      );
      if (restrictions.mutedUntil) {
        throw new GameException(ErrorCodes.ACCOUNT_MUTED, '账号禁言中', {
          until: restrictions.mutedUntil,
        });
      }
    }
    if (channel === ChatChannel.PRIVATE && recipientId) {
      const blocked = await this.socialService.isBlocked(senderId, recipientId);
      if (blocked) {
        throw new GameException(
          ErrorCodes.TARGET_BLOCKED_YOU,
          '无法向对方发送消息',
        );
      }
    }
  }
```

（GameException 构造签名：`new GameException(code, message, extra?)`——以 `auth.service.ts` 中 `ACCOUNT_BANNED` 用法为准。）

- [ ] **Step 5: 运行确认通过**

Run: `npx jest src/modules/chat/chat.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/chat/chat.module.ts src/modules/chat/chat.service.ts src/modules/chat/chat.service.spec.ts
git commit -m "feat(chat): 阶段5批1 发言链路禁言+私聊拉黑校验生效"
```

---

### Task 7: Social 链路拉黑拦截（好友申请/亲缘）

**Files:**
- Modify: `src/modules/social/social.service.ts`
- Test: `src/modules/social/social.service.spec.ts`

- [ ] **Step 1: 写失败测试**（追加到 `social.service.spec.ts`）

```typescript
describe('拉黑隔离生效点', () => {
  let service: SocialService;
  let blockRepo: any;

  beforeEach(() => {
    service = moduleRef.get<SocialService>(SocialService);
    blockRepo = moduleRef.get(getRepositoryToken(PlayerBlock));
    jest.clearAllMocks();
  });

  it('被拉黑时好友申请被拒', async () => {
    blockRepo.findOne.mockResolvedValueOnce({ id: '1' }); // 目标拉黑了申请人
    await expect(
      service.applyFriend('100', '200'),
    ).rejects.toMatchObject({ response: { code: ErrorCodes.TARGET_BLOCKED_YOU } });
  });

  it('互拉黑时缔结亲缘被拒', async () => {
    blockRepo.findOne.mockResolvedValueOnce({ id: '1' });
    await expect(
      service.formKinship('100', KinshipType.SWORN, ['200']),
    ).rejects.toMatchObject({ response: { code: ErrorCodes.TARGET_BLOCKED_YOU } });
  });
});
```

（`formKinship` 实际签名：`formKinship(playerId: string, type: KinshipType, memberIds: string[], name?: string)`——拦截逻辑遍历 `memberIds` 逐一校验 `isBlocked(playerId, m)`。）

- [ ] **Step 2: 运行确认失败**

Run: `npx jest src/modules/social/social.service.spec.ts -t "拉黑隔离"`
Expected: FAIL（无拦截逻辑）

- [ ] **Step 3: 实现拦截**（在 `applyFriend` 方法开头、现有查询之前插入；在 `formKinship` 的 `const members = [playerId, ...memberIds];` 之后插入）

```typescript
  async applyFriend(playerId: string, friendId: string): Promise<Friend> {
    const blocked = await this.isBlocked(playerId, friendId);
    if (blocked) {
      throw new GameException(
        ErrorCodes.TARGET_BLOCKED_YOU,
        '对方已将你拉黑，无法申请好友',
      );
    }
    const existing = await this.friendRepo.findOne({
```

```typescript
  // formKinship 中 const members = [playerId, ...memberIds]; 之后插入：
    for (const m of memberIds) {
      const blocked = await this.isBlocked(playerId, m);
      if (blocked) {
        throw new GameException(
          ErrorCodes.TARGET_BLOCKED_YOU,
          '双方存在拉黑关系，无法缔结亲缘',
        );
      }
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest src/modules/social/social.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/social/social.service.ts src/modules/social/social.service.spec.ts
git commit -m "feat(social): 阶段5批1 拉黑拦截生效 — 好友申请/亲缘缔结"
```

---

### Task 8: CommunityService 举报台账 + 处置

**Files:**
- Modify: `src/modules/community/community.module.ts`
- Modify: `src/modules/community/community.service.ts`
- Test: `src/modules/community/community.service.spec.ts`

- [ ] **Step 1: 更新 `community.module.ts`**：forFeature 追加 `PlayerReport`、`Player`，imports 追加 `AuthModule`

```typescript
import { PlayerReport } from '@modules/social/entities/player-report.entity';
import { Player } from '@modules/player/entities/player.entity';
import { AuthModule } from '@modules/auth/auth.module';
// forFeature 数组追加：
      PlayerReport,
      Player,
// imports 数组追加：
    AuthModule,
```

循环依赖验证：AuthModule 独立，CommunityModule 现有 imports [AdminModule, AnalyticsModule] 均不依赖 Community。无循环。

- [ ] **Step 2: 写失败测试**（`community.service.spec.ts` 追加 `PlayerReport`/`Player` repo mock、`AuthService` mock，并加 describe——先读既有 spec 的 providers 结构照其风格补充）

```typescript
describe('举报台账与处置', () => {
  let service: CommunityService;
  let reportRepo: any;
  let playerRepo: any;
  let authService: any;
  let adminService: any;

  beforeEach(() => {
    service = moduleRef.get<CommunityService>(CommunityService);
    reportRepo = moduleRef.get(getRepositoryToken(PlayerReport));
    playerRepo = moduleRef.get(getRepositoryToken(Player));
    authService = moduleRef.get(AuthService);
    adminService = moduleRef.get(AdminService);
    jest.clearAllMocks();
  });

  it('台账列表按状态筛选', async () => {
    reportRepo.find.mockResolvedValueOnce([{ id: '1', status: ReportStatus.PENDING }]);
    reportRepo.count.mockResolvedValueOnce(1);
    const result = await service.listReports(ReportStatus.PENDING, 1, 20);
    expect(result.total).toBe(1);
    expect(reportRepo.find).toHaveBeenCalled();
  });

  it('处理 MUTE 调用 applyPenalty 并标记已处理', async () => {
    reportRepo.findOne.mockResolvedValueOnce({
      id: '1', targetType: ReportTargetType.PLAYER, targetId: '200',
      status: ReportStatus.PENDING,
    });
    playerRepo.findOne.mockResolvedValueOnce({ id: '200', accountId: '9' });
    authService.applyPenalty.mockResolvedValueOnce({ id: 'p1' });
    adminService.logOperation.mockResolvedValueOnce(undefined);
    reportRepo.update.mockResolvedValueOnce({ affected: 1 });

    await service.handleReport(
      'admin1', 'adminName', '1', ReportHandleAction.MUTE, '骂人', 3600,
    );
    expect(authService.applyPenalty).toHaveBeenCalledWith(
      'adminName', '200', '9', PenaltyLevel.MUTE, '骂人', 3600,
    );
    expect(reportRepo.update).toHaveBeenCalledWith(
      { id: '1' },
      expect.objectContaining({ status: ReportStatus.PROCESSED, handleAction: 'MUTE' }),
    );
  });

  it('已处理举报拒绝重复处理', async () => {
    reportRepo.findOne.mockResolvedValueOnce({
      id: '1', status: ReportStatus.PROCESSED,
    });
    await expect(
      service.handleReport('admin1', 'adminName', '1', ReportHandleAction.IGNORE, 'x'),
    ).rejects.toMatchObject({ response: { code: ErrorCodes.REPORT_ALREADY_HANDLED } });
  });

  it('IGNORE 不落惩罚', async () => {
    reportRepo.findOne.mockResolvedValueOnce({
      id: '1', targetType: ReportTargetType.PLAYER, targetId: '200',
      status: ReportStatus.PENDING,
    });
    reportRepo.update.mockResolvedValueOnce({ affected: 1 });
    await service.handleReport('admin1', 'adminName', '1', ReportHandleAction.IGNORE, 'x');
    expect(authService.applyPenalty).not.toHaveBeenCalled();
  });
});
```

（`ReportHandleAction` 为处理动作枚举——见 Step 3 实现；`KinshipType`/`PenaltyLevel`/`AdminService` 的引入按既有 spec import 模式。）

- [ ] **Step 3: 运行确认失败**

Run: `npx jest src/modules/community/community.service.spec.ts -t "举报台账"`
Expected: FAIL（方法/枚举不存在）

- [ ] **Step 4: 实现**（`community.service.ts`：imports 加 `PlayerReport`、`AuthService`、`PenaltyLevel`、`ReportStatus`、`ReportTargetType`；构造器注入 `reportRepo`/`playerRepo`/`authService`；追加枚举与两方法）

在 `community.service.ts`（或 `enums.ts`，按代码组织习惯）定义处理动作枚举——本计划放 `enums.ts`：

```typescript
export enum ReportHandleAction {
  IGNORE = 'IGNORE',
  WARN = 'WARN',
  MUTE = 'MUTE',
  BAN = 'BAN',
}
```

（追加到 `enums.ts` 的 `ReportStatus` 之后，Task 1 已建枚举同文件。）

```typescript
  // ===== 举报台账（阶段5批1） =====

  async listReports(
    status?: ReportStatus,
    page = 1,
    limit = 20,
  ): Promise<{ items: PlayerReport[]; total: number }> {
    const [items, total] = await Promise.all([
      this.reportRepo.find({
        where: status ? { status } : {},
        order: { createdAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.reportRepo.count({ where: status ? { status } : {} }),
    ]);
    return { items, total };
  }

  async handleReport(
    adminId: string,
    adminName: string,
    reportId: string,
    action: ReportHandleAction,
    remark?: string,
    durationSeconds?: number,
  ): Promise<PlayerReport> {
    const report = await this.reportRepo.findOne({ where: { id: reportId } });
    if (!report) {
      throw new GameException(ErrorCodes.REPORT_NOT_FOUND, '举报记录不存在');
    }
    if (report.status !== ReportStatus.PENDING) {
      throw new GameException(ErrorCodes.REPORT_ALREADY_HANDLED, '举报已处理');
    }
    const updates: Record<string, any> = {
      handlerAdminId: adminId,
      handleRemark: remark?.trim() || null,
      handledAt: new Date(),
    };
    if (action === ReportHandleAction.IGNORE) {
      updates.status = ReportStatus.IGNORED;
      updates.handleAction = ReportHandleAction.IGNORE;
    } else {
      if (report.targetType !== ReportTargetType.PLAYER) {
        throw new GameException(
          ErrorCodes.REPORT_INVALID_TARGET,
          '仅玩家类举报可施加惩罚',
        );
      }
      const player = await this.playerRepo.findOne({
        where: { id: report.targetId },
      });
      if (!player) {
        throw new GameException(ErrorCodes.REPORT_INVALID_TARGET, '目标玩家不存在');
      }
      const level =
        action === ReportHandleAction.WARN
          ? PenaltyLevel.WARNING
          : action === ReportHandleAction.MUTE
            ? PenaltyLevel.MUTE
            : PenaltyLevel.BAN;
      await this.authService.applyPenalty(
        adminName,
        player.id,
        player.accountId,
        level,
        remark?.trim() || '举报处置',
        durationSeconds,
      );
      updates.status = ReportStatus.PROCESSED;
      updates.handleAction = action;
      await this.adminService.logOperation({
        adminId,
        targetPlayerId: player.id,
        operation: 'community.report.handle',
        changeAfter: { id: report.id, action },
      });
    }
    await this.reportRepo.update({ id: reportId }, updates);
    return { ...report, ...updates } as PlayerReport;
  }
```

（`adminService` 已在 `community.service` DI 中——`appointAmbassador` 已使用；`GameException`/`ErrorCodes` 若未引入则补 import。）

- [ ] **Step 5: 运行确认通过**

Run: `npx jest src/modules/community/community.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/constants/enums.ts src/modules/community/
git commit -m "feat(community): 阶段5批1 举报台账+处置（IGNORE/WARN/MUTE/BAN 复用分级惩罚）"
```

---

### Task 9: CommunityController admin 举报路由

**Files:**
- Modify: `src/modules/community/community.controller.ts`

- [ ] **Step 1: 实现路由**（追加到 controller 末尾，`AdminGuard` 已引入；imports 补 `ReportStatus`、`ReportHandleAction`、`Query` 若未引入）

```typescript
  // ===== 举报台账（阶段5批1） =====

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/community/reports')
  @ApiOperation({ summary: '举报台账（管理端，可按状态过滤）' })
  async listReports(
    @Query('status') status?: ReportStatus,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.communityService.listReports(
      status,
      Number(page),
      Number(limit),
    );
  }

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/community/reports/:id/handle')
  @ApiOperation({ summary: '处置举报（忽略/警告/禁言/封禁）' })
  async handleReport(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      action: ReportHandleAction;
      durationSeconds?: number;
      remark?: string;
    },
  ) {
    return this.communityService.handleReport(
      admin.adminId,
      admin.username,
      id,
      body.action,
      body.remark,
      body.durationSeconds,
    );
  }
```

- [ ] **Step 2: 编译 + 运行 community 测试**

Run: `npx tsc --noEmit` 与 `npx jest src/modules/community/`
Expected: 无报错 + 全 PASS

- [ ] **Step 3: Commit**

```bash
git add src/modules/community/community.controller.ts
git commit -m "feat(community): 阶段5批1 admin 举报台账路由"
```

---

### Task 10: 数据字典与手册更新

**Files:**
- Modify: `manual-src/dict-part.html`

- [ ] **Step 1: 数据字典补 2 表**：在 `player_ambassadors` 表之后追加 `player_reports`（10 字段，见 spec 4.1）与 `player_blocks`（4 字段）两表条目，字段/类型/说明与实体一致；更新章节统计（表数 72→74、字段数 664→+14=678，按实际新增字段数核算）；目录（章节内的表链接清单）同步追加两表链接。

- [ ] **Step 2: 重建并校验手册**

Run: `node e:\code\nest\manual-src\merge.js && node e:\code\nest\manual-src\check.js`
Expected: `MERGED_OK` + `全部检查通过`

- [ ] **Step 3: Commit**

```bash
git add manual-src/dict-part.html manual/index.html "manual/游戏服务器开发手册.md"
git commit -m "docs(social): 阶段5批1 数据字典补 player_reports/player_blocks 两表"
```

---

### Task 11: 冒烟脚本 smoke-stage5.sh

**Files:**
- Create: `scripts/smoke-stage5.sh`

- [ ] **Step 1: 编写冒烟脚本**（复用 `smoke-stage4.sh` 的结构：BASE_URL、注册/登录辅助函数、逐项断言、结尾汇总。覆盖：

1. 玩家 A 提交举报（玩家 B）→ code 0
2. A 24h 内重复举报 B → 92204
3. admin 登录 → 台账含该举报 → 处置 MUTE（durationSeconds=3600）
4. B 发言 → ACCOUNT_MUTED（50006）
5. A 拉黑 B → code 0；A 拉黑自己 → 92201
6. A 私聊 B → 92203（被拉黑）
7. B 申请加 A 好友 → 92203
8. A 取消拉黑 B → 恢复私聊/好友申请
9. A 调推荐接口 → 返回结构含 playerId/name/score/reason，不含好友与自己

脚本内用 `curl` + `jq`（沿用 smoke-stage4.sh 既有解析方式），断言失败 `exit 1`，结尾打印通过数。

- [ ] **Step 2: 本地静态检查**

Run: `bash -n scripts/smoke-stage5.sh`
Expected: 无语法错误（Windows 下若无 bash，跳过并在部署机上执行时验证）

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-stage5.sh
git commit -m "test(social): 阶段5批1 冒烟脚本 smoke-stage5.sh"
```

---

### Task 12: 全量回归 + 部署 + 收尾

**Files:**
- 全仓库

- [ ] **Step 1: 全量单测**

Run: `npx jest --silent`（在 `packages-game/game-server` 下）
Expected: 全部 PASS（含新增用例；既有 111+ 项冒烟脚本不在此命令内）

- [ ] **Step 2: 全量 tsc**

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 3: 构建并部署 game-server**（沿用既有部署流程：本地 `npm run build` → `tar -czf dist-stage5.tar.gz -C dist .` → scp 到 odoo → 服务器备份 `dist_prev_$(date +%Y%m%d_%H%M%S)` → 解压替换 → `systemctl restart game-server` → `journalctl -u game-server --since "-1 min"` 查 `Nest application successfully started`）

- [ ] **Step 4: 服务器执行冒烟**

Run: `scp scripts/smoke-stage5.sh odoo:/tmp/ && ssh odoo "bash /tmp/smoke-stage5.sh"`
Expected: 全部通过（脚本内断言）

- [ ] **Step 5: 验证新表建表**

Run（odoo 上）:
```bash
docker exec 1Panel-postgresql-4LsS psql -U game -d game_server -t -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('player_reports','player_blocks') ORDER BY tablename;"
```
Expected: 两表名输出

- [ ] **Step 6: 发布手册**

Run: `powershell -ExecutionPolicy Bypass -File e:\code\nest\deploy-manual.ps1`
Expected: `DEPLOY OK`（server verify 200/200）

- [ ] **Step 7: 收尾提交**

```bash
git add -A
git commit -m "chore(social): 阶段5批1 部署与冒烟收尾"
git push origin main
```

- [ ] **Step 8: 线上验证**

Run: `ssh odoo "curl -s -H 'Host: game.joho.cn' http://127.0.0.1/manual/ | grep -c player_reports"`
Expected: ≥1

---

## 验收对照（spec → task）

| spec 要求 | 任务 |
|---|---|
| 枚举 ReportTargetType/Reason/Status | Task 1 |
| 错误码 92201 区 | Task 1 |
| player_reports / player_blocks 表 | Task 2 |
| 举报提交（去重/自举报拒） | Task 3 |
| 拉黑管理（上限/幂等/isBlocked 双向） | Task 3 |
| 客户端路由（report/block/list/recommend） | Task 4 |
| 图谱协同推荐（打分+理由） | Task 5 |
| chat 禁言 + 私聊拉黑校验 | Task 6 |
| 好友申请/亲缘拉黑拦截 | Task 7 |
| admin 台账 + 处置（复用 applyPenalty） | Task 8 |
| admin 路由 | Task 9 |
| 数据字典 | Task 10 |
| 冒烟 + 回归 + 部署 + 手册发布 | Task 11-12 |
