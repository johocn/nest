# 互刷/洗分检测风控 v2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在风控 v1 之上补齐「扩摄入源 + 评分实时拦截 + 半自动回收」闭环。

**Architecture:** 扩 `risk_wash_flows` 加 `flow_class` 区分直接转移/到账；新增 `RiskGateService` 在拍卖/礼物/转账写库前按账号分拦截；新增 `risk_recover_records` 承载半自动回收留痕（建议→确认动账→可回滚）。全部沿用现有 `ConfigManageService` 配置键、`RemoteConfigs risk.*` 承载阈值、现有 error-code 区间 93201-93299。

**Tech Stack:** NestJS 3.6-vendure? — 实为 NestJS + TypeORM + @nestjs/schedule。测试用 Jest。无新 npm 依赖。

**基线（v1 已存在，勿改动其既有行为）**：`risk_wash_flows/cases/account_scores/whitelists` 4 表、`RiskWashService`（scan/ingestTradeFlows/detectCases/updateScores/disposeCase/listCases/getAccountScore/addWhitelist/removeWhitelist）、`RiskAdminController`（api/admin/v1/risk：cases/players/:id/dispose/whitelist）。`DB_SYNCHRONIZE=true`，新列/新表重启自动建。

**仓库事实（写代码前已核对）**
- git 根 `E:/code/nest`；game-server 在 `packages-game/game-server`。
- 枚举 & 错误码文件：`src/constants/enums.ts`、`src/constants/error-codes.ts`。
- Risk 模块：`src/modules/risk/`。模块 `risk.module.ts` imports `ConfigManageModule`（服务类 `ConfigManageService`，`setConfig(key,value,ConfigType,...)`）。
- 摄入源实体：
  - 直接转移：`trade_orders`（已完成，v1）；**gift 为社交积分转移**，源在 `src/modules/social/social.service.ts` 的 `deliverGift`（用 `SocialEconomyService` 做积分转移，bizType 'gift_send'）。
  - 到账 PAYOUT：`auction_items`（sellerId/currentPrice/current_bidder_id/status AuctionStatus.SETTLED）、`bounties`（publisher_id/acceptor_id/gold_reward）、`escrow_agreements`（buyer_id/seller_id/amount/released_at）、`barter_deals`（party_a_id/gold_amount）。
- `ConfigManageService.getConfig(key)` 返回 `{ value: string } | null`；`readNumber/readString` 已有。

---

### Task 1: 枚举扩展 + 错误码段

**Files:**
- Modify: `packages-game/game-server/src/constants/enums.ts`
- Modify: `packages-game/game-server/src/constants/error-codes.ts`

- [ ] **Step 1: enums.ts 扩展枚举**

在 `RiskBizType` 中追加成员，并新增 `RiskFlowClass` 与 `RiskRecoverStatus`（追加到文件末尾或既有 Risk 枚举附近，保持字段唯一）：

```ts
export enum RiskBizType {
  TRADE_ORDER = 'trade_order',
  GIFT = 'gift',
  AUCTION = 'auction',
  BARTER = 'barter',
  BOUNTY = 'bounty',
  ESCROW = 'escrow',
}

export enum RiskFlowClass {
  TRANSFER = 'transfer',
  PAYOUT = 'payout',
}

export enum RiskRecoverStatus {
  APPLIED = 'applied',
  ROLLED_BACK = 'rolled_back',
}
```

> 说明：`RiskCaseType`(round_trip/one_way/price_divergence)、`RiskCaseStatus`(open/frozen/ignored)、`RiskLevel`(normal/watch/high) 沿用 v1，不新增。

- [ ] **Step 2: error-codes.ts 追加 932xx 段**

在 `RISK_INVALID_ACTION: 92902` 之后、932xx 空闲区间追加：

```ts
// 风控接入 93201-93299
RISK_BLOCKED_TRANSFER: 93201, // 高危被限制转账/礼物（超限）
RISK_BLOCKED_AUCTION: 93202, // 高危被限制拍卖上架（起拍价超限）
RISK_RECOVER_NOT_FOUND: 93203,
RISK_RECOVER_STATE: 93204,
RISK_PAYOUT_DENIED: 93205,
```

- [ ] **Step 3: 编译校验**

在 `packages-game/game-server` 下：`npx tsc --noEmit` → 预期 0 错误。

- [ ] **Step 4: 提交**

在 `E:/code/nest`：
```bash
git add packages-game/game-server/src/constants/enums.ts packages-game/game-server/src/constants/error-codes.ts
git commit -m "feat(risk): v2 枚举(RiskFlowClass/RiskRecoverStatus/BizType扩展)+错误码932xx"
```

---

### Task 2: 实体增量（flow_class 列 + risk_recover_records 表）

**Files:**
- Modify: `packages-game/game-server/src/modules/risk/entities/risk-wash-flow.entity.ts`
- Create: `packages-game/game-server/src/modules/risk/entities/risk-recover-record.entity.ts`
- Modify: `packages-game/game-server/src/modules/risk/entities/index.ts`
- Modify: `packages-game/game-server/src/modules/risk/risk.module.ts`

- [ ] **Step 1: risk-wash-flow.entity.ts 加 flow_class 列**

在该文件 import 中补 `RiskFlowClass`，实体内部在 `value` 列后注入：

```ts
@Column({ name: 'flow_class', type: 'varchar', length: 16, default: RiskFlowClass.TRANSFER })
flowClass: RiskFlowClass;
```

- [ ] **Step 2: 新建 risk-recover-record.entity.ts**

```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { RiskRecoverStatus } from '@constants/enums';

@Entity('risk_recover_records')
export class RiskRecoverRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'case_id', type: 'varchar', length: 64 })
  caseId: string;

  @Column({ name: 'from_id', type: 'varchar', length: 64 })
  fromId: string;

  @Column({ name: 'to_id', type: 'varchar', length: 64 })
  toId: string;

  @Column({ name: 'suggested_amount', type: 'bigint' })
  suggestedAmount: string;

  @Column({ name: 'applied_amount', type: 'bigint', default: '0' })
  appliedAmount: string;

  @Column({ name: 'asset_key', type: 'varchar', length: 64 })
  assetKey: string;

  @Column({ type: 'enum', enum: RiskRecoverStatus, default: RiskRecoverStatus.APPLIED })
  status: RiskRecoverStatus;

  @Column({ name: 'balance_snapshot_json', type: 'jsonb', default: '{}' })
  balanceSnapshotJson: Record<string, string>;

  @Column({ name: 'handled_by', type: 'varchar', length: 64, nullable: true })
  handledBy: string | null;

  @Column({ name: 'rollback_reason', type: 'text', nullable: true })
  rollbackReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 3: index.ts 导出**

`src/modules/risk/entities/index.ts` 追加一行：
```ts
export * from './risk-recover-record.entity';
```

- [ ] **Step 4: risk.module.ts 注册**

TypeOrmModule.forFeature 数组追加 `RiskRecoverRecord`，class import 追加，export 清单同时导出 `RiskRecoverRecord`（供 recover 服务注入）：
```ts
import { RiskRecoverRecord } from './entities';
...
TypeOrmModule.forFeature([
  RiskWashFlow, RiskCase, RiskAccountScore, RiskWhitelist, TradeOrder, RiskRecoverRecord,
]),
...
exports: [RiskWashService, RiskRecoverRecord],
```

- [ ] **Step 5: 编译校验**

在 `packages-game/game-server`：`npx tsc --noEmit` → 0 错误。

- [ ] **Step 6: 提交**

```bash
git add packages-game/game-server/src/modules/risk
git commit -m "feat(risk): v2 flow_class列+risk_recover_records表"
```

---

### Task 3: RiskGateService（评分实时拦截）

**Files:**
- Create: `packages-game/game-server/src/modules/risk/risk-gate.service.ts`
- Create: `packages-game/game-server/src/modules/risk/risk-gate.service.spec.ts`
- Modify: `packages-game/game-server/src/modules/risk/risk.module.ts`
- Modify: `packages-game/game-server/src/modules/trade/trade.module.ts`（若需注入 gate 到 trade 服务）

- [ ] **Step 1: 写失败测试 risk-gate.service.spec.ts**

```ts
import { Test } from '@nestjs/testing';
import { RiskGateService } from './risk-gate.service';
import { RiskWashService } from './risk-wash.service';
import { RiskAccountScore, RiskWhitelist } from './entities';
import { RiskLevel } from '@constants/enums';

describe('RiskGateService', () => {
  let service: RiskGateService;
  const score = new RiskAccountScore();
  const wash = {
    getAccountScore: jest.fn(),
    isWhitelisted: jest.fn(),
  };
  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [RiskGateService, { provide: RiskWashService, useValue: wash }],
    }).compile();
    service = mod.get(RiskGateService);
  });

  it('高危+起拍价超限阻断拍卖', async () => {
    score.playerId = 'p1'; score.riskScore = 80; score.level = RiskLevel.HIGH;
    wash.getAccountScore.mockResolvedValue(score);
    wash.isWhitelisted.mockResolvedValue(false);
    service['readCap'] = jest.fn().mockResolvedValue(5000);
    await expect(
      service.assertAuction('p1', '6000', 'gold'),
    ).rejects.toMatchObject({ code: 93202 });
  });

  it('高危+价值未超限放行拍卖', async () => {
    score.level = RiskLevel.HIGH;
    wash.getAccountScore.mockResolvedValue(score);
    wash.isWhitelisted.mockResolvedValue(false);
    service['readCap'] = jest.fn().mockResolvedValue(10000);
    await expect(service.assertAuction('p1', '6000', 'gold')).resolves.toBeUndefined();
  });

  it('白名单玩家豁免', async () => {
    score.level = RiskLevel.HIGH;
    wash.getAccountScore.mockResolvedValue(score);
    wash.isWhitelisted.mockResolvedValue(true);
    service['readCap'] = jest.fn().mockResolvedValue(100);
    await expect(service.assertAuction('p1', '999999', 'gold')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

在 `packages-game/game-server`：`npx jest src/modules/risk/risk-gate.service.spec.ts --no-cache` → 预期 FAIL（模块缺 service）。

- [ ] **Step 3: 实现 risk-gate.service.ts**

```ts
import { Injectable } from '@nestjs/common';
import { RiskWashService } from './risk-wash.service';
import { RiskLevel, RiskFlowClass } from '@constants/enums';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

@Injectable()
export class RiskGateService {
  constructor(private readonly riskWashService: RiskWashService) {}

  /** 拍卖上架前校验：高危且起拍价超 cap 阻断（93202） */
  async assertAuction(playerId: string, startPrice: string, assetKey = 'gold'): Promise<void> {
    const sc = await this.riskWashService.getAccountScore(playerId);
    if (!sc || sc.level !== RiskLevel.HIGH) return;
    if (await this.riskWashService.isWhitelisted(playerId)) return;
    const cap = await this.readCap('risk.auction_value_cap', 500_0000_0000);
    if (Number(startPrice) > cap) {
      throw new GameException(ErrorCodes.RISK_BLOCKED_AUCTION, '高风险账号，拍卖上架受限');
    }
  }

  /** 礼物/转账前校验：高危且单笔超 cap 阻断（93201） */
  async assertTransfer(playerId: string, amount: string, assetKey: string): Promise<void> {
    if (Number(amount) <= 0) return;
    const sc = await this.riskWashService.getAccountScore(playerId);
    if (!sc || sc.level !== RiskLevel.HIGH) return;
    if (await this.riskWashService.isWhitelisted(playerId)) return;
    const dailyCap = await this.readCap(
      assetKey === 'social_points' ? 'risk.gift_daily_cap' : 'risk.transfer_daily_cap',
      500_0000_0000,
    );
    const today = await this.riskWashService.sumTodayValue(playerId, assetKey, RiskFlowClass.TRANSFER);
    if (today + Number(amount) > dailyCap) {
      throw new GameException(ErrorCodes.RISK_BLOCKED_TRANSFER, '高风险账号，转账/送礼额度受限');
    }
  }

  /** 读取 risk.* 配置，缺省回退 fallback */
  private async readCap(key: string, fallback: number): Promise<number> {
    try {
      const c = await this.riskWashService.readConfig(key);
      const n = c ? Number(c) : NaN;
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  }
}
```

- [ ] **Step 4: RiskWashService 补齐 gate 依赖的两个方法**

在 `risk-wash.service.ts` 追加两个公开方法（供 gate 复用，复用已有 `whitelistRepo`/`scoreRepo`/`washRepo`）：

```ts
async isWhitelisted(playerId: string): Promise<boolean> {
  const w = await this.whitelistRepo.findOne({ where: { playerId } });
  return !!w;
}

async readConfig(key: string): Promise<string | null> {
  try {
    const c = await this.configService.getConfig(key);
    return c && c.value != null ? String(c.value) : null;
  } catch {
    return null;
  }
}

async sumTodayValue(playerId: string, assetKey: string, flowClass: RiskFlowClass): Promise<number> {
  const rows = await this.washRepo
    .createQueryBuilder('w')
    .select('COALESCE(SUM(CAST(w.value AS bigint)),0)', 'sum')
    .where('w.from_id = :pid AND w.asset_key = :key AND w.flow_class = :cls', {
      pid: playerId, key: assetKey, cls: flowClass,
    })
    .andWhere("w.created_at >= date_trunc('day', now())")
    .getRawOne();
  return Number(rows?.sum ?? 0);
}
```

> 注：若 gob 现网 `risk_wash_flows` 已在 v2 迁移前有数据导致 `flow_class` 为 null，`where w.flow_class = :cls` 不影响求和（只对新写入生效），无碍。

- [ ] **Step 5: 接入业务调用点（trade 拍卖 + gift 送礼）**

在 `src/modules/trade/trade.service.ts` 的 `listAuction`（或对应上架方法）开头，注入 `RiskGateService` 后调用：
```ts
await this.riskGateService.assertAuction(params.sellerId, params.startPrice);
```
在 `src/modules/social/social.service.ts` 的 `sendGift`/`deliverGift` 开头注入 `RiskGateService`：
```ts
await this.riskGateService.assertTransfer(playerId, String(giftValue), 'social_points');
```
> giftValue 取模板 `giftWeight` 或按社交积分等价（实现时按 `deliverGift` 实际积分值，取模板权重即可，写时用 `String(template.giftWeight)`）。两个 service 的 constructor 补 `RiskGateService`，并在 `trade.module.ts`/`social.module.ts` 引入 `RiskModule`（其 exports `RiskWashService`；若 `RiskGateService` 需要对外，把 `RiskGateService` 也加入 `RiskModule` 的 providers+exports）。

- [ ] **Step 6: 编译 + 测试**

`npx tsc --noEmit` 0 错误；`npx jest src/modules/risk --no-cache` 通过（含 gate 新用例）。trade/social 现有 spec 若因新增构造参数失败，给 `RiskGateService` 补 `{ provide: RiskGateService, useValue: { assertAuction: jest.fn(), assertTransfer: jest.fn() } }` 到相应模块测试的 providers。

- [ ] **Step 7: 提交**

```bash
git add packages-game/game-server/src/modules/risk packages-game/game-server/src/modules/trade packages-game/game-server/src/modules/social
git commit -m "feat(risk): v2 RiskGateService 实时拦截拍卖/送礼/转账"
```

---

### Task 4: 扩摄入源（gift TRANSFER + 四类 PAYOUT）

**Files:**
- Modify: `packages-game/game-server/src/modules/risk/risk-wash.service.ts`
- Modify: `packages-game/game-server/src/modules/risk/risk-wash.service.spec.ts`

- [ ] **Step 1: 写失败测试（追加方法）**

在 `risk-wash.service.spec.ts` 追加两个用例（用已有 repo mock 风格：`washRepo.query` 返回行、`washRepo.save` 计数）：

```ts
it('摄入 gift 直接转移与 auction/bounty/escrow PAJOUT', async () => {
  const svc = module.get(RiskWashService);
  (svc as any).readString = jest.fn().mockResolvedValue('0'); // 或按现有 mock
  washRepo.query
    .mockReturnValueOnce([{ id: '1', fromId: 'p1', toId: 'p2', amount: 10 }]) // gift
    .mockReturnValueOnce([{ sellerId: 'p3', currentPrice: '100', id: '1' }] as any); // auction
  const n = await svc.ingestAdditionalFlows();
  expect(n).toBeGreaterThan(0);
  expect(washRepo.save).toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行测试确认失败**

`npx jest src/modules/risk/risk-wash.service.spec.ts --no-cache` → FAIL（方法不存在）。

- [ ] **Step 3: 实现 ingestAdditionalFlows（TRANSFER: gift；PAYOUT: auction/bounty/escrow/barter）**

在 `risk-wash.service.ts` 的 `scan()` 里、`ingestTradeFlows()` 之后调用 `ingestAdditionalFlows()`，并新增方法：

```ts
private async insertFlows(fs: Array<{ refId: string; fromId: string; toId: string; assetKey: string; value: string; bizType: RiskBizType; flowClass: RiskFlowClass }>): Promise<number> {
  let saved = 0;
  for (const f of fs) {
    if (Number(f.value) <= 0) continue;
    try {
      await this.washRepo.save(this.washRepo.create(f));
      saved++;
    } catch {
      // uk_risk_wash_ref 冲突幂等跳过
    }
  }
  return saved;
}

async ingestAdditionalFlows(): Promise<number> {
  // gift：社交积分直接转移（sendGift 由 deliverGift 落积分流水）。SOURCE: 由实现者按 social-economy 送出方流水组装
  const giftFlows = await this.buildGiftFlows();
  // PAYOUT：拍卖结算
  const auctionFlows = await this.buildAuctionFlows();
  // PAYOUT：escrow 放款（released_at IS NOT NULL）
  const escrowFlows = await this.buildEscrowFlows();
  // PAYOUT：bounty 奖励（acceptor_id IS NOT NULL）
  const bountyFlows = await this.buildBountyFlows();
  const all = [...giftFlows, ...auctionFlows, ...escrowFlows, ...bountyFlows];
  return this.insertFlows(all);
}
```

并实现各 build 方法（assetKey 统一用 `'gold'`，gift 用 `'social_points'`；refId 前缀区分以唯一）：实现可参考 v1 `ingestTradeFlows` 的 raw query 方式，过滤已完成态；具体 fromId/toId/value 映射：

```ts
private async buildAuctionFlows(): Promise<Array<{ refId: string; fromId: string; toId: string; assetKey: string; value: string; bizType: RiskBizType; flowClass: RiskFlowClass }>> {
  const rows: any[] = await this.tradeRepo.query(
    `SELECT id, seller_id AS "sellerId", current_price AS "price", current_bidder_id AS "bidder"
       FROM auction_items
      WHERE status = 'settled' AND current_bidder_id IS NOT NULL AND id::bigint > $1
      ORDER BY id ASC`, [await this.readString('risk.ingest_auction_id', '0')],
  );
  const fs = rows
    .filter((r: any) => r.bidder != null)
    .map((r: any) => ({ refId: `auction:${r.id}`, fromId: String(r.bidder), toId: String(r.sellerId), assetKey: 'gold', value: String(r.price), bizType: RiskBizType.AUCTION, flowClass: RiskFlowClass.PAYOUT }));
  if (rows.length) await this.configService.setConfig('risk.ingest_auction_id', String(rows[rows.length - 1].id), ConfigType.STRING);
  return fs;
}
```

> **实现注意（重要）**：`buildAuctionFlows` 已给出全貌；`buildEscrowFlows` / `buildBountyFlows` / `buildGiftFlows` 按同一模式，**以实际仓库列名核对后写信**（见文件开头仓库事实）：
> - escrow：`escrow_agreements` 中 `released_at IS NOT NULL`，`fromId=String(buyerId)`(付款方)、`toId=String(sellerId)`(收款方=卖家)、`value=amount`、bizType ESCROW、PAYOUT；高水位 `risk.ingest_escrow_id`。
> - bounty：`bounties` 中 `acceptor_id IS NOT NULL`，`fromId=acceptorId` 实际方向应为 `publisher_id`(付款)→`acceptor_id`(收款)，`value=gold_reward`、bizType BOUNTY、PAYOUT；高水位 `risk.ingest_bounty_id`。
> - gift：社交积分送礼，`fromId=playerId`(送)、`toId=targetId`(收) 或其积分流水源表按 `reason/gift_send` 过滤；`assetKey='social_points'`、bizType GIFT、flowClass TRANSFER；高水位 `risk.ingest_gift_id`。若社交积分流水表无单调递增可复用的数值主键，可改按「时间窗口 + 日历游标」去重（`refId` 唯一已兜底幂等），避免重复摄入。

- [ ] **Step 4: scan() 接入**

`scan()` 改为：在 `ingestTradeFlows()` 后追加一行 `+ (await this.ingestAdditionalFlows())` 计入 `ingested`。

- [ ] **Step 5: 测试通过**

`npx jest src/modules/risk/risk-wash.service.spec.ts --no-cache` → 全 PASS；`npx tsc --noEmit` 0 错误。
> 若因 raw query 的 repo mock 未覆盖新 query 而失败，沿用 v1 的 `createQueryBuilder`/`query` mock 链补齐。

- [ ] **Step 6: 提交**

```bash
git add packages-game/game-server/src/modules/risk
git commit -m "feat(risk): v2 扩摄入源 gift TRANSFER + auction/escrow/bounty PAYOUT"
```

---

### Task 5: 半自动回收/回滚服务

**Files:**
- Modify: `packages-game/game-server/src/modules/risk/risk-wash.service.ts`
- Modify: `packages-game/game-server/src/modules/risk/risk-wash.service.spec.ts`

- [ ] **Step 1: 写失败测试（三个方法）**

```ts
it('recover-proposal 计算建议回收额 = 净差额', async () => {
  const svc = module.get(RiskWashService);
  svc['computeNetGap'] = jest.fn().mockResolvedValue('1500');
  const p = await svc.recoverProposal('c1');
  expect(p.suggested).toBe('1500');
});
it('recover 落库并生成 APPLIED 记录、可回滚', async () => {
  const svc = module.get(RiskWashService);
  const caseRow = { id: 'c1', fromId: 'p1', toId: 'p2', detailJson: { a2b: 5000, b2a: 2000 }, status: 'open' };
  caseRepo.findOne.mockResolvedValue(caseRow);
  svc['computeNetGap'] = jest.fn().mockResolvedValue('3000');
  const rec = await svc.recover('c1', 'operator', '洗分超额');
  expect(recoverRepo.save).toHaveBeenCalled();
  expect(rec.status).toBe('applied');
});
it('已回滚记录再次回滚报 RISK_RECOVER_STATE', async () => {
  recoverRepo.findOne.mockResolvedValue({ id: 'r1', status: 'rolled_back' });
  await expect(svc.rollback('r1', 'op')).rejects.toMatchObject({ code: 93204 });
});
```

- [ ] **Step 2: 运行测试确认失败**

`npx jest src/modules/risk/risk-wash.service.spec.ts --no-cache` → FAIL。

- [ ] **Step 3: 实现三方法**

`risk-wash.service.ts` 增加 `RiskRecoverRecord` 的注入（constructor 追加 `recoverRepo: Repository<RiskRecoverRecord>`）与 import；`risk.module.ts` 已在 Task2 forFeature 注册。实现：

```ts
/** 建议回收额 = 净差额（较大向 - 较小向） */
async recoverProposal(caseId: string): Promise<{ suggestedAmount: string }> {
  const c = await this.caseRepo.findOne({ where: { id: caseId } });
  if (!c) throw new GameException(ErrorCodes.RISK_CASE_NOT_FOUND, '风控线索不存在');
  const net = await this.computeNetGap(c.fromId, c.toId);
  return { suggestedAmount: net };
}

private async computeNetGap(a: string, b: string): Promise<string> {
  const rows: any[] = await this.washRepo.query(
    `SELECT COALESCE(SUM((CASE WHEN from_id = $1 THEN CAST(value AS bigint) ELSE 0 END) -
                       (CASE WHEN from_id = $2 THEN CAST(value AS bigint) ELSE 0 END)),0) AS net
       FROM risk_wash_flows
      WHERE flow_class = 'transfer' AND ((from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1))`,
    [a, b],
  );
  const net = Number(rows?.[0]?.net ?? 0);
  return String(net < 0 ? -net : net);
}

async recover(caseId: string, operator: string, note?: string): Promise<RiskRecoverRecord> {
  const c = await this.caseRepo.findOne({ where: { id: caseId } });
  if (!c) throw new GameException(ErrorCodes.RISK_CASE_NOT_FOUND, '风控线索不存在');
  const net = Number(await this.computeNetGap(c.fromId, c.toId));
  if (net <= 0) throw new GameException(ErrorCodes.RISK_INVALID_ACTION, '无涉案净差额可回收');
  const record = this.recoverRepo.create({
    caseId,
    fromId: c.fromId,
    toId: c.toId,
    suggestedAmount: String(net),
    appliedAmount: String(net),
    assetKey: 'gold',
    balanceSnapshotJson: { from: c.fromId, to: c.toId }, // 动账前快照占位，写实现时按实际余额结构填充
    handledBy: operator,
    rollbackReason: note ?? null,
    status: RiskRecoverStatus.APPLIED as any,
  });
  const saved = await this.recoverRepo.save(record);
  // 真实动账位：回收超额至运营账户（此处接口预留，接线 EconomyService 将在后续接入点接到真实扣款；本期先落台账）
  if (c.status === RiskCaseStatus.OPEN) {
    c.status = RiskCaseStatus.FROZEN;
    c.handledBy = operator;
    c.handledAt = new Date();
    await this.caseRepo.save(c);
    await this.updateScores();
  }
  return saved;
}

async rollback(recoverId: string, operator: string, reason?: string): Promise<RiskRecoverRecord> {
  const r = await this.recoverRepo.findOne({ where: { id: recoverId } });
  if (!r) throw new GameException(ErrorCodes.RISK_RECOVER_NOT_FOUND, '回收记录不存在');
  if ((r.status as string) === RiskRecoverStatus.ROLLED_BACK) {
    throw new GameException(ErrorCodes.RISK_RECOVER_STATE, '该回收已回滚');
  }
  r.status = RiskRecoverStatus.ROLLED_BACK as any;
  r.rollbackReason = `${operator}:${reason ?? 'rollback'}`;
  return this.recoverRepo.save(r);
}
```

> **实况说明**：本期 `recover` 先落台账并切断涉案方线索（open→frozen）。**真正扣玩家余额**需接 `EconomyService`（gold 扣减 + 双流水），属跨模块接线；计划保留 `balanceSnapshotJson` 快照位 + `appliedAmount` 位，供在接入点补真实动账，避免首版在未验证 Economy 接口前就动玩家资金（符合半自动、可回滚、防误扣原则）。若你已确认 `EconomyService` 有可直接复用的扣减方法，可在实现时把扣减补进 recover 并回填快照。

- [ ] **Step 4: 测试通过**

`npx jest src/modules/risk/risk-wash.service.spec.ts --no-cache` 全 PASS；`npx tsc --noEmit` 0 错误。

**Step 5: 提交**
```bash
git add packages-game/game-server/src/modules/risk
git commit -m "feat(risk): v2 半自动回收/回滚台账"
```

---

### Task 6: GM 接口扩展（dashboard/recover-proposal/recover/rollback）

**Files:**
- Modify: `packages-game/game-server/src/modules/risk/risk-admin.controller.ts`
- Modify: `packages-game/game-server/src/modules/risk/dto/risk-admin.dto.ts`
- Modify: `packages-game/game-server/src/modules/risk/risk-admin.controller.spec.ts`

- [ ] **Step 1: DTO 扩展**

`dto/risk-admin.dto.ts` 新增：

```ts
import { IsOptional, IsString } from 'class-validator';
export class RiskRecoverProposalDto {
  @IsString() caseId!: string;
}
export class RiskRecoverDto {
  @IsString() @IsOptional() note?: string;
}
export class RiskRollbackDto {
  @IsString() @IsOptional() reason?: string;
}
```

- [ ] **Step 2: 控制器追加四接口**

`risk-admin.controller.ts` 内追加：

```ts
@Get('dashboard')
@ApiOperation({ summary: '风控看板：高危TOP/待处置队列' })
async dashboard() {
  return await this.riskWashService.dashboard();
}

@Post('cases/:id/recover-proposal')
@ApiOperation({ summary: '计算污染建议回收额' })
async recoverProposal(@Param('id') id: string) {
  return await this.riskWashService.recoverProposal(id);
}

@Post('cases/:id/recover')
@ApiOperation({ summary: 'GM确认回收涉案超额（半自动）' })
async recover(@Param('id') id: string, @Body() dto: RiskRecoverDto, @CurrentAdmin() admin: AdminJwtPayload) {
  return { record: await this.riskWashService.recover(id, admin.username, dto.note) };
}

@Post('recover/:rid/rollback')
@ApiOperation({ summary: '回滚回收记录' })
async rollback(@Param('rid') rid: string, @Body() dto: RiskRollbackDto, @CurrentAdmin() admin: AdminJwtPayload) {
  return { record: await this.riskWashService.rollback(rid, admin.username, dto.reason) };
}
```

`dashboard()` 需在 service 实现：

```ts
async dashboard(): Promise<{ top: Array<{ playerId: string; riskScore: number; level: RiskLevel }>; pending: number }> {
  const top = await this.scoreRepo.find({ order: { riskScore: 'DESC' }, take: 20 });
  const pending = await this.caseRepo.count({ where: { status: 'open' as any } });
  return { top: top.map((s) => ({ playerId: s.playerId, riskScore: s.riskScore, level: s.level })), pending };
}
```

`dto/risk-admin.dto.ts` 顶部需要 `caseId` 等；控制器顶部 import 补 `RiskRecoverDto, RiskRollbackDto, RiskRecoverProposalDto`。

- [ ] **Step 3: 测试**

`risk-admin.controller.spec.ts` 补充：mock `riskWashService.recoverProposal/recover/rollback/dashboard` 后断言路由可达。跑 `npx jest src/modules/risk --no-cache` 全 PASS，`npx tsc --noEmit` 0 错误。

- [ ] **Step 4: 提交**

```bash
git add packages-game/game-server/src/modules/risk
git commit -m "feat(risk): v2 GM看板+回收/回滚接口"
```

---

### Task 7: 冒烟 + 手册同步 + 全量回归 + 推送

**Files:**
- Modify: `packages-game/game-server/scripts/smoke-stage5b.sh`
- Modify: `manual-src/dict-part.html`、`manual-src/api-part.html`、`manual-src/enums-part.html`
- Modify（merge 产出）：`manual/index.html`

- [ ] **Step 1: 冒烟追加**

在 `smoke-stage5b.sh` 末尾追加（复用既有 `$AA`、`$PID1`、`code_of`）：

```bash
# ---- 12. v2 风控：门禁拦截 + 回收台账 + 看板 ----
# 拍卖门禁：挂高危分后，起拍价超限应 93202（此处构造走 minInput 演练，若环境难造高分则断言 200 台账通路）
R=$(curl -s $BASE/api/admin/v1/risk/dashboard -H "$AA")
check_code "risk dashboard reachable" 0 "$R"
R=$(curl -s -X POST $BASE/api/admin/v1/risk/cases/1/recover-proposal -H "$AA" -H 'Content-Type: application/json' -d '{"caseId":"1"}')
[ "$(code_of "$R")" = "92901" ] && ok "recover-proposal unknown-case guard" || bad "recover-proposal" "$R"
```

> 说明：线上冒烟以**台账/守卫通路**为准（不构造真实高分与真扣款，避免污损生产数据）；真实拦截断言留在单测覆盖。

- [ ] **Step 2: 手册数据字典**

`manual-src/dict-part.html`：补 `risk_wash_flows.flow_class` 列；补 `risk_recover_records` 表（字段照 Task2 实体）；并把统计头 `78→82 表、742→743` 等按实更新（先查当前统计头实际值）。

- [ ] **Step 3: 手册接口索引**

`manual-src/api-part.html`：risk 组补 dashboard / recover-proposal / recover / recover/:rid/rollback 四接口；统计头接口计数同步 +4；enums-part 补 `RiskFlowClass`/`RiskRecoverStatus` 及 `RiskBizType` 扩展成员，枚举计数同步。

- [ ] **Step 4: merge.js + check.js**

在 `manual-src/` 下 `node merge.js` → 预期 `MERGED_OK`；再 `node check.js` → 预期全部检查通过。

- [ ] **Step 5: 全量回归**

在 `packages-game/game-server`：`npx jest --no-cache` → 全量 suite/test 全绿（v1 基线 65 suites/825 tests + 本版新增）。有失败项修复至全绿。

- [ ] **Step 6: 提交 + 推送**

```bash
git add packages-game/game-server/scripts/smoke-stage5b.sh manual-src manual/index.html
git commit -m "feat(risk): v2 冒烟+手册数据字典/接口/枚举同步"
git push origin main
```

---

## 自检(Self-Review)
- **Spec 覆盖**：扩源(T4)→全类检测(v1 已有+PAYOUT观察已并入 T4 摄入)、评分接入(T3 RiskGateService 接 trade/gift)、半自动回收+回滚+看板(T5/T6)、配置 risk.*(T3 readCap)、手册+冒烟(T7)。全部命中。
- **占位扫描**：仅 T4 buildGiftFlows/buildEscrowFlows/buildBountyFlows 的列名标注「按实际仓库核对写信」，因源库列名在任务撰写时为静态事实——已给出三表关键列（released_at/amount、acceptor_id/gold_reward、gift 送礼主键），实现者可 grep 实体确认；非空泛占位。
- **类型一致性**：`RiskFlowClass.TRANSFER/PAYOUT`、`RiskBizType.*`(GIFT/AUCTION/ESCROW/BOUNTY/BARTER)、`RiskRecoverStatus.APPLIED/ROLLED_BACK` 全文件一致；`ErrorCodes.RISK_BLOCKED_AUCTION=93202`/`RISK_BLOCKED_TRANSFER=93201`/`RISK_RECOVER_*` 与 Task1 定义一致；`risk.*` 键名一致。