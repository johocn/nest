# LayaAir 2D 性能优化与压测 S8 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（沿用 S2/S3/S4 的既定方式）。

**Goal:** 让客户端在**总纲 §12 的性能预算内**稳定运行（H5 60fps / 小游戏 30fps 兜底、同屏 ≤150 实体、DrawCall ≤60/≤40、内存 ≤300MB、上行 ≤10 次/秒/人），并**量化**「50 人同场景」的服务端广播成本，给出「是否需要后端视口裁剪」的实测结论。

**Architecture:** 三条线并行——**渲染**（静态层合图 + 对象池 + 视口裁剪）、**同步**（远端插值 + 时间基移动）、**度量**（质量分级 + 压测脚本）。S3 决策中「对象池/阴影留到 S8」在此兑现；**本批默认不改后端契约**（是否加视口裁剪由压测数据决定，见 §4）。

---

## 0. 执行前必读（硬约束）

1. **不准碰 vendure**；2G 服务器（odoo, 39.106.99.9）**禁止构建**，也**禁止在本批对其做高压测**（见 D9）。
2. **不新增依赖**：压测 bot 复用 `game-server/node_modules` 里的 socket.io-client；不引入 benchmark/autocannon 等包。
3. **不改 WS 契约**：`world.move` / `world.entity_update` 字段零改动。后端视口裁剪若要做，属**广播行为变更**，必须先单独确认。
4. **不改 H5 既有行为**：优化必须是「同表现、更省资源」；有视觉变化的项（如标签合并）需在验收记录里明示。
5. 全部提交遵守 commitlint，单次提交聚焦一个任务。
6. 优化顺序：**先度量、再优化、后复测**——没有基线数据的优化必须拒绝（避免凭感觉调参）。

---

## 1. 设计

### 1.1 缺口盘点（已核实）

| # | 缺口 | 现状（已核实） | S8 处置 |
|---|---|---|---|
| 1 | **无对象池** | 每个实体在构造里 `new Laya.Sprite()` + `drawRect` + `drawTexture` + `Laya.Text`（[Entity.ts:22-36](file:///e:/code/nest/packages-game/game-client/src/entity/Entity.ts#L22-L36)）；离场直接 `removeChild` 丢弃 | `EntityPool` + `Entity.reset()` |
| 2 | **静态层逐条绘制** | `SceneBuilder.build` 用 `graphics.drawRect` + **每 100px 一条 `drawLine`**（[SceneBuilder.ts:14-25](file:///e:/code/nest/packages-game/game-client/src/world/SceneBuilder.ts#L14-L25)）→ 20×20 场景 = 40+ 次绘制命令 | 合图缓存（`cacheAs='bitmap'`）+ 网格合并/降频 |
| 3 | **Registry 无空间查询** | `EntityRegistry` 只有 `byId` Map 与 `all()`（[EntityRegistry.ts](file:///e:/code/nest/packages-game/game-client/src/entity/EntityRegistry.ts)），无按类型/矩形查询 | 加 `byKind(kind)`、`inRect(rect)` |
| 4 | **无视口裁剪** | 全场景实体常驻渲染（同屏上限 150 由内容侧保证） | 客户端视口裁剪（隐藏+停更，不走池则直接回收） |
| 5 | **远端无插值** | 广播到达即 `EntityRegistry.upsert → setPos`（[EntityRegistry.ts:25-34](file:///e:/code/nest/packages-game/game-client/src/entity/EntityRegistry.ts#L25-L34)）→ 位置**跳变** | 插值缓冲（默认 120ms） |
| 6 | **移动是帧基** | `SPEED_PX_PER_FRAME = 4`，`Laya.timer.frameLoop(1, …)`（[PlayerControl.ts:15,34,50-77](file:///e:/code/nest/packages-game/game-client/src/world/PlayerControl.ts#L15)）→ 帧率不同速度不同（小游戏 30fps 时**只有一半速度**） | 改时间基（px/ms），上报阈值沿用 `moveReportIntervalMs=100` / `moveReportThreshold=4` |
| 7 | **无质量分级** | 无任何降级开关 | `quality: high/low` + 运行时自动降级 |
| 8 | **无度量** | 无 FPS/DrawCall 面板，无压测脚本 | 面板 + `scripts/loadtest-s8.mjs` |
| 9 | **广播无视野裁剪** | `server.to('scene:<id>').emit(...)` 全房间广播（[game.gateway.ts:224](file:///e:/code/nest/packages-game/game-server/src/modules/gateway/game.gateway.ts#L224)）；`world.move` 上报 10Hz/人 | **只量化**，是否裁剪见 §4 |
| 10 | `resort()` 全量排序 | 每 N 帧对全部实体排序并 `setChildIndex`（[SceneBuilder.ts:92-102](file:///e:/code/nest/packages-game/game-client/src/world/SceneBuilder.ts#L92)） | 仅对**可见实体**排序；无位移时不排序 |

### 1.2 性能预算（总纲 §12，本批的判定口径）

| 指标 | 预算 | 度量方式 |
|---|---|---|
| 帧率 | H5 60fps / 小游戏 30fps 兜底 | `Laya.Stat.FPS`（面板常显，压测记录） |
| 同屏实体 | ≤150 | `EntityRegistry.all().length` + 可见实体数 |
| DrawCall | ≤60（H5）/ ≤40（小游戏） | `Laya.Stat` 面板（render 计数） |
| 内存 | ≤300MB（H5） | Chrome 任务管理器 / `performance.memory`（H5）；开发者工具内存面板（小游戏） |
| WS 上行 | ≤10 次/秒/人 | bot 侧与后端日志双计数 |
| 首屏 | 配置包 ≤300KB/场景 | `publish.mjs`/`check-config.mjs` 已有输出 |

### 1.3 已知事实（实现时不要再猜）

- 移动上报：`world.move` 用 `expectAck=false`（fire-and-forget），10Hz + 4px 阈值（[ws.ts:73-92](file:///e:/code/nest/packages-game/game-client/src/net/ws.ts#L73-L92)、[PlayerControl.ts:68-76](file:///e:/code/nest/packages-game/game-client/src/world/PlayerControl.ts#L68-L76)）。
- 广播分发：`WsClient.dispatch` 先按 `seq` 匹配 pending，再按 `cmd` 或 `'*'` 回调（[ws.ts:94-104](file:///e:/code/nest/packages-game/game-client/src/net/ws.ts#L94-L104)）→ 插值应注册在 `onBroadcast`/`on('world.entity_update')` 上。
- 后端房间：`world.enter-scene` 时 `client.join('scene:<id>')`（[game.gateway.ts:196](file:///e:/code/nest/packages-game/game-server/src/modules/gateway/game.gateway.ts#L196)）；广播即向该房间全体。
- 后端在线人数：`ConnectionService.getOnlineCount()`（[scheduler.service.ts:74-79](file:///e:/code/nest/packages-game/game-server/src/scheduler/scheduler.service.ts#L74-L79) 已在使用）。
- 压测 bot 依赖来源：`game-server/node_modules` 已含 `socket.io-client`（`world.move` 的 ack 形态见 [README.md:151-154](file:///e:/code/nest/packages-game/game-client/README.md#L151-L154) 的记录：**事件名即 cmd，handler 直接 return 走 ack 回调**）。
- 小游戏端性能要点：无 DOM、`Platform` 已是唯一出口（S7 完成）；本批的性能面板**必须引擎内自绘**。

### 1.4 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **先做度量再优化**：Task 1 必须先产出基线数据（改动前的 fps/drawcall/内存），后续每个 Task 都要前后对比 | 无基线 = 无法证明优化有效，也容易退化 |
| D2 | **质量分级 `quality: 'high' \| 'low'`**（H5 默认 high、小游戏默认 low），并提供**运行时自动降级**（连续 3 秒 fps 低于目标 80% → 降一档） | 一台机器/一种机型跑不满时不能白屏；降级项只影响表现不影响权威数据 |
| D3 | **降级项清单（只做开关，不做内容）**：名标签显示、网格线、触发区描边、插值精度、远端实体位置更新频率 | 当前无美术（无阴影/粒子素材），做了也是空转；开关留到有素材时直接生效 |
| D4 | **对象池只池化「高频增删」实体**：远端玩家、动态 NPC、掉落物；**静态物件与固定 NPC 不进池**（场景切换整体回收） | 池化收益与增删频率成正比；静态实体池化只增加复杂度 |
| D5 | **视口裁剪在客户端先行**：视口外实体 `visible=false` 且不再参与排序/插值 | 零后端改动即可拿到大部分收益；后端裁剪另议（D9） |
| D6 | **插值只作用于远端实体**，本地玩家保持即时表现 | 本地预测不是本批目标（总纲 §1.2 明确无帧同步/预测回滚） |
| D7 | **移动改时间基**：`speedPxPerMs`，由 `Laya.timer.delta` 提供；同时把 `frameLoop(1)` 改为 `frameLoop(1)` 但内部按 delta 计算（保持单帧执行） | 30fps 与 60fps 下手感一致；不改上报口径 |
| D8 | **`resort()` 增量化**：只在「有实体位移超过阈值」时排序，且只排可见实体 | 每帧全量排序在 150 实体时可忽略，但在小游戏端是纯浪费 |
| D9 | **压测在本机**：50 bot → 本地 `:3000`（mock-redis）；生产**不做高压测**，最多 ≤5 bot 短时冒烟 | 2G 服务器压测=打挂线上；本机数据足以判断是否需要后端裁剪 |
| D10 | **后端视口裁剪默认不做**，作为「数据不达标时」的候选方案提交用户决定 | 会改广播语义（影响多人互见验收口径），不能在性能批里顺手改 |

### 1.5 文件结构

**新增/修改（客户端 `packages-game/game-client/`）**

| 路径 | 动作 |
|---|---|
| `src/perf/Quality.ts` | **新增**：`quality` 档位、降级项开关、自动降级判定 |
| `src/perf/PerfPanel.ts` | **新增**：引擎内自绘 FPS/DrawCall/实体数/上行次数面板（`F3` 开关） |
| `src/entity/EntityPool.ts` | **新增**：按 `kind` 池化 + `acquire/release` |
| `src/entity/Entity.ts` | +`reset(...)`（复用 sprite，重设贴图/名字/位置）；名标签可关闭（D3） |
| `src/entity/EntityRegistry.ts` | +`byKind(kind)`、`inRect(rect)`、`visibleCount()` |
| `src/world/SceneBuilder.ts` | 背景合图（`cacheAs='bitmap'`）、网格线按档位、`resort()` 增量化、视口裁剪 tick |
| `src/world/Viewport.ts` | **新增**：视口矩形计算（跟随相机/玩家，含预加载边距） |
| `src/entity/components/RemoteInterp.ts` | **新增**：远端插值（目标点+时间戳，lerp，120ms 缓冲） |
| `src/world/PlayerControl.ts` | 时间基移动（D7） |
| `src/boot/Main.ts` | 广播处理接入插值；面板与质量初始化 |

**新增（后端 `packages-game/game-server/scripts/`，仅压测用，不改 src）**

| 路径 | 动作 |
|---|---|
| `scripts/loadtest-s8.mjs` | **新增**：N 个 bot（登录 → 进场景 → 10Hz 移动 → 采样广播延迟/丢失），输出 JSON 报告 |
| `scripts/loadtest-s8-report.md` | **新增**：压测报告（基线、调参前后对比、结论与建议） |

### 1.6 验收映射

| # | 验收项 | 判定方式 |
|---|---|---|
| A1 | 基线可复现 | Task 1 产出的面板数据；同一场景同一路径重复测量差异 < 10% |
| A2 | H5 帧率 | 同屏 150 实体（压测场景种子）稳定 ≥55fps（60fps 目标，允许 8% 抖动） |
| A3 | H5 DrawCall | ≤60（含前景实体） |
| A4 | 小游戏帧率 | 开发者工具 ≥30fps（自动降级生效后可稳定） |
| A5 | 内存 | H5 ≤300MB；场景切换后回落（不持续增长） |
| A6 | 上行节流 | 单人 10Hz 上限；静止时不发（bot 与后端双计数） |
| A7 | 50 人同场景 | 本机 50 bot 下：后端进程 CPU/内存无异常增长、广播端到端延迟 P95 ≤ 200ms、无 socket 掉线 |
| A8 | 零契约变更 | `git diff` 无 `world.move`/`world.entity_update` 字段变更；`npm test` ≥998 全绿 |
| A9 | 表现不回退 | S1 冒烟 9/9 PASS；两个浏览器窗口互见移动且**位置连续**（插值生效，无跳变） |
| A10 | 降级可验证 | 手动把 `quality` 设为 `low` 或触发自动降级 → 面板显示开关生效、帧率提升 |

### 1.7 测试基线

- **后端**：不改 src → `npm test` 仅作回归（≥998）；`smoke-laya2d-s1.mjs` 9/9 PASS 为门禁。
- **客户端**：无单测框架（S3 决策），改以「面板数据 + 固定路径采样」代替：`scripts/perf-sample.md` 记录每次测量的场景/路径/数值。
- **压测**：`scripts/loadtest-s8.mjs` 输出结构化 JSON（含 p50/p95 延迟、上行/下行消息数、掉线数），作为 A7 的证据。
- **双端**：H5 全量验收 + 小游戏端在开发者工具复测 A4（S7 完成后可跑）。

### 1.8 已知限制（S8 明确不覆盖）

1. **不做后端帧同步/预测回滚**（总纲 §1.2）。
2. 不做图集合并/美术资源优化（无美术资源）。
3. 不做真实网络弱网模拟（可用 Chrome 节流手动点检，不建自动化）。
4. 不做阴影/粒子内容（只留开关）。
5. 真机性能（低端安卓）不在本批（需 AppID）。

---

## 2. Tasks

> 客户端 cwd = `e:\code\nest\packages-game\game-client`；后端 cwd = `e:\code\nest\packages-game\game-server`。

### Task 1: 质量分级 + 性能面板 + **基线采集**

- [x] **Step 1** `Quality.ts`：`high`/`low` 档位与降级项（名标签、网格线、触发区描边、插值精度、远端更新频率）；`AppConfig.quality` 默认按平台（`isMiniGame()? 'low':'high'`）。
- [x] **Step 2** `PerfPanel.ts`（引擎内自绘，`F3` 开关）：FPS、DrawCall（render 计数）、实体总数/可见数、本秒 `world.move` 上行次数。
- [x] **Step 3** **采集基线**（改动前）：固定场景 + 固定路线（直线走 10 秒 + 静止 10 秒），记录 fps/drawcall/内存/上行次数 → 写入 `docs` 内的测量记录（append）。
- [x] **Step 4** H5 冒烟回归 → 9/9 PASS。
- [x] **Step 5** commit：`feat(game-client): 性能面板与质量分级基线`

### Task 2: 对象池

- [x] **Step 1** `Entity.reset(...)`：复用 sprite 与文本对象，重设贴图/名字/位置/可见性；**不重新 `new`**。
- [x] **Step 2** `EntityPool`：按 `kind` 分桶，`acquire(kind, init)` / `release(entity)`；实体被 release 时从父节点移除但不销毁。
- [x] **Step 3** 接入：远端玩家（掉线/离开视野）、动态 NPC（S4 的规则变化）、掉落物（S6/后续）走池；**静态物件与固定 NPC 不进池**（D4）。
- [x] **Step 4** 前后对比：反复进出视野 100 次，记录 drawcall/内存/GC 尖峰（对比基线）。
- [x] **Step 5** commit：`feat(game-client): 实体对象池与复用`

### Task 3: 静态层合图与背景优化

- [x] **Step 1** 背景（地块 + 网格 + 触发区描边）绘制到一个 `Laya.Sprite` 后 `cacheAs = 'bitmap'`（一次性绘制、后续复用）。
- [x] **Step 2** 网格线：`low` 档位不画网格；`high` 档位把线宽/间隔按需调整（**同表现优先**，视觉变化必须记录）。
- [x] **Step 3** 名标签：`low` 档位默认关闭（仅显示玩家/NPC 名字，不显示物件名）；开关来自 `Quality`。
- [x] **Step 4** `resort()` 增量化：仅当有实体位移 ≥ 阈值时排序，且只对可见实体排序（D8）。
- [x] **Step 5** 前后对比：drawcall 数值必须下降（预期静态层从「几十条绘制命令」降到 1~2）；记录数值。
- [x] **Step 6** commit：`perf(game-client): 静态层合图缓存与增量排序`

### Task 4: 视口裁剪

- [x] **Step 1** `EntityRegistry.byKind(kind)` / `inRect(rect)` / `visibleCount()`。
- [x] **Step 2** `Viewport.ts`：视口矩形 = 舞台尺寸 + 预加载边距（默认 1 屏外扩 200px）；跟随本地玩家。
- [x] **Step 3** `SceneBuilder` 每 5 帧执行一次裁剪：视口外实体 `visible=false`、跳过排序与插值；进入视口恢复（并从池中取）。
- [x] **Step 4** 边界验证：玩家在场景角落、快速穿越视口边界时**无实体闪烁/错位**（点检 + 录屏说明）。
- [x] **Step 5** 前后对比：150 实体场景下 drawcall 与 fps 变化 → 记录。
- [x] **Step 6** commit：`perf(game-client): 视口裁剪与实体可见性管理`

### Task 5: 远端插值与时间基移动

- [x] **Step 1** `RemoteInterp`：记录 `targetPos` 与到达时间，每帧向目标 lerp（默认 120ms 缓冲）；新广播覆盖目标点（不排队）。
- [x] **Step 2** 接入广播：`world.entity_update` 处理改为「设置插值目标」而非直接 `setPos`；本地玩家（`entityId === 'player:<自己>'`）保持即时。
- [x] **Step 3** `PlayerControl` 改时间基（`speedPxPerMs`，默认等价 4px/帧@60fps ≈ 0.0667px/ms）；上报阈值与频率不变。
- [x] **Step 4** 验证：H5 双窗口互见，位置**连续无跳变**；小游戏 30fps 下速度与 H5 一致（走同一路径耗时对比）。
- [x] **Step 5** 性能复测：插值不引入额外 drawcall（目标：数值不变）。
- [x] **Step 6** commit：`feat(game-client): 远端插值与时间基移动`

### Task 6: 压测脚本与 50 人实测

- [x] **Step 1** `scripts/loadtest-s8.mjs`（后端 scripts 目录，零新增依赖，复用 `game-server/node_modules/socket.io-client`）：参数 `--bots 50 --seconds 30 --scene 1`；每 bot：登录 → `world.enter-scene` → 10Hz `world.move`（`expectAck=false`）→ 采样自己收到的 `world.entity_update` 延迟与条数。
- [x] **Step 2** 输出 JSON 报告：`{bots, durationSec, upMsgs, downMsgs, latencyP50, latencyP95, disconnects, serverCpu?, serverRss?}`（服务端指标用本机 `pm2`/`process` 侧采集，**不登生产**）。
- [x] **Step 3** 跑三档：1 / 10 / 50 bots，各自记录 → 形成曲线（每 bot 下行消息数、P95 延迟）。
- [x] **Step 4** 判定：若 50 bots 下 P95 延迟 > 200ms 或下行消息数 > 50×50×10/s 数量级导致瓶颈 → 触发 §4 待确认 2（后端视口裁剪）。
- [x] **Step 5** commit：`test(game-perf): 50 人同场景压测脚本与报告`

### Task 7: 调参与报告（含是否上后端裁剪的结论）

- [x] **Step 1** 按报告调参：`moveReportIntervalMs`（若上行偏高）、插值缓冲（若抖动）、降级阈值、裁剪边距。
- [x] **Step 2** `loadtest-s8-report.md`：基线 vs 调参后对比表 + **明确结论**（是否需要在后端做视口裁剪，若需要，给出预期收益与风险）。
- [x] **Step 3** 全量回归：`npm test` ≥998；`smoke-laya2d-s1.mjs` 9/9；H5 与（S7 完成后）小游戏端各跑一次 A2–A5。
- [ ] **PENDING** (deferred until S7 lands) -> **Step 4** 生产：本地构建 → scp 产物与 `gamedata` → 服务器重载（**零构建**）；线上做 **≤5 bot、≤10 秒**的短时冒烟（不做高压测）。
- [x] **Step 5** commit：`docs(game-perf): S8 压测报告与调参结论`

---

## 3. 风险与回退

| # | 风险 | 触发信号 | 回退动作 |
|---|---|---|---|
| 1 | 优化后表现回退（实体闪烁/名字丢失） | 点检异常 | 每 Task 独立 commit；`quality='high'` 必须与基线**表现一致**（视觉变化只能在 `low` 档） |
| 2 | 对象池引入「幽灵实体」（复用后残留状态） | 出现位置/名字错乱 | `reset()` 必须显式重置**全部可见状态**；单测式断言脚本覆盖 reset 后字段 |
| 3 | 合图缓存后动态元素被固化 | 触发区/网格不再更新 | 只把**静态背景**入缓存；动态层（实体/特效）严禁进同一 sprite |
| 4 | 视口裁剪与 S1「实体位置与配置一致」验收冲突 | S1 验收项 5 无法核对 | 裁剪只改 `visible`，**不改坐标**；验收脚本按配置坐标校验（不看可见性） |
| 5 | 插值导致「打不中/交互错位」 | 交互 `nearest()` 选中远处实体 | 交互距离判定**用插值后的渲染坐标**，且交互前做一次「追上目标点」的收敛（`snapIfFar`） |
| 6 | 压测打爆本机后端/mock-redis | 本机进程 OOM | 分档跑（1→10→50）；每档前重启后端；上限 50 bots |
| 7 | 误压生产 | odoo 负载飙升 | 压测脚本默认 `--base http://localhost:3000`；**指向非 localhost 需显式传参**；生产的 ≤5 bot 冒烟由人工执行 |
| 8 | 自动降级误触发（正常机器被判为低端） | 画质莫名下降 | 降级阈值需连续 3 秒低于目标 80% 才触发；提供 `quality` 强制覆盖（URL 参数/ENV） |

---

## 4. 待确认项（动手前请回答；无异议则按【默认】执行）

1. **压测环境**：【默认：本机（50 bots → 本地 `:3000` + mock-redis）；生产只做 ≤5 bot、≤10 秒冒烟，**不做高压测**】。
2. **后端视口裁剪**：【默认：本批**只量化不改**；若 Task 6 数据显示 P95 > 200ms 或明显瓶颈，再单独找你确认是否改广播】——若你希望本批直接做，请明示（会动广播行为，需重跑多人互见验收）。
3. **指标口径**：是否沿用总纲 §12（H5 60fps/≤60 drawcall、小游戏 30fps/≤40 drawcall、内存 ≤300MB）？【默认：沿用】。
4. **降级项**：`low` 档关闭「名标签 / 网格线 / 触发区描边」是否接受（这是唯一有视觉变化的项）？【默认：接受，且只在小游戏端或自动降级时生效】。
5. **本批是否上线生产**？【默认：是（Task 7 Step 4，零构建）】。

---

## 5. 执行方式

沿用 **Subagent-Driven**：每 Task 派新 subagent，Task 间两阶段评审（先 diff 后验收），每 Task 后跑 H5 冒烟 + 记一次面板数据（性能批的「验收」是**数值对比**，评审时必须看前后数字，不看主观感受）。

任务依赖：Task 1（度量）→ Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7。
Task 1 未产出基线前，不得开始任何优化任务。

---

## 6. 执行记录（S8）

> 执行时间：2026-09-23。本地环境：PostgreSQL 16（`localhost:5432/game_server`）+ mock-redis（`:6379`）+ 后端 dev server（`:3000`）+ Chromium 151。
> 生产环境：`odoo`（39.106.99.9）、应用 `/opt/game-server`、公网 `https://game.joho.cn`。

### 6.1 各 Task 提交

| Task | commit | message |
|---|---|---|
| Task 1 | `42028b28c` | feat(game-client): 性能面板与质量分级基线 |
| Task 2 | `67e981f1a` | feat(game-client): 实体对象池与复用 |
| Task 3 | `ace5b61d1` | perf(game-client): 静态层合图缓存与增量排序 |
| Task 4 | `0689d8af5` | perf(game-client): 视口裁剪与实体可见性管理 |
| Task 5 | `58f01ca57` | feat(game-client): 远端插值与时间基移动 |
| Task 6 | `8f05a6786` | test(game-perf): 50 人同场景压测脚本与报告 |
| Task 7 | （本次 docs 提交） | docs(game-perf): S8 压测报告与调参结论 |

> 偏离说明 1：Task 6 的提交信息含「与报告」，但实际只落了 `loadtest-s8.mjs` + `loadtest-s8-result.json`，报告 `loadtest-s8-report.md` 在 Task 7（本次）产出 —— 与计划 §2 Task 7 Step 2 的路径一致。
> 偏离说明 2：Task 3 → Task 4 → Task 5 的实际落地顺序为「合图 → 视口裁剪 → 插值」（与计划链一致，仅提交时间戳如此）。

### 6.2 门禁实测

| 项 | 命令 | 期望 | 实测 |
|---|---|---|---|
| 后端回归 | `game-server: npm test` | 全绿，tests ≥998 | **91 suites / 1176 tests 全绿**，exit 0（101s） |
| 客户端构建 | `game-client: node tools/build-fallback.mjs` | 构建 OK | **40 个产物重写导入扩展名**，exit 0 |
| S1 冒烟回归 | `game-server: node scripts/smoke-laya2d-s1.mjs` | 9/9 PASS | **9/9 PASS**，末行「S1 冒烟全部通过」，exit 0 |
| S3 组件断言 | `game-client: node scripts/smoke-s3-components.mjs` | 全 PASS | **16/16 PASS**，exit 0 |
| S4 NPC 断言 | `node scripts/smoke-s4-npc.mjs` | 全 PASS | **18/18 PASS**，exit 0 |
| S5 对话断言 | `node scripts/smoke-s5-dialogue.mjs` | 全 PASS | **27/27 PASS**，exit 0 |
| S6 建造断言 | `node scripts/smoke-s6-build.mjs` | 全 PASS | **50/50 PASS**，exit 0 |
| S8 性能断言 | `node scripts/smoke-s8-perf.mjs` | 全 PASS | **146/146 PASS**，exit 0 |
| S7 平台层断言 | `node scripts/smoke-platform-s7.mjs` | 全 PASS | **102/102 PASS**，exit 0 |
| 压测 | `game-server: node scripts/loadtest-s8.mjs`（1/10/50 bot） | 见 §7 | 见 `scripts/loadtest-s8-report.md` §3 |

### 6.3 Task 7 Step 1 结论：**参数不变更**

十条参数逐项复核后全部保持默认值（依据见 `scripts/loadtest-s8-report.md` §4）—— 实测未出现需要调参的信号：上行 9.24~9.32/s（≤10）、插值 A/B 达标、H5 全程 60fps 未触发自动降级。

### 6.4 未完成项

| 项 | 状态 | 原因与后续 |
|---|---|---|
| Task 7 Step 4（生产发布） | **PENDING** | S7（双端发布流程 + 小游戏 WS 适配）仍在进行中，此刻发布会把在飞的 S7 改动一并带上；待 S7 验收后与双端产物一并发布（命令见报告 §8） |
| A4（小游戏端 ≥30fps） | **PENDING** | 依赖 S7 收尾 + 开发者工具复测 |