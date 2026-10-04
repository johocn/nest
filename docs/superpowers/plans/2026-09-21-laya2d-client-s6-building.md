# LayaAir 2D 建造系统 S6 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（沿用 S2/S3/S4 的既定方式）。

**Goal:** 落地总纲 §9 的**三种建造模式**（`solo` 单独建造 / `coop` 共同建造 / `forbidden` 不允许建造），做到「地块占用、材料扣减、建造中→落成、共建投料与超时退款、拆除」全部**服务端权威**，客户端只做预览态与进度表现。

**Architecture:** 新增 5 张表（规则/蓝图/地块/实例/共建流水）→ 服务端接口（`world/client/v1/world/buildings/*`）做「校验 → 扣料 → 建实例(`state=building`) → 记录」→ 1 分钟定时任务结算 `building → built` 并**通过 EventBus → gateway 向 `scene:<id>` 房间广播 `world.entity_update`（`entityType='building'`）** → 客户端按 `EntityRegistry.upsert` 建/更新实体（复用 §9 已有语义，不新增推送机制）。

---

## 0. 执行前必读（硬约束）

1. **不准碰 vendure**；2G 服务器（odoo）**禁止构建**，构建本地完成、只上传产物。
2. **不新增依赖**；扣料**只调用既有服务**（`InventoryService.removeItem` / `EconomyService.deductCurrency`），禁止自行写 SQL 改背包/货币。
3. **不改旧契约**：`world.move` / `world.enter-scene` / `world.entity_update` 的既有字段零改动；建造广播**沿用同一事件名与结构**，只多一个 `entityType='building'`。
4. **命名避让**：`social` 模块已有 **`guild_building`** 表（帮派建筑等级，错误码 `GUILD_BUILDING_EXISTS:91205` / `GUILD_BUILDING_LEVEL_CAP:91206`）——本批新表一律用 `building_*` / `scene_*` 前缀，**不得复用/改名该实体**。
5. 全部提交遵守 commitlint，单次提交聚焦一个任务。
6. 范围只做建造（含共建与拆除）；建筑产出/仓储/增益**效果生效**不在本批（见 §1.7）。

---

## 1. 设计

### 1.1 缺口盘点

| # | 缺口 | 现状 | S6 处置 |
|---|---|---|---|
| 1 | 无建造规则表 | 只有帮派级 `guild_building` | 新增 `scene_build_rules`（场景唯一，承载 three-mode） |
| 2 | 无建筑蓝图 | 无 | 新增 `building_templates` |
| 3 | 无地块与实例 | 无 | 新增 `scene_land_plots` + `building_instances` |
| 4 | 无共建流水 | 无 | 新增 `building_coop_contributions` |
| 5 | 建造中→落成无结算 | 无 | 1 分钟定时任务（先例：`settleExpiredAuctions`） |
| 6 | 无建造广播 | 广播只有 `player:*` | 新增 EventBus 事件 → gateway 房间广播（先例：`PLAYER_OFFLINE_SYNC`） |
| 7 | 客户端无建造面板 | 无 | 引擎内自绘面板 + 半透明预览（S3 决策：引擎内 UI） |
| 8 | 扣料/退款原子性 | 无并发保护先例在建造域 | 复用 `CacheService.withLock`（背包/货币服务内部已用锁） |

### 1.2 已核实的事实（实现时不要再猜）

**扣料与发料（已核实签名）**
- `InventoryService.removeItem(playerId, itemTemplateId, quantity, opTrace)`（[inventory.service.ts:115](file:///e:/code/nest/packages-game/game-server/src/modules/inventory/inventory.service.ts#L115)）→ 自带 `lock:item:<playerId>:<templateId>` 锁、写 `PlayerItemChangeLog`（`ItemChangeType.REMOVE`）、发 `ITEM_CONSUMED`；不足抛 `ITEM_NOT_ENOUGH:20002`。
- `InventoryService.addItem(playerId, itemTemplateId, quantity, opTrace)`（[inventory.service.ts:40](file:///e:/code/nest/packages-game/game-server/src/modules/inventory/inventory.service.ts#L40)）→ 背包满抛 `BAG_FULL`。
  - ⚠️ **回滚注意**：`addItem` 也可能失败（背包满）→ 退款路径必须**先加后删**或失败时再退一次，见 §3 风险 2。
- `EconomyService.deductCurrency(playerId, currencyType, amount, source, opTrace, relatedId?)`（[economy.service.ts:104](file:///e:/code/nest/packages-game/game-server/src/modules/economy/economy.service.ts#L104)）/ `addCurrency`（:42）→ 自带 `lock:currency:<playerId>:<type>` 锁。
- 先例：`WorldService.startGame` 用 `deductCurrency(..., 'street_game', 'game:<id>:start', gameId)`（[world.service.ts:374-381](file:///e:/code/nest/packages-game/game-server/src/modules/world/world.service.ts#L374-L381)）——**`source`+`opTrace`+`relatedId` 三件套必须照抄**，以便对账。

**广播先例（已核实）**
- `GameGateway` 用 `@OnEvent(GameEvents.PLAYER_OFFLINE_SYNC)` 接收事件后 `this.server.to(socketId).emit(...)`（[game.gateway.ts:121-132](file:///e:/code/nest/packages-game/game-server/src/modules/gateway/game.gateway.ts#L121-L132)）→ **REST → EventBus → gateway 房间广播的链路成立**，S6 照此实现（避免 controller 直接依赖 gateway）。
- 广播帧结构（必须逐字对齐，[game.gateway.ts:224-237](file:///e:/code/nest/packages-game/game-server/src/modules/gateway/game.gateway.ts#L224-L237)）：`{cmd:'world.entity_update', seq:0, code:0, msg:'success', data:{entityId, entityType, playerId, pos:{x,y}, rotation, state}}`。建造广播：`entityId='building:<instanceId>'`、`entityType='building'`、`state='building'|'built'|'demolishing'`、`pos={x,y}`（建筑中心点）。
- 客户端 `EntityRegistry.upsert(entityId, pos, create)` **已支持 upsert 语义**（[EntityRegistry.ts:25-34](file:///e:/code/nest/packages-game/game-client/src/entity/EntityRegistry.ts#L25-L34)）→ 建造广播无需客户端新增寻址机制。

**定时任务先例（已核实）**
- `SchedulerService` 已有 `@Cron(CronExpression.EVERY_MINUTE) settleExpiredAuctions()`（[scheduler.service.ts:113-134](file:///e:/code/nest/packages-game/game-server/src/scheduler/scheduler.service.ts#L113-L134)）与 `@Cron('*/5 * * * * *') matchTick`（:87）→ 建造结算用 `EVERY_MINUTE`，共建超时退款用 `EVERY_MINUTE`（同一 tick 内两次查询可合并）。
- `ScheduleModule.forRoot()` 已启用；**不允许在 2G 服务器上跑高频（<1s）任务**。

**其他约定**
- 错误信封 HTTP 200 + `{code,msg,data}`；新增错误码建议走 **44xxx** 段：`BUILD_FORBIDDEN:44001`、`PLOT_OCCUPIED:44002`、`BUILD_LIMIT_REACHED:44003`、`BUILD_NOT_FOUND:44004`、`COOP_NOT_READY:44005`、`COOP_EXPIRED:44006`（实现前先确认该段未被占用）。
- `AdminGuard` 用于 admin 接口；`@CurrentPlayer()` + `JwtAuthGuard` 用于客户端接口（先例：[world.client.controller.ts](file:///e:/code/nest/packages-game/game-server/src/modules/world/world.client.controller.ts)）。
- 配置包（S2）**不承载建造规则**：`mode` 可能临时切换，走实时接口读取（§1.3 D5）。

### 1.3 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **地块惰性创建**：`scene_land_plots` 不预生成，首次在该格子建造时 `INSERT ... ON CONFLICT DO NOTHING`（唯一索引 `(scene_id,gx,gy)`） | 免去「每个场景预生成 N×N 行」的种子负担；唯一索引承担并发互斥 |
| D2 | **`building_instances` 一张表承载 `building/built/demolishing`**，用 `state`+`finish_at` 表达建造中 | 与总纲 §5.3 一致；不额外建队列表 |
| D3 | **投料即锁定**：共建投料立即扣料并写 `building_coop_contributions`；超时未达标**全额退回**（按流水逐条 addItem/addCurrency） | 有流水才能精确退款；「先扣后判」比「先判后扣」更能防并发超额 |
| D4 | **落成与退款都可重入**：结算任务按 `state` + `finish_at` 幂等处理，处理前用 `withLock('lock:building:<id>')` | 定时任务与玩家请求可能并发（玩家撤资/拆除恰好同时） |
| D5 | **建造规则走 HTTP 实时接口**（`GET /world/scenes/:sceneId/build-rule`），不进配置包 | 规则可能运营期临时改；配置包只承载静态世界（S2 已冻结 schema） |
| D6 | **广播走 EventBus → gateway**，不新增 WS 命令 | 复用先例链路；客户端零新增消息类型 |
| D7 | **拆除不退款**（本批） | 退款=刷料漏洞（建→拆→再建可无损）；经济调参留给后续批次，先保证漏洞为零 |
| D8 | **建筑 effect 只落 `payload jsonb`，不生效** | 生效涉及产出结算/仓储容量/增益，属经济系统范畴；本批先落契约 |

### 1.4 数据模型（5 张新表，全部 bigint PK + `created_at/updated_at/deleted_at`）

| 表 | 关键列 | 说明 |
|---|---|---|
| `scene_build_rules` | `scene_id bigint UNIQUE`、`mode enum(solo/coop/forbidden)`、`land_grid_size int default 64`、`max_buildings_per_player int default 5`、`allow_demolish bool default true`、`coop_min_contributors int default 2`、`coop_expire_hours int default 24`、`reserved_zones jsonb`（`[{x,y,w,h}]`） | 无行 = 该场景**不允许建造**（`forbidden` 语义显式落库亦可） |
| `building_templates` | `name`、`res_key`、`category`、`footprint_w/h int`、`build_cost jsonb`（`[{itemTemplateId?,currencyType?,amount}]`）、`build_seconds int`、`durability int`、`effect jsonb`、`unlock_condition jsonb`、`is_active bool` | 蓝图（配置数据） |
| `scene_land_plots` | `scene_id`、`gx int`、`gy int`、`w int`、`h int`、`state enum(empty/occupied/locked)`；**唯一索引 `(scene_id,gx,gy)`** | 世界状态 |
| `building_instances` | `scene_id`、`plot_id`、`template_id`、`owner_type enum(player/guild)`、`owner_id bigint`、`state enum(building/built/demolishing)`、`finish_at timestamptz`、`durability int`、`payload jsonb`；索引 `(scene_id,state)` | 建造中/已落成/拆除中 |
| `building_coop_contributions` | `building_instance_id`、`player_id`、`item_id nullable`、`currency_type nullable`、`amount int`、`refunded bool default false` | 共建流水 + 退款标记（幂等） |

### 1.5 文件结构

**新增（后端，相对 `packages-game/game-server/`）**

| 路径 | 职责 |
|---|---|
| `src/modules/world/entities/building-*.entity.ts`（4 个）、`scene-build-rule.entity.ts` | 上述 5 表 |
| `src/modules/world/building/build-rule.service.ts` | 规则读取、格点换算、区块保留判定、玩家上限判定 |
| `src/modules/world/building/build-cost.ts` | **纯函数**：成本校验/扣减计划生成/退款计划生成 |
| `src/modules/world/building/building.service.ts` | 建造/投料/结算/拆除/查询；调 `InventoryService`+`EconomyService` |
| `src/modules/world/building/building.service.spec.ts` + `build-cost.spec.ts` | 单测（见 §1.6） |
| `src/modules/world/building/building.scheduler.ts` | `@Cron(EVERY_MINUTE)`：落成结算 + 共建超时退款 |
| `src/modules/world/dto/building.dto.ts` | `CreateBuildingDto{templateId,gx,gy}` / `ContributeDto{buildingId,items?}` / `DemolishDto{buildingId}` |
| `src/modules/gateway/building.broadcaster.ts`（或并入 gateway） | `@OnEvent(BUILDING_STATE_CHANGED)` → 房间广播 |
| `seeds/building.seed.ts` | 1 个场景规则（`solo`）+ 1 个 `coop` 场景 + 3 个建筑蓝图 |

**修改（后端）**

| 路径 | 动作 |
|---|---|
| `src/modules/world/world.module.ts` | 注册 5 实体 + 3 service + scheduler |
| `src/modules/world/world.client.controller.ts` | +5 客户端接口 |
| `src/modules/world/world.controller.ts` | +admin 蓝图 CRUD + 规则 upsert + 实例列表 |
| `src/event-bus/game-events.ts` | +`BUILDING_STATE_CHANGED`、`BUILDING_CONTRIBUTED` |
| `src/constants/enums.ts` | +`BuildMode`/`BuildingState`/`BuildingOwnerType`/`PlotState` |
| `src/constants/error-codes.ts` | +6 个 44xxx 码 |
| `src/scheduler/scheduler.service.ts` | 不改（新 scheduler 独立注册，避免动既有文件） |

**新增/修改（客户端 `packages-game/game-client/`）**

| 路径 | 动作 |
|---|---|
| `src/world/BuildPanel.ts` | **新增**：引擎内自绘（模式提示/蓝图列表/格点预览/成本与进度/投料按钮/拆除按钮） |
| `src/entity/components/BuildComponent.ts` | 建造入口（`mode=forbidden` 时 `canInteract=false`） |
| `src/net/api.ts` | +`getBuildRule`、`createBuilding`、`contribute`、`demolish`、`listBuildings` |
| `src/entity/EntityFactory.ts` | +`createFromBuilding(instance)`（半透明地基 + 进度条 + 落成后正常贴图） |
| `src/world/SceneBuilder.ts` | 建造广播 upsert 接入（`entityType==='building'` 分支） |

### 1.6 测试基线

- 后端 `npm test` 全绿，基线 998 tests 不下降；新增 ≥14 用例：`forbidden` 拒绝、地块被占拒绝、玩家上限、成本不足抛 `ITEM_NOT_ENOUGH`、**扣料失败时地块不被占用**（先校验后写入顺序）、`solo` 建后 `state=building`、结算后 `state=built`（幂等重复跑不变）、`coop` 未达人数不落成、`coop` 超时退款且 `refunded=true`（重复跑不重复退款）、`coop` 达标后投料者权利可查、拆除按 `allow_demolish=false` 拒绝、拆除不退款、广播事件被 emit（事件总线断言）。
- 纯函数：`build-cost` 的「扣减计划/退款计划」同输入同输出。
- 冒烟：`scripts/smoke-building-s6.mjs`（≥10 条断言）覆盖三个模式的完整链路（含 `forbidden` 拒绝与 `coop` 超时退款，超时用**把 `coop_expire_hours` 设为 0 的测试场景**实现，不等待真实时间）。
- 客户端：浏览器点检（预览态、进度、落成后实体切换、拆除后消失）。

### 1.7 已知限制（S6 明确不覆盖）

1. **建筑效果不生效**（产出/仓储/增益只落 `payload`）。
2. **不做拖拽摆点**（键盘/点击选格 + 半透明预览）。
3. 不做建筑迁移/旋转/多格占地的自由形状（footprint 只做矩形）。
4. 不做帮派共有建造的权限细分（`owner_type=guild` 只落字段，不接帮派审批）。
5. 不做 GM「建造审核」面板（数据可 CRUD，面板归后续批次）。

---

## 2. Tasks

> 后端 cwd = `e:\code\nest\packages-game\game-server`；客户端 cwd = `e:\code\nest\packages-game\game-client`。

### Task 1: 5 张表 + 枚举 + 错误码

- [ ] **Step 1** `enums.ts`：`BuildMode(solo/coop/forbidden)`、`BuildingState(building/built/demolishing)`、`BuildingOwnerType(player/guild)`、`PlotState(empty/occupied/locked)`。
- [ ] **Step 2** 建 5 个实体（§1.4；枚举列用 PostgreSQL enum，与既有实体写法一致）；`scene_land_plots` 加唯一索引 `(scene_id,gx,gy)`。
- [ ] **Step 3** `error-codes.ts` +44xxx 6 个（先搜索确认未占用）。
- [ ] **Step 4** `world.module.ts` 注册实体。
- [ ] **Step 5** `psql ... -c "\d building_instances"` / `"\d scene_land_plots"` → Expected：列齐、唯一索引存在、枚举列类型为 enum。
- [ ] **Step 6** commit：`feat(game-build): 建造 5 张表与枚举、错误码`

### Task 2: 规则与地块（纯逻辑 + 并发互斥）

- [ ] **Step 1** `build-rule.service.ts`：`getRule(sceneId)`（无行 → 返回 `forbidden` 视图）、`toGrid(x,y)`/`toCenter(gx,gy)`（`land_grid_size` 换算）、`inReservedZone(rule,x,y)`、`countPlayerBuildings(sceneId,playerId)`。
- [ ] **Step 2** 地块懒创建：`ensurePlot(sceneId,gx,gy)` 用 `INSERT ... ON CONFLICT (scene_id,gx,gy) DO NOTHING`（TypeORM `orIgnore()`）+ 回查；`state` 为 `occupied` 时抛 `PLOT_OCCUPIED`。
- [ ] **Step 3** 单测：格点换算边界（场景外拒绝）、保留区拒绝、上限拒绝、两次并行 `ensurePlot` 只有一行。
- [ ] **Step 4** commit：`feat(game-build): 场景建造规则与地块服务`

### Task 3: 单独建造（solo）+ 落成结算

- [ ] **Step 1** `createBuilding(playerId, sceneId, {templateId,gx,gy})`：读规则 → `mode!=solo` 拒绝 → 校验上限/保留区/地块 → 按 `build_cost` **逐项扣料**（道具走 `removeItem`、货币走 `deductCurrency`）→ 写 `building_instances(state=building, finish_at=now+build_seconds)` → 地块置 `occupied` → 发 `BUILDING_STATE_CHANGED`。
  - **顺序硬要求**：先全部校验 → 再扣料 → 最后写实例与地块；任一扣料失败**立刻中止**并回滚已扣项（按已扣列表逆向补偿）。
- [ ] **Step 2** `BuildingScheduler.reconcile()`：查 `state='building' AND finish_at<=now()` → `withLock('lock:building:<id>')` → 置 `built` → 发事件；**幂等**（重复执行不改变已 `built` 的行）。
- [ ] **Step 3** 单测：成本不足时**不产生实例、地块仍 `empty`**；扣两项时第二项失败→第一项被补偿回退；结算幂等。
- [ ] **Step 4** commit：`feat(game-build): 单独建造与落成结算`

### Task 4: 共同建造（coop）

- [ ] **Step 1** `createCoopBuilding`：创建 `state=building`、`finish_at` 留**空**（未达标不开始计时）或按 `coop_expire_hours` 设超时时刻——**实现时二选一并在 commit 里写明**（推荐：`finish_at = createdAt + coop_expire_hours`，语义为「超时时刻」，达标时改写为 `now + build_seconds`）。
- [ ] **Step 2** `contribute(playerId, buildingId, items)`：校验 `state==='building'` 且未超时 → 逐项扣料 → **逐条写 `building_coop_contributions`**（`item_id`/`currency_type`/`amount`）；参与者去重计数 ≥ `coop_min_contributors` 且**投料总量 ≥ `build_cost`** → 达标 → 改写 `finish_at`。
- [ ] **Step 3** 超时退款（scheduler 内）：`state==='building'` 且已过超时 → `withLock` → 按流水逐条退款（道具 `addItem`、货币 `addCurrency`）→ 标记 `refunded=true` → 实例置 `demolishing`（待清）→ 地块释放 `empty` → 发事件。
  - 退款失败（背包满）**不标记 `refunded`**，下一 tick 重试；连续失败需 `logger.error` 告警。
- [ ] **Step 4** 单测：未达标不落成；达标后落成；超时退款只发生一次；退款失败可重试。
- [ ] **Step 5** commit：`feat(game-build): 共同建造投料、达标落成与超时退款`

### Task 5: 拆除

- [ ] **Step 1** `demolish(playerId, buildingId)`：`state==='built'` + `allow_demolish` + 所有者校验（`owner_type=player` 且 `owner_id===playerId`）→ 置 `state='demolishing'` → 本地事务结束后置删（或直接软删 + 地块释放 `empty`）。
- [ ] **Step 2** **不退款**（D7），在返回体与日志中写明。
- [ ] **Step 3** 单测：非所有者拒绝；`allow_demolish=false` 拒绝；拆除后地块可再次建造。
- [ ] **Step 4** commit：`feat(game-build): 建筑拆除与地块释放`

### Task 6: 广播接线 + 客户端/管理接口

- [ ] **Step 1** `game-events.ts` +`BUILDING_STATE_CHANGED`；`BuildingBroadcaster`（gateway 模块内）`@OnEvent` → `server.to('scene:<sceneId>').emit('message', {cmd:'world.entity_update', seq:0, code:0, msg:'success', data:{entityId:'building:<id>', entityType:'building', playerId:null, pos:{x,y}, rotation:0, state}})`。
  - ⚠️ 广播 `data` 必须与既有 `world.entity_update` **同结构**（多带 `buildingId`/`templateId` 允许）。
- [ ] **Step 2** 客户端接口（`api/client/v1/world`，`JwtAuthGuard`）：`GET scenes/:sceneId/build-rule`、`GET scenes/:sceneId/buildings`、`POST buildings`、`POST buildings/:id/contribute`、`POST buildings/:id/demolish`。
- [ ] **Step 3** admin 接口（`api/admin/v1/world`，`AdminGuard`）：蓝图 CRUD（list/create/update/toggle）、规则 upsert、实例列表（按场景/玩家筛选）。
- [ ] **Step 4** 手工验证：两个客户端窗口，A 建建筑 → B 窗口出现半透明地基；结算后 B 侧变实体（无刷新）。
- [ ] **Step 5** 未授权校验：客户端接口不带 token → 401/403（非 404）。
- [ ] **Step 6** commit：`feat(game-build): 建造广播接线与建造接口`

### Task 7: 客户端建造面板与预览

- [ ] **Step 1** `BuildPanel`（引擎内自绘，不依赖 DOM）：模式提示（`forbidden` → 提示「此场景不允许建造」并禁用入口）、蓝图列表（成本、耗时）、格点预览（半透明方块 + 合法性红/绿）、投料/拆除按钮、进度条。
- [ ] **Step 2** 交互入口：建造键（如 `B`）打开面板；`InteractController` 的 `canInteract` 增加 `BuildComponent` 分支（`mode=forbidden` → 不可交互），保持 S3 的选择器语义。
- [ ] **Step 3** 实体表现：`EntityFactory.createFromBuilding` — `building` 态半透明 + 进度条；`built` 态正常贴图 + `durability`；`demolishing` 态淡出后移除。
- [ ] **Step 4** 建造广播接入：`entityType==='building'` → `EntityRegistry.upsert(entityId, pos, create)`。
- [ ] **Step 5** 浏览器点检：solo 场景建一栋（看到扣料 + 进度 + 落成）、coop 场景投料两次（看到达标落成）、forbidden 场景入口禁用、拆除后消失。
- [ ] **Step 6** commit：`feat(game-client): 建造面板、预览态与建筑实体表现`

### Task 8: 冒烟 + 回归 + 生产部署

- [ ] **Step 1** `scripts/smoke-building-s6.mjs`（≥10 条，每条 `PASS/FAIL` + 证据）：规则读取 → forbidden 拒绝 → solo 扣料建楼（校验背包差额）→ 结算后 `state=built` → 上限拒绝 → 地块占用拒绝 → coop 投料未达标不落成 → 达标落成 → 超时退款（`coop_expire_hours=0` 测试规则）→ 拆除后地块可复用。
- [ ] **Step 2** `node scripts/smoke-building-s6.mjs` → Expected：全 PASS，退出码 0。
- [ ] **Step 3** 回归：`npm test` 全绿 ≥998；`node scripts/smoke-laya2d-s1.mjs` 9/9 PASS（**含多人互见**，验证广播未被破坏）。
- [ ] **Step 4** 生产：本地 `npm run build` → scp dist → 服务器备份替换 + `systemctl restart game-server` → **DDL 脚本在服务器执行**（禁构建）→ `building.seed` 用 SQL 执行。
- [ ] **Step 5** 线上验收：`GET /api/client/v1/world/scenes/1/build-rule` 返回规则；线上建一栋并看到广播。
- [ ] **Step 6** commit：`test(game-build): S6 冒烟脚本与部署验收记录`

---

## 3. 风险与回退

| # | 风险 | 触发信号 | 回退动作 |
|---|---|---|---|
| 1 | 扣料与建实例不一致（幽灵建筑/白扣料） | 背包少了但无建筑 | 顺序硬要求（Task 3 Step 1）+ 补偿回退；单测覆盖「第二项失败」 |
| 2 | 退款失败（背包满）导致料丢失 | 退款路径 `BAG_FULL` | 不标 `refunded`，下 tick 重试 + `logger.error`；**禁止吞异常** |
| 3 | 地块并发写双占 | 同格两栋 | 唯一索引 `(scene_id,gx,gy)` + `orIgnore`；单测覆盖 |
| 4 | 结算任务与玩家操作并发 | 重复落成/重复退款 | `withLock('lock:building:<id>')` + 状态机幂等判断 |
| 5 | 广播结构偏离既有契约 | S1 多人互见冒烟 FAIL | 广播字段与 `game.gateway.ts:224` 逐字对齐（只多 `buildingId/templateId`） |
| 6 | 表名与 `guild_building` 混淆 | 迁移/查询串表 | 新表一律 `building_*`/`scene_*`；`grep -i guild_building` 确认未引用 |
| 7 | 2G 服务器被定时任务压垮 | 服务器负载升高/SSH 卡 | 结算与退款合并到 **同一条 `EVERY_MINUTE`**；查询走 `(scene_id,state)` 索引 |
| 8 | 生产 DDL 漏执行 | 线上 500 `relation does not exist` | 部署 Step 4 固化 DDL 脚本，验收前 `\d building_instances` |

---

## 4. 待确认项（动手前请回答；无异议则按【默认】执行）

1. **共建超时退款**：按流水**全额退回原物**（道具/货币原路返还）？【默认：是，不扣税】。
2. **拆除退款**：【默认：**不退款**（D7，防刷料）】——若你希望退 50%，请明示材料类型与比例。
3. **地块创建方式**：【默认：惰性创建 + 唯一索引】——另一选项是播种时按 `land_grid_size` 预生成整张地图的地块。
4. **建筑效果（产出/仓储/增益）**是否本批生效？【默认：不生效，只落 `payload`】。
5. **放置交互**：【默认：点击/键盘选格 + 半透明预览，不做拖拽】。
6. **本批是否上线生产**？【默认：是】。

---

## 5. 执行方式

沿用 **Subagent-Driven**：每 Task 派新 subagent，Task 间两阶段评审（先 diff 后验收），每 Task 提交后跑 S1 冒烟作回归门禁。

任务依赖：Task 1 → Task 2 → Task 3 → Task 4 → Task 5 →（Task 6 后端可与 Task 5 并行）→ Task 7 → Task 8。