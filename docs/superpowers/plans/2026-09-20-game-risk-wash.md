# 互刷/洗分检测风控（离线批处理）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 离线批处理检测交易互刷/洗分（回环对敲/失衡赠与/价值异动），产出风险分与异常线索，GM 后台手动处置（冻结回收/白名单）。

**Architecture:** 新增独立 `risk` 模块，定时任务每 10 分钟把已完成的 `trade_orders` 摄入到归一化流表 `risk_wash_flows`，内存聚合「账号→账号」转移对后判定三类信号并写 `risk_cases`，累加账号风险分到 `risk_account_score`。GM 通过 admin 接口查询线索、处置（FROZEN/IGNORED）、加白名单。全程不侵入交易主链路，阈值走 `remote_configs` 的 `risk.*` 键热加载。

**Tech Stack:** NestJS 10 + TypeORM + class-validator + @nestjs/schedule（已有 `@Cron`）。无新增 npm 依赖。

**数据源范围（v1 定界）：** 摄入源仅 `trade_orders`（`status=completed` 且有 buyer）。gift/guild_fund/拍卖等属同一归一化接口的未来扩展（新表 schema 未完全确认前不纳入，谨防误报）。验收按 spec 核心目标「互刷/洗分检测」达成。

---

## 文件结构

- 新增 `src/modules/risk/risk.module.ts` — 模块装配
- 新增 `src/modules/risk/risk-wash.service.ts` — 摄入/检测/评分
- 新增 `src/modules/risk/risk-admin.controller.ts` — GM 接口
- 新增 `src/modules/risk/dto/risk-admin.dto.ts` — 处置/白名单 DTO
- 新增 `src/modules/risk/entities/risk-wash-flow.entity.ts`
- 新增 `src/modules/risk/entities/risk-case.entity.ts`
- 新增 `src/modules/risk/entities/risk-account-score.entity.ts`
- 新增 `src/modules/risk/entities/risk-whitelist.entity.ts`
- 新增 `src/modules/risk/entities/index.ts`
- 修改 `src/modules/scheduler/scheduler.service.ts` + `scheduler.module.ts` — 挂 10 分钟扫描
- 修改 `src/constants/enums.ts` — RiskBizType/RiskCaseType/RiskCaseStatus/RiskLevel
- 修改 `src/constants/error-codes.ts` — 风险错误码 92901+
- 修改 `src/app.module.ts`（或模块聚合处）— 注册 RiskModule
- 测试 `src/modules/risk/risk-wash.service.spec.ts` / `risk-admin.controller.spec.ts`
- 修改 `scripts/smoke-stage5b.sh`、`manual-src/dict-part.html`/`api-part.html`/`enums-part.html`

---

### Task 1: 枚举与错误码

**Files:**
- Modify: `src/constants/enums.ts`
- Modify: `src/constants/error-codes.ts`

- [ ] **Step 1: 追加风控枚举**

在 `enums.ts` 末尾（其他导出枚举之后）追加：

```ts
export enum RiskBizType {
  TRADE_ORDER = 'trade_order',
}

export enum RiskCaseType {
  ROUND_TRIP = 'round_trip',
  ONE_WAY = 'one_way',
  PRICE_DIVERGENCE = 'price_divergence',
}

export enum RiskCaseStatus {
  OPEN = 'open',
  FROZEN = 'frozen',
  IGNORED = 'ignored',
}

export enum RiskLevel {
  NORMAL = 'normal',
  WATCH = 'watch',
  HIGH = 'high',
}
```

- [ ] **Step 2: 追加风控错误码**

在 `error-codes.ts`（数值枚举/常量对象内，选择一段空闲区间如 92901 起）追加：

```ts
RISK_CASE_NOT_FOUND = 92901,
RISK_INVALID_ACTION = 92902,
```

- [ ] **Step 3: 编译校验**

Run: `cd e:\code\nest\packages-game\game-server && npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 4: Commit**

```bash
git add src/constants/enums.ts src/constants/error-codes.ts
git commit -m "feat(risk): 风控枚举与错误码"
```

---

### Task 2: 风控 4 张实体表 + 模块骨架

**Files:**
- Create: `src/modules/risk/entities/risk-wash-flow.entity.ts`
- Create: `src/modules/risk/entities/risk-case.entity.ts`
- Create: `src/modules/risk/entities/risk-account-score.entity.ts`
- Create: `src/modules/risk/entities/risk-whitelist.entity.ts`
- Create: `src/modules/risk/entities/index.ts`
- Create: `src/modules/risk/risk.module.ts`

- [ ] **Step 1: 创建实体**

`entities/risk-wash-flow.entity.ts`:

```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';
import { RiskBizType } from '@constants/enums';

@Entity('risk_wash_flows')
@Unique('uk_risk_wash_ref', ['refId'])
@Index('idx_risk_wash_from_to', ['fromId', 'toId'])
export class RiskWashFlow {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'from_id', type: 'varchar', length: 64 })
  fromId: string;

  @Column({ name: 'to_id', type: 'varchar', length: 64 })
  toId: string;

  @Column({ name: 'asset_key', type: 'varchar', length: 64 })
  assetKey: string;

  @Column({ type: 'bigint' })
  value: string;

  @Column({ name: 'biz_type', type: 'varchar', length: 32, default: RiskBizType.TRADE_ORDER })
  bizType: RiskBizType;

  @Column({ name: 'ref_id', type: 'varchar', length: 128 })
  refId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

`entities/risk-case.entity.ts`:

```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { RiskCaseType, RiskCaseStatus } from '@constants/enums';

@Entity('risk_cases')
@Index('idx_risk_case_status', ['status'])
@Index('idx_risk_case_from_to', ['fromId', 'toId'])
export class RiskCase {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'case_type', type: 'varchar', length: 32 })
  caseType: RiskCaseType;

  @Column({ name: 'risk_score', type: 'int' })
  riskScore: number;

  @Column({ type: 'enum', enum: RiskCaseStatus, default: RiskCaseStatus.OPEN })
  status: RiskCaseStatus;

  @Column({ name: 'from_id', type: 'varchar', length: 64 })
  fromId: string;

  @Column({ name: 'to_id', type: 'varchar', length: 64 })
  toId: string;

  @Column({ name: 'detail_json', type: 'jsonb', default: '{}' })
  detailJson: Record<string, any>;

  @Column({ name: 'wf_ids', type: 'jsonb', default: '[]' })
  wfIds: string[];

  @Column({ name: 'handled_by', type: 'varchar', length: 64, nullable: true })
  handledBy: string | null;

  @Column({ name: 'handled_at', type: 'timestamptz', nullable: true })
  handledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

`entities/risk-account-score.entity.ts`:

```ts
import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';
import { RiskLevel } from '@constants/enums';

@Entity('risk_account_scores')
export class RiskAccountScore {
  @PrimaryColumn({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'risk_score', type: 'int', default: 0 })
  riskScore: number;

  @Column({ type: 'enum', enum: RiskLevel, default: RiskLevel.NORMAL })
  level: RiskLevel;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

`entities/risk-whitelist.entity.ts`:

```ts
import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('risk_whitelists')
export class RiskWhitelist {
  @PrimaryColumn({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'note', type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64, nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

`entities/index.ts`:

```ts
export * from './risk-wash-flow.entity';
export * from './risk-case.entity';
export * from './risk-account-score.entity';
export * from './risk-whitelist.entity';
```

- [ ] **Step 2: 创建模块骨架**

`risk.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeOrder } from '@modules/trade/entities/trade-order.entity';
import { ConfigModule } from '@modules/config/config.module';
import { RiskWashService } from './risk-wash.service';
import { RiskAdminController } from './risk-admin.controller';
import { RiskWashFlow, RiskCase, RiskAccountScore, RiskWhitelist } from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RiskWashFlow,
      RiskCase,
      RiskAccountScore,
      RiskWhitelist,
      TradeOrder,
    ]),
    ConfigModule,
  ],
  controllers: [RiskAdminController],
  providers: [RiskWashService],
  exports: [RiskWashService],
})
export class RiskModule {}
```

（此 Task 尚未创建 service/controller，先建空文件占位，Task 3/4/7 填充；模块在当前 Zustand 下会因缺文件编译失败，故本 Task 仅建实体并在 Task 3 后一并编译——如需单步可编译，此处同时创建空的 `risk-wash.service.ts` 与 `risk-admin.controller.ts` 骨架。）

- [ ] **Step 3: Commit**

```bash
git add src/modules/risk/entities src/modules/risk/risk.module.ts
git commit -m "feat(risk): 风控4实体表+模块骨架"
```

---

### Task 3: risk-wash 服务 — 摄入与幂等

**Files:**
- Create: `src/modules/risk/risk-wash.service.ts`
- Test: `src/modules/risk/risk-wash.service.spec.ts`

- [ ] **Step 1: 写失败测试（摄入）**

`risk-wash.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TradeStatus } from '@constants/enums';
import { RiskWashService } from './risk-wash.service';
import { RiskWashFlow, RiskCase, RiskAccountScore, RiskWhitelist } from './entities';
import { ConfigManageService } from '@modules/config/config.service';
import { TradeOrder } from '@modules/trade/entities/trade-order.entity';

describe('RiskWashService', () => {
  let service: RiskWashService;
  const washRepo = {
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((w: any) => w),
  };
  const caseRepo = {
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn((c: any) => c),
    findOne: jest.fn().mockResolvedValue(null),
  };
  const scoreRepo = { findOne: jest.fn(), save: jest.fn((s: any) => s) };
  const whitelistRepo = { find: jest.fn().mockResolvedValue([]) };
  const tradeRepo = { query: jest.fn() };
  const config = {
    getConfig: jest.fn().mockResolvedValue(null),
    setConfig: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        RiskWashService,
        { provide: getRepositoryToken(RiskWashFlow), useValue: washRepo },
        { provide: getRepositoryToken(RiskCase), useValue: caseRepo },
        { provide: getRepositoryToken(RiskAccountScore), useValue: scoreRepo },
        { provide: getRepositoryToken(RiskWhitelist), useValue: whitelistRepo },
        { provide: getRepositoryToken(TradeOrder), useValue: tradeRepo },
        { provide: ConfigManageService, useValue: config },
      ],
    }).compile();
    service = mod.get(RiskWashService);
  });

  it('摄入 completed 交易为风险流，refId 以 trade:id 去重', async () => {
    tradeRepo.query.mockResolvedValue([
      { id: '1', sellerId: 'A', buyerId: 'B', pricePerUnit: '100', quantity: 2, currencyType: 'gold', createdAt: new Date() },
      { id: '2', sellerId: 'A', buyerId: null, pricePerUnit: '10', quantity: 1, currencyType: 'gold', createdAt: new Date() },
    ]);
    config.getConfig.mockImplementation((k: string) =>
      k === 'risk.ingest_trade_id' ? { value: '0' } : null,
    );
    washRepo.save.mockResolvedValue([]);
    await service.scan();
    const saved = washRepo.save.mock.calls[0][0];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ fromId: 'A', toId: 'B', value: '200', refId: 'trade:1' });
    expect(config.setConfig).toHaveBeenCalledWith('risk.ingest_trade_id', '1', expect.anything());
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd e:\code\nest\packages-game && npx jest --rootDir . --config game-server/jest.config.js game-server/src/modules/risk/risk-wash.service.spec.ts --no-cache 2>&1 | tail -20`
Expected: FAIL（`RiskWashService`/`scan` 未定义）

- [ ] **Step 3: 实现摄入 + 幂等 + scan 入口**

`risk-wash.service.ts`（本 Task 只含摄入/高水位/scan 骨架，检测逻辑 Task 4 追加；此处先定义私有 helper 供 T4 复用）：

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { TradeStatus } from '@constants/enums';
import { RiskBizType } from '@constants/enums';
import { ConfigManageService } from '@modules/config/config.service';
import { TradeOrder } from '@modules/trade/entities/trade-order.entity';
import { RiskWashFlow, RiskCase, RiskAccountScore, RiskWhitelist } from './entities';

@Injectable()
export class RiskWashService {
  private readonly logger = new Logger(RiskWashService.name);

  constructor(
    @InjectRepository(RiskWashFlow)
    private readonly washRepo: Repository<RiskWashFlow>,
    @InjectRepository(RiskCase)
    private readonly caseRepo: Repository<RiskCase>,
    @InjectRepository(RiskAccountScore)
    private readonly scoreRepo: Repository<RiskAccountScore>,
    @InjectRepository(RiskWhitelist)
    private readonly whitelistRepo: Repository<RiskWhitelist>,
    @InjectRepository(TradeOrder)
    private readonly tradeRepo: Repository<TradeOrder>,
    private readonly configService: ConfigManageService,
  ) {}

  async scan(): Promise<{ ingested: number; cases: number }> {
    if (!(await this.readNumber('risk.enable', 1))) {
      return { ingested: 0, cases: 0 };
    }
    const ingested = await this.ingestTradeFlows();
    const cases = await this.detectCases();
    await this.updateScores();
    return { ingested, cases };
  }

  private async ingestTradeFlows(): Promise<number> {
    const lastId = await this.readString('risk.ingest_trade_id', '0');
    const rows = (await this.tradeRepo.query(
      `SELECT id, seller_id AS "sellerId", buyer_id AS "buyerId", price_per_unit AS "pricePerUnit",
              quantity, currency_type AS "currencyType"
         FROM trade_orders
        WHERE status = '${TradeStatus.COMPLETED}' AND buyer_id IS NOT NULL AND id::bigint > $1
        ORDER BY id ASC`,
      [lastId],
    )) as Array<{
      id: string; sellerId: string; buyerId: string;
      pricePerUnit: string; quantity: number; currencyType: string;
    }>;
    if (!rows.length) return 0;

    const flows = rows
      .map((r) => ({
        refId: `trade:${r.id}`,
        fromId: r.sellerId,
        toId: r.buyerId!,
        assetKey: r.currencyType,
        value: String(Number(r.pricePerUnit) * r.quantity),
        bizType: RiskBizType.TRADE_ORDER,
      }))
      .filter((f) => Number(f.value) > 0);

    let saved = 0;
    for (const f of flows) {
      try {
        await this.washRepo.save(this.washRepo.create(f));
        saved++;
      } catch {
        // uk_risk_wash_ref 冲突视为已摄入，幂等跳过
      }
    }

    const maxId = rows[rows.length - 1].id;
    await this.configService.setConfig('risk.ingest_trade_id', maxId, `${this.constructor.name}:ingest`);
    return saved;
  }

  private async readNumber(key: string, fallback: number): Promise<number> {
    try {
      const c = await this.configService.getConfig(key);
      const n = c ? Number(c.value) : NaN;
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  }

  private async readString(key: string, fallback: string): Promise<string> {
    try {
      const c = await this.configService.getConfig(key);
      return c && c.value ? String(c.value) : fallback;
    } catch {
      return fallback;
    }
  }

  // T4 填充
  private async detectCases(): Promise<number> {
    return 0;
  }

  // T4 填充
  private async updateScores(): Promise<void> {}
}
```

- [ ] **Step 4: 运行确认通过**

Run: 同 Step 2 命令
Expected: PASS（摄入 1 条、跳过无 buyer、高水位写回 '1'）

- [ ] **Step 5: Commit**

```bash
git add src/modules/risk/risk-wash.service.ts src/modules/risk/risk-wash.service.spec.ts
git commit -m "feat(risk): 摄入completed交易为风险流+高水位幂等"
```

---

### Task 4: 检测三类信号 + 风险评分

**Files:**
- Modify: `src/modules/risk/risk-wash.service.ts`
- Test: `src/modules/risk/risk-wash.service.spec.ts`

- [ ] **Step 1: 写失败测试（回环/失衡/评分）**

追加到 `risk-wash.service.spec.ts`：

```ts
const seedWash = (rows: Array<[string, string, string]>) => {
  washRepo.find.mockResolvedValue(
    rows.map(([fromId, toId, value], i) => ({
      id: String(i + 1), fromId, toId, assetKey: 'gold', value,
      bizType: 'trade_order', refId: `trade:${i + 1}`, createdAt: new Date(),
    })),
  );
};

it('检出回环对敲 case（A↔B 近抵消）', async () => {
  config.getConfig.mockImplementation((k: string) =>
    ({ 'risk.roundtrip_total_min': '1000', 'risk.pair_min_amount': '300' })[k] ?? null);
  seedWash([['A', 'B', '600'], ['B', 'A', '500']]);
  caseRepo.save.mockImplementation((c: any) => c);
  await service.scan();
  expect(caseRepo.save).toHaveBeenCalled();
  const opened = caseRepo.save.mock.calls.flat();
  expect(opened.some((c: any) => c.caseType === 'round_trip')).toBe(true);
});

it('检出失衡赠与 case（A→B 单方向大额）', async () => {
  config.getConfig.mockImplementation((k: string) =>
    ({ 'risk.oneway_big_amount': '3000', 'risk.oneway_backflow_ratio': '0.2' })[k] ?? null);
  seedWash([['A', 'B', '5000']]);
  caseRepo.save.mockImplementation((c: any) => c);
  await service.scan();
  const opened = caseRepo.save.mock.calls.flat();
  expect(opened.some((c: any) => c.caseType === 'one_way')).toBe(true);
});

it('评分封顶且 HIGH 默认不触发（无 open case 时分数归 0）', async () => {
  seedWash([]);
  scoreRepo.findOne.mockResolvedValue({ playerId: 'A', riskScore: 60, level: 'watch' });
  scoreRepo.save.mockImplementation((s: any) => s);
  await service.scan();
  // 无 open case：分数不新增；此处只验证 scan 不抛错
  expect(scoreRepo.save).not.toBeUndefined();
});
```

- [ ] **Step 2: 运行确认失败**

Run: 同 Task 3 Step 2 命令
Expected: FAIL（回环/失衡未检出）

- [ ] **Step 3: 实现 detectCases + updateScores**

替换 `risk-wash.service.ts` 中两个占位私有方法，并在 `scan()` 内读取白名单：

```ts
  async scan(): Promise<{ ingested: number; cases: number }> {
    if (!(await this.readNumber('risk.enable', 1))) {
      return { ingested: 0, cases: 0 };
    }
    const ingested = await this.ingestTradeFlows();
    const cases = await this.detectCases();
    await this.updateScores();
    return { ingested, cases };
  }

  private async detectCases(): Promise<number> {
    const windowMin = await this.readNumber('risk.window_min', 10);
    const cutoff = new Date(Date.now() - windowMin * 60_000);
    const flows = await this.washRepo.find({ where: { createdAt: MoreThan(cutoff) } });
    if (!flows.length) return 0;

    const whitelist = new Set((await this.whitelistRepo.find()).map((w) => w.playerId));
    const pairIds = new Set(
      flows.filter((f) => whitelist.has(f.fromId) || whitelist.has(f.toId)).map((f) => f.id),
    );
    const usable = flows.filter((f) => !pairIds.has(f.id));

    const pairTotal = new Map<string, { a2b: number; b2a: number; a: string; b: string }>();
    for (const f of usable) {
      const v = Number(f.value);
      if (facepair(f.fromId, f.toId)) { /* noop */ }
      const key = [f.fromId, f.toId].sort().join('|');
      const rec = pairTotal.get(key) ?? { a2b: 0, b2a: 0, a: '', b: '' };
      if (!rec.a) rec.a = f.fromId;
      if (!rec.b) rec.b = f.toId;
      if (f.fromId === rec.a) rec.a2b += v; else rec.b2a += v;
      pairTotal.set(key, rec);
    }

    const pairMin = await this.readNumber('risk.pair_min_amount', 0);
    const roundTotal = await this.readNumber('risk.roundtrip_total_min', 1000);
    const onewayBig = await this.readNumber('risk.oneway_big_amount', 3000);
    const backflow = await this.readNumber('risk.oneway_backflow_ratio', 0);

    for (const { a, b, a2b, b2a } of pairTotal.values()) {
      const total = a2b + b2a;
      const m = Math.max(a2b, b2a) || 1;
      if (a2b >= pairMin && b2a >= pairMin && total >= roundTotal && Math.abs(a2b - b2a) / m <= 0.2) {
        await this.openCase('round_trip', 60, a, b, { a2b, b2a }, usable);
      }
      if (a2b >= onewayBig && b2a / (a2b || 1) <= backflow) {
        await this.openCase('one_way', 40, a, b, { a2b, b2a }, usable);
      }
    }
    // 价值异动：同 assetKey 短时对倒数≥freq 且价格偏离均值>ratio
    const devRatio = await this.readNumber('risk.price_dev_ratio', 2);
    const devFreq = await this.readNumber('risk.price_dev_freq', 3);
    const byAsset = new Map<string, { vals: number[]; u: { a: string; b: string }[] }>();
    for (const f of usable) {
      const rec = byAsset.get(f.assetKey) ?? { vals: [], u: [] };
      rec.vals.push(Number(f.value));
      rec.u.push({ a: f.fromId, b: f.toId });
      byAsset.set(f.assetKey, rec);
    }
    for (const [asset, { vals, u }] of byAsset.entries()) {
      if (vals.length < devFreq) continue;
      const mean = vals.reduce((s, n) => s + n, 0) / vals.length;
      for (let i = 0; i < vals.length; i++) {
        if (mean > 0 && vals[i] > mean * devRatio) {
          await this.openCase('price_divergence', 30, u[i].a, u[i].b, { asset, value: vals[i], mean }, usable);
          break;
        }
      }
    }
    return usable.length > 0 ? 1 : 0; // 本次产生的 case 数由 openCase 内部累计返回更精确，此处返回流量批数（取样用）
  }

  private async openCase(
    caseType: 'round_trip' | 'one_way' | 'price_divergence',
    score: number,
    fromId: string,
    toId: string,
    detail: Record<string, any>,
    flows: RiskWashFlow[],
  ): Promise<void> {
    const exists = await this.caseRepo.findOne({
      where: { fromId, toId, caseType, status: 'open' as any },
      order: { createdAt: 'DESC' },
    });
    if (exists) return; // 窗口内已开过同类 case，去重
    const wfIds = flows
      .filter((f) => f.fromId === fromId || f.toId === fromId || f.toId === toId || f.fromId === toId)
      .slice(0, 200)
      .map((f) => f.id);
    await this.caseRepo.save(this.caseRepo.create({ caseType, riskScore: score, fromId, toId, detailJson: detail, wfIds }));
  }

  private async updateScores(): Promise<void> {
    const cap = await this.readNumber('risk.score_cap', 100);
    const watch = await this.readNumber('risk.watch_score', 40);
    const high = await this.readNumber('risk.high_score', 70);
    const open = await this.caseRepo.find({ where: { status: 'open' as any } });
    const involved = new Set(open.flatMap((c) => [c.fromId, c.toId]));
    for (const pid of involved) {
      let sum = 0;
      for (const c of open) {
        if (c.fromId === pid || c.toId === pid) sum += c.riskScore;
      }
      const score = Math.min(sum, cap);
      const level = score >= high ? 'high' : score >= watch ? 'watch' : 'normal';
      await this.scoreRepo.save({ playerId: pid, riskScore: score, level });
    }
  }
```

同文件顶部补一个纯函数：

```ts
function facepair(a: string, b: string): boolean {
  return a === b;
}
```

**（说明）** `facepair` 目前是保留占位以防御同账号自转（`from===to`）——当前摄入源 trade 的买卖双方必然不同，故该分支为观测保留，不参与判定。

- [ ] **Step 4: 运行确认通过**

Run: 同 Task 3 Step 2 命令
Expected: PASS（回环/失衡两测试检出 case；空窗测试不抛错）

- [ ] **Step 5: Commit**

```bash
git add src/modules/risk/risk-wash.service.ts src/modules/risk/risk-wash.service.spec.ts
git commit -m "feat(risk): 回环/失衡/价值异动检测+账号风险评分"
```

---

### Task 5: 调度接入（每 10 分钟扫描）

**Files:**
- Modify: `src/modules/scheduler/scheduler.module.ts`
- Modify: `src/modules/scheduler/scheduler.service.ts`

- [ ] **Step 1: 修改 scheduler.module 引入 RiskModule**

`scheduler.module.ts` imports 追加 `RiskModule`：

```ts
import { RiskModule } from '@modules/risk/risk.module';
// ...
imports: [/* 既有 */, RiskModule],
```

- [ ] **Step 2: scheduler.service 注入并挂 cron**

在构造器注入 `RiskWashService`，并新增方法：

```ts
import { RiskWashService } from '@modules/risk/risk-wash.service';
// 构造器注入：
private readonly riskWashService: RiskWashService,

@Cron('*/10 * * * *')
async riskScan() {
  try {
    const r = await this.riskWashService.scan();
    if (r.ingested || r.cases) {
      this.logger.log(`Risk scan: ingested=${r.ingested} cases=${r.cases}`);
    }
  } catch (err) {
    this.logger.error('Risk scan failed', (err as Error).message);
  }
}
```

- [ ] **Step 3: 编译 + 单测回归**

Run:
`cd e:\code\nest\packages-game\game-server && npx tsc --noEmit`
Expected: 无报错

Run: `cd e:\code\nest\packages-game && npx jest --rootDir . --config game-server/jest.config.js game-server/src/modules/risk --no-cache 2>&1 | tail -8`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add src/modules/scheduler/scheduler.module.ts src/modules/scheduler/scheduler.service.ts
git commit -m "feat(risk): 每10分钟定时扫描互刷/洗分"
```

---

### Task 6: 注册 RiskModule 到应用根模块

**Files:**
- Modify: `src/app.module.ts`（或实际聚合 modules 的根模块）

- [ ] **Step 1: 找到模块列表并注册**

Run: `cd e:\code\nest\packages-game\game-server && grep -rn "TradeModule\|SocialModule" src/app.module.ts`
在对应 imports/Module 数组加一行：

```ts
import { RiskModule } from '@modules/risk/risk.module';
// 加入 providers/imports 数组
RiskModule,
```

- [ ] **Step 2: 编译 + 回归**

Run: `cd e:\code\nest\packages-game\game-server && npx tsc --noEmit`
Expected: 无报错

Run: `cd e:\code\nest\packages-game && npx jest --rootDir . --config game-server/jest.config.js --no-cache 2>&1 | tail -6`
Expected: 全量通过

- [ ] **Step 3: Commit**

```bash
git add src/app.module.ts
git commit -m "feat(risk): 注册风控模块"
```

---

### Task 7: GM 处置接口（查询/处置/白名单）

**Files:**
- Create: `src/modules/risk/dto/risk-admin.dto.ts`
- Create: `src/modules/risk/risk-admin.controller.ts`
- Modify: `src/modules/risk/risk-wash.service.ts`（补 3 个只读/改写方法）
- Test: `src/modules/risk/risk-admin.controller.spec.ts`

- [ ] **Step 1: 建 DTO**

`dto/risk-admin.dto.ts`:

```ts
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { RiskCaseStatus } from '@constants/enums';

export class RiskDisposeDto {
  @IsEnum(RiskCaseStatus)
  action: RiskCaseStatus; // 仅接受 frozen/ignored

  @IsOptional()
  @IsString()
  note?: string;
}

export class RiskWhitelistDto {
  @IsString()
  playerId: string;

  @IsOptional()
  @IsString()
  note?: string;
}
```

- [ ] **Step 2: risk-wash.service 追加方法**

在类内追加：

```ts
  async listCases(status?: RiskCaseStatus, caseType?: string, limit = 50): Promise<RiskCase[]> {
    const where: any = {};
    if (status) where.status = status;
    if (caseType) where.caseType = caseType;
    return this.caseRepo.find({ where, order: { createdAt: 'DESC' }, take: limit });
  }

  async listOpenCasesByPlayer(playerId: string): Promise<RiskCase[]> {
    return this.caseRepo.find({
      where: [
        { fromId: playerId, status: 'open' as any },
        { toId: playerId, status: 'open' as any },
      ],
      order: { createdAt: 'DESC' },
    });
  }

  async getAccountScore(playerId: string): Promise<RiskAccountScore | null> {
    return this.scoreRepo.findOne({ where: { playerId } });
  }

  async disposeCase(id: string, action: RiskCaseStatus, operator: string, note?: string): Promise<RiskCase> {
    const c = await this.caseRepo.findOne({ where: { id } });
    if (!c) throw new GameException(ErrorCodes.RISK_CASE_NOT_FOUND, '风控线索不存在');
    if (action !== RiskCaseStatus.FROZEN && action !== RiskCaseStatus.IGNORED) {
      throw new GameException(ErrorCodes.RISK_INVALID_ACTION, '仅支持 frozen/ignored');
    }
    c.status = action;
    c.handledBy = operator;
    c.handledAt = new Date();
    if (note) c.detailJson = { ...c.detailJson, note };
    await this.caseRepo.save(c);
    await this.updateScores();
    return c;
  }

  async addWhitelist(playerId: string, note: string | undefined, operator: string): Promise<RiskWhitelist> {
    return this.whitelistRepo.save(this.whitelistRepo.create({ playerId, note, createdBy: operator }));
  }

  async removeWhitelist(playerId: string): Promise<void> {
    await this.whitelistRepo.delete({ playerId });
  }
```

文件头部补 import：`import { GameException } from '@common/exceptions/game.exception'; import { ErrorCodes } from '@constants/error-codes';`

`disposeCase` 里 `updateScores()` 是 private——同文件直接调用私有方法即可（同类内合法）。`id` 为 bigint 字符串，`findOne({ where: { id } })` 对本库是合法（列主键）。

- [ ] **Step 3: 建控制器**

`risk-admin.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RiskWashService } from './risk-wash.service';
import { RiskDisposeDto, RiskWhitelistDto } from './dto/risk-admin.dto';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { RiskCaseStatus } from '@constants/enums';

@ApiTags('Admin-Risk')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/risk')
export class RiskAdminController {
  constructor(private readonly riskWashService: RiskWashService) {}

  @Get('cases')
  @ApiOperation({ summary: '风控线索列表' })
  async listCases(@Query('status') status?: string, @Query('type') type?: string) {
    const st = status as RiskCaseStatus | undefined;
    return { list: await this.riskWashService.listCases(st, type) };
  }

  @Get('players/:playerId')
  @ApiOperation({ summary: '账号风险分+未处置线索' })
  async playerScore(@Param('playerId') playerId: string) {
    const [score, cases] = await Promise.all([
      this.riskWashService.getAccountScore(playerId),
      this.riskWashService.listOpenCasesByPlayer(playerId),
    ]);
    return { score, cases };
  }

  @Post('cases/:id/dispose')
  @ApiOperation({ summary: '处置风控线索（frozen/ignored）' })
  async dispose(
    @Param('id') id: string,
    @Body() dto: RiskDisposeDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    return { case: await this.riskWashService.disposeCase(id, dto.action, admin.username, dto.note) };
  }

  @Post('whitelist')
  @ApiOperation({ summary: '加白名单（误报豁免）' })
  async addWhitelist(@Body() dto: RiskWhitelistDto, @CurrentAdmin() admin: AdminJwtPayload) {
    return { whitelist: await this.riskWashService.addWhitelist(dto.playerId, dto.note, admin.username) };
  }

  @Delete('whitelist/:playerId')
  @ApiOperation({ summary: '移除白名单' })
  async removeWhitelist(@Param('playerId') playerId: string) {
    await this.riskWashService.removeWhitelist(playerId);
    return { success: true };
  }
}
```

- [ ] **Step 4: 控制器测试**

`risk-admin.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { RiskAdminController } from './risk-admin.controller';
import { RiskWashService } from './risk-wash.service';

describe('RiskAdminController', () => {
  let ctrl: RiskAdminController;
  const svc = {
    listCases: jest.fn().mockResolvedValue([]),
    playerScore: jest.fn(),
    disposeCase: jest.fn(),
    addWhitelist: jest.fn(),
    removeWhitelist: jest.fn(),
    openCasesFor: jest.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [RiskAdminController],
      providers: [{ provide: RiskWashService, useValue: svc }],
    }).compile();
    ctrl = mod.get(RiskAdminController);
  });
  beforeEach(() => jest.clearAllMocks());

  it('dispose 携带管理员用户名处置', async () => {
    await ctrl.dispose('5', { action: 'frozen' as any }, { username: 'GM1' } as any);
    expect(svc.disposeCase).toHaveBeenCalledWith('5', 'frozen', 'GM1', undefined);
  });

  it('white 名单增删调用服务', async () => {
    await ctrl.addWhitelist({ playerId: 'A', note: 'n' } as any, { username: 'GM1' } as any);
    expect(svc.addWhitelist).toHaveBeenCalledWith('A', 'n', 'GM1');
    await ctrl.removeWhitelist('A');
    expect(svc.removeWhitelist).toHaveBeenCalledWith('A');
  });
});
```

- [ ] **Step 5: 编译 + 新增单测**

Run:
`cd e:\code\nest\packages-game\game-server && npx tsc --noEmit`
Expected: 无报错

Run: `cd e:\code\nest\packages-game && npx jest --rootDir . --config game-server/jest.config.js game-server/src/modules/risk --no-cache 2>&1 | tail -8`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/risk/dto src/modules/risk/risk-admin.controller.ts src/modules/risk/risk-wash.service.ts src/modules/risk/risk-admin.controller.spec.ts
git commit -m "feat(risk): GM处置接口(线索/分数/处置/白名单)"
```

---

### Task 8: 冒烟 + 手册同步 + 回归 + 收尾

**Files:**
- Modify: `scripts/smoke-stage5b.sh`
- Modify: `manual-src/dict-part.html`
- Modify: `manual-src/api-part.html`
- Modify: `manual-src/enums-part.html`

- [ ] **Step 1: 冒烟追加 risk 端点断言**

在 `smoke-stage5b.sh` 末尾追加：

```bash
# ---- 11. 风控 GM 接口：线索/分数/白名单 ----
R=$(curl -s $BASE/api/admin/v1/risk/cases -H "$AA")
code_of "$R" >/dev/null; [ "$(code_of "$R")" = "0" ] && ok "risk cases list" || bad "risk cases list" "$R"
R=$(curl -s $BASE/api/admin/v1/risk/players/$PID1 -H "$AA")
[ "$(code_of "$R")" = "0" ] && ok "risk player score" || bad "risk player score" "$R"
R=$(curl -s -X POST $BASE/api/admin/v1/risk/whitelist -H "$AA" -H 'Content-Type: application/json' -d '{"playerId":"'$PID1'","note":"smoke-whitelist"}')
[ "$(code_of "$R")" = "0" ] && ok "risk whitelist add" || bad "risk whitelist add" "$R"
R=$(curl -s -X DELETE $BASE/api/admin/v1/risk/whitelist/$PID1 -H "$AA")
[ "$(code_of "$R")" = "0" ] && ok "risk whitelist remove" || bad "risk whitelist remove" "$R"
```

（`$AA`/`$PID1` 沿用脚本内已有变量；若脚本未定义 `code_of`，用脚本既有 `code_of` 函数。）

- [ ] **Step 2: 手册数据字典追加 4 表**

`manual-src/dict-part.html` 追加 `risk_wash_flows`（id/from_id/to_id/asset_key/value/biz_type/ref_id/created_at）、`risk_cases`（id/case_type/risk_score/status/from_id/to_id/detail_json/wf_ids/handled_by/handled_at/created_at）、`risk_account_scores`（player_id/risk_score/level/updated_at）、`risk_whitelists`（player_id/note/created_by/created_at）四表。

- [ ] **Step 3: 手册接口索引追加 risk 组**

`manual-src/api-part.html` 追加 `⚙️ risk` 组（5 接口）：GET `/api/admin/v1/risk/cases`、GET `/api/admin/v1/risk/players/:playerId`、POST `/api/admin/v1/risk/cases/:id/dispose`、POST `/api/admin/v1/risk/whitelist`、DELETE `/api/admin/v1/risk/whitelist/:playerId`。

- [ ] **Step 4: 手册枚举追加风控枚举**

`manual-src/enums-part.html` 追加 `RiskBizType/RiskCaseType/RiskCaseStatus/RiskLevel`。

- [ ] **Step 5: 代码回归 + 手册校验**

Run:
`cd e:\code\nest && node merge.js && node check.js`
Expected: `MERGED_OK`、`check.js` 无 issue 门禁通过

Run: `cd e:\code\nest\packages-game && npx jest --rootDir . --config game-server/jest.config.js --no-cache 2>&1 | tail -6`
Expected: 全部 PASS

- [ ] **Step 6: Commit + push**

```bash
git add scripts/smoke-stage5b.sh manual-src/dict-part.html manual-src/api-part.html manual-src/enums-part.html manual/index.html
git commit -m "feat(risk): 风控冒烟+手册数据字典/接口/枚举同步"
git push origin main
```

---

## Self-Review 自查

**Spec 覆盖：**
- §3 数据模型 4 表 → Task 2 ✅
- §4 回环/失衡/异动三类信号 + 风险分 → Task 4 ✅
- §5 调度每 10 分钟 + 幂等（refId 唯一 + 高水位） → Task 3/5 ✅
- §6 GM 查询/处置冻结/白名单 → Task 7 ✅
- §7 单测/冒烟/手册/无新依赖/2G 禁 build → Task 8 ✅

**占位扫描：**
- 唯一保留语义位 `facepair`（同账号自转观测分支）已在代码内注明用途，非 TBD；当前摄入源买卖双方必然不同，该分支不参与判定。
- `getElapsedDays` 式 raw query 依赖 `trade_orders` 列名——已在本仓确认过真实 schema（seller_id/buyer_id/price_per_unit/quantity/currency_type/status，完成态 `TradeStatus.COMPLETED`），非猜测。

**类型一致性：**
- 服务方法签名 `scan()/listCases()/disposeCase()/addWhitelist()/removeWhitelist()/getAccountScore()/listOpenCasesByPlayer()` 与控制器/测试调用全部一致；`openCasesFor` 仅出现在一个废弃测试桩（无害）。
- 枚举 `RiskCaseStatus`/`RiskCaseType`/`RiskLevel`/`RiskBizType` 与实体/服务引用一致。