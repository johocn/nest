# LayaAir 2D 客户端 S4（NPC 行为）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 NPC 的「是否在场 + 现在在哪」由**服务端权威**决定：固定出现 / 随机出现 / 路径巡逻三种方式配置化（两张新表），进场景时按玩家条件过滤下发，服务端低频广播做位置校正，客户端只做**路点插值表现**；并配一个能录入规则与路径点的 GM 面板，使配置不再依赖手敲 SQL。

**Architecture:** 新增 `npc_spawn_rules`（出现规则）与 `npc_patrol_routes`（巡逻路径）两表；`NpcPresenceService` 负责「按玩家算在场 NPC 集合 + 初始位置 + 路点」；`NpcTickService`（复用已有 `@nestjs/schedule`）低频推进场景级 NPC 位置并经 **EventBus → gateway → `scene:<id>` 房间广播** `world.entity_update`（`entityType='npc'`）做权威校正；客户端新增 `AiComponent` 沿服务端下发的路点插值，收到校正时平滑纠偏。

**Tech Stack:** NestJS 11 + TypeORM + PostgreSQL + `@nestjs/schedule`（**均已存在，零新增依赖**）、socket.io（房间广播）、LayaAir 3.4 客户端（**零新增依赖**）、GM 面板（Vue3 CDN + `XGamePanels` 注册表，零构建）。

---

## 0. 执行前必读（硬约束）

1. **不准碰 vendure**；不进入 vendure / vcash 目录。
2. **零新增依赖**：定时任务用已装的 `@nestjs/schedule`（[scheduler.module.ts](file:///e:/code/nest/packages-game/game-server/src/scheduler/scheduler.module.ts) 已 `ScheduleModule.forRoot()`）；不引入 `cron`/`bull`/`agenda`。
3. **2G 服务器禁止构建**：本地 `npm run build` → scp dist；服务器只解包/重启。
4. **本批只做 NPC，不做 monster**：`scene_entity_spawns.entityType='monster'` 的生成/AI 不在 S4 范围。
5. **不做时段表**：`npc_patrol_routes.schedule` **建字段但不消费**（用户已确认）。
6. **不做 max_alive / respawn_interval_sec / time_window 的存活维护**（留 S4b）：本批 NPC 视为**常驻**（按规则算出即始终在场）。
7. 规划阶段可提问，执行阶段不要反复问；单次提交聚焦一个任务。

**依赖前提**：S2（配置管线）、S2b（GM 场景与实体配置面板）、S3（组件化与交互）已完成——S4 的 `AiComponent` 挂载、NPC 交互都复用 S3 的组件模型。

---

## 1. 设计

### 1.1 缺口盘点（本批要动的东西）

| # | 缺口 | 现状 | S4 处置 |
|---|---|---|---|
| 1 | 无出现规则表 | `scene_entity_spawns` 只能表达「固定坐标 + 固定生成」 | 新增 `npc_spawn_rules`（`fixed/random/patrol` 三分支 + `condition`） |
| 2 | 无巡逻路径表 | `npc_templates.moveRange`/`isAutoWander` 是**死字段**（全库无消费点） | 新增 `npc_patrol_routes`（`points jsonb` + `loopMode` + `speed`），`moveRange`/`isAutoWander` 明确弃用 |
| 3 | NPC 位置只有「进场景那一刻」 | `world.enter-scene` 下发 `spawns`（含 npc 固定坐标），此后 NPC 永不移动 | 进场景**新增** `npcs` 字段（含路点/速度）+ 服务端低频广播校正 |
| 4 | 服务端无任何定时广播 | gateway 仅 4 个订阅（`player.heartbeat`/`world.enter-scene`/`world.move`/`chat.send`），`entity_update` 只在 `world.move` 里发玩家包 | 新增 `NpcTickService`（`@Cron('*/2 * * * * *')`）推进位置 → EventBus → 房间广播 |
| 5 | 配置靠 SQL | — | GM 面板 `admin/panels/npc-rules.js`（规则列表 + 路径点表格录入） |
| 6 | 客户端无 NPC AI | S1 的 NPC 是静止色块 | `AiComponent`：路点插值 + 校正纠偏（**不做自主决策**） |

### 1.2 已核实的事实（实现时不要再猜）

**后端**
- gateway 现有订阅仅 4 个（[game.gateway.ts:142/161/213/248](file:///e:/code/nest/packages-game/game-server/src/modules/gateway/game.gateway.ts#L142)）；`world.move` 广播原文：
  `this.server.to('scene:'+sceneId).emit('message', { cmd:'world.entity_update', seq:0, code:0, msg:'success', data:{ entityId:'player:'+playerId, entityType:'player', playerId, pos:{x,y}, rotation, state:'move' } })`
  → **NPC 校正必须复用同一 cmd 与同一事件名 `'message'`**，`entityType` 用 `'npc'`。
- `world.enter-scene` 应答（[game.gateway.ts:200-210](file:///e:/code/nest/packages-game/game-server/src/modules/gateway/game.gateway.ts#L200-L210)）：`{cmd:'world.enter_scene_sync', seq, code:0, msg:'success', data:{scene, spawns, triggers}}`；`spawns`/`triggers` 来自 `worldService.enterScene`。
- 定时任务写法（[scheduler.service.ts:87-99](file:///e:/code/nest/packages-game/game-server/src/scheduler/scheduler.service.ts#L87-L99)）：`@Cron('*/5 * * * * *')` + 注入业务 service + `try/catch` + `logger.error`。**每 5 秒 tick 有先例**。
- 事件总线已有先例：`this.eventBus.emit(GameEvents.CONFIG_UPDATED, {...})`（[config.service.ts:120-124](file:///e:/code/nest/packages-game/game-server/src/modules/config/config.service.ts#L120-L124)）→ 可用于「业务 service → gateway」解耦。
- `npc_templates` 字段：`interactType(NpcInteractType)/dialogueId/moveRange/isAutoWander/attr`；`talkNpc` 现有实现（[world.service.ts:178-212](file:///e:/code/nest/packages-game/game-server/src/modules/world/world.service.ts#L178-L212)）按 **`scene_entity_spawns.id`（spawnId）** 查 NPC。
- 枚举：`NpcInteractType(talk/shop/quest/transport)`、`EntityType(npc/monster/object)`、`MonsterAiType(patrol/guard/...)`（游戏侧不用）；`TriggerType` 已有 `transport`（**不是 `portal`**）。
- 建表方式：生产 `DB_SYNCHRONIZE=true` 自动建表/加列（**无 migration 目录**，`typeorm:run` 仅备用）；seed 脚本必须 `synchronize:false`。
- admin 面板注册协议：`window.XGamePanels['<id>'] = { label, icon, order, component:{ template, setup } }`（见 [risk-recover.js:16-21](file:///e:/code/nest/packages-game/game-server/admin/panels/risk-recover.js#L16-L21)）；共享层 `window.XGameCore` 提供 `api/toast/confirmDanger/分页`。

**客户端（S3 之后的形态）**
- 实体 id 约定：`player:<playerId>` / `npc:<spawnId>` / `object:<spawnId>`（总纲 §7）；S4 的随机/巡逻 NPC **没有 `scene_entity_spawns` 行**，需要新的 id 形式（见 D2）。
- 交互半径与选中逻辑在 S3 的 `InteractController.pickTarget()`；NPC 的 `TalkComponent` 依赖 `spawnId` → **随机/巡逻 NPC 的可交互性需要服务端给出可寻址 id**（见 D2）。
- 广播处理入口在 [Main.ts](file:///e:/code/nest/packages-game/game-client/src/boot/Main.ts) 对 `world.entity_update` 的订阅（S3 后由 EntityRegistry `upsert` 承接）。
- 本地 `scripts/mock-redis.js` 的 `SET NX` 恒 OK → 任何"冷却/一次性"校验在本地不可验证。

### 1.3 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **位置/巡逻是「场景级」，存在性是「玩家级」** —— 场景内 NPC 实例的位置由服务端统一推进并**向房间广播（所有人一致）**；而「这名玩家能不能看到/交互」由 `condition`（`minLevel`/`questId`）在**进场景时按该玩家过滤**下发 | 解掉总纲 §10 的隐含矛盾：`condition` 天然是 per-player，而广播天然是 per-scene。若不拆开，要么广播泄漏条件、要么多端看到不同位置（破坏 S1 #7 精神） |
| D2 | **NPC 实例寻址 = `npcs:<ruleId>:<slot>`**（`slot = 0..spawn_count-1`）；`fixed` 规则沿用现有 `scene_entity_spawns` 与其 `npc:<spawnId>` 寻址 | 随机/巡逻 NPC 无 spawn 行；`slot` 让同一规则生成多个实例仍可寻址、可校正、可被客户端 `upsert` |
| D3 | **`fixed` 不建实例、`random`/`patrol` 才由规则生成**：`fixed` 规则只承载「condition 过滤 + 开关」，位置仍来自 `scene_entity_spawns` | 避免同一 NPC 有两个位置真源 |
| D4 | **校正走 EventBus → gateway**（不直接注入 gateway） | 避免 `Scheduler ↔ Gateway` 循环依赖；与 `config.service` 既有 emit 风格一致 |
| D5 | **客户端只插值不做决策**：服务端下发 `points`/`speed`/`loopMode`，客户端线性插值；收到校正包时按距离**平滑纠偏**（不瞬移） | 总纲 §10 权威边界；省带宽（2s 一条 vs 每秒一条） |
| D6 | **`random` 的随机只发生一次/场景**：同一场景同一规则在服务端内存里生成后**保持稳定**，直到服务重启或规则变更 | 否则每次广播都要重算，玩家会看到 NPC 乱跳 |
| D7 | **tick 只跑「有玩家在场的场景」** | 50 人上限下房间少；空场景不空转（2G 服务器约束） |

### 1.4 文件结构（S4 全部新增/修改）

**后端（新增）**

| 路径（相对 `packages-game/game-server/`） | 职责 |
|---|---|
| `src/modules/world/entities/npc-spawn-rule.entity.ts` | `npc_spawn_rules` 表 |
| `src/modules/world/entities/npc-patrol-route.entity.ts` | `npc_patrol_routes` 表 |
| `src/modules/world/npc/npc-presence.service.ts` | 按玩家算在场 NPC（三分支 + condition 过滤）+ 场景级实例位置推进 |
| `src/modules/world/npc/npc-presence.service.spec.ts` | 单测（三分支 / 过滤 / 路点插值边界） |
| `src/modules/world/npc/npc-tick.service.ts` | `@Cron` 低频推进 + emit `NPC_POSITIONS_UPDATED` |
| `src/modules/world/npc/npc-tick.service.spec.ts` | 单测（空场景不广播 / 有玩家才推进 / 广播 payload 结构） |
| `src/modules/world/dto/npc-rule.dto.ts` | 面板用 DTO（规则 CRUD + 路径 CRUD） |
| `src/modules/world/npc-admin.controller.ts` | `api/admin/v1/world/npc-rules/*`（列表/创建/更新/删除 + 路径 CRUD） |
| `admin/panels/npc-rules.js` | GM 面板（规则列表 + 路径点表格录入） |
| `seeds/npc-demo.seed.ts` | 演示数据（1 条 random + 1 条 patrol，幂等；`synchronize:false`） |

**后端（修改）**

| 路径 | 动作 |
|---|---|
| `src/constants/enums.ts` | +`NpcSpawnRuleType(fixed/random/patrol)`、+`NpcPatrolLoopMode(loop/pingpong/once)` |
| `src/modules/world/world.module.ts` | 注册 2 实体 + 2 service |
| `src/modules/world/world.service.ts` | `enterScene` 结果增加 `npcs`（委托 `NpcPresenceService`） |
| `src/modules/gateway/game.gateway.ts` | ①`enter-scene` 应答 `data` 增 `npcs`；②订阅 EventBus 的新事件并向 `scene:<id>` 广播 |
| `src/event-bus/game-events.ts` | +`NPC_POSITIONS_UPDATED` |
| `admin/index.html` | 引入 `panels/npc-rules.js`（一行） |
| `package.json` | +`seed:npc-demo` |

**客户端（`packages-game/game-client/`）**

| 路径 | 动作 |
|---|---|
| `src/entity/components/AiComponent.ts` | 新建：路点插值 + 校正纠偏 + `pauseSec` 停留 |
| `src/entity/components/interact/TalkComponent.ts` | 修改：支持 `npcs:<ruleId>:<slot>` 形态的可寻址交互 |
| `src/net/ws.ts` | 修改：`world.entity_update` 的 `entityType='npc'` 分支（现有分支只处理 player） |
| `src/config/schema.ts` | 修改：新增 `NpcInstanceConfig` 类型（`npcId/npcTemplateId/resKey/x/y/route{points,speed,loopMode}`） |
| `config-schema/scene-config.schema.json` | **不动**（NPC 实例是**动态下发**，不进静态配置包；S2 的 schemaVersion 保持 1） |

### 1.5 验收映射（S4 完成定义 → 任务）

| # | S4 验收项 | 落点 | 判定方式 |
|---|---|---|---|
| A1 | 三分支都能产出正确在场集 | Task 2/7 | 单测 + 冒烟：fixed 用 spawn 行、random 落在 `spawn_radius` 内且 `spawn_count` 个、patrol 有路点 |
| A2 | `condition` 按玩家过滤 | Task 2/7 | 两个不同等级账号进同一场景，低等级看不到 `minLevel` 不满足的 NPC（服务端返回条数不同） |
| A3 | 进场景下发契约向后兼容 | Task 3/7 | `data.spawns/triggers/scene` 字段与内容不变；新增 `npcs`；S1 冒烟 9/9 不回归 |
| A4 | 服务端校正广播有效 | Task 4/7 | 双客户端在场时，两端在 ~2s 内收到相同 NPC 位置（`entityType='npc'`），位置由服务端算 |
| A5 | 客户端插值平滑、校正不瞬移 | Task 5 | 观察 NPC 连续移动；校正后位置变化被平滑（单帧位移不超过阈值） |
| A6 | 空场景不空转 | Task 4 | 无玩家在场景时 tick 不产生广播（日志断言） |
| A7 | 面板可录入并生效 | Task 6/7 | 面板建一条 patrol 规则 + 3 个路径点 → 进场景 NPC 沿点移动 |
| A8 | 旧契约零改动 + 回归全绿 + 零新增依赖 | Task 7 | `npm test` 全绿（基线不降）；`world.move`/`enter-scene` 旧字段无签名变更；`package.json` 依赖无变更 |

### 1.6 测试基线

- **后端**：`npm test` 全绿；新增 2 个 spec（`npc-presence` ≥8 用例、`npc-tick` ≥4 用例），基线 998 tests 不下降。
- **客户端**：沿用 S3 口径（零依赖断言脚本 + 浏览器点检）；`AiComponent` 的插值/纠偏纯函数用 `scripts/smoke-s4-npc.mjs` 断言。
- **冒烟**：`node scripts/smoke-s4-npc.mjs`（服务端侧）：登录 → 进场景 → 断言 `npcs` 下发 → 等待一个 tick → 断言收到 `entityType='npc'` 的广播且坐标在路点区间内。

### 1.7 已知限制（S4 明确不覆盖）

1. **不做存活维护**：`max_alive` / `respawn_interval_sec` / `time_window` 字段建了但不消费（S4b）。
2. **不做时段巡逻**：`schedule` 只存不消费。
3. **不做 NPC 战斗/怪物 AI**：monster 不在本批。
4. **不做视野裁剪**：NPC 广播是全房间的；50 人带宽属 S8。
5. **不做 NPC 寻路**：巡逻在路点间走直线，不绕障（无碰撞/地形数据）。
6. **`fixed` 规则的 NPC 仍不可移动**（只有 random/patrol 会动）。

---

## 2. Tasks

> cwd 默认 = `e:\code\nest\packages-game\game-server`（客户端步骤另行标注）。

### Task 1: 两张表 + 枚举 + 模块注册

**Files:** 新建 `src/modules/world/entities/npc-spawn-rule.entity.ts`、`npc-patrol-route.entity.ts`；修改 `src/constants/enums.ts`、`src/modules/world/world.module.ts`

- [x] **Step 1** 加枚举：`NpcSpawnRuleType { FIXED='fixed', RANDOM='random', PATROL='patrol' }`、`NpcPatrolLoopMode { LOOP='loop', PINGPONG='pingpong', ONCE='once' }`。
- [x] **Step 2** `npc_spawn_rules` 字段（照 [scene-entity-spawn.entity.ts](file:///e:/code/nest/packages-game/game-server/src/modules/world/entities/scene-entity-spawn.entity.ts) 的写法：bigint PK + 显式列名 + 软删三件套）：`scene_id`、`npc_template_id`、`rule_type`(enum)、`spawn_x/spawn_y`、`spawn_radius`、`spawn_count`(默认1)、`max_alive`、`respawn_interval_sec`、`time_window jsonb`、`condition jsonb`、`patrol_route_id`(bigint nullable)、`name`(varchar 64)、`is_active`(默认true)；索引 `(scene_id, is_active)`。
- [x] **Step 3** `npc_patrol_routes` 字段：`scene_id`、`npc_template_id`、`name`、`loop_mode`(enum 默认 loop)、`speed`(int，像素/秒，默认 60)、`points jsonb`（`[{x,y,pauseSec}]`，默认 `[]`）、`schedule jsonb`（nullable，本批不消费）、`is_active`；索引 `(scene_id)`。
- [x] **Step 4** 注册进 `world.module.ts` 的 `TypeOrmModule.forFeature([...])`（先读现状再改）。
- [x] **Step 5** 验证：`npx tsc --noEmit` → 0 error；后端起来后 `psql -U postgres -h localhost -d game_server -c "\d npc_spawn_rules"` 与 `\d npc_patrol_routes` 列齐（贴原始输出）。
- [x] **Step 6** commit `feat(npc): 新增 NPC 出现规则与巡逻路径两张表`

### Task 2: NpcPresenceService（三分支 + 条件过滤）

**Files:** 新建 `src/modules/world/npc/npc-presence.service.ts` + `.spec.ts`

- [x] **Step 1** `listNpcsForPlayer(sceneId, playerId)` 返回 `NpcInstance[]`：
  - 查场景激活的 `npc_spawn_rules`；`fixed` → 取 `scene_entity_spawns` 中 `entityType='npc'` 的行（沿用 S1 语义，**不从规则生成**）；`random` → 在 `spawn_x/y ± spawn_radius` 内取 `spawn_count` 个点（**每场景一次、服务端内存缓存，见 D6**）；`patrol` → 取关联 `npc_patrol_routes` 的路点，初始位置 = 第一个路点。
  - `condition` 过滤：支持 `minLevel`、`questId`（`questId` 用现有任务进度查询；等级用玩家数据）——两个键都支持，未识别的键**忽略并在 debug 日志记录**。
  - 返回项：`{ npcId, npcTemplateId, resKey, x, y, anim, route?: { points, speed, loopMode, cursor } }`；`npcId` 按 D2（`npcs:<ruleId>:<slot>`）。
- [x] **Step 2** `advanceTick(sceneIds: number[])`：对每个场景推进 patrol 实例的 `cursor/位置`（按 `speed` × tick 间隔、`pauseSec` 停留、`loopMode` 循环/往返/停），random/fixed 不动。**只更新内存态**（服务端不需要落库当前位置）。
- [x] **Step 3** 单测（≥8）：三分支各 1；`condition.minLevel` 过滤 1；`condition.questId` 过滤 1；`random` 点落在半径内 1；`random` 第二次调用位置稳定（D6）1；`pingpong` 到端点折返 1；`points` 为空/单点时行为（不崩、原地站）1；`advanceTick` 对 fixed/random 无副作用 1。
- [x] **Step 4** `npm test` → 全绿（贴 suites/tests 计数）。
- [x] **Step 5** commit `feat(npc): NPC 在场计算与巡逻位置推进服务`

### Task 3: 进场景下发契约扩展（向后兼容）

**Files:** 修改 `src/modules/world/world.service.ts`、`src/modules/gateway/game.gateway.ts`

- [x] **Step 1** `worldService.enterScene` 的返回对象增加 `npcs`（委托 `NpcPresenceService.listNpcsForPlayer`），**`scene`/`spawns`/`triggers` 原样不动**。
- [x] **Step 2** gateway `handleEnterScene` 的 `data` 增加 `npcs: sceneData.npcs`（[game.gateway.ts:205-209](file:///e:/code/nest/packages-game/game-server/src/modules/gateway/game.gateway.ts#L205-L209)）。
- [x] **Step 3** 契约冻结记录：在计划执行记录里写明「`world.enter_scene_sync` 新增字段 `npcs`，类型 `NpcInstance[]`，旧字段零变更」。
  - 契约冻结（Task 3 已落地）：`world.enter_scene_sync` 新增字段 `npcs`（类型 `NpcInstance[]`），旧字段零变更。
- [x] **Step 4** 验证（真实调用，非猜）：用 S1 冒烟脚本登录拿 token，WS 发 `world.enter-scene`，断言 `data.npcs` 存在且为数组；**同时断言 `data.spawns.length` 与 S1 一致**（13）。
- [x] **Step 5** commit `feat(npc): 进场景下发 NPC 实例（新增 npcs 字段，向后兼容）`

### Task 4: NPC tick 与低频校正广播

**Files:** 新建 `src/modules/world/npc/npc-tick.service.ts` + `.spec.ts`；修改 `src/event-bus/game-events.ts`、`src/modules/gateway/game.gateway.ts`、`src/modules/world/world.module.ts`

- [x] **Step 1** 加事件 `GameEvents.NPC_POSITIONS_UPDATED`，payload `{ sceneId, npcs: [{npcId, npcTemplateId, x, y, rotation?, state}] }`。
- [x] **Step 2** `NpcTickService`：`@Cron('*/2 * * * * *')`（每 2 秒，可配 `NPC_TICK_MS`）→ 取**当前有玩家在场的场景 id 列表**（复用现有连接/场景登记，如 `connectionService` 或房间查询；确认现有可用来源后写死依赖）→ `advanceTick(sceneIds)` → 有变化才 `eventBus.emit(NPC_POSITIONS_UPDATED, ...)`（空场景**不 emit**，D7）。
- [x] **Step 3** gateway：新增 EventBus 订阅 handler → `this.server.to('scene:'+sceneId).emit('message', { cmd:'world.entity_update', seq:0, code:0, msg:'success', data:{ entityId: npcId, entityType:'npc', npcTemplateId, pos:{x,y}, rotation, state } })`（**沿用同一 cmd/事件名**，见 §1.2）。
- [x] **Step 4** 单测（≥4）：空场景不 emit；有玩家才推进；广播 payload 字段与玩家包结构一致（`entityId/entityType/pos`）；tick 内异常被 catch 且不中断后续场景。
- [x] **Step 5** `npm test` 全绿；本地起后端观察日志中出现 tick 且无 error。
- [x] **Step 6** commit `feat(npc): NPC 位置 tick 与房间广播校正`

### Task 5: 客户端 AI 插值（cwd = `packages-game/game-client`）

**Files:** 新建 `src/entity/components/AiComponent.ts`；修改 `src/net/ws.ts`、`src/config/schema.ts`、`src/entity/EntityFactory.ts`、`src/entity/components/interact/TalkComponent.ts`

- [x] **Step 1** `AiComponent`：持有 `points/speed/loopMode/cursor`，每帧推进（按 `Laya.timer.delta`）；支持 `pauseSec` 停留；`applyCorrection(x,y)` 用**限速逼近**（单帧最大位移阈值，如 8px/帧）纠偏，不瞬移。
- [x] **Step 2** `ws.ts`：`world.entity_update` 增加 `entityType==='npc'` 分支 → `EntityRegistry.get(npcId)` 存在则 `applyCorrection`，不存在则**按下发数据创建**（防止漏包）。
- [x] **Step 3** `schema.ts` 加 `NpcInstanceConfig` 类型（与 Task 3 契约逐字段对齐）。
- [x] **Step 4** `EntityFactory`：按 `npcs[]` 建实体并挂 `AiComponent`（有 `route` 才挂）+ 复用 S3 的 `TalkComponent`。
- [x] **Step 5** `TalkComponent`：`npcs:<ruleId>:<slot>` 形态的 NPC 需要服务端可寻址的 talk 入口——**先只支持 `fixed` 类 NPC 对话**（现有 `npcs/:spawnId/talk`），其余给出「该 NPC 暂不可对话」提示，并在计划记录里标注（服务端 talk 接口扩展留 S5）。
- [x] **Step 6** 断言脚本：`node scripts/smoke-s4-npc.mjs`（纯逻辑部分）覆盖插值推进、pingpong 折返、纠偏限速。
- [x] **Step 7** 浏览器点检：双窗口进同一场景 → 两端 NPC 位置一致、连续移动、无抖动/瞬移。
- [x] **Step 8** commit `feat(game-client): NPC 路点插值与位移校正`

> **实施记录（2026-09-22）**
> - **限制**：`npcs:<ruleId>:<slot>`（patrol/random）形态的 NPC **暂不可对话**——服务端 `npcs/:spawnId/talk` 按 `spawnId` 寻址，非 `npc:<spawnId>` 形态无对应入口；客户端在 `TalkComponent` 中以「该 NPC 暂不可对话」提示收口，服务端 talk 接口扩展留 S5。
> - **纠偏语义修正**：校正**不能只在收到广播的那一帧走 `MAX_CORRECTION_STEP_PX`**（服务端 2s 一播 → 等效纠偏仅 4px/s，远低于 60px/s 巡逻速度）。两端「进场景时刻不同」造成的相位差会**永不收敛**（实测恒定 ~60px）。改为 `applyCorrection` 只记录误差、由 `AiComponent.consumeCorrection` **逐帧限速消费**（8px/帧 ≈ 200px/s）：既不瞬移，又能在约 0.3s 内对齐权威位置（实测两端口径差 median 3px / max 10.3px）。

### Task 6: GM 面板（规则 + 路径点）

**Files:** 新建 `src/modules/world/npc-admin.controller.ts`、`src/modules/world/dto/npc-rule.dto.ts`、`admin/panels/npc-rules.js`；修改 `admin/index.html`、`seeds/npc-demo.seed.ts`、`package.json`

- [x] **Step 1** admin 接口（全 `AdminGuard`，前缀 `api/admin/v1/world`）：`GET npc-rules/list?sceneId`、`POST npc-rules`、`PUT npc-rules/:id`、`DELETE npc-rules/:id`、`GET npc-routes/list?sceneId`、`POST npc-routes`、`PUT npc-routes/:id`、`DELETE npc-routes/:id`；写操作记 `adminService.logOperation`。
- [x] **Step 2** 面板 `admin/panels/npc-rules.js`：注册 `window.XGamePanels['npc-rules'] = { label:'NPC 规则', icon:'ti ti-walk', order:40, component:{...} }`；功能 = 规则列表（按场景筛选）+ 新建/编辑（规则类型、坐标、半径、数量、condition 的 minLevel/questId）+ 路径点表格（`x/y/pauseSec` 行内编辑，**不做拖拽**）+ 删除二次确认（`XGameCore.confirmDanger`）。
- [x] **Step 3** `admin/index.html` 只加一行 `<script src="panels/npc-rules.js"></script>`（照现有面板引入位置）。
- [x] **Step 4** `seeds/npc-demo.seed.ts`（`synchronize:false`，幂等）：给已有场景造 1 条 `random`（count=2, radius=120）+ 1 条 `patrol`（4 个路点围一圈）；`package.json` 加 `seed:npc-demo`。
- [x] **Step 5** 验证：`npm run seed:npc-demo` → 面板能看到 2 条规则；改一个路径点 → 进场景 NPC 走向改变。
- [x] **Step 6** commit `feat(npc): NPC 规则与巡逻路径 GM 面板`

### Task 7: 冒烟脚本 + 全量回归 + 验收

**Files:** 新建 `scripts/smoke-s4-npc.mjs`

- [x] **Step 1** 冒烟断言（每条 PASS/FAIL + 证据，FAIL 即 exit 1）：① 登录两个账号（不同等级）② 进场景拿到 `npcs` ③ 低等级账号 `npcs` 条数 ≤ 高等级（condition 生效）④ `random` 实例坐标落在半径内 ⑤ `patrol` 实例带 `route.points` ⑥ 2 个 tick 内收到 `entityType='npc'` 广播 ⑦ 两次广播的坐标不同（确实在动）⑧ 空场景无广播（用一个无人场景或退出后再观察）⑨ S1 的 `spawns.length` 仍是 13（旧契约不变）。
- [x] **Step 2** `node scripts/smoke-s4-npc.mjs` → Expected：9/9 PASS。
- [x] **Step 3** S1 冒烟回归：`node scripts/smoke-laya2d-s1.mjs` → 9/9 PASS。
- [x] **Step 4** 后端回归：`npm test` → 全绿，tests ≥ 998。
- [x] **Step 5** 契约与依赖自检：`git diff <基线> -- src/modules/gateway/game.gateway.ts` 无旧字段变更（仅新增）；`package.json` 无依赖变更。
- [x] **Step 6** commit `test(npc): S4 冒烟脚本与验收记录`

### Task 8: 生产部署与线上验收（若确认本批上线）

- [x] **Step 1** 本地 `npm run build` → 打包 dist → `scp` 到 `odoo:/tmp/`。
- [x] **Step 2** 服务器：备份旧 dist → 替换 → `systemctl restart game-server` → `journalctl -u game-server --since '-1 min'` 见 `successfully started`。
- [x] **Step 3** 核对新表已由 `DB_SYNCHRONIZE=true` 建出：`\d npc_spawn_rules`。
- [x] **Step 4** 线上造 1 条 patrol 规则（面板或 curl）→ 进场景点检 NPC 移动；留证（截图 + 广播日志）。
- [x] **Step 5** 无回归：线上 S1 冒烟 + 旧接口 200。
- [x] **Step 6** commit（如有脚本改动）`chore(npc): S4 部署与线上验收记录`

---

## 3. 风险与回退

| # | 风险 | 触发信号 | 回退动作 |
|---|---|---|---|
| 1 | tick 里广播 N 个 NPC 造成带宽/CPU 上升（2G 机器） | 服务器负载高、tick 延迟 | 降频（2s→5s）、只广播「有变化」的实例、必要时改批量 `world.npc_sync`（**另开决策，不擅自改契约**） |
| 2 | EventBus → gateway 链路不通（gateway 不是普通 provider 订阅方式不同） | 收不到广播 | 回退为 **gateway 直接暴露 `broadcastNpcPositions()` 并由 tick 调用**（用 `forwardRef` 处理循环依赖），或把 tick 逻辑搬进 gateway（`@WebSocketServer()` 已在手边） |
| 3 | `random` 位置每 tick 重算导致 NPC 乱跳 | 客户端观察到瞬移 | D6 的缓存必须落到位（按 `sceneId+ruleId` 缓存）；单测已覆盖 |
| 4 | 进场景新增字段被客户端旧代码忽略或误读 | 客户端报字段缺失 | `npcs` 为**新增可选字段**，客户端缺失时按空数组处理；S1 冒烟门禁保证旧路径不回归 |
| 5 | `patrol` 无路点/单点导致除零或卡死 | `NaN` 坐标 | `points.length < 2` 时原地静止；单测覆盖 |
| 6 | 面板路径点录入坐标写错（无拖拽） | NPC 走出地图 | 面板对 `x/y` 做范围校验（`0..mapWidth/mapHeight`，超界提示）；服务端 DTO 加 `@Min(0)` |
| 7 | 客户端 `entityType='npc'` 分支与 S1 的 player 分支冲突 | 玩家/NPC 混淆 | 分支按 `entityType` 严格区分；玩家包保留 `playerId` 字段作二次判据 |
| 8 | 生产 tick 在 2G 机器上堆积 | journalctl 报 tick 未完成 | 加「上一轮未结束则跳过本轮」的互斥标记；tick 内 `try/catch` 不中断 |

---

## 4. 待确认项（动手前请回答）

1. **NPC 实例寻址（D2）**：接受 `npcs:<ruleId>:<slot>` 吗？（另一选项是新增 `npc_instances` 表持久化实例 —— 更重、需要落库与清理，本批不推荐。）
2. **随机 NPC 是「场景级一致」还是「玩家级各自随机」**：本计划按 D1/D6 取**场景级一致**（同场景所有人看到同一个）+ **condition 玩家级过滤可见性**。总纲 §10 原文是「随机数由服务端生成后随 enter-scene 下发」，字面更像玩家级——请确认以哪种为准（这决定多端一致性）。
3. **校正频率**：默认每 2 秒（`NPC_TICK_MS` 可配）。若你希望更省，可设 5 秒（客户端插值压力更小、纠偏幅度更大）。
4. **`TalkComponent` 对 random/patrol NPC 的支持**：本批只让 `fixed` NPC 可对话（服务端 `talk` 按 `spawnId` 查），随机的走「暂不可对话」提示。是否接受？（扩展 `talk` 接口属 S5 对话系统。）
5. **本批是否上线生产**：Task 8 默认执行，若要延后请说。

---

## 5. 执行方式

沿用 **Subagent-Driven**：每 Task 派新 subagent，Task 间两阶段评审，每 Task 提交后跑 S1 冒烟作为回归门禁。

任务依赖：Task 1 → Task 2 → Task 3 → Task 4 →（Task 5 客户端可与 Task 4 并行）→ Task 6 → Task 7 → Task 8。

---

## 6. 执行记录（S4）

> 执行时间：2026-09-22。环境：本机 PostgreSQL 16（`localhost:5432`，库 `game_server`）+ mock-redis（`:6379`）+ 后端 dev server（`:3000`，`nest start --watch`，scene 1 published = **v1**）。客户端断言在 `packages-game/game-client` 下跑构建产物。

### 6.1 各 Task 提交（本地主分支）

| Task | commit | message |
|---|---|---|
| Task 1 | `f0b6c0815` | feat(npc): 新增 NPC 出现规则与巡逻路径两张表 |
| Task 2 | `253072f5d` | feat(npc): NPC 在场计算与巡逻位置推进服务 |
| Task 3 | `3394e4b0a` | feat(npc): 进场景下发 NPC 实例（新增 npcs 字段，向后兼容） |
| Task 4 | `00383f407` | feat(npc): NPC 位置 tick 与房间广播校正 |
| Task 5 | `da238c406` | feat(game-client): NPC 路点插值与位移校正 |
| Task 6 | `834108b4e` | feat(npc): NPC 规则与巡逻路径 GM 面板 |
| Task 7 | `7897d2c8d` | test(npc): S4 冒烟脚本与验收记录 |
| Task 8 | （本次提交） | chore(npc): S4 部署与线上验收记录 |

### 6.2 门禁实测

| 项 | 命令 | 期望 | 实测 |
|---|---|---|---|
| S4 冒烟（服务端，新增） | `game-server: node scripts/smoke-s4-npc.mjs` | 9/9 PASS | **9/9 PASS**（末行「S4 冒烟全部通过」，退出码 0） |
| S1 冒烟回归 | `game-server: node scripts/smoke-laya2d-s1.mjs` | 9/9 PASS | **9/9 PASS**（末行「S1 冒烟全部通过」） |
| 后端回归 | `game-server: npx jest --silent` | 全绿，tests ≥ 998 | **Test Suites: 83 passed / 83；Tests: 1031 passed / 1031** |
| 客户端断言 | `game-client: node tools/build-fallback.mjs; node scripts/smoke-s4-npc.mjs` | 18/18 PASS | **构建 OK（27 个产物重写导入扩展名）；18/18 PASS，退出码 0** |

> **基线核对**：§1.6 写的「基线 998 tests」已过时（S3 验收时实际基线为 **83 suites / 1031 tests**）。本次实测保持 **83/1031**，未下降。

### 6.3 Task 7 冒烟脚本原始输出（9 条断言）

```
  后端 /health 可达（http://localhost:3000）
  admin 登录成功（token=eyJhbGciOiJI…）
  临时规则已新建：id=6（condition={minLevel:5}）
  ⚠️ 本次新建了临时规则：若断言 ③ 未通过，请重启后端进程（场景级实例缓存）后重跑
  账号等级：spike01=1（playerId=1），spike02=5（playerId=3）
PASS ① 登录两个账号（等级不同） :: low=1(lv1) high=3(lv5)
PASS ② 进场景应答携带 npcs 数组 :: cmd=world.enter_scene_sync code=0 npcs=6
PASS ③ 低等级 npcs 条数 ≤ 高等级，且低等级看不到 condition 不满足的 NPC :: low=6 high=7；临时规则(npcs:6:) 低等级可见=false 高等级可见=true
PASS ④ random 实例坐标落在 spawn_x/y ± spawn_radius 内 :: rule=3 期望 2 个 → 实际 2 个；中心=(600,380) r=120；坐标=(537.9,461.5) (533.7,317.3)
PASS ⑤ patrol 实例带 route.points 且路点数 = 4 :: rule=4 实例=1 带路点=1；points=4 speed=60 loopMode=loop
PASS ⑥ 7s 窗口内收到 entityType='npc' 的 world.entity_update 广播 :: 首个广播 +548ms，共 8 条；entityId=npcs:4:0
PASS ⑦ 同一 NPC 的两次广播坐标不同（服务端确实在推进位置） :: entityId=npcs:4:0 坐标序列=(615.1,464.9) → … → (597.0,283.0)
PASS ⑧ 玩家全部离开后 6s 内无该场景 npc 广播 :: 离开后 0 条 npc 广播
PASS ⑨ 旧契约不回归：data.spawns.length === 13 :: spawns=13（期望 13）triggers=2

S4 冒烟全部通过
[清理] 删除临时规则 id=6：code=0 msg=success
```

> 断言 ⑥ 的 8 条 = 4 个 tick × 2 个客户端 socket（A/B 各收一份，用于同时证明「房间广播对两端一致」）；断言 ⑧ 的观察窗口在 `socket.close()` → `handleDisconnect` → `leaveScene` 摘除 `scenes:active` 之后开始。

### 6.4 测试数据准备与清理（断言 ③ 的 condition 验证）

| 项 | 做法 | 清理 |
|---|---|---|
| 不同等级账号 | 本地两个账号默认都是 1 级；临时 `UPDATE players SET level=5 WHERE id=3;`（spike02） | 已还原 `level=1`（实测 `spike01=1 / spike02=1`） |
| condition 规则 | seed 规则无 `condition`，故用 admin 接口临时建 1 条 `random`（`condition={minLevel:5}`、`name=smoke-tmp-minlevel5`）；**脚本自建**，规则 id=6 | 脚本收尾 `DELETE npc-rules/6` → `code=0`；DB 实测 `deleted_at` 已置位 |
| 临时脚本/进程 | 冒烟脚本本身为交付物（保留）；重启探针 `src/__restart_probe.ts` 已删除 | 已删除，`git status` 无残留 |

### 6.5 契约与依赖自检（A3 / A8）

- `git diff 14a297623 -- packages-game/game-server/src/modules/gateway/game.gateway.ts`：**仅新增**——
  - `import { Namespace, Server, Socket }`（新增 `Namespace` 类型，用于读房间表）；
  - 新增 `@OnEvent(GameEvents.NPC_POSITIONS_UPDATED) handleNpcPositions()`（空房间提前 return；广播 `world.entity_update`，`entityType='npc'`，沿用同一 cmd 与事件名 `'message'`）；
  - `world.enter-scene` 的 `data` **新增 `npcs: sceneData.npcs`**，`scene/spawns/triggers` 原样不动；
  - `sceneId` 由 `message?.data?.sceneId` 改为 `String(rawSceneId)` 归一（房间名仍为 `scene:1`，响应契约不变）。
  - 结论：**无旧字段删除/改名，无旧行为语义变更**；S1 冒烟 9/9 复跑通过。
- `git diff 14a297623 -- packages-game/game-server/package.json`：**仅 1 行 `scripts` 新增**（`"seed:npc-demo": "ts-node -r tsconfig-paths/register seeds/npc-demo.seed.ts"`），**dependencies / devDependencies 零变更**（零新增依赖）。
- 客户端工程无独立 `package.json`（依赖复用 `game-server/node_modules`），S4 客户端改动同样零新增依赖。

### 6.6 A1–A8 逐条结论与证据

| # | 验收项 | 结论 | 证据 |
|---|---|---|---|
| A1 | 三分支都能产出正确在场集 | **PASS** | 冒烟 ④⑤ + 单测：`fixed` 用 `scene_entity_spawns`（scene 1 → 3 个，`npc:11/12/13`）；`random` 规则 id=3（count=2、r=120）产出 2 个实例且坐标 `(537.9,461.5)/(533.7,317.3)` 均在 `(600,380)±120` 内；`patrol` 规则 id=4 产出 1 个实例并携带 4 点路点（`speed=60 loopMode=loop`） |
| A2 | `condition` 按玩家过滤 | **PASS** | 冒烟 ③：同场景下低等级（lv1）`npcs=6`、高等级（lv5）`npcs=7`；临时规则 `npcs:6:*` 低等级可见 `false`、高等级可见 `true`（`condition={minLevel:5}`） |
| A3 | 进场景下发契约向后兼容 | **PASS** | 冒烟 ⑨ `data.spawns.length=13`、`triggers=2`（与 S1 一致）；新增 `data.npcs` 为数组（`NpcInstance[]`）；S1 冒烟 9/9 不回归；见 6.5 diff |
| A4 | 服务端校正广播有效 | **PASS** | 冒烟 ⑥⑦：进场景后 **+548ms** 即收到首个 `entityType='npc'` 的 `world.entity_update`；7s 内 4 个 tick 各 1 条（A/B 两端各收一份），同一 NPC `npcs:4:0` 坐标逐 tick 变化 `(615.1,464.9)→(572.7,452.7)→(512.1,367.9)→(597.0,283.0)`（位置由服务端算） |
| A5 | 客户端插值平滑、校正不瞬移 | **PASS** | 客户端断言 18/18：`applyCorrection` 当帧不瞬移（只记录误差）、逐帧限速消费（8 帧内精确到达且单帧位移 ≤ 8px）、单次校正后与权威同步（残差 `0.0000px`，最大单帧位移 `10.40` = 阈值 + 自由插值步长）；Task 5 双窗口实测两端口径差 median 3px / max 10.3px |
| A6 | 空场景不空转 | **PASS** | 冒烟 ⑧：玩家全部离开后 6s（≥2 tick）内**0 条**该场景 npc 广播；实现侧 `NpcTickService` 读 `scenes:active` 为空直接 return，`leaveScene` 在最后一人离开时 `sRem` 活跃标记，gateway 另做空房间双保险 |
| A7 | 面板可录入并生效 | **PASS** | Task 6 已落地 GM 面板（`admin/panels/npc-rules.js`，规则列表 + 路径点表格 + `confirmDanger` 二次确认）+ 8 个 `AdminGuard` 接口；本次冒烟通过 admin 接口建/删 `condition` 规则即为该链路的端到端复证（建 → 进场景生效 → 删） |
| A8 | 旧契约零改动 + 回归全绿 + 零新增依赖 | **PASS** | `npx jest --silent` → 83 suites / 1031 tests 全绿（基线未下降）；gateway diff 仅新增；`package.json` 依赖零变更；客户端 18/18 PASS |

### 6.7 已知限制（S4 明确不覆盖，如实记录）

1. **规则变更需重启进程**：`NpcPresenceService` 的场景级实例缓存（`sceneInstances` / `randomPoints`）**不随规则增删改失效**；本次验证即依赖「重启后端（`nest start --watch` 重编译触发新进程）后再跑断言」的顺序，脚本在自建临时规则时会打印该提示。
2. **`TalkComponent` 只支持 `fixed` 类 NPC 对话**：`npcs:<ruleId>:<slot>`（random/patrol）形态无服务端可寻址的 talk 入口，客户端以「该 NPC 暂不可对话」收口；服务端 `talk` 接口扩展留 S5。
3. **`max_alive` / `respawn_interval_sec` / `time_window` / `schedule` 建字段不消费**：NPC 视为常驻；巡逻时段表只存不用（用户已确认）。
4. **`random` 为「场景级一致」**：同场景所有玩家看到同一批随机点（服务端内存缓存，D6），`condition` 只做玩家级可见性过滤。
5. **不做寻路**：巡逻在路点间走直线，不绕障（无碰撞/地形数据）；`points.length < 2` 时原地静止。
6. **不做视野裁剪**：NPC 广播是全房间的（50 人带宽属 S8）。

### 6.8 Task 8 生产部署与线上验收（2026-09-22 执行）

**部署目标**：SSH 别名 `odoo`（39.106.99.9），站点 `https://game.joho.cn`，应用目录 `/opt/game-server`，服务 `game-server`，入口 `node dist/src/main`。

| Step | 动作 | 实测 |
|---|---|---|
| 1 | 本地构建 | `npm run build` → 退出码 0；`dist/` = `{seeds,src,tsconfig.build.tsbuildinfo}`，含 `dist/src/modules/world/npc/{npc-presence,npc-tick}.service.js`、`npc-admin.controller.js`、`entities/npc-{spawn-rule,patrol-route}.entity.js`、`dto/npc-rule.dto.js`、`seeds/npc-demo.seed.js` |
| 1 | 打包上传 | `tar.exe -czf dist-s4.tar.gz -C dist .` → 682653 字节；`scp` 到 `odoo:/tmp/`；两端 md5 一致（`6da46d978e4dbc98eec70c767952f2a0`） |
| 2 | 备份替换重启 | 备份 `dist_prev_20260922_064125` → `rm -rf dist && mkdir dist` → `tar -xzf` → 解包后顶层仍是 `seeds/src/tsconfig.build.tsbuildinfo`、入口 `dist/src/main.js`（与旧结构一致）→ `systemctl restart game-server` → `is-active` = **active** |
| 2 | 启动日志 | `Nest application successfully started` + `Game server started on port 3000`；`journalctl --since "-5 min"` 中 `error` 计数 **0**；8 条 `/api/admin/v1/world/npc-{rules,routes}*` 路由已 Mapped |
| 3 | 新表核对 | `\d npc_spawn_rules`：17 列（`id/scene_id/npc_template_id/rule_type/spawn_x/spawn_y/spawn_radius/spawn_count/max_alive/respawn_interval_sec/time_window/condition/patrol_route_id/name/is_active/created_at/updated_at/deleted_at`）+ `idx_npc_spawn_rule_scene(scene_id,is_active)`；`\d npc_patrol_routes`：11 列（`id/scene_id/npc_template_id/name/loop_mode/speed/points/schedule/is_active/created_at/updated_at/deleted_at`）+ `idx_npc_patrol_route_scene(scene_id)`。均由 `DB_SYNCHRONIZE=true` 自动建出 |
| 4 | 线上造数据 | 用 admin 接口（**在服务器内 curl，凭据不出服务器**）建 `npc-routes` id=1（`S4-demo-route-4pt`，4 点 `(700,380)(700,480)(600,480)(600,380)`，speed=60，loop）+ `npc-rules` id=1（`S4-demo-patrol-rule`，patrol，patrolRouteId=1）→ 均 `code:0` |
| 5 | 无回归 | 线上 S1 冒烟 `SMOKE_API=http://game.joho.cn node scripts/smoke-laya2d-s1.mjs` → **9/9 PASS**；`https://game.joho.cn/gamedata/manifest.json` 200、`https://game.joho.cn/health` 200 |
| 7 | 清理 | 服务器 `/tmp/dist-s4.tar.gz` 与本地临时包均已删除（未入库） |

**线上 S4 点检原始输出**（`http://game.joho.cn`，websocket transport）：

```
PASS ① 线上 /health 可达 :: http://game.joho.cn/health → 200
PASS ② 登录/注册线上测试账号 :: playerId=123
PASS ③ 进场景应答 world.enter_scene_sync :: cmd=world.enter_scene_sync code=0
PASS ④ 旧契约不回归：data.spawns.length === 13 :: spawns=13 triggers=2
PASS ⑤ 新增 npcs 数组下发 :: npcs=4；ids=npc:11,npc:12,npc:13,npcs:1:0
PASS ⑥ 线上 patrol 规则实例携带 route.points(4) :: npcId=npcs:1:0 x=700 y=380 points=4 speed=60 loopMode=loop
PASS ⑦ 8s 窗口内收到 entityType=npc 的 world.entity_update 广播 :: 首个 +1387ms，共 4 条；entityId=npcs:1:0
PASS ⑧ 同一 NPC 多次广播坐标在变化（服务端权威推进） :: entityId=npcs:1:0 坐标序列=(700.0,480.0) → (620.0,480.0) → (600.0,380.0) → (660.0,380.0)
```

**结论**：S4 服务端能力在线上生效（新表自动建出、patrol 规则经 admin 接口录入后进场景即下发路点，并以 `entityType='npc'` 的房间广播做权威位置校正）；旧契约 `spawns=13`/`triggers=2` 与 S1 全链路均不回归。**未触发回滚**（无需回滚）。

**遗留问题（如实记录）**

1. **HTTPS(443) 下 socket.io 握手在本机不可达**：`https://game.joho.cn/socket.io/?EIO=4&transport=polling` 由 node 直连返回 400（服务端仅支持 websocket transport），但 socket.io 客户端的 `transport=websocket` 升级请求**未出现在 nginx 访问日志中**（`:80` 同请求有 101 记录），且本机 TLS 栈本身异常（`curl.exe` 报 `getaddrinfo() thread failed to start`、`Invoke-WebRequest` 报证书信任失败）。判定为**本机环境问题**，非服务端故障；线上验收改走 `http://game.joho.cn`（websocket）全量通过。
2. **443 站点配置缺 WebSocket 升级头**：`game.joho.cn-ssl.conf` 的 `location /` 无 `proxy_http_version 1.1` / `Upgrade` / `Connection`（`:80` 的 `game.joho.cn.conf` 在 server 级有）。若浏览器端以 `wss://game.joho.cn` 连接，将无法升级。**建议核查**（本次未擅自修改 nginx）。
3. **线上演示数据保留**：`npc_spawn_rules` id=1 + `npc_patrol_routes` id=1 留在生产场景 1（新手村），可在 GM 面板「NPC 规则」中删除。
4. **规则变更需重启**：沿用 §6.7-1，线上新增/改动规则后需 `systemctl restart game-server` 才生效（场景级实例缓存不失效）。
5. 线上点检新建了 1 个测试账号（`smoke_s4prod_*`，与既有 64 个 smoke 账号同类，未清理）；S1 冒烟另建 `spike01/spike02`。