# 阶段 1 · 社交基础能力 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 game-server（NestJS 11）上落地手册阶段 1 的四个迭代：社交货币（C）→ 账号安全（A）→ 角色名片（D）→ 场景物件（B），全部为增量扩展，不重构既有系统。

**Architecture:** 沿用现有模块化结构（modules/ 下每模块 entity/service/controller/dto/spec）。四迭代按依赖顺序实施：社交货币是地基层（账号安全/角色名片的扣减与发放依赖它），场景物件最独立。复用现有 `economy.service`（加扣+锁+流水）、`resource-balance.policy`（资源平衡）、`AdminGuard`（角色元数据，需补 `@Roles` 装饰器）、`JwtAuthGuard`+`@CurrentPlayer`（玩家侧）。新表通过 TypeORM `synchronize=true` 自动创建。

**Tech Stack:** NestJS 11、TypeORM（PostgreSQL）、Redis（CacheService withLock）、Jest（spec 同目录）、Node 内置 crypto（零新依赖——遵守 1G 服务器依赖约束）。

**依据 Spec:** `docs/superpowers/specs/2026-09-19-social-game-devplan-design.md` 第 3 节（阶段 1 详细设计）+ 第 5/6/7 节（测试/部署/风险护栏）。

**项目根:** `e:\code\nest\packages-game\game-server`（下文所有路径相对此根）

**常用命令:**
- 单测（在 `packages-game\game-server` 目录）：`npx jest src/modules/<m>/<m>.service.spec.ts --no-coverage`（PowerShell）
- 全量单测：`npx jest --no-coverage`
- 本地构建（部署用）：`npm run build`（1G 服务器禁止构建，只在本地）

---

## 文件结构映射

| 文件 | 职责 | 归属 |
|---|---|---|
| `src/constants/enums.ts` | CurrencyType 三新币、ObjectType LANDMARK、TriggerType 三机关、InteractType、GameType、PenaltyLevel | Task 1/12 |
| `src/constants/error-codes.ts` | 新增错误码（兑换/封禁/称号/物件/机关/玩法） | Task 1 |
| `src/event-bus/game-events.ts` | 预留 FAVOR_GAINED/GUILD_CONTRIB_GAINED/FACE_CHANGED 事件名 | Task 1 |
| `src/common/decorators/roles.decorator.ts` | `@Roles(...)` 装饰器（AdminGuard 已支持读取） | Task 1 |
| `src/modules/player/player.service.ts` | createPlayer 初始化五币行 | Task 2 |
| `src/modules/economy/economy.service.ts` | ensureCurrencyRow、exchange（兑换铁律） | Task 2 |
| `src/modules/economy/economy.controller.ts` | 玩家侧：social/balances、exchange（新 controller，不改 Admin 的） | Task 3 |
| `src/modules/economy/economy.service.spec.ts` | exchange 铁律测试 | Task 2 |
| `src/modules/auth/entities/auth-account.entity.ts` | +mutedUntil/tradeLockedUntil/realName/idNoHash/antiAddictionOn | Task 4 |
| `src/modules/auth/entities/account-penalty.entity.ts` | 新表 account_penalties | Task 4 |
| `src/modules/auth/entities/account-security-event.entity.ts` | 新表 account_security_events | Task 4 |
| `src/common/crypto/crypto.util.ts` | AES-256-GCM 加解密 + sha256（零依赖） | Task 5 |
| `src/modules/auth/auth.service.ts` | 风控事件、getAccountRestrictions、applyPenalty、bindRealName、getSecurityStatus | Task 6 |
| `src/modules/auth/auth.controller.ts` | 玩家侧：security/verify、realname、security-status | Task 7 |
| `src/modules/auth/auth-admin.controller.ts` | Admin 侧：penalties 增查（@Roles） | Task 8 |
| `src/modules/auth/auth.service.spec.ts` | 风控/封禁/实名测试 | Task 6 |
| `src/modules/character/entities/character-profile.entity.ts` | +alias/poem/socialBio | Task 9 |
| `src/modules/character/entities/title-template.entity.ts` | 新表 title_templates | Task 9 |
| `src/modules/character/entities/character-title.entity.ts` | 新表 character_titles | Task 9 |
| `src/modules/character/character.service.ts` | updateCard/getCard/grantTitle/equipTitle/getTitles | Task 10 |
| `src/modules/character/character.controller.ts` | 玩家侧：card、titles/equip、card/:id | Task 11 |
| `src/modules/character/character.service.spec.ts` | 名片/称号测试 | Task 10 |
| `src/modules/world/entities/player-mount.entity.ts` | 新表 player_mounts | Task 12 |
| `src/modules/world/entities/street-game.entity.ts` | 新表 street_games | Task 12 |
| `src/modules/world/entities/game-session.entity.ts` | 新表 game_sessions | Task 12 |
| `src/modules/world/entities/landmark-message.entity.ts` | 新表 landmark_messages | Task 12 |
| `src/modules/world/entities/trigger-unlock.entity.ts` | 新表 trigger_unlocks | Task 12 |
| `src/modules/world/world.service.ts` | interactObject/activateTrigger/mount/game/landmark | Task 13/14 |
| `src/modules/world/world.client.controller.ts` | 玩家侧 world 接口 | Task 15 |
| `src/modules/world/world.service.spec.ts` | 物件/机关/玩法测试 | Task 13/14 |
| `src/modules/world/world.module.ts` | imports CharacterModule、EconomyModule | Task 15 |
| `src/modules/character/character.module.ts` | exports CharacterService | Task 15 |

---

## Task 1: 枚举、错误码、事件与 Roles 装饰器（基础扩展）

**Files:**
- Modify: `src/constants/enums.ts`
- Modify: `src/constants/error-codes.ts`
- Modify: `src/event-bus/game-events.ts`
- Create: `src/common/decorators/roles.decorator.ts`

- [ ] **Step 1: 修改 `src/constants/enums.ts`**

在 `CurrencyType` 枚举内追加三个社交货币：

```ts
export enum CurrencyType {
  GOLD = 'gold',
  DIAMOND = 'diamond',
  BOUND_DIAMOND = 'bound_diamond',
  FAVOR = 'favor', // 人情值
  GUILD_CONTRIB = 'guild_contrib', // 帮贡
  FACE = 'face', // 颜面
}
```

在 `ObjectType` 追加 `LANDMARK`：

```ts
export enum ObjectType {
  CHEST = 'chest',
  COLLECT = 'collect',
  STONE = 'stone',
  PLANT = 'plant',
  LANDMARK = 'landmark',
}
```

在 `TriggerType` 追加三个机关类型：

```ts
export enum TriggerType {
  TRANSPORT = 'transport',
  STORY = 'story',
  BATTLE = 'battle',
  ACTIVITY = 'activity',
  PUZZLE = 'puzzle',
  GATE = 'gate',
  TRAP = 'trap',
}
```

在世界场景枚举段末尾（`EntityState` 之后）追加两个新枚举：

```ts
export enum InteractType {
  COLLECT = 'collect',
  HIDE = 'hide',
  CAMP = 'camp',
  SIT = 'sit',
  LIE = 'lie',
  CARVE = 'carve',
  READ = 'read',
  MOUNT = 'mount',
  FISH = 'fish',
  PLAY = 'play',
}

export enum GameType {
  FISHING = 'fishing',
  CHESS = 'chess',
  ARCHERY = 'archery',
  CRICKET = 'cricket',
  RING = 'ring',
}

export enum GameSessionStatus {
  OPEN = 'open',
  PLAYING = 'playing',
  FINISHED = 'finished',
}
```

在社交模块枚举段（`GuildRole` 之前）追加封禁等级枚举：

```ts
export enum PenaltyLevel {
  WARNING = 'warning',
  MUTE = 'mute',
  GUILD_REMOVE = 'guild_remove',
  TRADE_LIMIT = 'trade_limit',
  BAN = 'ban',
}
```

- [ ] **Step 2: 修改 `src/constants/error-codes.ts`**

在「背包道具」段（`CURRENCY_TYPE_INVALID: 20008` 后）追加：

```ts
  EXCHANGE_NOT_ALLOWED: 20009,
```

在「社交公会」段（`ALREADY_IN_GUILD: 50004` 后）追加：

```ts
  PENALTY_LEVEL_INVALID: 50005,
  ACCOUNT_MUTED: 50006,
  TRADE_LOCKED: 50007,
  TITLE_NOT_FOUND: 50008,
  TITLE_NOT_OWNED: 50009,
  OBJECT_COOLDOWN: 50010,
  OBJECT_ALREADY_OPENED: 50011,
  TRIGGER_NOT_READY: 50012,
  GAME_NOT_FOUND: 50013,
  GAME_NOT_OPEN: 50014,
  BET_INVALID: 50015,
  MOUNT_ALREADY_ACTIVE: 50016,
```

- [ ] **Step 3: 修改 `src/event-bus/game-events.ts`**

在「社交事件」段（`FRIEND_ADDED` 后）追加预留事件名：

```ts
  FAVOR_GAINED: 'economy.favor.gained',
  GUILD_CONTRIB_GAINED: 'economy.guild_contrib.gained',
  FACE_CHANGED: 'economy.face.changed',
```

- [ ] **Step 4: 创建 `src/common/decorators/roles.decorator.ts`**

```ts
import { SetMetadata } from '@nestjs/common';
import { ADMIN_ROLES_KEY } from '@common/guards/admin.guard';

export const Roles = (...roles: string[]) => SetMetadata(ADMIN_ROLES_KEY, roles);
```

- [ ] **Step 5: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无错误退出（exit 0）。

- [ ] **Step 6: Commit**

```bash
git add src/constants/enums.ts src/constants/error-codes.ts src/event-bus/game-events.ts src/common/decorators/roles.decorator.ts
git commit -m "feat: 枚举/错误码/事件扩展 + Roles 装饰器（阶段1基础）"
```

---

## Task 2: 社交货币——初始化五币 + 兑换铁律

**Files:**
- Modify: `src/modules/player/player.service.ts`
- Modify: `src/modules/economy/economy.service.ts`
- Modify: `src/modules/economy/economy.service.spec.ts`

- [ ] **Step 1: 写失败测试（economy.service.spec.ts）**

在 `e:\code\nest\packages-game\game-server\src\modules\economy\economy.service.spec.ts` 末尾追加（先读该文件确认现有 mock 结构，沿用 `mockPlayerService` / `mockCacheService` 命名；若命名不同，对齐到现有命名后再运行）：

```ts
describe('exchange 兑换铁律', () => {
  let service: EconomyService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EconomyService,
        {
          provide: getRepositoryToken(Transaction),
          useValue: {
            create: jest.fn((v) => v),
            save: jest.fn((v) => Promise.resolve(v)),
            find: jest.fn(() => Promise.resolve([])),
          },
        },
        {
          provide: PlayerService,
          useValue: mockPlayerService,
        },
        {
          provide: CacheService,
          useValue: mockCacheService,
        },
        {
          provide: EventBusService,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = moduleRef.get(EconomyService);
  });

  it('社交币之间禁止兑换', async () => {
    await expect(
      service.exchange('1', CurrencyType.FAVOR, CurrencyType.GUILD_CONTRIB, 10),
    ).rejects.toMatchObject({ code: ErrorCodes.EXCHANGE_NOT_ALLOWED });
  });

  it('社交币与金币/钻石禁止兑换', async () => {
    await expect(
      service.exchange('1', CurrencyType.GOLD, CurrencyType.FAVOR, 10),
    ).rejects.toMatchObject({ code: ErrorCodes.EXCHANGE_NOT_ALLOWED });
    await expect(
      service.exchange('1', CurrencyType.FAVOR, CurrencyType.DIAMOND, 10),
    ).rejects.toMatchObject({ code: ErrorCodes.EXCHANGE_NOT_ALLOWED });
  });

  it('金币不参与兑换', async () => {
    await expect(
      service.exchange('1', CurrencyType.GOLD, CurrencyType.DIAMOND, 10),
    ).rejects.toMatchObject({ code: ErrorCodes.EXCHANGE_NOT_ALLOWED });
  });

  it('钻石可兑换绑定钻（1:1）', async () => {
    mockPlayerService.getCurrency.mockImplementation(
      (playerId: string, type: CurrencyType) =>
        Promise.resolve({ playerId, currencyType: type, amount: '100' }),
    );
    mockPlayerService.saveCurrency.mockImplementation((c) =>
      Promise.resolve(c),
    );
    const result = await service.exchange(
      '1',
      CurrencyType.DIAMOND,
      CurrencyType.BOUND_DIAMOND,
      30,
    );
    expect(result.balanceAfter).toBe('70');
    // 绑定钻 +30
    const saveCalls = mockPlayerService.saveCurrency.mock.calls;
    const boundSave = saveCalls.find(
      (c) => c[0].currencyType === CurrencyType.BOUND_DIAMOND,
    );
    expect(boundSave[0].amount).toBe('30');
  });

  it('金额必须大于0', async () => {
    await expect(
      service.exchange('1', CurrencyType.DIAMOND, CurrencyType.BOUND_DIAMOND, 0),
    ).rejects.toMatchObject({ code: ErrorCodes.PARAM_INVALID });
  });

  it('相同货币禁止兑换', async () => {
    await expect(
      service.exchange('1', CurrencyType.DIAMOND, CurrencyType.DIAMOND, 10),
    ).rejects.toMatchObject({ code: ErrorCodes.EXCHANGE_NOT_ALLOWED });
  });
});
```

`exchange` 尚不存在，测试会失败。运行确认失败：

Run: `npx jest src/modules/economy/economy.service.spec.ts --no-coverage -t "exchange"`
Expected: FAIL（`exchange` 不是函数 / Cannot read properties of undefined）。

- [ ] **Step 2: 修改 `src/modules/player/player.service.ts` 初始化五币**

在 `createPlayer` 中，将原来的两行 `currencyRepo.create` 替换为五行（含三个社交货币，初始 `'0'`）：

```ts
    const goldCurrency = this.currencyRepo.create({
      playerId: savedPlayer.id,
      currencyType: CurrencyType.GOLD,
      amount: initialGold.toString(),
    });
    const diamondCurrency = this.currencyRepo.create({
      playerId: savedPlayer.id,
      currencyType: CurrencyType.DIAMOND,
      amount: initialDiamond.toString(),
    });
    const favorCurrency = this.currencyRepo.create({
      playerId: savedPlayer.id,
      currencyType: CurrencyType.FAVOR,
      amount: '0',
    });
    const guildContribCurrency = this.currencyRepo.create({
      playerId: savedPlayer.id,
      currencyType: CurrencyType.GUILD_CONTRIB,
      amount: '0',
    });
    const faceCurrency = this.currencyRepo.create({
      playerId: savedPlayer.id,
      currencyType: CurrencyType.FACE,
      amount: '0',
    });
    await this.currencyRepo.save([
      goldCurrency,
      diamondCurrency,
      favorCurrency,
      guildContribCurrency,
      faceCurrency,
    ]);
```

- [ ] **Step 3: 修改 `src/modules/economy/economy.service.ts`**

3a. 在类顶部加常量与私有方法（`getBalance` 方法之前）：

```ts
  private static readonly SOCIAL_CURRENCIES = [
    CurrencyType.FAVOR,
    CurrencyType.GUILD_CONTRIB,
    CurrencyType.FACE,
  ];

  private async ensureCurrencyRow(
    playerId: string,
    currencyType: CurrencyType,
  ): Promise<void> {
    const currency = await this.playerService.getCurrency(playerId, currencyType);
    if (currency) return;
    await this.playerService.saveCurrency(
      this.playerService.createEmptyCurrency
        ? await this.playerService.createEmptyCurrency(playerId, currencyType)
        : ({ playerId, currencyType, amount: '0' } as any),
    );
  }
```

3b. 在 `addCurrency` 与 `deductCurrency` 的 `withLock` 回调开头（`const currency = await this.playerService.getCurrency(...)` 之前）插入：

```ts
        await this.ensureCurrencyRow(playerId, currencyType);
```

这样存量玩家（未初始化三新币行）首次加扣时自动补 `'0'` 行，同时保留原有的「货币类型不存在」防御（getCurrency 仍可能返回 null 的情况由 ensureCurrencyRow 兜底后不再出现）。

3c. 在 `getBalance` 之前新增 `exchange` 方法：

```ts
  async exchange(
    playerId: string,
    from: CurrencyType,
    to: CurrencyType,
    amount: number,
  ): Promise<{ balanceAfter: string }> {
    if (amount <= 0) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '金额必须大于0');
    }
    if (from === to) {
      throw new GameException(ErrorCodes.EXCHANGE_NOT_ALLOWED, '货币相同不可兑换');
    }
    const socialOrGold = (t: CurrencyType) =>
      EconomyService.SOCIAL_CURRENCIES.includes(t) || t === CurrencyType.GOLD;
    if (socialOrGold(from) || socialOrGold(to)) {
      throw new GameException(
        ErrorCodes.EXCHANGE_NOT_ALLOWED,
        '仅钻石与绑定钻之间允许兑换（社交货币只能通过社交获取）',
      );
    }

    // 先扣后加：扣款失败直接中断；加款失败则回补，保证不丢币
    await this.deductCurrency(
      playerId,
      from,
      amount,
      'exchange',
      `exchange:${playerId}:${from}->${to}:${amount}`,
    );
    try {
      return await this.addCurrency(
        playerId,
        to,
        amount,
        'exchange',
        `exchange:${playerId}:${from}->${to}:${amount}`,
      );
    } catch (err) {
      await this.addCurrency(
        playerId,
        from,
        amount,
        'exchange_rollback',
        `exchange:${playerId}:${from}->${to}:${amount}:rollback`,
      );
      throw err;
    }
  }
```

3d. 在 `getBalance` 之后新增 `getSocialBalances`：

```ts
  async getSocialBalances(playerId: string): Promise<Record<string, string>> {
    const [favor, guildContrib, face] = await Promise.all([
      this.getBalance(playerId, CurrencyType.FAVOR),
      this.getBalance(playerId, CurrencyType.GUILD_CONTRIB),
      this.getBalance(playerId, CurrencyType.FACE),
    ]);
    return { favor, guildContrib, face };
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest src/modules/economy/economy.service.spec.ts --no-coverage`
Expected: PASS（含新增 6 用例与原有用例）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/player/player.service.ts src/modules/economy/economy.service.ts src/modules/economy/economy.service.spec.ts
git commit -m "feat(economy): 社交货币三币种 + 兑换铁律（仅钻石↔绑定钻）"
```

---

## Task 3: 社交货币玩家侧接口

**Files:**
- Create: `src/modules/economy/dto/exchange.dto.ts`
- Create: `src/modules/economy/economy.client.controller.ts`
- Modify: `src/modules/economy/economy.module.ts`（注册新 controller）

- [ ] **Step 1: 创建 `src/modules/economy/dto/exchange.dto.ts`**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, Min } from 'class-validator';
import { CurrencyType } from '@constants/enums';

export class ExchangeDto {
  @ApiProperty({ enum: CurrencyType })
  @IsEnum(CurrencyType)
  from: CurrencyType;

  @ApiProperty({ enum: CurrencyType })
  @IsEnum(CurrencyType)
  to: CurrencyType;

  @ApiProperty()
  @IsInt()
  @Min(1)
  amount: number;
}
```

（先读 `src/modules/economy/dto/admin-currency.dto.ts` 确认 class-validator 风格，若项目用 joi 或其他则对齐。）

- [ ] **Step 2: 创建 `src/modules/economy/economy.client.controller.ts`**

```ts
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EconomyService } from './economy.service';
import { ExchangeDto } from './dto/exchange.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

@ApiTags('Economy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/client/v1/economy')
export class EconomyClientController {
  constructor(private readonly economyService: EconomyService) {}

  @Get('social/balances')
  @ApiOperation({ summary: '社交货币余额（人情值/帮贡/颜面）' })
  async getSocialBalances(@CurrentPlayer() player: CurrentPlayerData) {
    return this.economyService.getSocialBalances(player.playerId);
  }

  @Post('exchange')
  @ApiOperation({ summary: '货币兑换（仅钻石↔绑定钻）' })
  async exchange(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: ExchangeDto,
  ) {
    return this.economyService.exchange(
      player.playerId,
      dto.from,
      dto.to,
      dto.amount,
    );
  }
}
```

- [ ] **Step 3: 注册 controller**

读 `src/modules/economy/economy.module.ts`，在 `controllers` 数组加入 `EconomyClientController`，并确保 `imports` 已含 `TypeOrmModule.forFeature([Transaction])`（沿用现有）。

- [ ] **Step 4: 编译校验 + 本地冒烟**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0。

本地起服后冒烟（管理员先给测试号发一枚钻石，再用玩家 token）：
```
POST http://localhost:3000/api/client/v1/economy/exchange  {"from":"diamond","to":"bound_diamond","amount":10}
```
Expected: `{"balanceAfter":"..."}`；用 `{"from":"favor","to":"gold","amount":10}` 应返回 body.code=20009（HTTP 200，见 errorResponse 契约）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/economy/dto/exchange.dto.ts src/modules/economy/economy.client.controller.ts src/modules/economy/economy.module.ts
git commit -m "feat(economy): 社交货币余额与兑换接口"
```

---

## Task 4: 账号安全——实体与表扩展

**Files:**
- Modify: `src/modules/auth/entities/auth-account.entity.ts`
- Create: `src/modules/auth/entities/account-penalty.entity.ts`
- Create: `src/modules/auth/entities/account-security-event.entity.ts`
- Modify: `src/modules/auth/auth.module.ts`（注册新实体）

- [ ] **Step 1: 修改 `auth-account.entity.ts`**

在 `banExpireAt` 字段之后追加：

```ts
  @Column({ name: 'muted_until', type: 'timestamp', nullable: true })
  mutedUntil: Date | null;

  @Column({ name: 'trade_locked_until', type: 'timestamp', nullable: true })
  tradeLockedUntil: Date | null;

  @Column({ name: 'real_name', type: 'varchar', length: 512, nullable: true })
  realName: string | null; // AES 加密存储

  @Column({ name: 'id_no_hash', type: 'varchar', length: 64, nullable: true })
  idNoHash: string | null;

  @Column({ name: 'anti_addiction_on', type: 'boolean', default: false })
  antiAddictionOn: boolean;
```

- [ ] **Step 2: 创建 `account-penalty.entity.ts`**

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { PenaltyLevel } from '@constants/enums';

@Entity('account_penalties')
export class AccountPenalty {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'enum', enum: PenaltyLevel })
  level: PenaltyLevel;

  @Column({ type: 'varchar', length: 255 })
  reason: string;

  @Column({ name: 'until', type: 'timestamp', nullable: true })
  until: Date | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64 })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 3: 创建 `account-security-event.entity.ts`**

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('account_security_events')
export class AccountSecurityEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ type: 'varchar', length: 32 })
  type: string; // login_risk / verify_ok / verify_fail

  @Column({ name: 'login_ip', type: 'varchar', length: 45, nullable: true })
  loginIp: string | null;

  @Column({ name: 'device_info', type: 'varchar', length: 255, nullable: true })
  deviceInfo: string | null;

  @Column({ type: 'varchar', length: 32, default: 'flagged' })
  result: string; // flagged / ok / fail

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 4: 注册实体**

读 `src/modules/auth/auth.module.ts`，在 `TypeOrmModule.forFeature([...])` 数组加入 `AccountPenalty`、`AccountSecurityEvent`。

- [ ] **Step 5: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0。

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/entities/auth-account.entity.ts src/modules/auth/entities/account-penalty.entity.ts src/modules/auth/entities/account-security-event.entity.ts src/modules/auth/auth.module.ts
git commit -m "feat(auth): 账号安全实体（禁言/限交易/实名/封禁链/风控事件表）"
```

---

## Task 5: 加密工具（零依赖）

**Files:**
- Create: `src/common/crypto/crypto.util.ts`
- Create: `src/common/crypto/crypto.util.spec.ts`

- [ ] **Step 1: 写失败测试 `src/common/crypto/crypto.util.spec.ts`**

```ts
import { aesEncrypt, aesDecrypt, sha256Hex } from './crypto.util';

describe('crypto.util', () => {
  const secret = 'test-secret-123';

  it('aes 加解密往返一致', () => {
    const plain = '张三';
    const enc = aesEncrypt(plain, secret);
    expect(enc).not.toContain('张三');
    expect(aesDecrypt(enc, secret)).toBe(plain);
  });

  it('同一明文两次加密密文不同（随机 IV）', () => {
    expect(aesEncrypt('张三', secret)).not.toBe(aesEncrypt('张三', secret));
  });

  it('密钥错误解密失败', () => {
    const enc = aesEncrypt('张三', secret);
    expect(() => aesDecrypt(enc, 'wrong-secret')).toThrow();
  });

  it('sha256 固定输出', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest src/common/crypto/crypto.util.spec.ts --no-coverage`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 创建 `src/common/crypto/crypto.util.ts`**

```ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function aesEncrypt(plain: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function aesDecrypt(payload: string, secret: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('invalid ciphertext');
  }
  const key = deriveKey(secret);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest src/common/crypto/crypto.util.spec.ts --no-coverage`
Expected: PASS（4 用例）。

- [ ] **Step 5: Commit**

```bash
git add src/common/crypto/crypto.util.ts src/common/crypto/crypto.util.spec.ts
git commit -m "feat(common): AES-256-GCM 加密与 sha256 工具（零依赖）"
```

---

## Task 6: 账号安全——auth.service 扩展

**Files:**
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/auth.service.spec.ts`

- [ ] **Step 1: 写失败测试（auth.service.spec.ts 末尾追加）**

先读 `src/modules/auth/auth.service.spec.ts`，沿用现有 `mockAccountRepo` / `mockLoginLogRepo` / `mockPlayerService` 等 mock 命名，在 providers 中补 `mockPenaltyRepo` 与 `mockSecurityEventRepo`：

```ts
describe('账号安全扩展', () => {
  let service: AuthService;
  const mockPenaltyRepo = {
    create: jest.fn((v) => v),
    save: jest.fn((v) => Promise.resolve(v)),
    find: jest.fn(() => Promise.resolve([])),
    findOne: jest.fn(() => Promise.resolve(null)),
  };
  const mockSecurityEventRepo = {
    create: jest.fn((v) => v),
    save: jest.fn((v) => Promise.resolve(v)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(AuthAccount), useValue: mockAccountRepo },
        { provide: getRepositoryToken(AccountLoginLog), useValue: mockLoginLogRepo },
        { provide: getRepositoryToken(AccountPenalty), useValue: mockPenaltyRepo },
        {
          provide: getRepositoryToken(AccountSecurityEvent),
          useValue: mockSecurityEventRepo,
        },
        { provide: PlayerService, useValue: mockPlayerService },
        { provide: JwtService, useValue: { sign: jest.fn(() => 'token') } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => ({ secret: 's', expiresIn: '7d', realNameSecret: 'rs' })) },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('applyPenalty 禁言写冗余列并留痕', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '1',
      mutedUntil: null,
      tradeLockedUntil: null,
      status: AccountStatus.ACTIVE,
    });
    mockPenaltyRepo.findOne.mockResolvedValue(null);
    mockAccountRepo.update.mockResolvedValue({});

    await service.applyPenalty('gm1', '1', '1', PenaltyLevel.MUTE, '骂人', 3600);

    expect(mockPenaltyRepo.save).toHaveBeenCalled();
    expect(mockAccountRepo.update).toHaveBeenCalledWith(
      { id: '1' },
      expect.objectContaining({ mutedUntil: expect.any(Date) }),
    );
  });

  it('封禁不降级（新等级序号必须高于当前）', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '1',
      mutedUntil: new Date(),
      tradeLockedUntil: null,
      status: AccountStatus.ACTIVE,
    });
    mockPenaltyRepo.findOne.mockResolvedValue({ level: PenaltyLevel.BAN });

    await expect(
      service.applyPenalty('gm1', '1', '1', PenaltyLevel.MUTE, '降级尝试', 3600),
    ).rejects.toMatchObject({ code: ErrorCodes.PENALTY_LEVEL_INVALID });
  });

  it('bindRealName 加密存储且脱敏查询', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '1',
      realName: null,
      idNoHash: null,
    });
    mockAccountRepo.save.mockImplementation((v) => Promise.resolve(v));

    await service.bindRealName('1', '张三', '110101199001011234');
    const saved = mockAccountRepo.save.mock.calls[0][0];
    expect(saved.realName).not.toContain('张三');
    expect(saved.idNoHash).toHaveLength(64);

    const status = await service.getSecurityStatus('1');
    expect(status.realNameMasked).toContain('*');
  });

  it('getAccountRestrictions 到期自动解除', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '1',
      mutedUntil: new Date(Date.now() - 1000),
      tradeLockedUntil: null,
    });
    mockAccountRepo.update.mockResolvedValue({});

    const res = await service.getAccountRestrictions('1');
    expect(res.mutedUntil).toBeNull();
    expect(mockAccountRepo.update).toHaveBeenCalledWith(
      { id: '1' },
      { mutedUntil: null },
    );
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest src/modules/auth/auth.service.spec.ts --no-coverage -t "账号安全扩展"`
Expected: FAIL（applyPenalty 等不存在）。

- [ ] **Step 3: 实现 auth.service 扩展**

3a. 导入新增：

```ts
import { AccountPenalty } from './entities/account-penalty.entity';
import { AccountSecurityEvent } from './entities/account-security-event.entity';
import { PenaltyLevel } from '@constants/enums';
import { aesEncrypt, sha256Hex } from '@common/crypto/crypto.util';
```

3b. 构造函数注入两个新 repo，并读取 `realNameSecret`：

```ts
    @InjectRepository(AccountPenalty)
    private readonly penaltyRepo: Repository<AccountPenalty>,
    @InjectRepository(AccountSecurityEvent)
    private readonly securityEventRepo: Repository<AccountSecurityEvent>,
```
构造函数体内：
```ts
    this.realNameSecret =
      this.configService.get<string>('auth.realNameSecret') ??
      (jwtConfig?.secret ?? 'default-secret');
```
（类内新增字段：`private readonly realNameSecret: string;`）

3c. 新增 `recordSecurityEvent` 私有方法与风控标记。在 `login` 成功分支（`recordLoginLog(...'success')` 之后）插入风控检查：

```ts
    await this.recordLoginRiskIfAny(account.id, loginIp, deviceInfo);
```

新增方法（放在 `recordLoginLog` 之后）：

```ts
  private async recordLoginRiskIfAny(
    accountId: string,
    loginIp: string,
    deviceInfo?: string,
  ): Promise<void> {
    const last = await this.loginLogRepo.findOne({
      where: { accountId, loginResult: 'success' },
      order: { createdAt: 'DESC' },
    });
    if (!last || !last.loginIp) return;
    if (last.loginIp === loginIp) return;
    const evt = this.securityEventRepo.create({
      accountId,
      type: 'login_risk',
      loginIp,
      deviceInfo: deviceInfo ?? null,
      result: 'flagged',
    });
    await this.securityEventRepo.save(evt);
  }
```

（`AccountLoginLog` 需要 `findOne` 带 order——TypeORM Repository 原生支持，无需改实体。）

3d. 新增公开方法（放在 `getAccountById` 之后）：

```ts
  private static readonly PENALTY_ORDER: Record<PenaltyLevel, number> = {
    [PenaltyLevel.WARNING]: 1,
    [PenaltyLevel.MUTE]: 2,
    [PenaltyLevel.GUILD_REMOVE]: 3,
    [PenaltyLevel.TRADE_LIMIT]: 4,
    [PenaltyLevel.BAN]: 5,
  };

  async applyPenalty(
    adminUsername: string,
    playerId: string,
    accountId: string,
    level: PenaltyLevel,
    reason: string,
    durationSeconds?: number,
  ): Promise<AccountPenalty> {
    const order = AuthService.PENALTY_ORDER[level];
    if (!order) {
      throw new GameException(ErrorCodes.PENALTY_LEVEL_INVALID, '封禁等级无效');
    }
    const latest = await this.penaltyRepo.findOne({
      where: { accountId },
      order: { createdAt: 'DESC' },
    });
    if (latest && AuthService.PENALTY_ORDER[latest.level] > order) {
      throw new GameException(
        ErrorCodes.PENALTY_LEVEL_INVALID,
        '不能降级处置，当前等级更高',
      );
    }

    const until =
      durationSeconds && durationSeconds > 0
        ? new Date(Date.now() + durationSeconds * 1000)
        : null;
    const penalty = this.penaltyRepo.create({
      accountId,
      playerId,
      level,
      reason,
      until,
      createdBy: adminUsername,
    });
    await this.penaltyRepo.save(penalty);

    const update: Record<string, any> = {};
    if (level === PenaltyLevel.MUTE) update.mutedUntil = until;
    if (level === PenaltyLevel.TRADE_LIMIT) update.tradeLockedUntil = until;
    if (level === PenaltyLevel.BAN) {
      update.status = AccountStatus.BANNED;
      update.banReason = reason;
      update.banExpireAt = until;
    }
    if (Object.keys(update).length > 0) {
      await this.accountRepo.update({ id: accountId }, update);
    }
    return penalty;
  }

  async getPenalties(playerId: string): Promise<AccountPenalty[]> {
    return this.penaltyRepo.find({
      where: { playerId },
      order: { createdAt: 'DESC' },
    });
  }

  async getAccountRestrictions(accountId: string): Promise<{
    mutedUntil: Date | null;
    tradeLockedUntil: Date | null;
    realNameBound: boolean;
    antiAddictionOn: boolean;
  }> {
    const account = await this.accountRepo.findOne({
      where: { id: accountId },
    });
    if (!account) {
      throw new GameException(ErrorCodes.ACCOUNT_NOT_FOUND, '账号不存在');
    }
    const now = new Date();
    const update: Record<string, any> = {};
    let { mutedUntil, tradeLockedUntil } = account;
    if (mutedUntil && mutedUntil < now) {
      mutedUntil = null;
      update.mutedUntil = null;
    }
    if (tradeLockedUntil && tradeLockedUntil < now) {
      tradeLockedUntil = null;
      update.tradeLockedUntil = null;
    }
    if (Object.keys(update).length > 0) {
      await this.accountRepo.update({ id: accountId }, update);
    }
    return {
      mutedUntil,
      tradeLockedUntil,
      realNameBound: Boolean(account.realName),
      antiAddictionOn: account.antiAddictionOn,
    };
  }

  async bindRealName(
    accountId: string,
    realName: string,
    idNo: string,
  ): Promise<void> {
    const account = await this.accountRepo.findOne({
      where: { id: accountId },
    });
    if (!account) {
      throw new GameException(ErrorCodes.ACCOUNT_NOT_FOUND, '账号不存在');
    }
    account.realName = aesEncrypt(realName.trim(), this.realNameSecret);
    account.idNoHash = sha256Hex(idNo.trim());
    await this.accountRepo.save(account);
  }

  async getSecurityStatus(accountId: string): Promise<{
    realNameMasked: string | null;
    idNoBound: boolean;
    antiAddictionOn: boolean;
  }> {
    const account = await this.accountRepo.findOne({
      where: { id: accountId },
    });
    if (!account) {
      throw new GameException(ErrorCodes.ACCOUNT_NOT_FOUND, '账号不存在');
    }
    let realNameMasked: string | null = null;
    if (account.realName) {
      const plain = (await import('@common/crypto/crypto.util')).aesDecrypt(
        account.realName,
        this.realNameSecret,
      );
      realNameMasked =
        plain.length <= 1 ? plain[0] + '*' : plain[0] + '*'.repeat(plain.length - 1);
    }
    return {
      realNameMasked,
      idNoBound: Boolean(account.idNoHash),
      antiAddictionOn: account.antiAddictionOn,
    };
  }

  async setAntiAddiction(
    accountId: string,
    on: boolean,
  ): Promise<void> {
    await this.accountRepo.update({ id: accountId }, { antiAddictionOn: on });
  }
```

（顶部已 import `aesDecrypt` 则去掉 `await import` 写法，直接用；为简洁，3a 导入改为 `import { aesDecrypt, aesEncrypt, sha256Hex } from '@common/crypto/crypto.util';`，`getSecurityStatus` 直接调用 `aesDecrypt`。）

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest src/modules/auth/auth.service.spec.ts --no-coverage`
Expected: PASS（新增 4 用例 + 原有用例）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/auth.service.ts src/modules/auth/auth.service.spec.ts
git commit -m "feat(auth): 风控事件/分级封禁链/实名防沉迷/限制查询"
```

---

## Task 7: 账号安全——玩家侧接口

**Files:**
- Create: `src/modules/auth/dto/realname.dto.ts`
- Modify: `src/modules/auth/auth.controller.ts`

- [ ] **Step 1: 创建 `src/modules/auth/dto/realname.dto.ts`**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

export class RealNameDto {
  @ApiProperty()
  @IsString()
  @Length(2, 32)
  realName: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{17}[\dXx]$/, { message: '身份证号格式不正确' })
  idNo: string;
}

export class VerifyDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  deviceInfo?: string;
}

export class AntiAddictionDto {
  @ApiProperty()
  @IsBoolean()
  on: boolean;
}
```

（先读 `src/modules/auth/dto/login.dto.ts` 确认校验风格，若项目用 joi 则对齐；`class-validator` 若未装，用简单手写校验代替——计划按 class-validator 走，项目已有 DTO。）

- [ ] **Step 2: 修改 `auth.controller.ts`**

在类内追加（沿用 `@UseGuards(JwtAuthGuard)` + `@CurrentPlayer` 风格；注意 AuthController 目前是 Public 无守卫，新增接口需要单独守卫——Nest 中控制器级守卫会覆盖所有路由，因此改为在新增的三个方法上各加 `@UseGuards(JwtAuthGuard)`，控制器级不加守卫，避免影响 register/login/guest 的 Public）：

```ts
  @UseGuards(JwtAuthGuard)
  @Post('security/verify')
  @ApiOperation({ summary: '风控确认（记录本人确认事件）' })
  async verify(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: VerifyDto,
    @Ip() ip: string,
  ) {
    await this.authService.recordSecurityConfirm(
      player.accountId,
      ip,
      dto.deviceInfo,
    );
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('realname')
  @ApiOperation({ summary: '实名绑定' })
  async bindRealName(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: RealNameDto,
  ) {
    await this.authService.bindRealName(player.accountId, dto.realName, dto.idNo);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('security-status')
  @ApiOperation({ summary: '账号安全状态（禁言/限交易/实名/防沉迷）' })
  async securityStatus(@CurrentPlayer() player: CurrentPlayerData) {
    const restrictions = await this.authService.getAccountRestrictions(
      player.accountId,
    );
    const security = await this.authService.getSecurityStatus(player.accountId);
    return { ...restrictions, ...security };
  }

  @UseGuards(JwtAuthGuard)
  @Post('anti-addiction')
  @ApiOperation({ summary: '切换防沉迷' })
  async setAntiAddiction(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: AntiAddictionDto,
  ) {
    await this.authService.setAntiAddiction(player.accountId, dto.on);
    return { ok: true };
  }
```

3b. `AuthService` 新增 `recordSecurityConfirm`（在 `recordLoginRiskIfAny` 之后）：

```ts
  async recordSecurityConfirm(
    accountId: string,
    loginIp: string,
    deviceInfo?: string,
  ): Promise<void> {
    const evt = this.securityEventRepo.create({
      accountId,
      type: 'verify_ok',
      loginIp,
      deviceInfo: deviceInfo ?? null,
      result: 'ok',
    });
    await this.securityEventRepo.save(evt);
  }
```

- [ ] **Step 3: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0。

- [ ] **Step 4: Commit**

```bash
git add src/modules/auth/dto/realname.dto.ts src/modules/auth/auth.controller.ts src/modules/auth/auth.service.ts
git commit -m "feat(auth): 玩家侧风控确认/实名/安全状态接口"
```

---

## Task 8: 账号安全——Admin 处置接口

**Files:**
- Create: `src/modules/auth/auth-admin.controller.ts`
- Create: `src/modules/auth/dto/penalty.dto.ts`
- Modify: `src/modules/auth/auth.module.ts`（注册 controller）

- [ ] **Step 1: 创建 `src/modules/auth/dto/penalty.dto.ts`**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { PenaltyLevel } from '@constants/enums';

export class ApplyPenaltyDto {
  @ApiProperty()
  @IsString()
  playerId: string;

  @ApiProperty()
  @IsString()
  accountId: string;

  @ApiProperty({ enum: PenaltyLevel })
  @IsEnum(PenaltyLevel)
  level: PenaltyLevel;

  @ApiProperty()
  @IsString()
  @Length(1, 255)
  reason: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  durationSeconds?: number;
}
```

- [ ] **Step 2: 创建 `src/modules/auth/auth-admin.controller.ts`**

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ApplyPenaltyDto } from './dto/penalty.dto';
import { AdminGuard } from '@common/guards/admin.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';

@ApiTags('Admin-Auth')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Roles('super_admin', 'admin', 'operator')
@Controller('api/admin/v1/auth')
export class AuthAdminController {
  constructor(private readonly authService: AuthService) {}

  @Post('penalties')
  @ApiOperation({ summary: 'GM 分级处置（警告/禁言/帮派除名/限交易/封禁）' })
  async applyPenalty(
    @Body() dto: ApplyPenaltyDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    return this.authService.applyPenalty(
      admin.username,
      dto.playerId,
      dto.accountId,
      dto.level,
      dto.reason,
      dto.durationSeconds,
    );
  }

  @Get('penalties/:playerId')
  @ApiOperation({ summary: '查询玩家处置记录' })
  async getPenalties(@Param('playerId') playerId: string) {
    return this.authService.getPenalties(playerId);
  }
}
```

- [ ] **Step 3: 注册 controller**

读 `src/modules/auth/auth.module.ts`，`controllers` 数组加入 `AuthAdminController`。

- [ ] **Step 4: 编译校验 + 冒烟说明**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0。

冒烟（部署后）：admin token 调 `POST /api/admin/v1/auth/penalties`，viewer 角色应 401（Insufficient permissions）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/dto/penalty.dto.ts src/modules/auth/auth-admin.controller.ts src/modules/auth/auth.module.ts
git commit -m "feat(auth): GM 分级处置管理接口（角色权限矩阵）"
```

---

## Task 9: 角色名片——实体扩展

**Files:**
- Modify: `src/modules/character/entities/character-profile.entity.ts`
- Create: `src/modules/character/entities/title-template.entity.ts`
- Create: `src/modules/character/entities/character-title.entity.ts`
- Modify: `src/modules/character/character.module.ts`（注册新实体）

- [ ] **Step 1: 修改 `character-profile.entity.ts`**

在 `background` 字段之后追加：

```ts
  @Column({ name: 'alias', type: 'varchar', length: 24, nullable: true })
  alias: string | null;

  @Column({ name: 'poem', type: 'varchar', length: 64, nullable: true })
  poem: string | null;

  @Column({ name: 'social_bio', type: 'jsonb', default: [] })
  socialBio: any;
```

- [ ] **Step 2: 创建 `title-template.entity.ts`**

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('title_templates')
export class TitleTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ name: 'icon_url', type: 'varchar', length: 256, nullable: true })
  iconUrl: string | null;

  @Column({ type: 'jsonb', default: {} })
  condition: any;

  @Column({ name: 'reward_json', type: 'jsonb', default: {} })
  rewardJson: any;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 3: 创建 `character-title.entity.ts`**

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('character_titles')
@Index(['characterId', 'titleId'], { unique: true })
export class CharacterTitle {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @Column({ name: 'title_id', type: 'bigint' })
  titleId: string;

  @Column({ name: 'is_equipped', type: 'boolean', default: false })
  isEquipped: boolean;

  @CreateDateColumn({ name: 'obtained_at' })
  obtainedAt: Date;
}
```

- [ ] **Step 4: 注册实体**

读 `src/modules/character/character.module.ts`，`TypeOrmModule.forFeature([...])` 加入 `TitleTemplate`、`CharacterTitle`。

- [ ] **Step 5: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0。

- [ ] **Step 6: Commit**

```bash
git add src/modules/character/entities/character-profile.entity.ts src/modules/character/entities/title-template.entity.ts src/modules/character/entities/character-title.entity.ts src/modules/character/character.module.ts
git commit -m "feat(character): 名片字段 + 称号模板/持有实体"
```

---

## Task 10: 角色名片——service 方法 + 测试

**Files:**
- Modify: `src/modules/character/character.service.ts`
- Modify: `src/modules/character/character.service.spec.ts`

- [ ] **Step 1: 写失败测试（character.service.spec.ts 末尾追加）**

先读 `src/modules/character/character.service.spec.ts`，沿用现有 `moduleRef`/mock repo 模式；确保 providers 含 `TitleTemplate` 与 `CharacterTitle` 的 mock repo（`getRepositoryToken`），并为 `getByPlayerId` 提供返回值。

```ts
describe('角色名片与称号', () => {
  it('updateCard 校验长度并保存', async () => {
    // mock profileRepo.findOne 返回 { alias: null, poem: null }
    // mock profileRepo.save 返回入参
    await expect(
      characterService.updateCard('1', { alias: 'x'.repeat(25) }),
    ).rejects.toMatchObject({ code: ErrorCodes.PARAM_INVALID });
    const res = await characterService.updateCard('1', {
      alias: '逍遥客',
      poem: '十步杀一人，千里不留行',
    });
    expect(res.alias).toBe('逍遥客');
  });

  it('equipTitle 未拥有拒绝 / 装备唯一', async () => {
    // titleRepo.findOne 返回 { id: '10', name: '状元', iconUrl: null }
    // charTitleRepo.findOne 返回 null → 未拥有
    await expect(
      characterService.equipTitle('1', '10', true),
    ).rejects.toMatchObject({ code: ErrorCodes.TITLE_NOT_OWNED });
  });

  it('grantTitle 幂等：已拥有不重复插入', async () => {
    // charTitleRepo.findOne 返回 { characterId:'1', titleId:'10' }
    // 调 grantTitle 两次，第二次不抛错且 save 只调一次
  });

  it('getCard 返回脱敏名片', async () => {
    // 返回 { alias, poem, titles: [...] }
  });
});
```

（步骤 1 的测试骨架依赖现有 spec 的注入方式——打开 `character.service.spec.ts` 后按该文件的实际 mock 命名补全断言与 mock 返回值，再运行确认红。）

- [ ] **Step 2: 运行确认失败**

Run: `npx jest src/modules/character/character.service.spec.ts --no-coverage -t "角色名片与称号"`
Expected: FAIL。

- [ ] **Step 3: 实现 character.service 扩展**

3a. 导入：

```ts
import { TitleTemplate } from './entities/title-template.entity';
import { CharacterTitle } from './entities/character-title.entity';
```

3b. 构造函数追加：

```ts
    @InjectRepository(TitleTemplate)
    private readonly titleRepo: Repository<TitleTemplate>,
    @InjectRepository(CharacterTitle)
    private readonly charTitleRepo: Repository<CharacterTitle>,
```

3c. 新增方法（文件末尾）：

```ts
  async updateCard(
    characterId: string,
    data: { alias?: string; poem?: string },
  ): Promise<{ alias: string | null; poem: string | null }> {
    const profile = await this.profileRepo.findOne({
      where: { characterId },
    });
    if (!profile) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色档案不存在');
    }
    if (data.alias !== undefined) {
      const alias = data.alias.trim();
      if (alias.length > 24) {
        throw new GameException(ErrorCodes.PARAM_INVALID, '名号最长24字');
      }
      profile.alias = alias || null;
    }
    if (data.poem !== undefined) {
      const poem = data.poem.trim();
      if (poem.length > 64) {
        throw new GameException(ErrorCodes.PARAM_INVALID, '诗号最长64字');
      }
      profile.poem = poem || null;
    }
    const saved = await this.profileRepo.save(profile);
    return { alias: saved.alias, poem: saved.poem };
  }

  async getCard(characterId: string): Promise<{
    name: string;
    alias: string | null;
    poem: string | null;
    level: number;
    titles: { name: string; iconUrl: string | null }[];
  }> {
    const profile = await this.profileRepo.findOne({
      where: { characterId },
    });
    const character = await this.characterRepo.findOne({
      where: { id: characterId },
    });
    if (!profile || !character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    const titles = await this.charTitleRepo.find({
      where: { characterId, isEquipped: true },
    });
    const titleTemplates = titles.length
      ? await this.titleRepo.find({
          where: { id: In(titles.map((t) => t.titleId)) },
        })
      : [];
    const titleMap = new Map(titleTemplates.map((t) => [t.id, t]));
    return {
      name: character.name,
      alias: profile.alias,
      poem: profile.poem,
      level: character.level,
      titles: titles.map((t) => {
        const tmpl = titleMap.get(t.titleId);
        return {
          name: tmpl?.name ?? '',
          iconUrl: tmpl?.iconUrl ?? null,
        };
      }),
    };
  }

  async grantTitle(
    characterId: string,
    titleId: string,
  ): Promise<CharacterTitle> {
    const existing = await this.charTitleRepo.findOne({
      where: { characterId, titleId },
    });
    if (existing) return existing;
    const title = await this.titleRepo.findOne({ where: { id: titleId } });
    if (!title) {
      throw new GameException(ErrorCodes.TITLE_NOT_FOUND, '称号不存在');
    }
    const record = this.charTitleRepo.create({
      characterId,
      titleId,
      isEquipped: false,
    });
    return this.charTitleRepo.save(record);
  }

  async equipTitle(
    characterId: string,
    titleId: string,
    equip: boolean,
  ): Promise<void> {
    const owned = await this.charTitleRepo.findOne({
      where: { characterId, titleId },
    });
    if (!owned) {
      throw new GameException(ErrorCodes.TITLE_NOT_OWNED, '未获得该称号');
    }
    if (equip) {
      await this.charTitleRepo.update(
        { characterId, isEquipped: true },
        { isEquipped: false },
      );
      owned.isEquipped = true;
    } else {
      owned.isEquipped = false;
    }
    await this.charTitleRepo.save(owned);
  }

  async getTitles(characterId: string): Promise<CharacterTitle[]> {
    return this.charTitleRepo.find({
      where: { characterId },
      order: { obtainedAt: 'DESC' },
    });
  }
```

（注意：`character.service.ts` 需要确认 `profileRepo` 与 `characterRepo` 的既有字段名——打开文件后对齐；`In` 从 `typeorm` 导入；`character.name`/`character.level` 若不存在则改用 `getFullProfile` 返回结构。若 `Character` 实体字段不同，按实际字段调整。）

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest src/modules/character/character.service.spec.ts --no-coverage`
Expected: PASS（新增 4 用例 + 原有）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/character/character.service.ts src/modules/character/character.service.spec.ts
git commit -m "feat(character): 名片（名号/诗号）+ 称号获取/装备"
```

---

## Task 11: 角色名片——玩家侧接口

**Files:**
- Create: `src/modules/character/dto/card.dto.ts`
- Modify: `src/modules/character/character.controller.ts`

- [ ] **Step 1: 创建 `src/modules/character/dto/card.dto.ts`**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class UpdateCardDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 24)
  alias?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  poem?: string;
}

export class EquipTitleDto {
  @ApiProperty()
  @IsString()
  titleId: string;

  @ApiProperty()
  @IsBoolean()
  equip: boolean;
}
```

- [ ] **Step 2: 修改 `character.controller.ts`**

在类内追加三个接口（沿用现有 getByPlayerId → 不存在抛 PLAYER_NOT_FOUND 模式）：

```ts
  @Put('card')
  @ApiOperation({ summary: '设置名号/诗号' })
  async updateCard(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: UpdateCardDto,
  ) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return this.characterService.updateCard(character.id, dto);
  }

  @Post('titles/equip')
  @ApiOperation({ summary: '装备/卸下称号' })
  async equipTitle(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: EquipTitleDto,
  ) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return this.characterService.equipTitle(
      character.id,
      dto.titleId,
      dto.equip,
    );
  }

  @Get('titles')
  @ApiOperation({ summary: '我的称号列表' })
  async getTitles(@CurrentPlayer() player: CurrentPlayerData) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return this.characterService.getTitles(character.id);
  }

  @Get('card/:id')
  @ApiOperation({ summary: '查看他人名片' })
  async getCard(@Param('id') characterId: string) {
    return this.characterService.getCard(characterId);
  }
```

（`@Param` 需从 `@nestjs/common` 导入，确认文件顶部 import 已含。）

- [ ] **Step 3: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0。

- [ ] **Step 4: Commit**

```bash
git add src/modules/character/dto/card.dto.ts src/modules/character/character.controller.ts
git commit -m "feat(character): 名片/称号玩家侧接口"
```

---

## Task 12: 场景物件——枚举 + 新表

**Files:**
- Modify: `src/constants/enums.ts`（Task 1 已完成枚举，本任务无重复）
- Create: `src/modules/world/entities/player-mount.entity.ts`
- Create: `src/modules/world/entities/street-game.entity.ts`
- Create: `src/modules/world/entities/game-session.entity.ts`
- Create: `src/modules/world/entities/landmark-message.entity.ts`
- Create: `src/modules/world/entities/trigger-unlock.entity.ts`
- Modify: `src/modules/world/world.module.ts`（注册实体）

- [ ] **Step 1: 创建 `player-mount.entity.ts`**

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('player_mounts')
@Index(['characterId', 'mountId'], { unique: true })
export class PlayerMount {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @Column({ name: 'mount_id', type: 'bigint' })
  mountId: string;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  @CreateDateColumn({ name: 'obtained_at' })
  obtainedAt: Date;
}
```

- [ ] **Step 2: 创建 `street-game.entity.ts`**

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { GameType } from '@constants/enums';

@Entity('street_games')
export class StreetGame {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ name: 'game_type', type: 'enum', enum: GameType })
  gameType: GameType;

  @Column({ name: 'min_level', type: 'int', default: 1 })
  minLevel: number;

  @Column({ name: 'bet_range', type: 'jsonb', default: { min: 10, max: 1000 } })
  betRange: any;

  @Column({ name: 'reward_json', type: 'jsonb', default: {} })
  rewardJson: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 3: 创建 `game-session.entity.ts`**

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { GameSessionStatus } from '@constants/enums';

@Entity('game_sessions')
export class GameSession {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'game_id', type: 'bigint' })
  gameId: string;

  @Column({ name: 'host_player_id', type: 'bigint' })
  hostPlayerId: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: GameSessionStatus,
    default: GameSessionStatus.OPEN,
  })
  status: GameSessionStatus;

  @Column({ name: 'bet_pool', type: 'bigint', default: '0' })
  betPool: string;

  @Column({ name: 'winner_player_id', type: 'bigint', nullable: true })
  winnerPlayerId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'finished_at', type: 'timestamp', nullable: true })
  finishedAt: Date | null;
}
```

- [ ] **Step 4: 创建 `landmark-message.entity.ts`**

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('landmark_messages')
export class LandmarkMessage {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'object_id', type: 'bigint' })
  objectId: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'varchar', length: 100 })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 5: 创建 `trigger-unlock.entity.ts`**

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('trigger_unlocks')
export class TriggerUnlock {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'trigger_id', type: 'bigint' })
  triggerId: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @CreateDateColumn({ name: 'unlocked_at' })
  unlockedAt: Date;
}
```

- [ ] **Step 6: 注册实体**

读 `src/modules/world/world.module.ts`，`TypeOrmModule.forFeature([...])` 加入全部五个新实体。

- [ ] **Step 7: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0。

- [ ] **Step 8: Commit**

```bash
git add src/modules/world/entities/player-mount.entity.ts src/modules/world/entities/street-game.entity.ts src/modules/world/entities/game-session.entity.ts src/modules/world/entities/landmark-message.entity.ts src/modules/world/entities/trigger-unlock.entity.ts src/modules/world/world.module.ts
git commit -m "feat(world): 场景物件实体（坐骑/街头玩法/地标留言/机关解锁）"
```

---

## Task 13: 场景物件——物件互动（冷却/一次性/资源策略）

**Files:**
- Modify: `src/modules/world/world.service.ts`
- Modify: `src/modules/world/world.service.spec.ts`
- Modify: `src/modules/world/world.module.ts`（imports EconomyModule）

- [ ] **Step 1: 写失败测试（world.service.spec.ts 末尾追加）**

先读 `src/modules/world/world.service.spec.ts`，沿用其模块编译方式；WorldService 新增依赖 `EconomyService` 与 `CacheService`（`CacheService` 若 world.service 尚无则需补 mock：`withLock: jest.fn((key, fn) => fn())`、`get/set/incr 等`按 service 实际调用补）。为控制 mock 面，本计划规定 `interactObject` 只依赖 `objectRepo`、`cacheService`、`economyService`：

```ts
describe('物件互动', () => {
  it('冷却中拒绝', async () => {
    mockObjectRepo.findOne.mockResolvedValue({
      id: '1',
      type: ObjectType.COLLECT,
      interactCd: 60,
      isOneTime: false,
      reward: { type: 'currency', currencyType: 'gold', amount: 10 },
    });
    mockCacheService.setNx.mockResolvedValue(false); // 已存在冷却键
    await expect(
      worldService.interactObject('1', '1', InteractType.COLLECT),
    ).rejects.toMatchObject({ code: ErrorCodes.OBJECT_COOLDOWN });
  });

  it('一次性物件已开启拒绝', async () => {
    mockObjectRepo.findOne.mockResolvedValue({
      id: '2',
      type: ObjectType.CHEST,
      interactCd: 0,
      isOneTime: true,
      reward: { type: 'currency', currencyType: 'gold', amount: 50 },
    });
    mockCacheService.setNx.mockResolvedValue(false); // 已开过
    await expect(
      worldService.interactObject('1', '2', InteractType.COLLECT),
    ).rejects.toMatchObject({ code: ErrorCodes.OBJECT_ALREADY_OPENED });
  });

  it('采集产出走资源策略折算', async () => {
    mockObjectRepo.findOne.mockResolvedValue({
      id: '3',
      type: ObjectType.COLLECT,
      interactCd: 5,
      isOneTime: false,
      reward: { type: 'currency', currencyType: 'gold', amount: 100 },
    });
    mockCacheService.setNx.mockResolvedValue(true);
    mockCacheService.get.mockResolvedValue('31'); // 当日第 31 次采集
    mockEconomyService.addCurrency.mockResolvedValue({ balanceAfter: '70' });

    await worldService.interactObject('1', '3', InteractType.COLLECT);

    const amountArg = mockEconomyService.addCurrency.mock.calls[0][2];
    expect(amountArg).toBeLessThan(100); // 效率递减生效
  });

  it('非采集类物件不走资源策略', async () => {
    mockObjectRepo.findOne.mockResolvedValue({
      id: '4',
      type: ObjectType.LANDMARK,
      interactCd: 0,
      isOneTime: false,
      reward: null,
    });
    mockCacheService.setNx.mockResolvedValue(true);
    const result = await worldService.interactObject('1', '4', InteractType.READ);
    expect(result).toHaveProperty('ok', true);
    expect(mockEconomyService.addCurrency).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest src/modules/world/world.service.spec.ts --no-coverage -t "物件互动"`
Expected: FAIL（interactObject 不存在 / 缺依赖）。

- [ ] **Step 3: 实现 world.service.interactObject**

3a. 构造函数注入新依赖（保持原有注入不动）：

```ts
    private readonly cacheService: CacheService,
    private readonly economyService: EconomyService,
```

（若 `world.service.ts` 已注入 `CacheService`，则只加 `EconomyService`。`world.module.ts` 增加 `imports: [..., EconomyModule]`；`EconomyModule` 需 `exports: [EconomyService]`——读 `economy.module.ts` 确认，若未 exports 则补。）

3b. 新增方法：

```ts
  async interactObject(
    playerId: string,
    objectId: string,
    interactType: InteractType,
  ): Promise<{ ok: boolean; reward?: any }> {
    const obj = await this.objectRepo.findOne({ where: { id: objectId } });
    if (!obj) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '物件不存在');
    }

    // 冷却校验（redis setNx）
    const cdKey = `world:obj:cd:${objectId}:${playerId}`;
    const cdOk = await this.cacheService.setNx(cdKey, '1');
    if (!cdOk) {
      throw new GameException(ErrorCodes.OBJECT_COOLDOWN, '物件冷却中');
    }
    if (obj.interactCd > 0) {
      await this.cacheService.expire(cdKey, obj.interactCd);
    } else {
      await this.cacheService.del(cdKey);
    }

    // 一次性校验
    if (obj.isOneTime) {
      const onceKey = `world:obj:once:${objectId}`;
      const first = await this.cacheService.setNx(onceKey, '1');
      if (!first) {
        throw new GameException(ErrorCodes.OBJECT_ALREADY_OPENED, '该物件已被开启');
      }
    }

    // 奖励发放（支持 { type:'currency', currencyType, amount }）
    const reward = obj.reward;
    if (reward && reward.type === 'currency') {
      let amount = Number(reward.amount);
      if (
        obj.type === ObjectType.COLLECT ||
        obj.type === ObjectType.STONE ||
        obj.type === ObjectType.PLANT
      ) {
        const policy = new ResourceBalancePolicy();
        const dateKey = new Date().toISOString().slice(0, 10);
        const harvestKey = `world:harvest:${playerId}:${dateKey}`;
        const seqKey = `world:seq:${objectId}`;
        const [harvestCount, seqCount] = await Promise.all([
          this.cacheService.get(harvestKey),
          this.cacheService.get(seqKey),
        ]);
        const harvestN = Number(harvestCount ?? '0');
        const seqN = Number(seqCount ?? '0');
        amount = policy.degradedYield(amount, seqN);
        amount = Math.floor(amount * policy.efficiencyFactor(harvestN + 1));
        await this.cacheService.incr(harvestKey);
        await this.cacheService.incr(seqKey);
        if (seqN === 0) {
          await this.cacheService.expire(seqKey, 6 * 3600);
        }
      }
      await this.economyService.addCurrency(
        playerId,
        reward.currencyType as CurrencyType,
        amount,
        'object',
        `object:${objectId}:${interactType}`,
        objectId,
      );
      return { ok: true, reward: { currencyType: reward.currencyType, amount } };
    }

    return { ok: true };
  }
```

3c. 若 `CacheService` 缺 `setNx`/`expire`/`del`/`incr` 方法，读 `src/common/cache/cache.service.ts` 确认实际方法名并对齐（如 `set` with nx 选项）；计划按 `setNx(key, val)`/`expire(key, secs)`/`del(key)`/`incr(key)` 命名，实现时对齐现有 API。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest src/modules/world/world.service.spec.ts --no-coverage`
Expected: PASS（新增 4 用例 + 原有）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/world/world.service.ts src/modules/world/world.service.spec.ts src/modules/world/world.module.ts
git commit -m "feat(world): 物件互动（冷却/一次性/资源策略折算）"
```

---

## Task 14: 场景物件——机关/坐骑/街头玩法/地标

**Files:**
- Modify: `src/modules/world/world.service.ts`
- Modify: `src/modules/world/world.service.spec.ts`

- [ ] **Step 1: 写失败测试（world.service.spec.ts 末尾追加）**

```ts
describe('机关/坐骑/街头玩法/地标', () => {
  it('机关激活：人数不足拒绝', async () => {
    mockTriggerRepo.findOne.mockResolvedValue({
      id: '1',
      triggerType: TriggerType.PUZZLE,
      onceOnly: false,
      condition: { requiredPlayers: 3 },
    });
    await expect(
      worldService.activateTrigger('1', '1', ['2']), // 共2人 < 3
    ).rejects.toMatchObject({ code: ErrorCodes.TRIGGER_NOT_READY });
  });

  it('街头玩法：下注计入奖池', async () => {
    mockGameRepo.findOne.mockResolvedValue({
      id: '1',
      name: '对弈',
      betRange: { min: 10, max: 1000 },
    });
    mockSessionRepo.findOne.mockResolvedValue({
      id: 's1',
      gameId: '1',
      hostPlayerId: '1',
      status: GameSessionStatus.OPEN,
      betPool: '0',
    });
    mockEconomyService.deductCurrency.mockResolvedValue({ balanceAfter: '90' });

    const res = await worldService.betGame('2', 's1', 100);
    expect(res.betPool).toBe('100');
  });

  it('地标留言：长度校验', async () => {
    await expect(
      worldService.leaveLandmarkMessage('1', '1', 'x'.repeat(101)),
    ).rejects.toMatchObject({ code: ErrorCodes.PARAM_INVALID });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest src/modules/world/world.service.spec.ts --no-coverage -t "机关"`
Expected: FAIL。

- [ ] **Step 3: 实现 world.service 四个方法**

```ts
  async activateTrigger(
    playerId: string,
    triggerId: string,
    memberIds: string[] = [],
  ): Promise<{ unlocked: boolean; members: string[] }> {
    const trigger = await this.triggerRepo.findOne({
      where: { id: triggerId },
    });
    if (!trigger) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '机关不存在');
    }
    if (
      trigger.triggerType !== TriggerType.PUZZLE &&
      trigger.triggerType !== TriggerType.GATE &&
      trigger.triggerType !== TriggerType.TRAP
    ) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '该触发器非机关类型');
    }
    const required = trigger.condition?.requiredPlayers ?? 1;
    const members = [playerId, ...memberIds.filter((m) => m !== playerId)];
    if (members.length < required) {
      throw new GameException(
        ErrorCodes.TRIGGER_NOT_READY,
        `机关需要 ${required} 人配合，当前 ${members.length} 人`,
      );
    }
    const records = members.map((pid) =>
      this.triggerUnlockRepo.create({ triggerId, playerId: pid }),
    );
    await this.triggerUnlockRepo.save(records);
    return { unlocked: true, members };
  }

  async equipMount(
    characterId: string,
    mountId: string,
  ): Promise<{ ok: boolean }> {
    const existing = await this.mountRepo.findOne({
      where: { characterId, mountId },
    });
    if (existing) {
      await this.mountRepo.update(
        { characterId, isActive: true },
        { isActive: false },
      );
      existing.isActive = true;
      await this.mountRepo.save(existing);
      return { ok: true };
    }
    const mount = this.mountRepo.create({
      characterId,
      mountId,
      isActive: true,
    });
    await this.mountRepo.save(mount);
    return { ok: true };
  }

  async rideMount(
    characterId: string,
    mountId: string,
    ride: boolean,
  ): Promise<{ ok: boolean }> {
    const existing = await this.mountRepo.findOne({
      where: { characterId, mountId },
    });
    if (!existing) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '坐骑未获得');
    }
    await this.mountRepo.update(
      { id: existing.id },
      { isActive: ride },
    );
    return { ok: true };
  }

  async startGame(
    playerId: string,
    gameId: string,
    betAmount: number,
  ): Promise<GameSession> {
    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game) {
      throw new GameException(ErrorCodes.GAME_NOT_FOUND, '玩法不存在');
    }
    const range = game.betRange ?? { min: 10, max: 1000 };
    if (betAmount < range.min || betAmount > range.max) {
      throw new GameException(ErrorCodes.BET_INVALID, '下注金额超出范围');
    }
    await this.economyService.deductCurrency(
      playerId,
      CurrencyType.GOLD,
      betAmount,
      'street_game',
      `game:${gameId}:start`,
      gameId,
    );
    const session = this.sessionRepo.create({
      gameId,
      hostPlayerId: playerId,
      status: GameSessionStatus.OPEN,
      betPool: betAmount.toString(),
    });
    return this.sessionRepo.save(session);
  }

  async betGame(
    playerId: string,
    sessionId: string,
    betAmount: number,
  ): Promise<{ betPool: string }> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new GameException(ErrorCodes.GAME_NOT_FOUND, '对局不存在');
    }
    if (session.status !== GameSessionStatus.OPEN) {
      throw new GameException(ErrorCodes.GAME_NOT_OPEN, '对局已开始或已结束');
    }
    const game = await this.gameRepo.findOne({
      where: { id: session.gameId },
    });
    const range = game?.betRange ?? { min: 10, max: 1000 };
    if (betAmount < range.min || betAmount > range.max) {
      throw new GameException(ErrorCodes.BET_INVALID, '下注金额超出范围');
    }
    await this.economyService.deductCurrency(
      playerId,
      CurrencyType.GOLD,
      betAmount,
      'street_game_bet',
      `session:${sessionId}:bet`,
      sessionId,
    );
    session.betPool = (
      BigInt(session.betPool) + BigInt(betAmount)
    ).toString();
    await this.sessionRepo.save(session);
    return { betPool: session.betPool };
  }

  async finishGame(
    playerId: string,
    sessionId: string,
    winnerPlayerId: string,
  ): Promise<{ winner: string; payout: string }> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new GameException(ErrorCodes.GAME_NOT_FOUND, '对局不存在');
    }
    if (session.hostPlayerId !== playerId) {
      throw new GameException(ErrorCodes.FORBIDDEN, '只有房主可结算');
    }
    if (session.status === GameSessionStatus.FINISHED) {
      throw new GameException(ErrorCodes.GAME_NOT_OPEN, '对局已结束');
    }
    const pool = BigInt(session.betPool);
    const payout = (pool * 95n) / 100n; // 5% 场景税
    if (payout > 0n) {
      await this.economyService.addCurrency(
        winnerPlayerId,
        CurrencyType.GOLD,
        Number(payout),
        'street_game_win',
        `session:${sessionId}:finish`,
        sessionId,
      );
    }
    session.status = GameSessionStatus.FINISHED;
    session.winnerPlayerId = winnerPlayerId;
    session.finishedAt = new Date();
    await this.sessionRepo.save(session);
    return { winner: winnerPlayerId, payout: payout.toString() };
  }

  async leaveLandmarkMessage(
    playerId: string,
    objectId: string,
    content: string,
  ): Promise<LandmarkMessage> {
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 100) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '留言1-100字');
    }
    const msg = this.landmarkMsgRepo.create({
      objectId,
      playerId,
      content: trimmed,
    });
    return this.landmarkMsgRepo.save(msg);
  }

  async listLandmarkMessages(objectId: string): Promise<LandmarkMessage[]> {
    return this.landmarkMsgRepo.find({
      where: { objectId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }
```

（需要五个新 repo 注入：`triggerUnlockRepo`/`mountRepo`/`gameRepo`/`sessionRepo`/`landmarkMsgRepo`，类型 `Repository<对应实体>`。在构造函数追加。`CurrencyType`、`GameSessionStatus`、`TriggerType`、`GameSession`、`LandmarkMessage` 需导入。）

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest src/modules/world/world.service.spec.ts --no-coverage`
Expected: PASS（新增 3 用例 + 原有）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/world/world.service.ts src/modules/world/world.service.spec.ts
git commit -m "feat(world): 机关配合解锁/坐骑/街头玩法对局/地标留言"
```

---

## Task 15: 场景物件——玩家侧接口 + 模块装配

**Files:**
- Create: `src/modules/world/dto/object-interact.dto.ts`
- Create: `src/modules/world/world.client.controller.ts`
- Modify: `src/modules/world/world.module.ts`
- Modify: `src/modules/character/character.module.ts`（确保 exports CharacterService）

- [ ] **Step 1: 创建 `src/modules/world/dto/object-interact.dto.ts`**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { InteractType } from '@constants/enums';

export class ObjectInteractDto {
  @ApiProperty({ enum: InteractType })
  @IsEnum(InteractType)
  interactType: InteractType;
}

export class TriggerActivateDto {
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  memberIds?: string[];
}

export class MountActionDto {
  @ApiProperty()
  @IsString()
  mountId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  ride?: boolean;
}

export class StartGameDto {
  @ApiProperty()
  @IsString()
  gameId: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  betAmount: number;
}

export class BetGameDto {
  @ApiProperty()
  @IsString()
  sessionId: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  betAmount: number;
}

export class FinishGameDto {
  @ApiProperty()
  @IsString()
  sessionId: string;

  @ApiProperty()
  @IsString()
  winnerPlayerId: string;
}

export class LandmarkMessageDto {
  @ApiProperty()
  @IsString()
  @Length(1, 100)
  content: string;
}
```

- [ ] **Step 2: 创建 `src/modules/world/world.client.controller.ts`**

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WorldService } from './world.service';
import { CharacterService } from '@modules/character/character.service';
import {
  ObjectInteractDto,
  TriggerActivateDto,
  MountActionDto,
  StartGameDto,
  BetGameDto,
  FinishGameDto,
  LandmarkMessageDto,
} from './dto/object-interact.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

@ApiTags('World')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/client/v1/world')
export class WorldClientController {
  constructor(
    private readonly worldService: WorldService,
    private readonly characterService: CharacterService,
  ) {}

  private async resolveCharacterId(playerId: string): Promise<string> {
    const character = await this.characterService.getByPlayerId(playerId);
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return character.id;
  }

  @Post('objects/:id/interact')
  @ApiOperation({ summary: '物件互动（采集/藏身/烧火/坐/躺/刻字等）' })
  async interactObject(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') objectId: string,
    @Body() dto: ObjectInteractDto,
  ) {
    return this.worldService.interactObject(
      player.playerId,
      objectId,
      dto.interactType,
    );
  }

  @Post('triggers/:id/activate')
  @ApiOperation({ summary: '机关配合解锁' })
  async activateTrigger(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') triggerId: string,
    @Body() dto: TriggerActivateDto,
  ) {
    return this.worldService.activateTrigger(
      player.playerId,
      triggerId,
      dto.memberIds ?? [],
    );
  }

  @Post('mounts/equip')
  @ApiOperation({ summary: '获得/切换坐骑' })
  async equipMount(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: MountActionDto,
  ) {
    const characterId = await this.resolveCharacterId(player.playerId);
    return this.worldService.equipMount(characterId, dto.mountId);
  }

  @Post('mounts/ride')
  @ApiOperation({ summary: '骑乘/收起坐骑' })
  async rideMount(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: MountActionDto,
  ) {
    const characterId = await this.resolveCharacterId(player.playerId);
    return this.worldService.rideMount(
      characterId,
      dto.mountId,
      dto.ride ?? true,
    );
  }

  @Post('games/start')
  @ApiOperation({ summary: '开局街头玩法（房主下注）' })
  async startGame(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: StartGameDto,
  ) {
    return this.worldService.startGame(player.playerId, dto.gameId, dto.betAmount);
  }

  @Post('games/bet')
  @ApiOperation({ summary: '围观下注' })
  async betGame(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: BetGameDto,
  ) {
    return this.worldService.betGame(player.playerId, dto.sessionId, dto.betAmount);
  }

  @Post('games/finish')
  @ApiOperation({ summary: '结算对局（房主，5% 场景税）' })
  async finishGame(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: FinishGameDto,
  ) {
    return this.worldService.finishGame(
      player.playerId,
      dto.sessionId,
      dto.winnerPlayerId,
    );
  }

  @Post('landmarks/:id/message')
  @ApiOperation({ summary: '路牌/地标留言' })
  async leaveLandmarkMessage(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') objectId: string,
    @Body() dto: LandmarkMessageDto,
  ) {
    return this.worldService.leaveLandmarkMessage(
      player.playerId,
      objectId,
      dto.content,
    );
  }

  @Get('landmarks/:id/messages')
  @ApiOperation({ summary: '地标留言列表（最近50条）' })
  async listLandmarkMessages(@Param('id') objectId: string) {
    return this.worldService.listLandmarkMessages(objectId);
  }
}
```

- [ ] **Step 3: 模块装配**

3a. `world.module.ts`：
- `imports` 加 `CharacterModule` 与 `EconomyModule`
- `controllers` 加 `WorldClientController`
- `TypeOrmModule.forFeature` 已含全部实体（Task 12 完成）

3b. `character.module.ts`：确认 `exports: [CharacterService]`，若无则补。

3c. `economy.module.ts`：确认 `exports: [EconomyService]`，若无则补（world 依赖其 addCurrency/deductCurrency）。

- [ ] **Step 4: 编译校验 + 冒烟说明**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0。

冒烟（部署后）：`POST /api/client/v1/world/objects/1/interact {"interactType":"camp"}` → 物件存在返回 `{ok:true}`；冷却中返回 body.code=50010。

- [ ] **Step 5: Commit**

```bash
git add src/modules/world/dto/object-interact.dto.ts src/modules/world/world.client.controller.ts src/modules/world/world.module.ts src/modules/character/character.module.ts src/modules/economy/economy.module.ts
git commit -m "feat(world): 玩家侧场景物件接口 + 模块装配"
```

---

## Task 16: 全量回归 + 冒烟清单 + 部署

**Files:**
- 无（验证与运维步骤）

- [ ] **Step 1: 全量单测**

Run: `npx jest --no-coverage`
Expected: 全部 PASS（各模块原有 + 新增用例）。

- [ ] **Step 2: 类型编译**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0。

- [ ] **Step 3: 冒烟清单（本地启动后逐项验证）**

| 接口 | 入参 | 期望 |
|---|---|---|
| POST /api/client/v1/economy/exchange | {"from":"diamond","to":"bound_diamond","amount":10} | balanceAfter 正确 |
| POST /api/client/v1/economy/exchange | {"from":"favor","to":"gold","amount":10} | body.code=20009 |
| GET /api/client/v1/economy/social/balances | - | favor/guildContrib/face |
| POST /api/client/v1/character/card | {"alias":"逍遥客"} | alias 保存 |
| POST /api/client/v1/character/titles/equip | {"titleId":"未拥有","equip":true} | body.code=50009 |
| GET /api/client/v1/character/card/:id | - | 名片含 alias/称号 |
| POST /api/client/v1/world/objects/:id/interact | {"interactType":"camp"} | ok:true / 冷却 50010 |
| POST /api/client/v1/world/triggers/:id/activate | {"memberIds":[]} | 人数不足 50012 |
| POST /api/client/v1/world/games/start | {"gameId":"1","betAmount":100} | session 返回 |
| POST /api/client/v1/auth/security-status | - | 禁言/限交易/实名状态 |
| POST /api/admin/v1/auth/penalties（viewer token） | - | 401 Insufficient permissions |

- [ ] **Step 4: 部署（按 Spec 第 6 节，需用户确认后执行）**

```bash
# 1. 备份（服务器）
pg_dump game_server > /tmp/game_server_$(date +%Y%m%d).sql
# 2. 本地构建
npm run build
# 3. 打包上传 + 保留旧 dist
# 4. systemd restart game-server（synchronize 自动建新表/扩枚举，只加不删）
# 5. 线上按 Step 3 冒烟清单验证；失败回滚上一 dist
```

（部署动作本身不在本计划内自动执行——需要用户授权后按既有部署流程走。）

- [ ] **Step 5: 手册一致性**

Run（仓库 `e:\code\nest` 下）：`node manual-src/check.js`
Expected: 全绿（新增接口可同步补入手册附录 A 接口索引，属可选维护）。

- [ ] **Step 6: Commit（如有文档更新）**

```bash
git add -A
git commit -m "chore: 阶段1实施完成（社交货币/账号安全/角色名片/场景物件）"
```

---

## 自检记录

**Spec 覆盖对照（spec 第 3 节）：**
- 迭代 C（3.1）：Task 1/2/3 全覆盖——枚举、兑换铁律、social/balances、exchange、事件预留 ✓
- 迭代 A（3.2）：Task 4/5/6/7/8 全覆盖——风控事件、分级封禁链（幂等升级/自动到期）、GM 权限矩阵（@Roles）、实名防沉迷（AES 加密 + hash + 脱敏）✓
- 迭代 D（3.3）：Task 9/10/11 全覆盖——档案扩展、称号双表、equip 唯一、名片浏览 ✓
- 迭代 B（3.4）：Task 12/13/14/15 全覆盖——InteractType、机关（TriggerType 扩展 + 人数配合）、坐骑、街头玩法（下注/结算 5% 税）、地标留言、资源策略接入 ✓
- 测试/部署/风险（spec 5/6/7 节）：Task 2/6/10/13/14 单测、Task 16 回归+冒烟+部署步骤、风险护栏（只加不删、加密、服务端校验、回滚）已在各 Task 内体现 ✓

**占位符扫描：** 无 TBD/TODO；每 Task 含完整代码与命令。

**类型一致性：** `ExchangeDto.from/to` 用 `CurrencyType`；`PenaltyLevel` 五值（warning/mute/guild_remove/trade_limit/ban）全计划一致；`InteractType` 十值一致；`GameSessionStatus` OPEN/PLAYING/FINISHED 一致；新错误码命名全计划唯一。
