# P0-7 交易经济结算补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让摆摊交易、拍卖、易物三条链路真正结算——挂单/上架时校验绑定并托管卖家库存，成交时扣买家货币、给卖家入账（扣税）、转移道具，堵住「交易空转」与「绑定道具可流通」两个漏洞。

**Architecture:** 在 `InventoryService` 新增「只扣未绑定堆」的门面方法（现有 `removeItem` 按 `playerId+itemTemplateId` 查、不区分 `bindStatus`，无法表达「只能交易未绑定那堆」）；`TradeService` 在三条链路的入口与成交点补上「校验 → 托管扣减 → 状态原子占位 → 结算发放」，任一步失败按已完成的步骤逆向补偿。费率（上架手续费/成交税/税收反哺帮派比例）从 `remote_configs` 读取并带默认值，缺失不报错。并发防护统一用「状态条件更新 `affected=0` 即视为已被处理」，与 P0-4 的领奖占位模式一致。

**Tech Stack:** NestJS 11 + TypeScript、TypeORM + PostgreSQL、class-validator、Jest 30 + ts-jest。

---

## 设计

### 缺陷根因

| 缺陷 | 根因 | 证据 |
|---|---|---|
| 挂单不托管库存 | `createTradeOrder` 只 `tradeRepo.create/save`，从不查背包、不扣库存、不校验绑定 | [trade.service.ts:83-98](file:///e:/code/nest/packages-game/game-server/src/modules/trade/trade.service.ts#L83-L98) |
| 成交不结算 | `buyItem` 只把 `status` 改 `COMPLETED`：不扣买家货币、不给卖家入账、不转移道具 | [trade.service.ts:100-123](file:///e:/code/nest/packages-game/game-server/src/modules/trade/trade.service.ts#L100-L123) |
| 取消不退货 | `cancelTradeOrder` 只改 `status = CANCELLED`，无库存退回（因挂单时也没扣） | [trade.service.ts:125-139](file:///e:/code/nest/packages-game/game-server/src/modules/trade/trade.service.ts#L125-L139) |
| 拍卖不托管不结算不收费 | `listAuction` 只落库；`endAuction` 只改状态，无货币/道具结算；无上架手续费 | [trade.service.ts:156-188](file:///e:/code/nest/packages-game/game-server/src/modules/trade/trade.service.ts#L156-L188)、[235-254](file:///e:/code/nest/packages-game/game-server/src/modules/trade/trade.service.ts#L235-L254) |
| 易物不结算且格式未定义 | `itemsAJson`/`itemsBJson` 类型为 `Record<string, any>`，无契约；`createBarter`/`acceptBarter` 只改状态 | [barter.dto.ts](file:///e:/code/nest/packages-game/game-server/src/modules/trade/dto/barter.dto.ts)、[trade.service.ts:718-765](file:///e:/code/nest/packages-game/game-server/src/modules/trade/trade.service.ts#L718-L765) |
| 无成交税/上架费 | 全库唯一费率为 `escrow.feePercent = 2`（给担保人），市场与拍卖零费零税 | [trade.service.ts:469](file:///e:/code/nest/packages-game/game-server/src/modules/trade/trade.service.ts#L469) |
| 社交/绑定货币可作交易币种 | `currencyType` 是自由字符串，控制器默认 `'gold'` 但不校验 | [trade.controller.ts:62](file:///e:/code/nest/packages-game/game-server/src/modules/trade/trade.controller.ts#L62)、[trade-order.entity.ts:36-42](file:///e:/code/nest/packages-game/game-server/src/modules/trade/entities/trade-order.entity.ts#L36-L42) |
| 无绑定判定能力 | `InventoryItem` 按 `playerId+itemTemplateId` 存，同一模板可同时存在 `BOUND`/`UNBOUND` 两行；`removeItem` 的 `findOne` 不区分 `bindStatus` | [inventory.service.ts:121-126](file:///e:/code/nest/packages-game/game-server/src/modules/inventory/inventory.service.ts#L121-L126)、[inventory-item.entity.ts:34-40](file:///e:/code/nest/packages-game/game-server/src/modules/inventory/entities/inventory-item.entity.ts#L34-L40) |

### 手册要求（原文依据）

- [main-part.html:1989](file:///e:/code/nest/manual-src/main-part.html#L1989)：「绑定道具（bind_status / bind_type）**禁止交易流通**，保护绑定钻石经济；建议收取上架手续费与成交税，回收金币。」
- [main-part.html:2049](file:///e:/code/nest/manual-src/main-part.html#L2049)：「**税收反哺**：成交税（见 11.2）按比例入帮派资金（帮派占产地商品，见 8.8）与系统回收；**比例可远程配置**（见 13.2）。」
- [main-part.html:2093](file:///e:/code/nest/manual-src/main-part.html#L2093)：「**「社交货币不可交易」是铁律**。」

### 关键设计决策

1. **新增 `InventoryService.removeUnboundItem`，不改现有 `removeItem`**。交易/拍卖只允许动「未绑定」堆；`removeItem` 保持原语义（背包消耗等场景），避免影响既有调用方。判定顺序：模板存在 → `template.canTrade !== false` → 存在 `UNBOUND` 行 → 数量足够。
2. **复用已定义未使用的错误码**，不新增物品类错误码：`ITEM_BOUND: 20003`（存在道具但全是绑定堆）、`ITEM_CANNOT_TRADE: 20005`（模板 `canTrade = false`）、`ITEM_NOT_FOUND: 20001`、`ITEM_NOT_ENOUGH: 20002`。交易币种越界用新增的 `TRADE_CURRENCY_NOT_ALLOWED: 70008`。
3. **可交易币种白名单 = `[GOLD, DIAMOND]`**。`BOUND_DIAMOND`（绑定钻石）按手册 11.2 原文属被保护对象，与 `FAVOR`/`GUILD_CONTRIB`/`FACE`/`INFAMY` 一并禁止（手册 11.3 社交货币不可交易铁律）。
4. **挂单/上架即托管卖家库存**（扣减），成交后转给买家、取消/流拍后原样退回。这是「不结算」能成立的前提——否则同一件道具可被无限次挂单。
5. **并发防护 = 状态条件更新占位**：`repo.update({ id, status: <前置态> }, { status: <终态> })`，`affected = 0` 即视为已被处理并抛错。用于 `buyItem`（防双买）、`cancelTradeOrder`（防取消与买入并发）、`endAuction`（防重复结算）、`acceptBarter`（防重复接受）。理由：现有代码是 read-modify-write，并发下会双结算。
6. **补偿策略（用户已选「withLock + 补偿」）**：不引入 `runInTransaction`。每个入口把「可能失败的扣减类操作」排在前面，并对已完成的步骤做逆向补偿（退款/退货）；发放类操作（`addItem`/`addCurrency`）排在后面，因其几乎不会失败。残余窗口：若在「给卖家入账成功后、给买家道具前」进程崩溃，会出现买家已付款但未收货——记为已知风险，不做分布式事务。
7. **成交税去向按比例拆分**（手册 11.3）：`tax = total * sale_tax_percent / 100`；`guildShare = tax * tax_guild_share_percent / 100` 入**卖家所在帮派**资金（`SocialService.adjustGuildFund`），余额 `tax - guildShare` 作为系统回收（不从任何账户支出，即从流通中消失）。BigInt 整除的余数归系统回收，保证「卖家到手 + 帮派 + 回收 = total」恒等。
8. **帮派入账失败只记 warning，不阻断成交**（税已从卖家侧扣走，差额自然落入系统回收）。用 `Logger.warn`，与 P0-4 的「未识别奖励键」处理一致。
9. **拍卖出价时不冻结资金，成交时扣款**（最小改动）。若成交时买家余额不足，则**流拍**（`status = EXPIRED`）并退回卖家库存，同时抛 `CURRENCY_NOT_ENOUGH` 让调用方感知。
10. **上架手续费口径 = `startPrice * quantity * listing_fee_percent / 100`，从卖家扣金币**（拍卖无 `currencyType` 字段，恒为金币）。默认 2%。
11. **易物物品格式契约 = `{ "<道具模板id>": <正整数数量> }`**（本批首次定义）。非法键/值抛 `PARAM_INVALID`。易物**不收税**（手册未要求），只做双向物品转移 + A 方 `goldAmount` 支付。
12. **费率配置键与默认值**：`trade.listing_fee_percent`（默认 2）、`trade.sale_tax_percent`（默认 5）、`trade.tax_guild_share_percent`（默认 50）。读取失败（`CONFIG_NOT_FOUND`）或值非法（非有限数/负数/>100）一律回退默认值，不抛错。
13. **不做的**：交易纠纷仲裁、信用评价联动（8.15）、绑定道具的代购出口（8.8/11.2 代购）、拍卖出价预冻结、成交播报、`escrow`/`bounty`/`credit` 三条链路的费率统一（它们已有各自结算）。

### 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/modules/inventory/inventory.service.ts` | 修改 | 新增 `removeUnboundItem`：只扣未绑定堆，禁交易模板直接拒 |
| `src/modules/inventory/inventory.service.spec.ts` | 修改 | 4 例：正常扣减 / 全绑定 → 20003 / 模板禁交易 → 20005 / 数量不足 → 20002 |
| `src/constants/error-codes.ts` | 修改 | 新增 `TRADE_CURRENCY_NOT_ALLOWED: 70008` |
| `src/modules/trade/trade.service.ts` | 修改 | 注入 `InventoryService`/`ConfigManageService`；新增 `assertTradableCurrency`/`readPercent`/`parseItemMap`/`recycleTaxToGuild`；改造 3 条链路共 7 个方法 |
| `src/modules/trade/trade.module.ts` | 修改 | imports 增加 `InventoryModule`、`ConfigManageModule` |
| `src/scheduler/scheduler.service.ts` | 修改 | 新增每分钟任务：扫描到期拍卖并逐个 `endAuction` 结算（`endAuction` 当前无任何调用方） |
| `src/scheduler/scheduler.module.ts` | 修改 | imports 增加 `TradeModule` |
| `src/modules/trade/dto/barter.dto.ts` | 修改 | 注释中固化 `itemsAJson`/`itemsBJson` 的 `{模板id: 数量}` 契约 |
| `src/modules/trade/trade.service.spec.ts` | 修改 | 新增结算相关用例（既有用例需补 provider mock） |
| `scripts/smoke-p07-trade.sh` | 创建 | 部署后冒烟：绑定拒挂单、成交后双方余额与库存变化、税拆分、取消退货、拍卖流拍退货 |
| `docs/superpowers/specs/2026-09-20-game-server-completeness-inventory-design.md` | 修改 | P0-7 标注 + 第四批进度段落 + §7 计数改 7/8 |

### 测试基线

当前 **80 suites / 960 tests 全绿**（P0-4 收尾后）。本批预计 +20~24 例，收尾基线 **80 suites / ≈985 tests**，`npx tsc --noEmit` 0 error。

### 完成验收

1. `npm test` 全绿；`npx tsc --noEmit` 0 error。
2. 绑定道具（`bindStatus = BOUND`）或 `canTrade = false` 的道具**无法挂单/上架/易物**，返回 `20003` / `20005`。
3. 挂单后卖家库存立即减少 `quantity`；成交后买家库存增加、卖家不再持有；取消后库存原样退回。
4. 成交后：买家扣 `pricePerUnit * quantity`；卖家到账 `总额 - 税`；帮派资金增加 `税 * 比例`；三者与总额恒等（BigInt 整除余数归系统回收）。
5. 社交货币（`favor`/`guild_contrib`/`face`/`infamy`）与 `bound_diamond` 作 `currencyType` 挂单被拒（`70008`）。
6. 拍卖成交结算与摆摊同口径；买家余额不足时**流拍**且卖家库存退回。
7. 费率配置项缺失时使用默认值（2% / 5% / 50%），不抛错；非法值同样回退默认。
8. 并发双买同一挂单只有一次成功，第二次返回 `70003`。
9. 到期拍卖由每分钟定时任务自动结算（扫描 `listed`/`bid` 且 `expireAt < now()`），无需人工触发；`endAuction` 不再是死代码。

### 风险与回滚

| 风险 | 影响 | 处置 |
|---|---|---|
| 存量 `trade_orders`（`PENDING`）挂单时未托管库存 | 上线后这些单成交会「凭空发货」给买家 | 上线前排查：`SELECT id,seller_id,item_template_id,quantity,status FROM trade_orders WHERE status = 'pending';`，逐单确认卖家库存是否仍在；确认不了就批量置 `cancelled` |
| 存量 `auction_items`（`LISTED`/`BID`）未托管、未收上架费 | 同上 | `SELECT id,seller_id,item_template_id,quantity,status FROM auction_items WHERE status IN ('listed','bid');`，同上处理 |
| 存量 `barter_deals`（`PENDING`）`itemsAJson` 格式未知 | `acceptBarter` 解析失败抛 `PARAM_INVALID`，易物卡住 | `SELECT id,party_a_id,items_a_json FROM barter_deals WHERE status = 'pending';` 核对；不符契约的批量置 `cancelled` |
| 挂单即扣库存改变玩家体感 | 老玩家发现「挂单后背包就少了」 | 属正确行为（托管）；GM 侧需能查 `player_item_change_logs` 的 `trade.*` opTrace |
| 成交开始真收税 | 卖家到手金额下降 | 默认税率 5% 可通过 `remote_configs` 调为 0 关闭 |
| 拍卖成交时买家余额不足 → 流拍 | 卖家体验为「被出价后又流拍」 | 已在手册拍卖状态机范围内（`expired` 流拍）；后续可加出价预冻结 |
| 帮派入账失败被吞 | 税未进帮派资金，静默变为系统回收 | 已记 `Logger.warn`；对账可用 `economy` 流水 `source = 'auction_tax_guild'` 比对 |
| 补偿不覆盖进程崩溃 | 极端情况下买家已付款未收货 | 记为已知风险；上线后如需强一致再引入 `runInTransaction` |
| 既有依赖「挂单不校验库存」的脚本/用例失效 | `smoke-eco.sh` 的 `intel_buy` 链路（打听情报后直接挂单，未持有道具）会在挂单处报 `20001` | 属正确收紧；部署后跑 `smoke-eco.sh` 前需先给该玩家发对应道具，或将该断言放宽为「挂单被拒也算通过」 |

### 不在本次范围

- 交易纠纷仲裁、信用评价联动（8.15）
- 绑定道具的代购出口（8.8 / 11.2 代购）
- 拍卖出价预冻结、成交播报、熟客折扣累积（11.3 表格中的「熟客 ≥10 次」）
- `escrow` / `bounty` / `credit` 三条链路的费率与结算（已有各自实现，不动）
- GM 后台交易/拍卖面板（归 P0-8）

---

## Task 1: InventoryService 新增未绑定专用扣减

**Files:**
- Modify: `packages-game/game-server/src/modules/inventory/inventory.service.ts`（在 `removeItem` 之后插入新方法）
- Test: `packages-game/game-server/src/modules/inventory/inventory.service.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `inventory.service.spec.ts` 的 `describe('removeItem', ...)` 之后新增一个 describe 块（若 `removeItem` 无独立 describe，则追加到文件末尾的 `describe('InventoryService', ...)` 内、最后一个 `});` 之前）：

```ts
  describe('removeUnboundItem', () => {
    it('should deduct from unbound stack and write change log', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(makeTemplate({ canTrade: true }));
      inventoryItemRepo.findOne.mockResolvedValue({
        id: '1',
        playerId: 'p1',
        itemTemplateId: '100',
        quantity: 10,
        bindStatus: BindStatus.UNBOUND,
      } as any);
      inventoryItemRepo.save.mockImplementation((data: any) =>
        Promise.resolve(data),
      );

      const result = await service.removeUnboundItem('p1', '100', 4, 'trade.test');

      expect(result.quantity).toBe(6);
      expect(changeLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: -4, opTrace: 'trade.test' }),
      );
    });

    it('should reject with ITEM_BOUND when only bound stack exists', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(makeTemplate({ canTrade: true }));
      inventoryItemRepo.findOne
        .mockResolvedValueOnce(null) // UNBOUND 行不存在
        .mockResolvedValueOnce({ id: '1', bindStatus: BindStatus.BOUND } as any);

      await expect(
        service.removeUnboundItem('p1', '100', 1, 'trade.test'),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.ITEM_BOUND } });
    });

    it('should reject with ITEM_CANNOT_TRADE when template forbids trade', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ canTrade: false }),
      );

      await expect(
        service.removeUnboundItem('p1', '100', 1, 'trade.test'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.ITEM_CANNOT_TRADE },
      });
      expect(inventoryItemRepo.findOne).not.toHaveBeenCalled();
    });

    it('should reject with ITEM_NOT_ENOUGH when unbound stack is insufficient', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(makeTemplate({ canTrade: true }));
      inventoryItemRepo.findOne.mockResolvedValue({
        id: '1',
        playerId: 'p1',
        itemTemplateId: '100',
        quantity: 2,
        bindStatus: BindStatus.UNBOUND,
      } as any);

      await expect(
        service.removeUnboundItem('p1', '100', 5, 'trade.test'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.ITEM_NOT_ENOUGH },
      });
    });
  });
```

并在文件顶部 import 中加入 `ErrorCodes`：

```ts
import { ErrorCodes } from '@constants/error-codes';
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd packages-game/game-server && npx jest src/modules/inventory --silent
```

Expected: FAIL，报 `service.removeUnboundItem is not a function`（4 例全红）。

- [ ] **Step 3: 实现 `removeUnboundItem`**

在 `inventory.service.ts` 的 `removeItem` 方法结束的 `}` 之后、`useItem` 之前插入：

```ts
  /**
   * 交易/拍卖/易物专用扣减：只认「未绑定」堆。
   * 手册 11.2：绑定道具禁止交易流通，故不能复用 removeItem（后者不区分 bindStatus）。
   */
  async removeUnboundItem(
    playerId: string,
    itemTemplateId: string,
    quantity: number,
    opTrace: string,
  ): Promise<InventoryItem> {
    if (quantity <= 0) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '数量必须大于0');
    }
    if (!/^\d+$/.test(itemTemplateId)) {
      throw new GameException(ErrorCodes.ITEM_NOT_FOUND, '道具模板不存在');
    }

    const template = await this.templateRepo.findOne({
      where: { id: itemTemplateId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.ITEM_NOT_FOUND, '道具模板不存在');
    }
    if (template.canTrade === false) {
      throw new GameException(ErrorCodes.ITEM_CANNOT_TRADE, '该道具禁止交易');
    }

    const lockKey = `lock:item:${playerId}:${itemTemplateId}`;
    return this.cacheService.withLock(
      lockKey,
      async () => {
        const item = await this.itemRepo.findOne({
          where: {
            playerId,
            itemTemplateId,
            bindStatus: BindStatus.UNBOUND,
          },
        });
        if (!item) {
          // 区分「没有该道具」与「有但已绑定」，便于运营定位
          const anyItem = await this.itemRepo.findOne({
            where: { playerId, itemTemplateId },
          });
          throw new GameException(
            anyItem ? ErrorCodes.ITEM_BOUND : ErrorCodes.ITEM_NOT_FOUND,
            anyItem ? '道具已绑定，禁止交易流通' : '道具不存在',
          );
        }

        if (item.quantity < quantity) {
          throw new GameException(ErrorCodes.ITEM_NOT_ENOUGH, '道具数量不足', {
            current: item.quantity,
            required: quantity,
          });
        }

        item.quantity -= quantity;
        const saved = await this.itemRepo.save(item);

        await this.logRepo.save(
          this.logRepo.create({
            playerId,
            itemTemplateId,
            changeType: ItemChangeType.REMOVE,
            quantity: -quantity,
            opTrace,
            balanceAfter: saved.quantity,
          }),
        );

        this.eventBus.emit(GameEvents.ITEM_CONSUMED, {
          playerId,
          itemTemplateId,
          quantity,
        });

        return saved;
      },
      { ttl: 10, retry: 3, retryDelay: 100 },
    );
  }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages-game/game-server && npx jest src/modules/inventory --silent
```

Expected: PASS（原有用例 + 新增 4 例全绿）。

- [ ] **Step 5: Commit**

```bash
git add packages-game/game-server/src/modules/inventory/inventory.service.ts packages-game/game-server/src/modules/inventory/inventory.service.spec.ts
git commit -m "feat(inventory): 新增只扣未绑定堆的 removeUnboundItem（交易结算前置）"
```

---

## Task 2: 交易费率与币种白名单基础设施

**Files:**
- Modify: `packages-game/game-server/src/constants/error-codes.ts`
- Modify: `packages-game/game-server/src/modules/trade/trade.service.ts`
- Modify: `packages-game/game-server/src/modules/trade/trade.module.ts`
- Test: `packages-game/game-server/src/modules/trade/trade.service.spec.ts`

- [ ] **Step 1: 新增错误码**

在 `error-codes.ts` 的 `AUCTION_NOT_SELLER: 70007,` 之后加一行：

```ts
  TRADE_CURRENCY_NOT_ALLOWED: 70008,
```

- [ ] **Step 2: 写失败测试**

在 `trade.service.spec.ts` 的 `describe('TradeService', ...)` 内新增：

```ts
  describe('settlement infrastructure', () => {
    it('should reject social currency as trade currency', async () => {
      await expect(
        service.createTradeOrder({
          sellerId: 'p1',
          itemTemplateId: '100',
          itemName: '道具',
          quantity: 1,
          pricePerUnit: '10',
          currencyType: CurrencyType.FAVOR,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.TRADE_CURRENCY_NOT_ALLOWED },
      });
      expect(tradeRepo.save).not.toHaveBeenCalled();
    });

    it('should reject bound diamond as trade currency', async () => {
      await expect(
        service.createTradeOrder({
          sellerId: 'p1',
          itemTemplateId: '100',
          itemName: '道具',
          quantity: 1,
          pricePerUnit: '10',
          currencyType: CurrencyType.BOUND_DIAMOND,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.TRADE_CURRENCY_NOT_ALLOWED },
      });
    });

    it('should fall back to default sale tax when config missing', async () => {
      configService.getConfig.mockRejectedValue(
        new GameException(ErrorCodes.CONFIG_NOT_FOUND, '配置项不存在'),
      );
      const percent = await (service as any).readPercent(
        'trade.sale_tax_percent',
        5,
      );
      expect(percent).toBe(5);
    });

    it('should fall back to default when config value is illegal', async () => {
      configService.getConfig.mockResolvedValue({
        key: 'trade.sale_tax_percent',
        value: 'not-a-number',
        configType: ConfigType.NUMBER,
        version: 1,
      } as any);
      const percent = await (service as any).readPercent(
        'trade.sale_tax_percent',
        5,
      );
      expect(percent).toBe(5);
    });

    it('should read percent from remote config', async () => {
      configService.getConfig.mockResolvedValue({
        key: 'trade.sale_tax_percent',
        value: '8',
        configType: ConfigType.NUMBER,
        version: 1,
      } as any);
      const percent = await (service as any).readPercent(
        'trade.sale_tax_percent',
        5,
      );
      expect(percent).toBe(8);
    });
  });
```

同时在 `trade.service.spec.ts` 顶部补 import 与 provider：

```ts
import { ConfigManageService } from '@modules/config/config.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { ConfigType } from '@constants/enums';
```

在 `Test.createTestingModule` 的 `providers` 数组里（`TradeService` 之后）加入：

```ts
        {
          provide: InventoryService,
          useValue: {
            removeUnboundItem: jest.fn(),
            addItem: jest.fn(),
          },
        },
        {
          provide: ConfigManageService,
          useValue: {
            getConfig: jest.fn().mockRejectedValue(
              new GameException(ErrorCodes.CONFIG_NOT_FOUND, '配置项不存在'),
            ),
          },
        },
```

并在 `let` 声明区与 `module.get` 区各加一行：

```ts
  let configService: jest.Mocked<ConfigManageService>;
  let inventoryService: jest.Mocked<InventoryService>;
```

```ts
    configService = module.get(ConfigManageService);
    inventoryService = module.get(InventoryService);
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd packages-game/game-server && npx jest src/modules/trade --silent
```

Expected: FAIL —— `Nest can't resolve dependencies of the TradeService`（构造函数尚未注入新依赖），且 `service.readPercent is not a function`。

- [ ] **Step 4: 实现基础设施**

在 `trade.service.ts` 顶部 import 补：

```ts
import { In, Repository } from 'typeorm';
import { Logger } from '@nestjs/common';
import { InventoryService } from '@modules/inventory/inventory.service';
import { ConfigManageService } from '@modules/config/config.service';
```

（`import { Injectable } from '@nestjs/common';` 改为 `import { Injectable, Logger } from '@nestjs/common';`）

在 `TradeService` 类内、构造函数之前加常量与 logger：

```ts
  private readonly logger = new Logger(TradeService.name);

  /** 可交易币种白名单：社交货币与绑定钻石按手册 11.2/11.3 禁止流通 */
  private static readonly TRADABLE_CURRENCIES: string[] = [
    CurrencyType.GOLD,
    CurrencyType.DIAMOND,
  ];

  private static readonly LISTING_FEE_KEY = 'trade.listing_fee_percent';
  private static readonly SALE_TAX_KEY = 'trade.sale_tax_percent';
  private static readonly TAX_GUILD_SHARE_KEY = 'trade.tax_guild_share_percent';
  private static readonly DEFAULT_LISTING_FEE_PERCENT = 2;
  private static readonly DEFAULT_SALE_TAX_PERCENT = 5;
  private static readonly DEFAULT_TAX_GUILD_SHARE_PERCENT = 50;
```

构造函数参数末尾追加两个依赖：

```ts
    private readonly riskGateService: RiskGateService,
    private readonly inventoryService: InventoryService,
    private readonly configService: ConfigManageService,
  ) {}
```

在 `// ===== Trade Order =====` 之前插入私有工具方法：

```ts
  private assertTradableCurrency(currencyType: string): void {
    if (!TradeService.TRADABLE_CURRENCIES.includes(currencyType)) {
      throw new GameException(
        ErrorCodes.TRADE_CURRENCY_NOT_ALLOWED,
        '该币种不可用于交易',
      );
    }
  }

  /** 读取百分比配置：配置缺失或值非法一律回退默认值，不阻断交易 */
  private async readPercent(key: string, fallback: number): Promise<number> {
    try {
      const { value } = await this.configService.getConfig(key);
      const percent = Number(value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        return fallback;
      }
      return percent;
    } catch {
      return fallback;
    }
  }

  /** 成交税反哺卖家所在帮派资金；失败只记 warning，不阻断成交 */
  private async recycleTaxToGuild(
    sellerId: string,
    amount: number,
    reason: string,
  ): Promise<void> {
    try {
      const guildRole = await this.socialService.getMyGuildRole(sellerId);
      if (!guildRole) return;
      await this.socialService.adjustGuildFund(
        sellerId,
        guildRole.guildId,
        amount,
        reason,
      );
    } catch (err) {
      this.logger.warn(
        `Guild tax recycle failed (seller=${sellerId}, amount=${amount}): ${
          (err as Error).message
        }`,
      );
    }
  }

  /**
   * 易物道具契约：{ "<道具模板id>": <正整数数量> }。
   * 该格式为本批首次定义，非法键/值一律拒绝。
   */
  private parseItemMap(
    json: Record<string, any>,
  ): Array<{ itemTemplateId: string; quantity: number }> {
    return Object.entries(json ?? {}).map(([itemTemplateId, raw]) => {
      const quantity = Number(raw);
      if (
        !/^\d+$/.test(itemTemplateId) ||
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        throw new GameException(
          ErrorCodes.PARAM_INVALID,
          '易物道具格式须为 {"道具模板id": 正整数数量}',
        );
      }
      return { itemTemplateId, quantity };
    });
  }
```

`trade.module.ts` 的 imports 数组追加：

```ts
    InventoryModule,
    ConfigManageModule,
```

顶部 import 补：

```ts
import { InventoryModule } from '@modules/inventory/inventory.module';
import { ConfigManageModule } from '@modules/config/config.module';
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd packages-game/game-server && npx jest src/modules/trade --silent
```

Expected: PASS（既有 6 个 trade spec + 新增 5 例全绿）。注意：本步 `createTradeOrder` 只加了币种校验，尚未托管库存，既有「创建订单」用例仍应通过。

- [ ] **Step 6: Commit**

```bash
git add packages-game/game-server/src/constants/error-codes.ts packages-game/game-server/src/modules/trade/trade.service.ts packages-game/game-server/src/modules/trade/trade.module.ts packages-game/game-server/src/modules/trade/trade.service.spec.ts
git commit -m "feat(trade): 交易币种白名单与远程费率读取基础设施"
```

---

## Task 3: 摆摊交易结算（挂单托管 / 成交结算 / 取消退货）

**Files:**
- Modify: `packages-game/game-server/src/modules/trade/trade.service.ts`
- Test: `packages-game/game-server/src/modules/trade/trade.service.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `trade.service.spec.ts` 的 `describe('TradeService', ...)` 内新增：

```ts
  describe('trade order settlement', () => {
    const order = {
      id: '1',
      sellerId: 'seller',
      buyerId: null,
      itemTemplateId: '100',
      itemName: '道具',
      quantity: 3,
      pricePerUnit: '100',
      currencyType: CurrencyType.GOLD,
      status: TradeStatus.PENDING,
    };

    it('should escrow seller inventory on createTradeOrder', async () => {
      tradeRepo.save.mockImplementation((data: any) =>
        Promise.resolve({ ...data, id: '1' }),
      );

      await service.createTradeOrder({
        sellerId: 'seller',
        itemTemplateId: '100',
        itemName: '道具',
        quantity: 3,
        pricePerUnit: '100',
        currencyType: CurrencyType.GOLD,
      });

      expect(inventoryService.removeUnboundItem).toHaveBeenCalledWith(
        'seller',
        '100',
        3,
        'trade.createTradeOrder',
      );
    });

    it('should return escrowed items when order save fails', async () => {
      tradeRepo.save.mockRejectedValue(new Error('db down'));

      await expect(
        service.createTradeOrder({
          sellerId: 'seller',
          itemTemplateId: '100',
          itemName: '道具',
          quantity: 3,
          pricePerUnit: '100',
          currencyType: CurrencyType.GOLD,
        }),
      ).rejects.toThrow('db down');

      expect(inventoryService.addItem).toHaveBeenCalledWith(
        'seller',
        '100',
        3,
        'trade.createTradeOrder.rollback',
      );
    });

    it('should settle payment, tax and item transfer on buy', async () => {
      tradeRepo.findOne.mockResolvedValue({ ...order });
      tradeRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.buyItem('buyer', '1');

      // 买家付 300，税 5% = 15，卖家到手 285
      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        'buyer',
        CurrencyType.GOLD,
        300,
        'trade_buy',
        'trade.buyItem',
        '1',
      );
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'seller',
        CurrencyType.GOLD,
        285,
        'trade_sell',
        'trade.buyItem',
        '1',
      );
      expect(inventoryService.addItem).toHaveBeenCalledWith(
        'buyer',
        '100',
        3,
        'trade.buyItem',
      );
    });

    it('should reject second buyer when status placeholder fails', async () => {
      tradeRepo.findOne.mockResolvedValue({ ...order });
      tradeRepo.update.mockResolvedValue({ affected: 0 } as any);

      await expect(service.buyItem('buyer2', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.TRADE_ALREADY_COMPLETED },
      });
      expect(economyService.deductCurrency).not.toHaveBeenCalled();
    });

    it('should refund buyer and restore status when settlement fails', async () => {
      tradeRepo.findOne.mockResolvedValue({ ...order });
      tradeRepo.update.mockResolvedValue({ affected: 1 } as any);
      economyService.deductCurrency.mockResolvedValue({
        balanceAfter: '700',
      } as any);
      economyService.addCurrency.mockRejectedValue(new Error('db down'));

      await expect(service.buyItem('buyer', '1')).rejects.toThrow('db down');

      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'buyer',
        CurrencyType.GOLD,
        300,
        'trade_buy_refund',
        'trade.buyItem.rollback',
        '1',
      );
      expect(tradeRepo.update).toHaveBeenLastCalledWith(
        { id: '1' },
        { status: TradeStatus.PENDING, buyerId: null },
      );
    });

    it('should return escrowed items on cancel', async () => {
      tradeRepo.findOne.mockResolvedValue({ ...order });
      tradeRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.cancelTradeOrder('seller', '1');

      expect(inventoryService.addItem).toHaveBeenCalledWith(
        'seller',
        '100',
        3,
        'trade.cancelTradeOrder',
      );
    });

    it('should reject cancel by non-owner', async () => {
      tradeRepo.findOne.mockResolvedValue({ ...order });

      await expect(
        service.cancelTradeOrder('other', '1'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.TRADE_NOT_OWNER },
      });
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd packages-game/game-server && npx jest src/modules/trade/trade.service.spec.ts --silent
```

Expected: FAIL —— 挂单未托管（`removeUnboundItem` 未被调用）、`buyItem` 未结算（`deductCurrency` 未被调用）。

- [ ] **Step 3: 实现摆摊结算**

把 `trade.service.ts` 的 `createTradeOrder`、`buyItem`、`cancelTradeOrder` 三个方法整体替换为：

```ts
  async createTradeOrder(params: CreateTradeParams): Promise<TradeOrder> {
    this.assertTradableCurrency(params.currencyType);

    // 挂单即托管卖家库存：绑定/禁交易道具在此被拒，且防同一道具重复挂单
    await this.inventoryService.removeUnboundItem(
      params.sellerId,
      params.itemTemplateId,
      params.quantity,
      'trade.createTradeOrder',
    );

    try {
      const order = this.tradeRepo.create({
        ...params,
        buyerId: null,
        status: TradeStatus.PENDING,
      });
      const saved = await this.tradeRepo.save(order);

      this.eventBus.emit(GameEvents.TRADE_CREATED, {
        tradeId: saved.id,
        sellerId: params.sellerId,
        itemName: params.itemName,
      });

      return saved;
    } catch (err) {
      await this.inventoryService.addItem(
        params.sellerId,
        params.itemTemplateId,
        params.quantity,
        'trade.createTradeOrder.rollback',
      );
      throw err;
    }
  }

  async buyItem(buyerId: string, tradeId: string): Promise<TradeOrder> {
    const order = await this.tradeRepo.findOne({ where: { id: tradeId } });
    if (!order) {
      throw new GameException(ErrorCodes.TRADE_NOT_FOUND, '交易订单不存在');
    }
    if (order.status !== TradeStatus.PENDING) {
      throw new GameException(ErrorCodes.TRADE_ALREADY_COMPLETED, '交易已结束');
    }
    if (order.sellerId === buyerId) {
      throw new GameException(ErrorCodes.TRADE_NOT_OWNER, '不能购买自己的商品');
    }

    const currency = order.currencyType as CurrencyType;
    const total = BigInt(order.pricePerUnit) * BigInt(order.quantity);
    const taxPercent = await this.readPercent(
      TradeService.SALE_TAX_KEY,
      TradeService.DEFAULT_SALE_TAX_PERCENT,
    );
    const guildSharePercent = await this.readPercent(
      TradeService.TAX_GUILD_SHARE_KEY,
      TradeService.DEFAULT_TAX_GUILD_SHARE_PERCENT,
    );
    const tax = (total * BigInt(taxPercent)) / BigInt(100);
    const toSeller = total - tax;
    // BigInt 整除余数归系统回收，保证「卖家到手 + 帮派 + 回收 = total」
    const guildShare = (tax * BigInt(guildSharePercent)) / BigInt(100);

    // 状态原子占位：并发双买只有一次能拿到 affected=1
    const claimed = await this.tradeRepo.update(
      { id: order.id, status: TradeStatus.PENDING },
      { status: TradeStatus.COMPLETED, buyerId },
    );
    if (!claimed.affected) {
      throw new GameException(ErrorCodes.TRADE_ALREADY_COMPLETED, '交易已结束');
    }

    let deducted = false;
    try {
      await this.economyService.deductCurrency(
        buyerId,
        currency,
        Number(total),
        'trade_buy',
        'trade.buyItem',
        order.id,
      );
      deducted = true;

      if (toSeller > BigInt(0)) {
        await this.economyService.addCurrency(
          order.sellerId,
          currency,
          Number(toSeller),
          'trade_sell',
          'trade.buyItem',
          order.id,
        );
      }
      if (guildShare > BigInt(0)) {
        await this.recycleTaxToGuild(
          order.sellerId,
          Number(guildShare),
          'trade_tax_guild',
        );
      }
      await this.inventoryService.addItem(
        buyerId,
        order.itemTemplateId,
        order.quantity,
        'trade.buyItem',
      );
    } catch (err) {
      // 补偿：已扣款则退款，并回滚状态占位，避免「钱扣了单还是完成」
      if (deducted) {
        await this.economyService.addCurrency(
          buyerId,
          currency,
          Number(total),
          'trade_buy_refund',
          'trade.buyItem.rollback',
          order.id,
        );
      }
      await this.tradeRepo.update(
        { id: order.id },
        { status: TradeStatus.PENDING, buyerId: null },
      );
      throw err;
    }

    this.eventBus.emit(GameEvents.TRADE_COMPLETED, {
      tradeId: order.id,
      sellerId: order.sellerId,
      buyerId,
    });

    order.buyerId = buyerId;
    order.status = TradeStatus.COMPLETED;
    return order;
  }

  async cancelTradeOrder(
    sellerId: string,
    tradeId: string,
  ): Promise<TradeOrder> {
    const order = await this.tradeRepo.findOne({ where: { id: tradeId } });
    if (!order) {
      throw new GameException(ErrorCodes.TRADE_NOT_FOUND, '交易订单不存在');
    }
    if (order.sellerId !== sellerId) {
      throw new GameException(ErrorCodes.TRADE_NOT_OWNER, '无权操作他人交易');
    }
    if (order.status !== TradeStatus.PENDING) {
      throw new GameException(ErrorCodes.TRADE_ALREADY_COMPLETED, '交易已结束');
    }

    // 原子占位：与 buyItem 竞争同一 PENDING 状态
    const claimed = await this.tradeRepo.update(
      { id: order.id, status: TradeStatus.PENDING },
      { status: TradeStatus.CANCELLED },
    );
    if (!claimed.affected) {
      throw new GameException(ErrorCodes.TRADE_ALREADY_COMPLETED, '交易已结束');
    }

    await this.inventoryService.addItem(
      sellerId,
      order.itemTemplateId,
      order.quantity,
      'trade.cancelTradeOrder',
    );

    order.status = TradeStatus.CANCELLED;
    return order;
  }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages-game/game-server && npx jest src/modules/trade --silent
```

Expected: PASS。若既有用例因 `tradeRepo.update` 未 mock 而报错，在该 spec 的 `getRepositoryToken(TradeOrder)` mock 中补 `update: jest.fn()`。

- [ ] **Step 5: Commit**

```bash
git add packages-game/game-server/src/modules/trade/trade.service.ts packages-game/game-server/src/modules/trade/trade.service.spec.ts
git commit -m "feat(trade): 摆摊交易挂单托管、成交结算与取消退货"
```

---

## Task 4: 拍卖结算（上架托管+手续费 / 成交结算 / 流拍退货）

**Files:**
- Modify: `packages-game/game-server/src/modules/trade/trade.service.ts`
- Test: `packages-game/game-server/src/modules/trade/trade.service.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `trade.service.spec.ts` 内新增：

```ts
  describe('auction settlement', () => {
    const auction = {
      id: '9',
      sellerId: 'seller',
      itemTemplateId: '100',
      itemName: '道具',
      quantity: 2,
      startPrice: '100',
      currentPrice: '150',
      currentBidderId: null,
      expireAt: new Date(Date.now() - 1000),
      isExclusive: false,
      status: AuctionStatus.LISTED,
    };

    it('should escrow items and charge listing fee on listAuction', async () => {
      auctionRepo.save.mockImplementation((data: any) =>
        Promise.resolve({ ...data, id: '9' }),
      );

      await service.listAuction({
        sellerId: 'seller',
        itemTemplateId: '100',
        itemName: '道具',
        quantity: 2,
        startPrice: '100',
        expireAt: new Date(Date.now() + 3600000),
      });

      expect(inventoryService.removeUnboundItem).toHaveBeenCalledWith(
        'seller',
        '100',
        2,
        'trade.listAuction',
      );
      // 起拍总额 200，上架费 2% = 4
      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        'seller',
        CurrencyType.GOLD,
        4,
        'auction_listing_fee',
        'trade.listAuction',
      );
    });

    it('should settle bidder payment and transfer item on endAuction', async () => {
      auctionRepo.findOne.mockResolvedValue({
        ...auction,
        currentBidderId: 'buyer',
        status: AuctionStatus.BID,
      });
      auctionRepo.update.mockResolvedValue({ affected: 1 } as any);

      const result = await service.endAuction('9');

      expect(result.status).toBe(AuctionStatus.SOLD);
      // 成交额 150*2 = 300，税 5% = 15，卖家到手 285
      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        'buyer',
        CurrencyType.GOLD,
        300,
        'auction_buy',
        'trade.endAuction',
        '9',
      );
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'seller',
        CurrencyType.GOLD,
        285,
        'auction_sell',
        'trade.endAuction',
        '9',
      );
      expect(inventoryService.addItem).toHaveBeenCalledWith(
        'buyer',
        '100',
        2,
        'trade.endAuction',
      );
    });

    it('should expire auction and return items when no bidder', async () => {
      auctionRepo.findOne.mockResolvedValue({ ...auction });
      auctionRepo.update.mockResolvedValue({ affected: 1 } as any);

      const result = await service.endAuction('9');

      expect(result.status).toBe(AuctionStatus.EXPIRED);
      expect(inventoryService.addItem).toHaveBeenCalledWith(
        'seller',
        '100',
        2,
        'trade.endAuction.expired',
      );
    });

    it('should expire auction and return items when bidder cannot pay', async () => {
      auctionRepo.findOne.mockResolvedValue({
        ...auction,
        currentBidderId: 'buyer',
        status: AuctionStatus.BID,
      });
      auctionRepo.update.mockResolvedValue({ affected: 1 } as any);
      economyService.deductCurrency.mockRejectedValue(
        new GameException(ErrorCodes.CURRENCY_NOT_ENOUGH, '货币不足'),
      );

      await expect(service.endAuction('9')).rejects.toMatchObject({
        response: { code: ErrorCodes.CURRENCY_NOT_ENOUGH },
      });
      expect(auctionRepo.update).toHaveBeenLastCalledWith(
        { id: '9' },
        { status: AuctionStatus.EXPIRED },
      );
      expect(inventoryService.addItem).toHaveBeenCalledWith(
        'seller',
        '100',
        2,
        'trade.endAuction.rollback',
      );
    });

    it('should reject double settlement', async () => {
      auctionRepo.findOne.mockResolvedValue({ ...auction });
      auctionRepo.update.mockResolvedValue({ affected: 0 } as any);

      await expect(service.endAuction('9')).rejects.toMatchObject({
        response: { code: ErrorCodes.AUCTION_ALREADY_ENDED },
      });
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd packages-game/game-server && npx jest src/modules/trade/trade.service.spec.ts --silent
```

Expected: FAIL —— `listAuction` 未托管未收费、`endAuction` 未结算。

- [ ] **Step 3: 实现拍卖结算**

把 `listAuction` 与 `endAuction` 整体替换为：

```ts
  async listAuction(params: ListAuctionParams): Promise<AuctionItem> {
    await this.riskGateService.assertAuction(params.sellerId, params.startPrice);
    const exclusive = params.exclusive ?? false;
    if (exclusive) {
      const access = await this.vipService.getPrivilegeValue(
        params.sellerId,
        'exclusiveAuctionRoom',
        0,
      );
      if (!Number(access)) {
        throw new GameException(
          ErrorCodes.VIP_AUCTION_ROOM_FORBIDDEN,
          '专属拍卖室需 VIP 特权',
        );
      }
    }

    // 上架即托管卖家库存（绑定/禁交易道具在此被拒）
    await this.inventoryService.removeUnboundItem(
      params.sellerId,
      params.itemTemplateId,
      params.quantity,
      'trade.listAuction',
    );

    // 上架手续费：按起拍总额百分比从卖家扣金币
    const listingBase = BigInt(params.startPrice) * BigInt(params.quantity);
    const feePercent = await this.readPercent(
      TradeService.LISTING_FEE_KEY,
      TradeService.DEFAULT_LISTING_FEE_PERCENT,
    );
    const fee = (listingBase * BigInt(feePercent)) / BigInt(100);

    let feeCharged = false;
    try {
      if (fee > BigInt(0)) {
        await this.economyService.deductCurrency(
          params.sellerId,
          CurrencyType.GOLD,
          Number(fee),
          'auction_listing_fee',
          'trade.listAuction',
        );
        feeCharged = true;
      }

      const item = this.auctionRepo.create({
        ...params,
        isExclusive: exclusive,
        currentPrice: params.startPrice,
        currentBidderId: null,
        status: AuctionStatus.LISTED,
      });
      const saved = await this.auctionRepo.save(item);

      this.eventBus.emit(GameEvents.AUCTION_LISTED, {
        auctionId: saved.id,
        sellerId: params.sellerId,
        itemName: params.itemName,
      });

      return saved;
    } catch (err) {
      await this.inventoryService.addItem(
        params.sellerId,
        params.itemTemplateId,
        params.quantity,
        'trade.listAuction.rollback',
      );
      if (feeCharged) {
        await this.economyService.addCurrency(
          params.sellerId,
          CurrencyType.GOLD,
          Number(fee),
          'auction_listing_fee_refund',
          'trade.listAuction.rollback',
        );
      }
      throw err;
    }
  }

  async endAuction(auctionId: string): Promise<AuctionItem> {
    const item = await this.auctionRepo.findOne({ where: { id: auctionId } });
    if (!item) {
      throw new GameException(ErrorCodes.AUCTION_NOT_FOUND, '拍卖物品不存在');
    }

    const bidderId = item.currentBidderId;
    const nextStatus = bidderId ? AuctionStatus.SOLD : AuctionStatus.EXPIRED;

    // 原子占位：仅 listed/bid 可结算，防重复结算
    const claimed = await this.auctionRepo.update(
      { id: item.id, status: In([AuctionStatus.LISTED, AuctionStatus.BID]) },
      { status: nextStatus },
    );
    if (!claimed.affected) {
      throw new GameException(ErrorCodes.AUCTION_ALREADY_ENDED, '拍卖已结束');
    }

    if (!bidderId) {
      await this.inventoryService.addItem(
        item.sellerId,
        item.itemTemplateId,
        item.quantity,
        'trade.endAuction.expired',
      );
      item.status = nextStatus;
      return item;
    }

    const total = BigInt(item.currentPrice) * BigInt(item.quantity);
    const taxPercent = await this.readPercent(
      TradeService.SALE_TAX_KEY,
      TradeService.DEFAULT_SALE_TAX_PERCENT,
    );
    const guildSharePercent = await this.readPercent(
      TradeService.TAX_GUILD_SHARE_KEY,
      TradeService.DEFAULT_TAX_GUILD_SHARE_PERCENT,
    );
    const tax = (total * BigInt(taxPercent)) / BigInt(100);
    const toSeller = total - tax;
    const guildShare = (tax * BigInt(guildSharePercent)) / BigInt(100);

    let deducted = false;
    try {
      await this.economyService.deductCurrency(
        bidderId,
        CurrencyType.GOLD,
        Number(total),
        'auction_buy',
        'trade.endAuction',
        item.id,
      );
      deducted = true;

      if (toSeller > BigInt(0)) {
        await this.economyService.addCurrency(
          item.sellerId,
          CurrencyType.GOLD,
          Number(toSeller),
          'auction_sell',
          'trade.endAuction',
          item.id,
        );
      }
      if (guildShare > BigInt(0)) {
        await this.recycleTaxToGuild(
          item.sellerId,
          Number(guildShare),
          'auction_tax_guild',
        );
      }
      await this.inventoryService.addItem(
        bidderId,
        item.itemTemplateId,
        item.quantity,
        'trade.endAuction',
      );
    } catch (err) {
      // 买家余额不足等 → 流拍并退回卖家库存
      if (deducted) {
        await this.economyService.addCurrency(
          bidderId,
          CurrencyType.GOLD,
          Number(total),
          'auction_buy_refund',
          'trade.endAuction.rollback',
          item.id,
        );
      }
      await this.auctionRepo.update(
        { id: item.id },
        { status: AuctionStatus.EXPIRED },
      );
      await this.inventoryService.addItem(
        item.sellerId,
        item.itemTemplateId,
        item.quantity,
        'trade.endAuction.rollback',
      );
      throw err;
    }

    item.status = AuctionStatus.SOLD;
    this.eventBus.emit(GameEvents.AUCTION_SOLD, {
      auctionId: item.id,
      sellerId: item.sellerId,
      buyerId: bidderId,
      finalPrice: item.currentPrice,
    });
    return item;
  }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages-game/game-server && npx jest src/modules/trade --silent
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages-game/game-server/src/modules/trade/trade.service.ts packages-game/game-server/src/modules/trade/trade.service.spec.ts
git commit -m "feat(trade): 拍卖上架托管与手续费、成交结算、流拍退货"
```

---

## Task 5: 拍卖到期自动结算定时任务

**Files:**
- Modify: `packages-game/game-server/src/modules/trade/trade.service.ts`
- Modify: `packages-game/game-server/src/scheduler/scheduler.service.ts`
- Modify: `packages-game/game-server/src/scheduler/scheduler.module.ts`
- Test: `packages-game/game-server/src/modules/trade/trade.service.spec.ts`

背景：`endAuction` 目前**没有任何调用方**（全库仅 `trade.service.ts` 定义 + `trade.service.spec.ts` 测试），拍卖挂单后永远不会结算。本 Task 补上生产触发路径。

- [ ] **Step 1: 写失败测试**

在 `trade.service.spec.ts` 内新增：

```ts
  describe('expired auction scan', () => {
    it('should return ids of listed/bid auctions whose expireAt has passed', async () => {
      auctionRepo.find.mockResolvedValue([
        { id: '9', status: AuctionStatus.LISTED },
        { id: '10', status: AuctionStatus.BID },
      ] as any);

      const ids = await service.listExpiredAuctionIds();

      expect(ids).toEqual(['9', '10']);
      const [arg] = auctionRepo.find.mock.calls[0];
      expect(arg.take).toBe(100);
      expect(arg.where.expireAt).toBeDefined();
    });

    it('should cap the scan batch size at the given limit', async () => {
      auctionRepo.find.mockResolvedValue([] as any);

      await service.listExpiredAuctionIds(5);

      const [arg] = auctionRepo.find.mock.calls[0];
      expect(arg.take).toBe(5);
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd packages-game/game-server && npx jest src/modules/trade/trade.service.spec.ts --silent
```

Expected: FAIL —— `service.listExpiredAuctionIds is not a function`。

- [ ] **Step 3: 实现扫描方法**

在 `trade.service.ts` 的 `endAuction` 方法之后插入：

```ts
  /** 到期拍卖 id 列表（供每分钟定时任务结算）；只取进行中的 listed/bid */
  async listExpiredAuctionIds(limit = 100): Promise<string[]> {
    const items = await this.auctionRepo.find({
      where: {
        status: In([AuctionStatus.LISTED, AuctionStatus.BID]),
        expireAt: LessThan(new Date()),
      },
      take: limit,
    });
    return items.map((it) => it.id);
  }
```

并把 `trade.service.ts` 的 typeorm import 补上 `LessThan`：

```ts
import { In, LessThan, Repository } from 'typeorm';
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages-game/game-server && npx jest src/modules/trade --silent
```

Expected: PASS。

- [ ] **Step 5: 接入定时任务**

`packages-game/game-server/src/scheduler/scheduler.service.ts`：顶部 import 补

```ts
import { TradeService } from '@modules/trade/trade.service';
```

构造函数参数末尾追加：

```ts
    private readonly reconcileService: ReconcileService,
    private readonly tradeService: TradeService,
  ) {}
```

在 `riskScan()` 之后追加：

```ts
  @Cron(CronExpression.EVERY_MINUTE)
  async settleExpiredAuctions() {
    try {
      const ids = await this.tradeService.listExpiredAuctionIds();
      for (const id of ids) {
        try {
          await this.tradeService.endAuction(id);
        } catch (err) {
          // 单个流拍/结算失败不阻断其余拍卖
          this.logger.error(
            `Auction settle failed (id=${id})`,
            (err as Error).message,
          );
        }
      }
      if (ids.length) {
        this.logger.log(`Auction settle done: ${ids.length} expired`);
      }
    } catch (err) {
      this.logger.error('Auction settle scan failed', (err as Error).message);
    }
  }
```

`packages-game/game-server/src/scheduler/scheduler.module.ts`：imports 数组追加 `TradeModule,`，顶部补

```ts
import { TradeModule } from '@modules/trade/trade.module';
```

- [ ] **Step 6: 跑测试与编译确认通过**

```bash
cd packages-game/game-server && npx jest src/scheduler src/modules/trade --silent
cd packages-game/game-server && npx tsc --noEmit
```

Expected: PASS，0 error。若 `scheduler` 无既有 spec，jest 只跑 trade 部分即可。

- [ ] **Step 7: Commit**

```bash
git add packages-game/game-server/src/modules/trade/trade.service.ts packages-game/game-server/src/modules/trade/trade.service.spec.ts packages-game/game-server/src/scheduler/scheduler.service.ts packages-game/game-server/src/scheduler/scheduler.module.ts
git commit -m "feat(trade): 拍卖到期自动结算定时任务（endAuction 接入生产路径）"
```

---

## Task 6: 易物结算（格式契约 + 双向转移）

**Files:**
- Modify: `packages-game/game-server/src/modules/trade/dto/barter.dto.ts`
- Modify: `packages-game/game-server/src/modules/trade/trade.service.ts`
- Test: `packages-game/game-server/src/modules/trade/trade.service.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `trade.service.spec.ts` 内新增：

```ts
  describe('barter settlement', () => {
    it('should escrow party A items and gold on createBarter', async () => {
      barterRepo.save.mockImplementation((data: any) =>
        Promise.resolve({ ...data, id: '7' }),
      );

      await service.createBarter('a', { '100': 2 }, '50');

      expect(inventoryService.removeUnboundItem).toHaveBeenCalledWith(
        'a',
        '100',
        2,
        'trade.createBarter',
      );
      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        'a',
        CurrencyType.GOLD,
        50,
        'barter_hold',
        'trade.createBarter',
      );
    });

    it('should reject illegal item map format', async () => {
      await expect(
        service.createBarter('a', { abc: 1 } as any, '0'),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.PARAM_INVALID } });
      expect(inventoryService.removeUnboundItem).not.toHaveBeenCalled();
    });

    it('should transfer items both ways on acceptBarter', async () => {
      barterRepo.findOne.mockResolvedValue({
        id: '7',
        partyAId: 'a',
        partyBId: null,
        itemsAJson: { '100': 2 },
        itemsBJson: {},
        goldAmount: '50',
        aConfirm: true,
        bConfirm: false,
        status: BarterStatus.PENDING,
      } as any);
      barterRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.acceptBarter('b', '7', { '200': 1 });

      expect(inventoryService.removeUnboundItem).toHaveBeenCalledWith(
        'b',
        '200',
        1,
        'trade.acceptBarter',
      );
      expect(inventoryService.addItem).toHaveBeenCalledWith(
        'b',
        '100',
        2,
        'trade.acceptBarter',
      );
      expect(inventoryService.addItem).toHaveBeenCalledWith(
        'a',
        '200',
        1,
        'trade.acceptBarter',
      );
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'b',
        CurrencyType.GOLD,
        50,
        'barter_release',
        'trade.acceptBarter',
        '7',
      );
    });

    it('should refund party B items when placeholder fails', async () => {
      barterRepo.findOne.mockResolvedValue({
        id: '7',
        partyAId: 'a',
        partyBId: null,
        itemsAJson: {},
        itemsBJson: {},
        goldAmount: '0',
        aConfirm: true,
        bConfirm: false,
        status: BarterStatus.PENDING,
      } as any);
      barterRepo.update.mockResolvedValue({ affected: 0 } as any);

      await expect(
        service.acceptBarter('b', '7', { '200': 1 }),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.BARTER_CONFIRM_MISMATCH },
      });
      expect(inventoryService.addItem).toHaveBeenCalledWith(
        'b',
        '200',
        1,
        'trade.acceptBarter.rollback',
      );
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd packages-game/game-server && npx jest src/modules/trade/trade.service.spec.ts --silent
```

Expected: FAIL —— `createBarter` 未托管、`acceptBarter` 未转移。

- [ ] **Step 3: 固化 DTO 契约注释**

把 `barter.dto.ts` 整体替换为：

```ts
import { IsObject, IsString } from 'class-validator';

/**
 * 易物道具契约：{ "<道具模板id>": <正整数数量> }
 * 例：{ "1001": 3, "1002": 1 } 表示 3 个模板 1001、1 个模板 1002。
 * 非法键/值在 TradeService.parseItemMap 处抛 PARAM_INVALID。
 */
export class CreateBarterDto {
  @IsObject()
  itemsAJson: Record<string, any>;

  @IsString()
  goldAmount: string;
}

export class AcceptBarterDto {
  @IsObject()
  itemsBJson: Record<string, any>;
}
```

- [ ] **Step 4: 实现易物结算**

把 `createBarter` 与 `acceptBarter` 整体替换为：

```ts
  async createBarter(
    partyAId: string,
    itemsAJson: Record<string, any>,
    goldAmount: string,
  ): Promise<BarterDeal> {
    const itemsA = this.parseItemMap(itemsAJson);
    const gold = BigInt(goldAmount || '0');
    if (gold < BigInt(0)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '金币数量不能为负');
    }

    const escrowed: Array<{ itemTemplateId: string; quantity: number }> = [];
    let goldHeld = false;
    try {
      for (const it of itemsA) {
        await this.inventoryService.removeUnboundItem(
          partyAId,
          it.itemTemplateId,
          it.quantity,
          'trade.createBarter',
        );
        escrowed.push(it);
      }
      if (gold > BigInt(0)) {
        await this.economyService.deductCurrency(
          partyAId,
          CurrencyType.GOLD,
          Number(gold),
          'barter_hold',
          'trade.createBarter',
        );
        goldHeld = true;
      }

      const deal = this.barterRepo.create({
        partyAId,
        partyBId: null,
        itemsAJson,
        itemsBJson: {},
        goldAmount,
        aConfirm: true,
        bConfirm: false,
        status: BarterStatus.PENDING,
      });
      return await this.barterRepo.save(deal);
    } catch (err) {
      for (const it of escrowed) {
        await this.inventoryService.addItem(
          partyAId,
          it.itemTemplateId,
          it.quantity,
          'trade.createBarter.rollback',
        );
      }
      if (goldHeld) {
        await this.economyService.addCurrency(
          partyAId,
          CurrencyType.GOLD,
          Number(gold),
          'barter_hold_refund',
          'trade.createBarter.rollback',
        );
      }
      throw err;
    }
  }

  async acceptBarter(
    partyBId: string,
    barterId: string,
    itemsBJson: Record<string, any>,
  ): Promise<BarterDeal> {
    const deal = await this.barterRepo.findOne({ where: { id: barterId } });
    if (!deal || deal.status !== BarterStatus.PENDING) {
      throw new GameException(
        ErrorCodes.BARTER_NOT_FOUND,
        '易物记录不存在或已结束',
      );
    }
    if (deal.partyAId === partyBId || deal.bConfirm) {
      throw new GameException(
        ErrorCodes.BARTER_CONFIRM_MISMATCH,
        '易物确认不匹配',
      );
    }

    const itemsA = this.parseItemMap(deal.itemsAJson);
    const itemsB = this.parseItemMap(itemsBJson);

    // 先扣 B 侧（可能因绑定/不足失败），扣减阶段失败无副作用
    const escrowedB: Array<{ itemTemplateId: string; quantity: number }> = [];
    try {
      for (const it of itemsB) {
        await this.inventoryService.removeUnboundItem(
          partyBId,
          it.itemTemplateId,
          it.quantity,
          'trade.acceptBarter',
        );
        escrowedB.push(it);
      }
    } catch (err) {
      for (const it of escrowedB) {
        await this.inventoryService.addItem(
          partyBId,
          it.itemTemplateId,
          it.quantity,
          'trade.acceptBarter.rollback',
        );
      }
      throw err;
    }

    // 原子占位：并发重复接受只有一次成功
    const claimed = await this.barterRepo.update(
      { id: deal.id, status: BarterStatus.PENDING, bConfirm: false },
      {
        status: BarterStatus.COMPLETED,
        partyBId,
        bConfirm: true,
        itemsBJson,
      },
    );
    if (!claimed.affected) {
      for (const it of escrowedB) {
        await this.inventoryService.addItem(
          partyBId,
          it.itemTemplateId,
          it.quantity,
          'trade.acceptBarter.rollback',
        );
      }
      throw new GameException(
        ErrorCodes.BARTER_CONFIRM_MISMATCH,
        '易物确认不匹配',
      );
    }

    // 发放阶段：addItem/addCurrency 失败概率极低，失败只记 warning 不回滚（避免逆向收道具引发二次不一致）
    try {
      for (const it of itemsA) {
        await this.inventoryService.addItem(
          partyBId,
          it.itemTemplateId,
          it.quantity,
          'trade.acceptBarter',
        );
      }
      for (const it of itemsB) {
        await this.inventoryService.addItem(
          deal.partyAId,
          it.itemTemplateId,
          it.quantity,
          'trade.acceptBarter',
        );
      }
      const gold = BigInt(deal.goldAmount || '0');
      if (gold > BigInt(0)) {
        await this.economyService.addCurrency(
          partyBId,
          CurrencyType.GOLD,
          Number(gold),
          'barter_release',
          'trade.acceptBarter',
          deal.id,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Barter release failed (barter=${deal.id}): ${(err as Error).message}`,
      );
    }

    this.eventBus.emit(GameEvents.BARTER_COMPLETED, { playerId: partyBId });
    this.eventBus.emit(GameEvents.TRADE_COMPLETED, {
      barterId: deal.id,
      partyAId: deal.partyAId,
      partyBId,
      kind: 'barter',
    });

    deal.partyBId = partyBId;
    deal.itemsBJson = itemsBJson;
    deal.bConfirm = true;
    deal.status = BarterStatus.COMPLETED;
    return deal;
  }
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd packages-game/game-server && npx jest src/modules/trade --silent
```

Expected: PASS。若既有 `acceptBarter` 用例（`barter.service.spec.ts`）因新增 `barterRepo.update` 调用而失败，在该 spec 的 `BarterDeal` repo mock 中补 `update: jest.fn().mockResolvedValue({ affected: 1 })`。

- [ ] **Step 6: Commit**

```bash
git add packages-game/game-server/src/modules/trade/dto/barter.dto.ts packages-game/game-server/src/modules/trade/trade.service.ts packages-game/game-server/src/modules/trade/trade.service.spec.ts
git commit -m "feat(trade): 易物格式契约与双向物品/金币结算"
```

---

## Task 7: 全量回归、冒烟脚本与文档同步

**Files:**
- Create: `packages-game/game-server/scripts/smoke-p07-trade.sh`
- Modify: `docs/superpowers/specs/2026-09-20-game-server-completeness-inventory-design.md`

- [ ] **Step 1: 全量测试与编译**

```bash
cd packages-game/game-server && npm test
cd packages-game/game-server && npx tsc --noEmit
```

Expected: 全部 suite 绿（预期 ≥ 80 suites / ≥ 980 tests），0 error。

- [ ] **Step 2: 创建冒烟脚本**

创建 `packages-game/game-server/scripts/smoke-p07-trade.sh`：

```bash
#!/bin/bash
# P0-7 交易经济结算冒烟 · 绑定拒挂单 / 成交结算与税 / 取消退货 / 拍卖流拍
# Run on odoo: ADMIN_PASS 自动来自 .env.prod
BASE=http://127.0.0.1:3000
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1 | body: $2"; }

jstr() { echo "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"; }
want_code() { echo "$2" | grep -qE "\"code\"[[:space:]]*:[[:space:]]*$3" && ok "$1" || bad "$1 (want code=$3)" "$2"; }

# 直连生产库取确定值（余额/库存/状态断言不依赖响应体形状），沿用 smoke-eco.sh 的 PSQL 模式
CONTAINER=1Panel-postgresql-4LsS
PSQL() { docker exec -e PGCLIENTENCODING=UTF8 "$CONTAINER" psql -U game -d game_server -t -A -c "$1"; }
GOLD_OF() { PSQL "SELECT amount FROM player_currencies WHERE player_id=$1 AND currency_type='gold';"; }
INV_OF() { PSQL "SELECT quantity FROM inventory_items WHERE player_id=$1 AND item_template_id=$2 AND bind_status='unbound' AND deleted_at IS NULL;"; }
want_eq() { [ "$2" = "$3" ] && ok "$1 ($3)" || bad "$1 want=$3 got=${2:-none}"; }

ADMIN_PASS=$(grep '^ADMIN_DEFAULT_PASSWORD=' /opt/game-server/.env.prod | cut -d= -f2-)
ADMIN_LOGIN=$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}")
ADMIN_TOKEN=$(jstr "$ADMIN_LOGIN" token)
if [ -n "$ADMIN_TOKEN" ]; then ok "admin login"; else bad "admin login" "$ADMIN_LOGIN"; exit 1; fi
AT="Authorization: Bearer $ADMIN_TOKEN"

TS=$(date +%s)
reg() {
  curl -s -X POST $BASE/api/client/v1/auth/register -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"Smoke123!\",\"nickname\":\"$1\",\"deviceId\":\"p07-dev\"}"
}
U1="p07_a_$TS"; U2="p07_b_$TS"
R=$(reg "$U1"); T1=$(jstr "$R" token); P1=$(jstr "$R" playerId)
[ -n "$T1" ] && ok "register A (player=$P1)" || bad "register A" "$R"
sleep 15
R=$(reg "$U2"); T2=$(jstr "$R" token); P2=$(jstr "$R" playerId)
[ -n "$T2" ] && ok "register B (player=$P2)" || bad "register B" "$R"
A1="Authorization: Bearer $T1"
A2="Authorization: Bearer $T2"

# 造道具模板：真实路由是 POST /api/admin/v1/inventory/item-template（非 /template）
NEW_TPL() { # <name> <canTrade> -> echoes template id
  curl -s -X POST $BASE/api/admin/v1/inventory/item-template -H "$AT" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$1\",\"itemType\":\"material\",\"rarity\":\"common\",\"maxStack\":99,\"sellPrice\":\"10\",\"canTrade\":$2,\"canDrop\":true,\"bindType\":\"none\"}" >/dev/null
  PSQL "SELECT id FROM item_templates WHERE name='$1' ORDER BY id DESC LIMIT 1;"
}
# 发道具：无 GM 发放接口，直插 inventory_items（列名同 InventoryItem 实体）
GRANT_ITEM() { # <playerId> <templateId> <qty> <bindStatus>
  PSQL "INSERT INTO inventory_items (player_id,item_template_id,quantity,slot_index,bind_status,created_at,updated_at) VALUES ($1,$2,$3,0,'$4',now(),now());" >/dev/null
}
# 发金币：真实路由是 PUT /api/admin/v1/player/:id/currency
GRANT_GOLD() { # <playerId> <amount>
  curl -s -X PUT $BASE/api/admin/v1/player/$1/currency -H "$AT" -H 'Content-Type: application/json' \
    -d "{\"currencyType\":\"gold\",\"amount\":$2,\"operation\":\"add\",\"reason\":\"smoke-p07\"}" >/dev/null
}

TPL_ID=$(NEW_TPL "P07道具_$TS" true)
[ -n "$TPL_ID" ] && ok "create tradable template (id=$TPL_ID)" || bad "create tradable template" "$TPL_ID"
TPL_NOTRADE=$(NEW_TPL "P07禁交易_$TS" false)
[ -n "$TPL_NOTRADE" ] && ok "create non-tradable template (id=$TPL_NOTRADE)" || bad "create non-tradable template" "$TPL_NOTRADE"
TPL_BOUND=$(NEW_TPL "P07绑定_$TS" true)
[ -n "$TPL_BOUND" ] && ok "create bound-only template (id=$TPL_BOUND)" || bad "create bound-only template" "$TPL_BOUND"

GRANT_ITEM $P1 $TPL_ID 10 unbound
GRANT_ITEM $P1 $TPL_NOTRADE 1 unbound
GRANT_ITEM $P1 $TPL_BOUND 1 bound
GRANT_GOLD $P1 1000
GRANT_GOLD $P2 1000
want_eq "seller seeded 10 unbound" "$(INV_OF $P1 $TPL_ID)" 10
want_eq "seller seeded 1000 gold" "$(GOLD_OF $P1)" 1000
want_eq "buyer seeded 1000 gold" "$(GOLD_OF $P2)" 1000

echo "== T1 挂单托管库存 =="
R=$(curl -s -X POST $BASE/api/client/v1/trade/order -H "$A1" -H 'Content-Type: application/json' \
  -d "{\"itemTemplateId\":\"$TPL_ID\",\"itemName\":\"P07道具\",\"quantity\":4,\"pricePerUnit\":\"100\",\"currencyType\":\"gold\"}")
ORDER_ID=$(jstr "$R" id)
[ -n "$ORDER_ID" ] && ok "create trade order (id=$ORDER_ID)" || bad "create trade order" "$R"
want_eq "escrow deducted seller to 6" "$(INV_OF $P1 $TPL_ID)" 6

echo "== T2 币种白名单与绑定判定 =="
R=$(curl -s -X POST $BASE/api/client/v1/trade/order -H "$A1" -H 'Content-Type: application/json' \
  -d "{\"itemTemplateId\":\"$TPL_ID\",\"itemName\":\"P07道具\",\"quantity\":1,\"pricePerUnit\":\"100\",\"currencyType\":\"favor\"}")
want_code "social currency rejected" "$R" 70008
R=$(curl -s -X POST $BASE/api/client/v1/trade/order -H "$A1" -H 'Content-Type: application/json' \
  -d "{\"itemTemplateId\":\"$TPL_ID\",\"itemName\":\"P07道具\",\"quantity\":1,\"pricePerUnit\":\"100\",\"currencyType\":\"bound_diamond\"}")
want_code "bound diamond rejected" "$R" 70008
R=$(curl -s -X POST $BASE/api/client/v1/trade/order -H "$A1" -H 'Content-Type: application/json' \
  -d "{\"itemTemplateId\":\"$TPL_NOTRADE\",\"itemName\":\"P07禁交易\",\"quantity\":1,\"pricePerUnit\":\"100\",\"currencyType\":\"gold\"}")
want_code "non-tradable template rejected" "$R" 20005
R=$(curl -s -X POST $BASE/api/client/v1/trade/order -H "$A1" -H 'Content-Type: application/json' \
  -d "{\"itemTemplateId\":\"$TPL_BOUND\",\"itemName\":\"P07绑定\",\"quantity\":1,\"pricePerUnit\":\"100\",\"currencyType\":\"gold\"}")
want_code "bound-only stack rejected" "$R" 20003
want_eq "rejections left inventory untouched" "$(INV_OF $P1 $TPL_ID)" 6

echo "== T3 成交结算（买家付 400 / 卖家到手 380 / 买家收货 4）=="
R=$(curl -s -X POST $BASE/api/client/v1/trade/order/$ORDER_ID/buy -H "$A2")
echo "$R" | grep -q '"status":"completed"' && ok "buy completed" || bad "buy completed" "$R"
want_eq "buyer paid 400 (1000->600)" "$(GOLD_OF $P2)" 600
# 成交税 5% = 20，帮派分成为 0（卖家无帮派，差额归系统回收），卖家到手 380
want_eq "seller received 380 (1000->1380)" "$(GOLD_OF $P1)" 1380
want_eq "buyer received 4 items" "$(INV_OF $P2 $TPL_ID)" 4

echo "== T4 二次购买被拒 =="
R=$(curl -s -X POST $BASE/api/client/v1/trade/order/$ORDER_ID/buy -H "$A2")
want_code "second buy rejected" "$R" 70003
want_eq "buyer not charged twice" "$(GOLD_OF $P2)" 600

echo "== T5 取消退货 =="
R=$(curl -s -X POST $BASE/api/client/v1/trade/order -H "$A1" -H 'Content-Type: application/json' \
  -d "{\"itemTemplateId\":\"$TPL_ID\",\"itemName\":\"P07道具\",\"quantity\":2,\"pricePerUnit\":\"50\",\"currencyType\":\"gold\"}")
O2=$(jstr "$R" id)
want_eq "second order escrowed to 4" "$(INV_OF $P1 $TPL_ID)" 4
curl -s -X POST $BASE/api/client/v1/trade/order/$O2/cancel -H "$A1" >/dev/null
want_eq "cancel returned items to 6" "$(INV_OF $P1 $TPL_ID)" 6

echo "== T6 拍卖：上架托管+上架费 → 到期流拍退货 =="
GOLD_BEFORE=$(GOLD_OF $P1)
EXPIRED_AT=$(date -u -d '-60 seconds' +%Y-%m-%dT%H:%M:%SZ)
R=$(curl -s -X POST $BASE/api/client/v1/trade/auction -H "$A1" -H 'Content-Type: application/json' \
  -d "{\"itemTemplateId\":\"$TPL_ID\",\"itemName\":\"P07道具\",\"quantity\":2,\"startPrice\":\"100\",\"expireAt\":\"$EXPIRED_AT\"}")
AUC_ID=$(jstr "$R" id)
[ -n "$AUC_ID" ] && ok "list auction (id=$AUC_ID)" || bad "list auction" "$R"
want_eq "auction escrowed seller to 4" "$(INV_OF $P1 $TPL_ID)" 4
# 上架费 2% × (100×2) = 4 金币
want_eq "listing fee charged 4 gold" "$(GOLD_OF $P1)" "$((GOLD_BEFORE - 4))"
want_eq "auction row is listed" "$(PSQL "SELECT status FROM auction_items WHERE id=$AUC_ID;")" listed

echo "  等待定时任务结算到期拍卖（约 70s）..."
sleep 70
want_eq "auction auto expired" "$(PSQL "SELECT status FROM auction_items WHERE id=$AUC_ID;")" expired
want_eq "expired auction returned items to 6" "$(INV_OF $P1 $TPL_ID)" 6

echo "=============================="
echo "SMOKE P0-7 RESULT: PASS=$PASS FAIL=$FAIL"
```

注意：脚本依赖生产库容器 `1Panel-postgresql-4LsS`（用户 `game`/库 `game_server`），与 `smoke-eco.sh` 同一前提；`INV_OF`/`GOLD_OF` 只取 `unbound` 未软删行，避免误判。本批只创建脚本，**不执行**（需先部署新 dist 并重启，再跑本脚本）。

- [ ] **Step 3: 同步盘点报告**

编辑 `docs/superpowers/specs/2026-09-20-game-server-completeness-inventory-design.md`：

（1）P0 表中 `P0-7` 行的「项」列追加「（已修复）」；
（2）P0 表下方新增「修复进度（2026-09-21，第四批）」段落：P0-7 已修复（代码层，未部署），计划文件名、提交列表、测试账目、上线前存量数据排查 SQL；
（3）§7 风险条目 1 的已修复计数更新为 7/8。

```bash
git add docs/superpowers/specs/2026-09-20-game-server-completeness-inventory-design.md
git commit -m "docs: P0-7 完成后同步盘点报告进度"
```

- [ ] **Step 4: 提交冒烟脚本与计划文件**

```bash
git add packages-game/game-server/scripts/smoke-p07-trade.sh docs/superpowers/plans/2026-09-21-trade-economy-settlement-fix.md
git commit -m "chore(trade): P0-7 交易结算冒烟脚本与实施计划"
```

- [ ] **Step 5: 推送**

```bash
git push origin main
```

---

## 执行记录（2026-09-21 执行，子代理驱动）

| Task | 提交 | 文件 | 说明 |
|---|---|---|---|
| 计划 | `e0c6070c1` | 本文件 | 自检后补入 Task 5（拍卖到期结算）与真实 GM 路由修正 |
| 1 | `d5fdebf9d` | `inventory.service.ts` / `.spec.ts` | 纯新增 82 行 `removeUnboundItem`，`removeItem` 未动；inventory 20 tests |
| 2 | `551294f85` | `error-codes.ts` / `trade.service.ts` / `trade.module.ts` / 6 个 spec | 70008 + 币种白名单 + 费率读取 + 4 个私有方法 |
| 3 | `4519e98bb` | `trade.service.ts` / `trade.service.spec.ts` / `negotiation.service.spec.ts` | 摆摊挂单托管、成交结算、取消退货 |
| 4 | `d62989d3d` | `trade.service.ts` / `trade.service.spec.ts` | 拍卖上架托管+上架费、成交结算、流拍退货 |
| 5 | `6ab1a7fc0` | `trade.service.ts` / `.spec.ts` / `scheduler.service.ts` / `scheduler.module.ts` | 拍卖到期自动结算定时任务（`endAuction` 接入生产路径） |
| 6 | `c2914d2b3` | `barter.dto.ts` / `trade.service.ts` / `trade.service.spec.ts` / `barter.service.spec.ts` | 易物格式契约 + 双向物品/金币转移 |
| 7 | （本轮） | `scripts/smoke-p07-trade.sh` / 盘点报告 / 本文件 | 全量回归 + 冒烟脚本 + 文档同步 + push |

**测试账目**：起 80 suites / 960 tests → 收 **80 suites / 987 tests 全绿**（+27 例：inventory 4 + trade 基础设施 5 + 摆摊 7 + 拍卖 5 + 拍卖扫描 2 + 易物 4），`npx tsc --noEmit` 0 error。

**执行偏离**：
1. Task 2：计划漏列 5 个共用 `TradeService` 的 spec（escrow/barter/negotiation/bounty/credit）需补 `InventoryService`/`ConfigManageService` provider，否则注入新依赖后全部 `Nest can't resolve dependencies`；已补齐（4 个还需补 `GameException` import）。
2. Task 2：`tsconfig` 未开 `noUnusedLocals`，但为免死导入，`In` 延到 Task 4 需要时才加（计划原写 Task 2 就导入）。
3. Task 2：`createTradeOrder` 里的 `assertTradableCurrency(params.currencyType)` 调用，计划只在 Step 5 文字里隐含，已按 Step 5 与测试要求置入 `tradeRepo.create` 之前。核实 `CreateTradeParams.currencyType` 为必填、controller 已 `?? 'gold'`，无需额外兜底。
4. Task 3：补偿用例原计划用 `addCurrency.mockRejectedValue`（会连退款一起拒、状态回滚断言失效），改为 `mockRejectedValueOnce`。
5. Task 3 额外改 `negotiation.service.spec.ts`：`acceptNegotiation` 内部调 `buyItem`，5 个用例因缺 `tradeRepo.update` mock 而失败。
6. Task 6 两处加固：占位条件增加 `aConfirm: true`（保留原「A 侧未确认不成交」防护，避免凭空发道具）；`BigInt(goldAmount)` 包 try/catch 转 `PARAM_INVALID`（避免非法字符串 500）。
7. Task 7 冒烟脚本：计划原写的 4 个路由是编造的，已按实际代码改正（见 §文件结构 与脚本注释）。

**已验证的非问题**：子代理提出 `AuctionItem.expireAt` 为无时区 `timestamp`、`LessThan(new Date())` 可能时区偏移。核实结论为**无偏移**：pg driver 将 `Date` 参数序列化为 UTC ISO 串、`timestamp` 列直接截取该 UTC 值，与 DB 容器（UTC）的 `now()` 同源；项目内 `activity.service.ts:574`、`balance-audit.service.ts:237` 等处已有同口径注释确认。

**未完成 / 待办**：生产部署（存量 `trade_orders`/`auction_items`/`barter_deals` 排查后替换 dist 重启）、冒烟脚本未执行。
