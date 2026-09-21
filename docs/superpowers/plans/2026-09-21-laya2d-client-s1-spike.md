# LayaAir 2D 客户端 S1（工程与最小闭环 / Spike）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages-game/game-client` 落地 LayaAir 3.x 客户端最小可运行工程，跑通「命令行构建 → H5 打开 → 登录 → 加载配置包 → 进场景 → 见 NPC → 采集与对话 → 双窗口互见移动」的完整闭环，并实证 LayaAir 命令行构建工具链。

**Architecture:** 客户端分四层：`platform/`（H5/小游戏差异收敛）、`net/`（HTTP + socket.io WS，严格对齐后端帧结构）、`config/`（版本化配置包加载与轻量校验）、`world/ + entity/`（静态层由配置包渲染，动态层由服务端权威下发，按 `spawnId` 求交去重、配置包优先）。后端只做两处最小改动：修 `scene_triggers.scene_id` 缺失、新增 NPC 对话接口。

**Tech Stack:** LayaAir 3.4（IDE 自带引擎，`laya.core.js` + `laya.ui.js`）、TypeScript 5.7（复用 `game-server/node_modules` 的 tsc，零新增依赖）、socket.io-client 4.8.3（从 `game-server/node_modules` vendor 一份 min.js，零新增依赖）、NestJS 11 + TypeORM + PostgreSQL 16 + mock-redis。

---

## 0. 执行前必读（硬约束）

1. **不准碰 vendure**：任何命令不得进入 `e:\code\nest\packages-game\vendure` 或 vcash 相关目录。
2. **不新增依赖**：`game-client` 不安装任何 npm 包（引擎随 IDE、tsc/socket.io-client 从 `game-server/node_modules` 借用）。后端不新增运行时依赖。
3. **2G 服务器禁止构建**：本计划**全部构建在本地完成**，远端只做后续 S2/S7 的静态产物同步，S1 **不做任何生产部署**。
4. **规划阶段可提问，执行阶段不要反复问**：执行中遇到与「§1.2 已核实的事实」冲突的情况，按事实修正并在 commit message 里写明，不要停下来提问。
5. **客户端落位**：`e:\code\nest\packages-game\game-client`（与后端同仓）。
6. 全部提交遵守仓库 commitlint（conventional commits），单次提交聚焦一个任务。

**本机环境事实**：Node v20.19.6（有内置 fetch）、PostgreSQL 16 @5432（postgres/postgres，库 `game_server`）、无 Docker、LayaAir IDE 装在 `D:\Program Files\LayaAirIDE\LayaAirIDE.exe`（未加 PATH）。

---

## 1. 设计

### 1.1 缺口盘点（本计划要动的东西）

| # | 缺口 | 现状 | S1 处置 |
|---|---|---|---|
| 1 | 无客户端工程 | `packages-game/` 下只有 `game-server` 与 vendure | 新建 `game-client/`，18 个源码文件 + 7 个工具脚本 |
| 2 | 命令行构建未实证 | 无任何脚本 | 主路径 IDE CLI（`--script=Build.buildWeb`）+ 兜底 tsc 构建 |
| 3 | `scene_triggers` 无 `scene_id` | 触发器无法按场景归属 | 加列 + 索引 + 修 `getSceneTriggers` 过滤 + DDL 脚本（生产只产出不执行） |
| 4 | 世界内容基线为 0 | `scenes/spawns/triggers/npc_templates/object_templates` 全 0 行 | 新增 `seeds/scene-spike.seed.ts` 播种 1 场景 + 10 物件 + 3 NPC + 2 触发器 |
| 5 | 配置包不存在 | 无导出管线（S2 才做） | S1 由 seed 顺手生成 `assets/config/{manifest.json,scene-1-v1.json}`，走轻量校验（S2 换成正式导出脚本） |
| 6 | NPC 对话接口不存在 | `world.client.controller.ts` 无 npcs 路由 | 新增 `POST /api/client/v1/world/npcs/:spawnId/talk` + `worldService.talkNpc` + 单测 |
| 7 | 本地后端起不来 | `CacheService.onModuleInit` 直接连 Redis，本机无 Redis | 用现成 `scripts/mock-redis.js` 顶替，起服务前先启动它 |

### 1.2 已核实的事实（实现时不要再猜）

**后端**
- `WS 帧`：请求 `{cmd, seq, data}`；应答 `{cmd, seq, code, msg, data}`；广播固定事件名 `message`。`world.enter-scene` 的应答 `cmd` 是 **`world.enter_scene_sync`**，`data = {scene, spawns, triggers}`。
- `world.move` 广播 **含自己**：`server.to('scene:<id>').emit('message', {cmd:'world.entity_update', seq:0, code:0, data:{entityId:'player:<id>', entityType:'player', playerId, pos:{x,y}, rotation, state:'move'}})`。客户端必须忽略 `playerId === 自己` 的广播。
- WS gateway：namespace `/game`，`transports:['websocket']`，token 取 `handshake.query.token`。
- `WsExceptionFilter` 异常时也走 `message` 事件，`cmd` 回填为请求的 `cmd`、`seq` 回填请求 seq，`code` 非 0 → 客户端按「同 cmd+seq 的错误应答」处理即可。
- `GameException` 一律 **HTTP 200** + body `{code, msg, data}`；非 GameException（如 401）才用 HTTP 状态码。→ 客户端 HTTP 层必须判 `body.code !== 0`，不能只看 HTTP status。
- `world.service.ts` 中 `interactObject(playerId, objectId, interactType)` 的 `objectId` 是 **`object_templates.id`**（不是 spawn id）。
- `scene_entity_spawns.sceneId` / `scene_triggers.targetSceneId` / `object_templates` 主键均为 `type:'bigint'` → **TS 里是 string**。
- `npc_templates` 字段：`name/resKey/scale/defaultAnim/interactType(NpcInteractType)/dialogueId/moveRange/isAutoWander/attr jsonb` → S1 的对话文案从 **`attr.greeting`** 取。
- `object_templates` 字段：`name/resKey/type(ObjectType)/interactCd/reward jsonb/animOpen/isOneTime`。
- 枚举真值（以 `src/constants/enums.ts` 为准）：`ObjectType(chest/collect/stone/plant/landmark)`、`TriggerType(transport/story/battle/activity/puzzle/gate/trap)`、`NpcInteractType(talk/shop/quest/transport)`、`EntityType(npc/monster/object)`、`InteractType(collect/hide/camp/sit/lie/carve/read/mount/fish/play)`、`CurrencyType.GOLD='gold'`。
  - ⚠️ 总纲 §5.1/§6 示例里的 `"type": "portal"` 是笔误，**实际枚举值是 `transport`**，本计划一律用 `transport`。
- 登录接口：`POST /api/client/v1/auth/login`（`LoginDto{username≥3, password≥6, deviceId}`）与 `POST /api/client/v1/auth/register`（`RegisterDto{username 3-32 ^[a-zA-Z0-9_]+$, password 6-64, nickname 2-16, deviceId}`），均 `@Public()` + 限流 5 次/60s。返回 `{token, accountId, playerId}`。
  - ⚠️ **`deviceId` 实测必须传**：DTO 里写的是 `deviceId?: string`（看似可选），但**没有 `@IsOptional()`**，而 `main.ts` 的全局 `ValidationPipe` 是 `{whitelist:true, forbidNonWhitelisted:true}` → 不传 deviceId 会直接 **HTTP 400**（`deviceId must be a string`）。仓库里所有既有 smoke 脚本（`smoke-stage1~5b.sh`、`smoke-p07/p08/eco.sh`）都传了 deviceId。**结论：S1 一律带上 deviceId（客户端 `AppConfig.deviceId`，冒烟脚本用 `smoke-s1-a/b`），不改后端 DTO**（改 DTO 会动既有接口契约，违反验收 #9）。
  - ⚠️ **login 与 register 必须用不同的 body**：login 的 DTO 不含 `nickname`，在 `forbidNonWhitelisted` 下多传 `nickname` 会 **HTTP 400**。因此 `auth()` 必须先只用 `{username,password,deviceId}` 试登录，失败再带 `nickname` 走注册。
- 物件交互：`POST /api/client/v1/world/objects/:id/interact`，body `{interactType}`，需 JWT。
- 触发器：`POST /api/client/v1/world/triggers/:id/activate`，body `{memberIds?}`，仅 `PUZZLE/GATE/TRAP` 允许。
- `main.ts` 无 global prefix；`APP_PORT` 默认 3000；CORS 白名单来自 `.env` 的 `CORS_ORIGINS`，**`http://localhost:5173` 已在白名单内**。
- `scripts/mock-redis.js` 是 RESP2/RESP3 mock，`SET NX` **恒返回 OK** → 本地「冷却 / 一次性」校验永远放行（S1 只验正常路径，异常路径交给单测）。
- `seeds/admin.seed.ts` 用 `synchronize:true` + 实体子集（会 drop 其他表）→ **新 seed 必须 `synchronize:false`**，依赖 `.env` 的 `DB_SYNCHRONIZE=true` 先建表。
- jest `rootDir = src`，`testRegex = .*\.spec\.ts$` → 单测必须放 `src/**` 下。

**LayaAir 引擎**
- npm 无官方引擎包，引擎只随 IDE 分发：`D:\Program Files\LayaAirIDE\resources\engine\libs\`（`laya.core.js` 1.9MB、`laya.ui.js` 228KB、`laya.ui2.js` 396KB）。
- `class TextInput` / `class Label` / `class UIComponent` 定义在 **`laya.ui.js`**（不是 `laya.ui2.js`）。
- 已验证存在的 API：`Laya.init(width,height): Promise<void>`、`Laya.stage`、`Laya.timer.frameLoop(delay,caller,method,args?,coverBefore?)`、`Laya.loader.load(url)` / `Laya.Loader.getRes(url)`、`Laya.URL.basePath`（static）、`Laya.Sprite`/`Laya.Text`、`Graphics.drawRect|drawTexture`、`Laya.Keyboard`、`Laya.Event.KEY_DOWN`/`keyCode`、`Sprite.zOrder`（可用于 y 排序）。
- IDE 工程模板：`D:\Program Files\LayaAirIDE\resources\template\project\{2D-emptyProject,common}\`。`common/.gitignore`（忽略 `temp/ library/ local/ release/ node_modules/ bin/ js/ bundles`）、`common/tsconfig.json`、`common/settings/PlayerSettings.json`、`common/settings/EditorSettings.json`、`2D-emptyProject/assets/Scene.ls`(+`.meta`)。
- vendor 来源（零新增依赖）：`game-server/node_modules/socket.io-client/dist/socket.io.min.js`（4.8.3，46822 字节，浏览器 UMD，全局变量 `io`）。

### 1.3 关键设计决策（含与总纲的偏差）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **构建路线：IDE CLI 为主 + tsc 自建兜底** | 总纲 §13#1 要求「本地命令行产出 H5 产物」。IDE CLI 是官方路径但未实证；兜底路径（tsc → ESM → `bin/js/`）保证即使 IDE CLI 不通，H5 闭环仍可验收 |
| D2 | **H5 端 WS 用官方 socket.io-client 4**（从 `game-server/node_modules` vendor 的 min.js，运行时动态注入 `io` 全局） | 最小改动、零新增依赖；微信端 WS 适配推迟到 S7 |
| D3 | **登录 UI 用 H5 DOM 表单**，DOM 访问全部集中在 `platform/Platform.ts` | 规避引擎 UI 库（`laya.ui` vs `laya.ui2` addon）不确定性；世界渲染只用 `laya.core.js` |
| D4 | **配置包由 seed 生成**，`seeds/scene-spike.seed.ts` 直接写 `game-client/assets/config/*.json` | 避免手工抄 id 抄错；S2 再替换为正式导出管线 |
| D5 | **客户端源码用无扩展名相对导入**，兜底构建在 emit 后把 `./X` 重写为 `./X.js` | 源码保持 IDE 兼容；浏览器 ESM 需要显式扩展名 → 只在产物上做重写 |
| D6 | **静态资源统一经 `tools/serve.mjs` 提供**：`/config/*`→`assets/config`、`/assets/*`→`assets`、`/libs/*`→IDE engine libs、`/vendor/*`→`vendor`、`/js/*`→`bin/js`、其余→`bin/` | 产物布局与源码布局解耦，IDE 构建与兜底构建产出差异不影响客户端 URL |
| D7 | **`scene_triggers` 顺手修** | 缺 `scene_id` 直接导致「换场景后触发器仍是全场」，不修则 #4/#7 无法验证 |
| D8 | **去重规则落地**：以 `spawnId` 求交，配置包优先；服务端 `entity_type='object'` 的 spawn 一律忽略 | 总纲 §6.5 明确要求 |
| D9 | **#8 微信端验收降级**（见 §4 待确认项） | 总纲 #8 要求「开发者工具中可跑通同一场景」，但 WS/UI 微信适配已明确推迟到 S7，两者不可能同时满足 |

### 1.4 文件结构（S1 全部新增/修改）

**客户端（新增）—— 源码 18 个**

| 路径（相对 `packages-game/game-client/`） | 职责 |
|---|---|
| `src/boot/Boot.ts` | `Laya.init` + `URL.basePath` + stage 设置 |
| `src/boot/LoginView.ts` | H5 DOM 登录表单（注册/登录二选一，走 `platform/`） |
| `src/boot/Main.ts` | 总编排：Boot → 登录 → 配置包 → WS → 进场景 → 建实体 → 键盘/交互循环 |
| `src/config/AppConfig.ts` | 常量：apiBase/wsUrl/configBase/stage 尺寸/上报频率 |
| `src/config/schema.ts` | 配置包 TS 类型（与 §5.1 结构一一对应） |
| `src/config/validate.ts` | 手写轻量校验（不引入 zod） |
| `src/config/loader.ts` | manifest → 按 hash 判缓存 → fetch → 校验 → 返回 |
| `src/entity/Entity.ts` | 实体基类（`Laya.Sprite` + entityId/spawnId/kind + 占位贴图） |
| `src/entity/EntityRegistry.ts` | 按 id upsert / 查询 / 范围查询 |
| `src/entity/EntityFactory.ts` | 由配置包静态项 + 服务端 spawn 记录造实体 |
| `src/net/http.ts` | fetch 封装 + 信封解包 + `ApiError` |
| `src/net/api.ts` | 登录/注册/物件交互/NPC 对话/触发器 5 个接口 |
| `src/net/Session.ts` | token/accountId/playerId + 选主（走 `platform/`） |
| `src/net/ws.ts` | socket.io 封装：connect/send(seq+ack)/on/onBroadcast |
| `src/net/socketio.d.ts` | vendor `io` 的最小类型声明 |
| `src/platform/Platform.ts` | 平台差异层（DOM / 存储 / toast / 是否小游戏） |
| `src/ui/Toast.ts` | 中文提示（走 platform） |
| `src/world/SceneBuilder.ts` | 地形 + 网格参照 + 静态实体 + 触发器区域 |
| `src/world/PlayerControl.ts` | 键盘移动 + 约 10Hz 上报（阈值去抖） |
| `src/world/InteractController.ts` | F 键就近交互（NPC 对话 / 物件采集） |

**客户端（新增）—— 工程与工具 7 个**

| 路径 | 职责 |
|---|---|
| `tsconfig.json` | tsc 构建配置（target ES2017 / module ES2015 / outDir `bin/js`） |
| `src/types/laya.d.ts` | `/// <reference>` 指向 IDE 的 `LayaAir.d.ts` |
| `tools/assemble.mjs` | 从 IDE 模板装配工程壳（tsconfig/settings/.gitignore/Scene.ls） |
| `tools/serve.mjs` | 零依赖静态服务器（端口 5173，按 D6 映射） |
| `tools/build-fallback.mjs` | tsc 编译 → 重写导入扩展名 → 生成 `bin/index.html` |
| `tools/build-cli.ps1` | 调 IDE 命令行构建 |
| `tools/src/editor/Build.ts` | IDE `--script` 入口（`regClass` + `BuildTask.start("web")`） |
| `tools/check-config.mjs` | 校验生成的配置包（manifest 与 scene 文件一致、必填字段、hash） |
| `vendor/socket.io.min.js` | 从 `game-server/node_modules` 拷贝的 UMD（46KB） |
| `assets/config/` | seed 生成的 `manifest.json` + `scene-1-v1.json` |
| `index.html` | **兜底构建生成**（不手写），加载 `/libs/*` + `/js/boot/Main.js` |

**后端（修改/新增 6 处）**

| 路径 | 变更 |
|---|---|
| `src/modules/world/entities/scene-trigger.entity.ts` | 新增 `sceneId: string \| null` 列 + `@Index('idx_trigger_scene',['sceneId'])` |
| `src/modules/world/world.service.ts` | 修 `getSceneTriggers` 按 sceneId 过滤；新增 `talkNpc(playerId, spawnId)` |
| `src/modules/world/world.service.spec.ts` | 新增 2 个用例（触发器按场景过滤 / NPC 对话） |
| `src/modules/world/world.client.controller.ts` | 新增 `POST npcs/:spawnId/talk` |
| `src/modules/world/dto/object-interact.dto.ts` | 复用（talk 无 body，不加 DTO） |
| `scripts/ddl/2026-09-21-scene-trigger-scene-id.sql` | 生产 DDL（只产出，不执行） |
| `seeds/scene-spike.seed.ts` | 播种 + 生成配置包 |
| `package.json` | 新增 script `seed:scene-spike` |
| `scripts/smoke-laya2d-s1.mjs` | S1 冒烟脚本（HTTP + WS 全链路断言） |

### 1.5 验收映射（总纲 §13 九条 → 任务）

| # | 总纲验收项 | 本计划落点 | 判定方式 |
|---|---|---|---|
| 1 | 工具链：命令行产出 H5 产物并在浏览器打开 | Task 5（IDE CLI，主）/ Task 6（tsc 兜底） | 命令退出码 0 + `bin/js/boot/Main.js` 存在 + 浏览器无报错 |
| 2 | 登录：复用现有客户端登录接口拿到 token | Task 7 | 页面登录成功，控制台打印 `playerId`，token 存 localStorage |
| 3 | 配置包：加载 `scene-1-v1.json` 并渲染地形 + ≥1 静态物件 | Task 9 | 画面出现绿色地块 + 网格线 + ≥1 物件色块；控制台输出配置包版本 |
| 4 | 进场景：`world.enter-scene` 拿 `{scene,spawns,triggers}` 并生成实体 | Task 10 | 控制台输出 spawns/triggers 条数；实体数与去重规则一致 |
| 5 | NPC：渲染 ≥1 NPC，位置与配置一致 | Task 10 | NPC 色块像素坐标 === 配置包 `fixedNpcs[i].x/y`（seed 用整数坐标） |
| 6 | 交互：1 次采集 + 1 次 NPC 对话 | Task 12 | 采集中文提示含奖励数额；对话弹出 `attr.greeting` 文案 |
| 7 | 多人：两窗口互见移动 | Task 11 | A 移动时 B 窗口出现并移动 A 的色块（且 A 不重复渲染自己） |
| 8 | 小游戏：开发者工具可跑通同一场景 | Task 13（**降级，见 §4**） | wxgame 产物导出成功 + 开发者工具打开静态场景 + HTTP 登录成功 |
| 9 | 后端回归：现有测试全绿、旧接口契约零改动 | Task 14 | `npm test` 全绿；`git diff` 中无旧接口签名变更 |

### 1.6 测试基线

- **客户端**：S1 按总纲 §14 以「浏览器点检验收 + 冒烟脚本」为主，**不引入单测框架**（推迟 S3）。
- **后端**：`npm test`（jest，`rootDir=src`）必须全绿；本次新增 2 个用例，基线不下降。
- **冒烟**：`node scripts/smoke-laya2d-s1.mjs` 覆盖 HTTP 登录 → 物件交互 → NPC 对话 → WS 进场景 → 双端 move 广播，退出码 0 为通过。

### 1.7 已知限制（S1 明确不覆盖）

1. **mock-redis 的 `SET NX` 恒成功** → 本地「交互冷却 / 一次性」永不拒绝，S1 只验正常路径。
2. **无视野裁剪**：`world.move` 是全房间广播，50 人带宽未测（S8）。
3. **NPC 不移动**：S1 的 NPC 是固定位静态渲染，随机/巡逻属 S4。
4. **配置包无缓存校验回退链**：`crypto.subtle` 在非 HTTPS 的 localhost 可用；不可用时降级为「跳过 hash 校验并打印告警」。
5. **无建造/剧情/背包 UI**：属 S2/S3/S5/S6。
6. **微信端 WS/UI 不跑通**（见 §4）。
7. **触发器只渲染区域、不实现踩入自动传送**：S1 把 `triggers` 画成半透明矩形并标注 `targetSceneId`，但**不做踩入判定与场景切换**——踩入传送要处理「到达目标场景又踩回原场景」的自环，且传送链路属 S2/S3 子系统，S1 引入会超出 spike 边界。

---

## 2. Tasks

> 命令一律给出 **cwd**。后端步骤 cwd = `e:\code\nest\packages-game\game-server`，客户端步骤 cwd = `e:\code\nest\packages-game\game-client`。

### Task 1: 本地后端闭环（mock-redis + PG + 起服务）

**Files:** 无文件改动（纯环境打通，不提交）

- [ ] **Step 1: 启动 mock-redis（终端 A，保持运行）**

cwd = `e:\code\nest\packages-game\game-server`

```
node scripts/mock-redis.js
```

Expected（stderr/stdout 至少出现一行监听提示）：
```
mocked redis listening on 6379
```
> 若不启动它直接起服务，`CacheService.onModuleInit` 的 `client.connect()` 会失败导致进程退出。

- [ ] **Step 2: 确认本机 PostgreSQL 与库存在**

```
psql -U postgres -h localhost -p 5432 -d game_server -c "select 1;"
```

Expected：
```
 ?column?
----------
        1
(1 row)
```
> 若提示库不存在先执行 `createdb -U postgres game_server`（要密码则用 `$env:PGPASSWORD='postgres'` 前置）。

- [ ] **Step 3: 起后端（终端 B，保持运行）**

```
npm run start:dev
```

Expected：
```
[Nest] ... LOG [NestApplication] Nest application successfully started
```
> 首次启动会因 `.env` 的 `DB_SYNCHRONIZE=true` 建表，日志里会有大量 `CREATE TABLE`/`ALTER TABLE`。

- [ ] **Step 4: 健康检查**

```
Invoke-RestMethod -Uri http://localhost:3000/health
```

Expected：返回对象含 `status = "ok"`。

- [ ] **Step 5: 注册一个测试账号（幂等：已注册会返回错误码，不影响后续）**

```
Invoke-RestMethod -Uri http://localhost:3000/api/client/v1/auth/register -Method Post -ContentType 'application/json' -Body (@{username='spike01';password='spike123456';nickname='spike01';deviceId='laya2d-s1'} | ConvertTo-Json)
```

Expected（首次）：`code=0` 且 `data.token` 非空、`data.playerId` 为字符串数字。
> **必须带 `deviceId`**：不传会 HTTP 400（见 §1.2，DTO 无 `@IsOptional`）。
> 再次执行返回 `code!=0` 且 `msg` 为中文提示 —— 这本身也验证了「错误 HTTP 200 + body.code」的信封契约。

- [ ] **Step 6: 登录并记录 token（后续步骤会用到）**

```
Invoke-RestMethod -Uri http://localhost:3000/api/client/v1/auth/login -Method Post -ContentType 'application/json' -Body (@{username='spike01';password='spike123456';deviceId='laya2d-s1'} | ConvertTo-Json)
```

Expected：`code=0`，`data.token` 为三段式 JWT。
> login 的 body **不要带 `nickname`**（DTO 无此字段，`forbidNonWhitelisted` 会 400）。
> 注意：登录会让 `tokenVersion+1`，之前拿到的 token 立即失效 —— 每次重新登录后要换用新 token。

- [ ] **Step 7（无提交）** 本任务无代码改动，跳过 commit，直接进入 Task 2。

---

### Task 2: 后端修复 `scene_triggers.scene_id` 缺失

**Files:**
- Modify: `packages-game/game-server/src/modules/world/entities/scene-trigger.entity.ts`
- Modify: `packages-game/game-server/src/modules/world/world.service.ts:106-108`
- Test: `packages-game/game-server/src/modules/world/world.service.spec.ts`
- Create: `packages-game/game-server/scripts/ddl/2026-09-21-scene-trigger-scene-id.sql`

- [ ] **Step 1: 写失败测试**

在 `world.service.spec.ts` 的 `describe('WorldService', ...)` 内、现有触发器相关用例之后追加（`service` 与 `triggerRepo` 已在文件顶部声明，作用域内可直接用）：

```ts
  describe('getSceneTriggers', () => {
    it('只返回该场景的触发器（按 sceneId 过滤）', async () => {
      (triggerRepo.find as jest.Mock).mockResolvedValue([]);

      await service.getSceneTriggers('7');

      expect(triggerRepo.find).toHaveBeenCalledWith({
        where: { sceneId: '7' },
      });
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

```
npm test -- src/modules/world/world.service.spec.ts
```

Expected：FAIL，断言信息里 expected `{"where":{"sceneId":"7"}}` 但 received `{}`。

- [ ] **Step 3: 实体加列**

`scene-trigger.entity.ts`：把 `Index` 加进 typeorm 导入，并在 `id` 字段之后插入 `sceneId`：

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { TriggerType } from '@constants/enums';

@Entity('scene_triggers')
@Index('idx_trigger_scene', ['sceneId'])
export class SceneTrigger {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'scene_id', type: 'bigint', nullable: true })
  sceneId: string | null;

  // ...其余字段保持原样不动
}
```

- [ ] **Step 4: service 改为按场景过滤**

`world.service.ts` 第 106-108 行整体替换为：

```ts
  async getSceneTriggers(sceneId: string): Promise<SceneTrigger[]> {
    return this.triggerRepo.find({ where: { sceneId } });
  }
```

- [ ] **Step 5: 跑测试确认通过**

```
npm test -- src/modules/world/world.service.spec.ts
```

Expected：PASS，`Tests: X passed`。

- [ ] **Step 6: 产出生产 DDL（只产出，不执行）**

新建 `scripts/ddl/2026-09-21-scene-trigger-scene-id.sql`：

```sql
-- S1: scene_triggers 增加场景归属列（生产由人工在维护窗口执行，禁止服务器构建）
BEGIN;

ALTER TABLE scene_triggers
  ADD COLUMN IF NOT EXISTS scene_id bigint;

CREATE INDEX IF NOT EXISTS idx_trigger_scene
  ON scene_triggers (scene_id);

-- 存量数据归属：按触发器矩形中心点落在哪个场景的地图范围内回填（无匹配则保持 NULL）
UPDATE scene_triggers t
SET scene_id = s.id
FROM scenes s
WHERE t.scene_id IS NULL
  AND t.area_x >= 0 AND t.area_y >= 0
  AND t.area_x <= s.map_width AND t.area_y <= s.map_height
  AND (SELECT count(*) FROM scenes) = 1;

COMMIT;
```

- [ ] **Step 7: 全量回归**

```
npm test
```

Expected：全部 suite 通过，无 failed。

- [ ] **Step 8: Commit**

```
git add packages-game/game-server/src/modules/world/entities/scene-trigger.entity.ts packages-game/game-server/src/modules/world/world.service.ts packages-game/game-server/src/modules/world/world.service.spec.ts packages-game/game-server/scripts/ddl/2026-09-21-scene-trigger-scene-id.sql
git commit -m "fix(world): 触发器按场景归属过滤（新增 scene_id 列与索引）"
```

---

### Task 3: 客户端工程组装

**Files:**
- Create: `packages-game/game-client/tools/assemble.mjs`
- Create（由脚本生成）: `packages-game/game-client/.gitignore`、`settings/*`、`assets/Scene.ls(+.meta)`、`assets/resources/placeholder.png(+.meta)`、`vendor/socket.io.min.js`、`src/types/laya.d.ts`
- Create（手写）: `packages-game/game-client/tsconfig.json`

- [ ] **Step 1: 写装配脚本**

新建 `packages-game/game-client/tools/assemble.mjs`：

```js
// 从 LayaAir IDE 安装目录装配工程壳：模板文件 + 引擎类型声明 + vendored socket.io
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const IDE = process.env.LAYA_IDE_DIR || 'D:\\Program Files\\LayaAirIDE';
const TPL = join(IDE, 'resources', 'template', 'project');
const SERVER = join(root, '..', 'game-server');

function ensure(p) {
  mkdirSync(p, { recursive: true });
}
function must(src) {
  if (!existsSync(src)) throw new Error(`缺少源文件: ${src}`);
}
function copy(src, dst) {
  must(src);
  ensure(dirname(dst));
  copyFileSync(src, dst);
  console.log(`copy ${src} -> ${dst}`);
}

ensure(join(root, 'assets', 'config'));
ensure(join(root, 'assets', 'resources'));
ensure(join(root, 'vendor'));
ensure(join(root, 'settings'));
ensure(join(root, 'bin'));
ensure(join(root, 'src', 'types'));
ensure(join(root, 'tools', 'src', 'editor'));

// 1. IDE 模板壳
copy(join(TPL, 'common', '.gitignore'), join(root, '.gitignore'));
copy(join(TPL, 'common', 'settings', 'PlayerSettings.json'), join(root, 'settings', 'PlayerSettings.json'));
copy(join(TPL, 'common', 'settings', 'EditorSettings.json'), join(root, 'settings', 'EditorSettings.json'));
copy(join(TPL, '2D-emptyProject', 'assets', 'Scene.ls'), join(root, 'assets', 'Scene.ls'));
copy(join(TPL, '2D-emptyProject', 'assets', 'Scene.ls.meta'), join(root, 'assets', 'Scene.ls.meta'));
copy(join(TPL, 'common', 'assets', 'resources', 'layaAir.png'), join(root, 'assets', 'resources', 'placeholder.png'));
copy(join(TPL, 'common', 'assets', 'resources', 'layaAir.png.meta'), join(root, 'assets', 'resources', 'placeholder.png.meta'));

// 2. BuildSettings：启动场景指向模板 Scene.ls 的 uuid
const sceneMeta = JSON.parse(readFileSync(join(root, 'assets', 'Scene.ls.meta'), 'utf8'));
writeFileSync(
  join(root, 'settings', 'BuildSettings.json'),
  JSON.stringify({ name: 'LayaGame2D', startupScene: `res://${sceneMeta.uuid}` }, null, 4),
  'utf8',
);
console.log(`write settings/BuildSettings.json (startupScene=res://${sceneMeta.uuid})`);

// 3. 引擎类型声明（客户端零依赖，直接引用 IDE 自带 d.ts）
writeFileSync(
  join(root, 'src', 'types', 'laya.d.ts'),
  `/// <reference path="${join(IDE, 'resources', 'engine', 'types', 'LayaAir.d.ts').replace(/\\/g, '/')}" />\n`,
  'utf8',
);
console.log('write src/types/laya.d.ts');

// 4. vendored socket.io（浏览器 UMD，全局 io）
copy(join(SERVER, 'node_modules', 'socket.io-client', 'dist', 'socket.io.min.js'), join(root, 'vendor', 'socket.io.min.js'));

console.log('assemble done');
```

- [ ] **Step 2: 执行装配**

```
node tools/assemble.mjs
```

Expected（末行）：
```
assemble done
```

- [ ] **Step 3: 校验装配结果**

```
Get-ChildItem -Recurse -File -Path .gitignore,settings,assets,vendor,src\types | Where-Object { $_.FullName -notmatch 'node_modules' } | Select-Object -ExpandProperty FullName
```

Expected（至少包含）：
```
...\game-client\.gitignore
...\game-client\settings\BuildSettings.json
...\game-client\settings\EditorSettings.json
...\game-client\settings\PlayerSettings.json
...\game-client\assets\Scene.ls
...\game-client\assets\Scene.ls.meta
...\game-client\assets\resources\placeholder.png
...\game-client\vendor\socket.io.min.js
...\game-client\src\types\laya.d.ts
```

- [ ] **Step 4: 手写 tsconfig.json**

新建 `packages-game/game-client/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "ES2015",
    "moduleResolution": "node",
    "lib": ["ES2017", "DOM"],
    "types": [],
    "strict": false,
    "strictNullChecks": false,
    "noImplicitAny": false,
    "experimentalDecorators": true,
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "bin/js",
    "rootDir": "src",
    "sourceMap": false,
    "declaration": false,
    "removeComments": false,
    "noEmitOnError": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 5: Commit**

```
git add packages-game/game-client
git commit -m "chore(game-client): 装配 LayaAir 客户端工程壳（零新增依赖）"
```

---

### Task 4: 世界内容播种 + 配置包生成

**Files:**
- Create: `packages-game/game-server/seeds/scene-spike.seed.ts`
- Modify: `packages-game/game-server/package.json`（新增 script）
- Create（由 seed 生成）: `packages-game/game-client/assets/config/manifest.json`、`scene-1-v1.json`
- Create: `packages-game/game-client/tools/check-config.mjs`

**约定（写进 seed 与客户端 loader，必须一致）**
- `scene-<id>-v<n>.json` 内的 `hash` = 该文件**去掉 `hash` 字段后**的规范化 JSON（键名递归升序）的 `sha256` 十六进制，前缀 `sha256:`。仅用于展示与人工核对。
- `manifest.json` 里每个场景的 `hash` = **该场景文件原始文本（UTF-8 字节）** 的 `sha256` 十六进制，前缀 `sha256:`。客户端只用这一个做完整性校验。
- `scene.entry` 是客户端出生点（像素整数），S2 会并入正式 schema。

- [ ] **Step 1: 写 seed**

新建 `packages-game/game-server/seeds/scene-spike.seed.ts`：

```ts
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { Scene } from '../src/modules/world/entities/scene.entity';
import { SceneTrigger } from '../src/modules/world/entities/scene-trigger.entity';
import { SceneEntitySpawn } from '../src/modules/world/entities/scene-entity-spawn.entity';
import { ObjectTemplate } from '../src/modules/world/entities/object-template.entity';
import { NpcTemplate } from '../src/modules/world/entities/npc-template.entity';
import {
  EntityType,
  ObjectType,
  SceneStatus,
  SceneType,
  TriggerType,
} from '../src/constants/enums';

const SCENE_NAME = '新手村（Spike）';
const CONFIG_DIR = join(__dirname, '..', '..', 'game-client', 'assets', 'config');

/** ObjectType -> InteractType（客户端交互组件与后端交互链路对齐） */
const INTERACT_BY_OBJECT_TYPE: Record<string, string> = {
  [ObjectType.COLLECT]: 'collect',
  [ObjectType.STONE]: 'collect',
  [ObjectType.PLANT]: 'collect',
  [ObjectType.CHEST]: 'collect',
  [ObjectType.LANDMARK]: 'read',
};

const OBJECT_TEMPLATES = [
  { name: 'spike-草药丛', resKey: 'obj/plant_01', type: ObjectType.PLANT, interactCd: 10, reward: { type: 'currency', currencyType: 'gold', amount: 3 } },
  { name: 'spike-铁矿脉', resKey: 'obj/stone_01', type: ObjectType.STONE, interactCd: 20, reward: { type: 'currency', currencyType: 'gold', amount: 8 } },
  { name: 'spike-旧木箱', resKey: 'obj/chest_01', type: ObjectType.CHEST, interactCd: 0, reward: { type: 'currency', currencyType: 'gold', amount: 20 }, isOneTime: true },
  { name: 'spike-路牌', resKey: 'obj/landmark_01', type: ObjectType.LANDMARK, interactCd: 0, reward: null },
];

const NPC_TEMPLATES = [
  { name: 'spike-村长', resKey: 'npc/elder_01', interactType: 'talk', greeting: '村长：远来的客人，先四处看看吧。' },
  { name: 'spike-铁匠', resKey: 'npc_smith_01', interactType: 'talk', greeting: '铁匠：要打铁，先得有矿。' },
  { name: 'spike-货郎', resKey: 'npc/peddler_01', interactType: 'talk', greeting: '货郎：今日的货物，价钱好商量。' },
];

/** [x, y]：静态物件 10 个，其中 2 个紧邻出生点，保证 F 键可达 */
const OBJECT_SPOTS: Array<[number, number]> = [
  [560, 480], [720, 400], [420, 600], [860, 620], [300, 380],
  [640, 300], [980, 420], [520, 760], [760, 820], [380, 200],
];

/** [x, y]：NPC 3 个，均在出生点 200px 内 */
const NPC_SPOTS: Array<[number, number]> = [
  [600, 380], [700, 520], [500, 560],
];

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as any)[k])}`).join(',')}}`;
}

function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'game_server',
    entities: [Scene, SceneTrigger, SceneEntitySpawn, ObjectTemplate, NpcTemplate],
    // 必须为 false：实体子集同步会 drop 掉其他表
    synchronize: false,
  });
  await dataSource.initialize();

  const sceneRepo = dataSource.getRepository(Scene);
  const triggerRepo = dataSource.getRepository(SceneTrigger);
  const spawnRepo = dataSource.getRepository(SceneEntitySpawn);
  const objRepo = dataSource.getRepository(ObjectTemplate);
  const npcRepo = dataSource.getRepository(NpcTemplate);

  let scene = await sceneRepo.findOne({ where: { name: SCENE_NAME } });
  if (scene) {
    console.log(`场景已存在（id=${scene.id}），跳过播种，仅重新生成配置包`);
  } else {
    scene = await sceneRepo.save(
      sceneRepo.create({
        name: SCENE_NAME,
        sceneType: SceneType.TOWN,
        mapResKey: 'map/town_spike_01',
        mapWidth: 1280,
        mapHeight: 960,
        layerConfig: {},
        minLevel: 1,
        maxPlayers: 50,
        status: SceneStatus.OPEN,
      }),
    );
    console.log(`创建场景 id=${scene.id}`);

    const objs = await objRepo.save(OBJECT_TEMPLATES.map((t) => objRepo.create(t)));
    const objsByType = new Map(objs.map((o) => [o.type as string, o]));
    const order = [ObjectType.PLANT, ObjectType.STONE, ObjectType.CHEST, ObjectType.LANDMARK];
    for (let i = 0; i < OBJECT_SPOTS.length; i++) {
      const tpl = objsByType.get(order[i % order.length])!;
      const [x, y] = OBJECT_SPOTS[i];
      await spawnRepo.save(
        spawnRepo.create({
          sceneId: scene.id,
          entityType: EntityType.OBJECT,
          templateId: tpl.id,
          spawnX: x,
          spawnY: y,
          spawnCount: 1,
          spawnRadius: 0,
          isActive: true,
        }),
      );
    }
    console.log(`创建物件模板 ${objs.length} 个、物件落位 ${OBJECT_SPOTS.length} 个`);

    const npcs = await npcRepo.save(
      NPC_TEMPLATES.map((t) =>
        npcRepo.create({
          name: t.name,
          resKey: t.resKey,
          interactType: t.interactType as any,
          scale: 1.0,
          defaultAnim: 'idle',
          dialogueId: null,
          moveRange: 0,
          isAutoWander: false,
          attr: { greeting: t.greeting },
        }),
      ),
    );
    for (let i = 0; i < NPC_SPOTS.length; i++) {
      const [x, y] = NPC_SPOTS[i];
      await spawnRepo.save(
        spawnRepo.create({
          sceneId: scene.id,
          entityType: EntityType.NPC,
          templateId: npcs[i].id,
          spawnX: x,
          spawnY: y,
          spawnCount: 1,
          spawnRadius: 0,
          isActive: true,
        }),
      );
    }
    console.log(`创建 NPC 模板 ${npcs.length} 个、NPC 落位 ${NPC_SPOTS.length} 个`);

    await triggerRepo.save([
      triggerRepo.create({
        sceneId: scene.id,
        triggerType: TriggerType.TRANSPORT,
        areaX: 0,
        areaY: 0,
        areaW: 120,
        areaH: 120,
        targetSceneId: scene.id,
        condition: null,
        onceOnly: false,
      }),
      triggerRepo.create({
        sceneId: scene.id,
        triggerType: TriggerType.STORY,
        areaX: 600,
        areaY: 200,
        areaW: 160,
        areaH: 120,
        targetSceneId: null,
        condition: { storyId: 1 },
        onceOnly: true,
      }),
    ]);
    console.log('创建触发器 2 个');
  }

  // ---- 生成配置包 ----
  const sceneId = scene.id;
  const spawns = await spawnRepo.find({ where: { sceneId, isActive: true } });
  const triggers = await triggerRepo.find({ where: { sceneId }, order: { id: 'ASC' } });

  const staticEntities: any[] = [];
  const fixedNpcs: any[] = [];
  for (const sp of spawns) {
    if (sp.entityType === EntityType.OBJECT) {
      const tpl = await objRepo.findOne({ where: { id: sp.templateId } });
      if (!tpl) continue;
      staticEntities.push({
        kind: 'object',
        spawnId: Number(sp.id),
        templateId: Number(tpl.id),
        resKey: tpl.resKey,
        x: sp.spawnX,
        y: sp.spawnY,
        rotation: sp.spawnRotation,
        interact: {
          type: INTERACT_BY_OBJECT_TYPE[tpl.type] ?? 'collect',
          cd: tpl.interactCd,
          oneTime: tpl.isOneTime,
        },
      });
    } else if (sp.entityType === EntityType.NPC) {
      const tpl = await npcRepo.findOne({ where: { id: sp.templateId } });
      if (!tpl) continue;
      fixedNpcs.push({
        spawnId: Number(sp.id),
        npcTemplateId: Number(tpl.id),
        resKey: tpl.resKey,
        x: sp.spawnX,
        y: sp.spawnY,
        anim: tpl.defaultAnim ?? 'idle',
      });
    }
  }

  const payload = {
    schemaVersion: 1,
    sceneId: Number(sceneId),
    version: 1,
    scene: {
      name: scene.name,
      mapResKey: scene.mapResKey,
      mapWidth: scene.mapWidth,
      mapHeight: scene.mapHeight,
      minLevel: scene.minLevel,
      maxPlayers: scene.maxPlayers,
      sceneType: scene.sceneType,
      entry: { x: 640, y: 480 },
    },
    layers: scene.layerConfig ?? {},
    staticEntities,
    fixedNpcs,
    triggers: triggers.map((t) => ({
      id: Number(t.id),
      type: t.triggerType,
      area: { x: t.areaX, y: t.areaY, w: t.areaW, h: t.areaH },
      targetSceneId: t.targetSceneId ? Number(t.targetSceneId) : null,
      onceOnly: t.onceOnly,
    })),
  };

  const withHash = { ...payload, hash: sha256(canonicalJson(payload)) };
  const fileName = `scene-${Number(sceneId)}-v1.json`;
  const fileText = `${JSON.stringify(withHash, null, 2)}\n`;
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(join(CONFIG_DIR, fileName), fileText, 'utf8');

  const manifest = {
    generatedAt: new Date().toISOString(),
    scenes: [
      { sceneId: Number(sceneId), version: 1, hash: sha256(fileText), file: fileName },
    ],
  };
  writeFileSync(join(CONFIG_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`配置包已生成：${join(CONFIG_DIR, fileName)}`);
  console.log(`manifest 已生成：${join(CONFIG_DIR, 'manifest.json')}`);
  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: 注册 npm script**

`package.json` 的 scripts 中，在 `"seed:admin"` 之后加一行：

```json
    "seed:scene-spike": "ts-node -r tsconfig-paths/register seeds/scene-spike.seed.ts",
```

- [ ] **Step 3: 执行 seed**

cwd = `e:\code\nest\packages-game\game-server`

```
npm run seed:scene-spike
```

Expected（末两行）：
```
配置包已生成：...\game-client\assets\config\scene-1-v1.json
manifest 已生成：...\game-client\assets\config\manifest.json
```
> 若库中已有其他场景，`sceneId` 可能不是 1，文件名会相应变化 —— 客户端一律以 `manifest.json` 为准，不硬编码 id。

- [ ] **Step 4: 写配置包校验脚本**

新建 `packages-game/game-client/tools/check-config.mjs`：

```js
// 校验 seed 生成的配置包：manifest 结构、文件存在性、manifest.hash 与文件字节一致、场景必填字段
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = join(root, 'assets', 'config');
const issues = [];

function sha256(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

const manifestPath = join(dir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('缺少 manifest.json，请先执行 npm run seed:scene-spike');
  process.exit(1);
}
const manifestText = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText);
if (!Array.isArray(manifest.scenes) || manifest.scenes.length === 0) issues.push('manifest.scenes 为空');

for (const item of manifest.scenes ?? []) {
  const file = join(dir, item.file);
  if (!existsSync(file)) {
    issues.push(`缺少配置文件 ${item.file}`);
    continue;
  }
  const text = readFileSync(file, 'utf8');
  if (sha256(text) !== item.hash) issues.push(`${item.file} 的 manifest.hash 与文件字节不一致`);
  const cfg = JSON.parse(text);
  for (const key of ['schemaVersion', 'sceneId', 'version', 'scene', 'staticEntities', 'fixedNpcs', 'triggers']) {
    if (cfg[key] === undefined) issues.push(`${item.file} 缺少字段 ${key}`);
  }
  if (cfg.sceneId !== item.sceneId) issues.push(`${item.file} 的 sceneId 与 manifest 不一致`);
  if (cfg.version !== item.version) issues.push(`${item.file} 的 version 与 manifest 不一致`);
  if (!cfg.scene?.entry) issues.push(`${item.file} 缺少 scene.entry`);
  if ((cfg.staticEntities?.length ?? 0) < 1) issues.push(`${item.file} 静态物件为空`);
  if ((cfg.fixedNpcs?.length ?? 0) < 1) issues.push(`${item.file} 固定 NPC 为空`);
  for (const e of cfg.staticEntities ?? []) {
    if (!Number.isInteger(e.x) || !Number.isInteger(e.y)) issues.push(`staticEntities[${e.spawnId}] 坐标不是整数`);
  }
  for (const n of cfg.fixedNpcs ?? []) {
    if (!Number.isInteger(n.x) || !Number.isInteger(n.y)) issues.push(`fixedNpcs[${n.spawnId}] 坐标不是整数`);
  }
  console.log(`${item.file}: sceneId=${cfg.sceneId} v${cfg.version} 静态物件=${cfg.staticEntities.length} NPC=${cfg.fixedNpcs.length} 触发器=${cfg.triggers.length}`);
}

if (issues.length) {
  console.error('配置包校验失败：');
  for (const i of issues) console.error(` - ${i}`);
  process.exit(1);
}
console.log('配置包校验通过');
```

- [ ] **Step 5: 跑校验**

cwd = `e:\code\nest\packages-game\game-client`

```
node tools/check-config.mjs
```

Expected：
```
scene-1-v1.json: sceneId=1 v1 静态物件=10 NPC=3 触发器=2
配置包校验通过
```

- [ ] **Step 6: Commit**

```
git add packages-game/game-server/seeds/scene-spike.seed.ts packages-game/game-server/package.json packages-game/game-client/assets/config packages-game/game-client/tools/check-config.mjs
git commit -m "feat(world): 播种新手村场景并生成版本化配置包"
```

---

### Task 5: 工具链实证 A（IDE 命令行构建）

**Files:**
- Create: `packages-game/game-client/tools/src/editor/Build.ts`
- Create: `packages-game/game-client/tools/build-cli.ps1`

> ⚠️ **本任务含人工介入点（见 Step 1）**：`window.rendererInfo.cliScriptFiles` 需要在 IDE GUI 里一次性设置，无法纯命令行完成。若脚本机制最终不通，**投入上限 30 分钟后直接切 Task 6 兜底**（Task 6 不依赖本任务）。

- [ ] **Step 1: 人工介入 —— 用 IDE 打开工程并手动构建一次**

1. 双击 `D:\Program Files\LayaAirIDE\LayaAirIDE.exe`，打开工程目录 `e:\code\nest\packages-game\game-client`。
2. 菜单「文件 → 构建/发布」里执行一次 Web 构建，确认产物出现在 `e:\code\nest\packages-game\game-client\bin\`。
3. 若 IDE 设置里存在「命令行脚本」/`cliScriptFiles` 之类的配置项，把 `tools/src/editor/Build.ts` 加入其中（该文件在 Step 2 创建，可先跳过本小步，稍后回来设置）。

Expected：`game-client\bin\index.html` 存在。
若 IDE 打不开该工程（报缺少配置）→ 回到 Task 3 检查 `settings/`、`assets/Scene.ls`、`.gitignore` 是否齐全，补齐后重试。

- [ ] **Step 2: 写 CLI 脚本入口**

新建 `packages-game/game-client/tools/src/editor/Build.ts`：

```ts
// LayaAir IDE 命令行构建入口（--script=Build.buildWeb）
IEditorEnv.regClass();

export class Build {
  static async buildWeb(): Promise<void> {
    await IEditorEnv.BuildTask.start('web').waitForCompletion();
    console.log('[cli] build web done');
  }
}
```

- [ ] **Step 3: 写调用脚本**

新建 `packages-game/game-client/tools/build-cli.ps1`：

```powershell
$ErrorActionPreference = 'Stop'
$ide = if ($env:LAYA_IDE_DIR) { Join-Path $env:LAYA_IDE_DIR 'LayaAirIDE.exe' } else { 'D:\Program Files\LayaAirIDE\LayaAirIDE.exe' }
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Test-Path $ide)) { throw "找不到 LayaAirIDE: $ide" }
Write-Host "IDE=$ide PROJECT=$project"
& $ide "--project=$project" '--script=Build.buildWeb'
$code = $LASTEXITCODE
Write-Host "exit=$code"
if (-not (Test-Path (Join-Path $project 'bin\index.html'))) { Write-Host 'WARN: bin\index.html 未生成'; exit 2 }
Write-Host 'OK: bin\index.html 已生成'
exit $code
```

- [ ] **Step 4: 执行 CLI 构建**

cwd = `e:\code\nest\packages-game\game-client`

```
powershell -ExecutionPolicy Bypass -File tools\build-cli.ps1
```

Expected（成功）：
```
OK: bin\index.html 已生成
exit=0
```
Expected（失败，允许）：
```
unknown script
exit=2
```
→ 失败即**记录原始输出**并切 Task 6；不要在本任务上继续加投时间。

- [ ] **Step 5: 记录结论**

把 Step 4 的真实输出（成功命令 / 失败原文）追加到 `packages-game/game-client/README.md` 的「S1 工具链实证」小节（该文件在本步创建，只写实测结论，不写设想）：
- 生效命令（若有）
- 产物路径
- 失败时的原始报错

- [ ] **Step 6: Commit**

```
git add packages-game/game-client/tools packages-game/game-client/README.md
git commit -m "chore(game-client): 实证 LayaAir IDE 命令行构建入口"
```

---

### Task 6: 兜底构建 + 静态服务（不依赖 Task 5）

**Files:**
- Create: `packages-game/game-client/tools/build-fallback.mjs`
- Create: `packages-game/game-client/tools/serve.mjs`
- Create: `packages-game/game-client/src/config/AppConfig.ts`
- Create: `packages-game/game-client/src/boot/Boot.ts`
- Create: `packages-game/game-client/src/boot/Main.ts`（最小版，Task 7 会扩展）
- Create（由脚本生成）: `packages-game/game-client/bin/index.html`

- [ ] **Step 1: 写常量**

新建 `packages-game/game-client/src/config/AppConfig.ts`：

```ts
export const AppConfig = {
  /** 客户端版本（展示用） */
  clientVersion: '0.1.0-s1',
  /** HTTP 接口根地址（后端无 global prefix） */
  apiBase: 'http://localhost:3000',
  /** socket.io 地址：namespace /game */
  wsUrl: 'http://localhost:3000/game',
  /** 配置包根路径（由 tools/serve.mjs 映射到 assets/config） */
  configBase: '/config',
  /** 资源根路径（Laya.URL.basePath 用，必须以 / 结尾） */
  assetBase: '/assets/',
  /** 舞台尺寸（spike 用固定尺寸，缩放交给引擎 scaleMode） */
  stageWidth: 960,
  stageHeight: 640,
  /** 移动上报间隔（毫秒）与最小位移阈值（像素） */
  moveReportIntervalMs: 100,
  moveReportThreshold: 4,
  /** 就近交互半径（像素） */
  interactRadius: 120,
  /** 设备标识：后端 DTO 未标 @IsOptional，不传会 400（见 §1.2） */
  deviceId: 'laya2d-s1',
};
```

- [ ] **Step 2: 写 Boot**

新建 `packages-game/game-client/src/boot/Boot.ts`：

```ts
import { AppConfig } from '../config/AppConfig';

export class Boot {
  static async start(): Promise<void> {
    Laya.URL.basePath = AppConfig.assetBase;
    await Laya.init(AppConfig.stageWidth, AppConfig.stageHeight);
    Laya.stage.alignH = 'center';
    Laya.stage.alignV = 'middle';
    Laya.stage.scaleMode = Laya.Stage.SCALE_SHOWALL;
    Laya.stage.bgColor = '#101418';
    console.log(`[S1] boot ok, client=${AppConfig.clientVersion}`);
  }
}
```

- [ ] **Step 3: 写最小 Main**

新建 `packages-game/game-client/src/boot/Main.ts`：

```ts
import { Boot } from './Boot';

async function main(): Promise<void> {
  await Boot.start();
  console.log('[S1] ready');
}

main().catch((err) => {
  console.error('[S1] 启动失败', err);
});
```

- [ ] **Step 4: 写兜底构建脚本**

新建 `packages-game/game-client/tools/build-fallback.mjs`：

```js
// 兜底构建：tsc（借用 game-server 的 typescript）→ 重写产物导入扩展名 → 生成 bin/index.html
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsc = join(root, '..', 'game-server', 'node_modules', 'typescript', 'bin', 'tsc');

execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.json')], { stdio: 'inherit' });

const outRoot = join(root, 'bin', 'js');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

let rewritten = 0;
for (const file of walk(outRoot).filter((f) => f.endsWith('.js'))) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(
    /(from\s+|import\s+)(["'])(\.{1,2}\/[^"']+)(["'])/g,
    (m, head, q1, spec, q2) => (spec.endsWith('.js') ? m : `${head}${q1}${spec}.js${q2}`),
  );
  if (after !== before) {
    writeFileSync(file, after, 'utf8');
    rewritten++;
  }
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>江湖录 · S1 Spike</title>
<style>
  html, body { margin: 0; padding: 0; background: #101418; overflow: hidden; font-family: "Microsoft YaHei", sans-serif; }
  #s1-login { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 10;
    background: #1b2129; padding: 24px 28px; border-radius: 8px; color: #e6edf3; min-width: 280px; }
  #s1-login h2 { margin: 0 0 16px; font-size: 18px; }
  #s1-login label { display: block; font-size: 12px; color: #9aa7b4; margin: 10px 0 4px; }
  #s1-login input { width: 100%; box-sizing: border-box; padding: 8px; border-radius: 4px; border: 1px solid #2c3540; background: #0d1117; color: #e6edf3; }
  #s1-login button { margin-top: 16px; width: 100%; padding: 10px; border: 0; border-radius: 4px; background: #2f81f7; color: #fff; cursor: pointer; }
  #s1-login .err { color: #ff7b72; font-size: 12px; margin-top: 10px; min-height: 16px; }
  #s1-toast { position: absolute; left: 50%; bottom: 60px; transform: translateX(-50%); z-index: 20;
    background: rgba(0,0,0,.75); color: #e6edf3; padding: 8px 16px; border-radius: 4px; font-size: 13px; display: none; }
</style>
</head>
<body>
<script src="/libs/laya.core.js"></script>
<script src="/libs/laya.ui.js"></script>
<script src="/vendor/socket.io.min.js"></script>
<script type="module" src="/js/boot/Main.js"></script>
</body>
</html>
`;

mkdirSync(join(root, 'bin'), { recursive: true });
writeFileSync(join(root, 'bin', 'index.html'), html, 'utf8');
console.log(`fallback build done: ${rewritten} 个产物文件重写了导入扩展名`);
```

- [ ] **Step 5: 执行兜底构建**

cwd = `e:\code\nest\packages-game\game-client`

```
node tools/build-fallback.mjs
```

Expected：
```
fallback build done: N 个产物文件重写了导入扩展名
```

- [ ] **Step 6: 校验产物**

```
Get-ChildItem bin -Recurse -File | Select-Object -ExpandProperty FullName
```

Expected 至少包含：
```
...\game-client\bin\index.html
...\game-client\bin\js\boot\Boot.js
...\game-client\bin\js\boot\Main.js
...\game-client\bin\js\config\AppConfig.js
```

- [ ] **Step 7: 写静态服务器**

新建 `packages-game/game-client/tools/serve.mjs`：

```js
// 零依赖静态服务器：把「产物目录 / 源码资源 / IDE 引擎库 / vendored 三方库」映射到统一 URL 空间
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const IDE = process.env.LAYA_IDE_DIR || 'D:\\Program Files\\LayaAirIDE';
const PORT = Number(process.env.S1_PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

const ROUTES = [
  ['/config/', join(root, 'assets', 'config')],
  ['/assets/', join(root, 'assets')],
  ['/vendor/', join(root, 'vendor')],
  ['/libs/', join(IDE, 'resources', 'engine', 'libs')],
  ['/js/', join(root, 'bin', 'js')],
  ['/', join(root, 'bin')],
];

function resolveFile(urlPath) {
  const path = decodeURIComponent(urlPath.split('?')[0]);
  for (const [prefix, base] of ROUTES) {
    if (prefix === '/' ? true : path.startsWith(prefix)) {
      const rel = prefix === '/' ? path.slice(1) : path.slice(prefix.length);
      const full = normalize(join(base, rel));
      if (!full.startsWith(normalize(base) + sep) && full !== normalize(base)) return null;
      if (existsSync(full) && statSync(full).isFile()) return full;
      return null;
    }
  }
  return null;
}

createServer((req, res) => {
  const file = resolveFile(req.url ?? '/');
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 ${req.url}`);
    console.log(`404 ${req.url}`);
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
  console.log(`200 ${req.url}`);
}).listen(PORT, () => {
  console.log(`S1 static server: http://localhost:${PORT}/`);
  console.log(`libs 来源: ${join(IDE, 'resources', 'engine', 'libs')}`);
  console.log('提示：请确保后端已在 3000 端口运行，且 CORS_ORIGINS 含 http://localhost:5173');
});
```

- [ ] **Step 8: 起服务器并验证 200**

cwd = `e:\code\nest\packages-game\game-client`（终端 C，保持运行）

```
node tools/serve.mjs
```

Expected：
```
S1 static server: http://localhost:5173/
```

另开一条命令验证：

```
(Invoke-WebRequest -Uri http://localhost:5173/ -UseBasicParsing).StatusCode
(Invoke-WebRequest -Uri http://localhost:5173/js/boot/Main.js -UseBasicParsing).StatusCode
(Invoke-WebRequest -Uri http://localhost:5173/libs/laya.core.js -UseBasicParsing).StatusCode
```

Expected：三行都是 `200`。

- [ ] **Step 9: 浏览器验证（验收 #1 的前半）**

浏览器打开 `http://localhost:5173/`。

Expected：
- 控制台输出 `[S1] boot ok, client=0.1.0-s1` 与 `[S1] ready`
- 页面无红色报错（`laya.core.js` 404 会直接报 `Laya is not defined`，即说明 serve 映射错了）

- [ ] **Step 10: Commit**

```
git add packages-game/game-client
git commit -m "feat(game-client): 兜底构建与静态服务（命令行产出 H5 产物）"
```

---

### Task 7: HTTP 层 + 登录（验收 #2）

**Files:**
- Create: `packages-game/game-client/src/platform/Platform.ts`
- Create: `packages-game/game-client/src/ui/Toast.ts`
- Create: `packages-game/game-client/src/net/http.ts`
- Create: `packages-game/game-client/src/net/api.ts`
- Create: `packages-game/game-client/src/net/Session.ts`
- Create: `packages-game/game-client/src/boot/LoginView.ts`
- Modify: `packages-game/game-client/src/boot/Main.ts`

- [ ] **Step 1: 平台适配层（所有 DOM 访问的唯一出口）**

新建 `src/platform/Platform.ts`：

```ts
/**
 * 平台差异唯一出口：业务代码不得直接访问 document / localStorage / wx。
 * S1 只实现 H5 分支；微信小游戏分支在 S7 补齐。
 */
export const Platform = {
  isMiniGame(): boolean {
    return typeof (globalThis as any).wx !== 'undefined' && typeof document === 'undefined';
  },

  storageGet(key: string): string | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  },

  storageSet(key: string, value: string): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  },

  storageRemove(key: string): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  },

  toast(text: string, ms = 2600): void {
    if (typeof document === 'undefined') {
      console.log(`[toast] ${text}`);
      return;
    }
    let el = document.getElementById('s1-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 's1-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.display = 'block';
    if ((this as any)._toastTimer) clearTimeout((this as any)._toastTimer);
    (this as any)._toastTimer = setTimeout(() => {
      if (el) el.style.display = 'none';
    }, ms);
  },

  showLoginForm(handlers: {
    onSubmit: (username: string, password: string) => Promise<void>;
  }): void {
    if (typeof document === 'undefined') {
      throw new Error('当前平台不支持 DOM 登录表单');
    }
    this.hideLoginForm();
    const box = document.createElement('div');
    box.id = 's1-login';
    box.innerHTML = `
      <h2>江湖录 · S1 Spike</h2>
      <label for="s1-user">账号（3-32 位字母/数字/下划线）</label>
      <input id="s1-user" value="spike01" autocomplete="username" />
      <label for="s1-pass">密码（6-64 位）</label>
      <input id="s1-pass" type="password" value="spike123456" autocomplete="current-password" />
      <button id="s1-submit">登录 / 自动注册</button>
      <div class="err" id="s1-err"></div>
    `;
    document.body.appendChild(box);

    const user = box.querySelector('#s1-user') as HTMLInputElement;
    const pass = box.querySelector('#s1-pass') as HTMLInputElement;
    const err = box.querySelector('#s1-err') as HTMLDivElement;
    const btn = box.querySelector('#s1-submit') as HTMLButtonElement;

    btn.addEventListener('click', () => {
      err.textContent = '';
      btn.disabled = true;
      handlers
        .onSubmit(user.value.trim(), pass.value)
        .catch((e: unknown) => {
          err.textContent = e instanceof Error ? e.message : String(e);
        })
        .finally(() => {
          btn.disabled = false;
        });
    });
  },

  hideLoginForm(): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('s1-login');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  },
};
```

- [ ] **Step 2: 提示封装**

新建 `src/ui/Toast.ts`：

```ts
import { Platform } from '../platform/Platform';

export const Toast = {
  info(text: string): void {
    Platform.toast(text);
  },
  error(text: string): void {
    console.error(`[S1] ${text}`);
    Platform.toast(text, 3600);
  },
};
```

- [ ] **Step 3: HTTP 层**

新建 `src/net/http.ts`：

```ts
import { AppConfig } from '../config/AppConfig';

export class ApiError extends Error {
  constructor(
    public readonly code: number,
    msg: string,
  ) {
    super(msg);
    this.name = 'ApiError';
  }
}

export interface Envelope<T> {
  code: number;
  msg: string;
  data: T;
}

/**
 * 后端约定：业务错误也是 HTTP 200，错误信息在 body.code / body.msg。
 * 因此必须优先看 body.code，而不是 HTTP status。
 */
export async function httpJson<T>(
  method: 'GET' | 'POST',
  path: string,
  opts: { token?: string | null; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(`${AppConfig.apiBase}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (e) {
    throw new ApiError(-1, `无法连接后端 ${AppConfig.apiBase}（请确认服务已启动且 CORS 放行）`);
  }

  const text = await res.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(res.status, `响应不是 JSON：${text.slice(0, 120)}`);
  }

  if (payload && typeof payload.code === 'number') {
    if (payload.code !== 0) throw new ApiError(payload.code, payload.msg || '请求失败');
    return payload.data as T;
  }
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return payload as T;
}
```

- [ ] **Step 4: 接口清单**

新建 `src/net/api.ts`：

```ts
import { AppConfig } from '../config/AppConfig';
import { httpJson } from './http';

export interface AuthResult {
  token: string;
  accountId: string;
  playerId: string;
}

export interface NpcTalkResult {
  spawnId: string;
  npcTemplateId: string;
  name: string;
  talkType: string;
  dialogueId: number | null;
  text: string;
  options: Array<{ text: string; next: string | null }>;
}

export interface InteractResult {
  ok: boolean;
  reward?: { type?: string; currencyType?: string; amount?: number } | null;
}

export const Api = {
  /** login 不能带 nickname（DTO 无该字段，forbidNonWhitelisted 会 400） */
  login(username: string, password: string): Promise<AuthResult> {
    return httpJson<AuthResult>('POST', '/api/client/v1/auth/login', {
      body: { username, password, deviceId: AppConfig.deviceId },
    });
  },

  register(username: string, password: string, nickname: string): Promise<AuthResult> {
    return httpJson<AuthResult>('POST', '/api/client/v1/auth/register', {
      body: { username, password, nickname, deviceId: AppConfig.deviceId },
    });
  },

  /** objectTemplateId 是 object_templates.id（不是 spawnId），与后端 interactObject 契约一致 */
  interactObject(
    objectTemplateId: number,
    interactType: string,
    token: string | null,
  ): Promise<InteractResult> {
    return httpJson<InteractResult>(
      'POST',
      `/api/client/v1/world/objects/${objectTemplateId}/interact`,
      { token, body: { interactType } },
    );
  },

  talkNpc(spawnId: number, token: string | null): Promise<NpcTalkResult> {
    return httpJson<NpcTalkResult>(
      'POST',
      `/api/client/v1/world/npcs/${spawnId}/talk`,
      { token },
    );
  },
};
```

- [ ] **Step 5: 会话（token 持久化）**

新建 `src/net/Session.ts`：

```ts
import { Platform } from '../platform/Platform';
import type { AuthResult } from './api';

const K_TOKEN = 's1.token';
const K_ACCOUNT = 's1.accountId';
const K_PLAYER = 's1.playerId';

export const Session = {
  token: null as string | null,
  accountId: null as string | null,
  playerId: null as string | null,

  load(): void {
    Session.token = Platform.storageGet(K_TOKEN);
    Session.accountId = Platform.storageGet(K_ACCOUNT);
    Session.playerId = Platform.storageGet(K_PLAYER);
  },

  save(result: AuthResult): void {
    Session.token = result.token;
    Session.accountId = result.accountId;
    Session.playerId = result.playerId;
    Platform.storageSet(K_TOKEN, result.token);
    Platform.storageSet(K_ACCOUNT, result.accountId);
    Platform.storageSet(K_PLAYER, result.playerId);
    console.log(`[S1] 登录成功 playerId=${result.playerId} token=${result.token.slice(0, 16)}…`);
  },

  clear(): void {
    Session.token = null;
    Session.accountId = null;
    Session.playerId = null;
    Platform.storageRemove(K_TOKEN);
    Platform.storageRemove(K_ACCOUNT);
    Platform.storageRemove(K_PLAYER);
  },
};
```

- [ ] **Step 6: 登录视图（登录失败自动尝试注册）**

新建 `src/boot/LoginView.ts`：

```ts
import { Api } from '../net/api';
import type { AuthResult } from '../net/api';
import { ApiError } from '../net/http';
import { Session } from '../net/Session';
import { Platform } from '../platform/Platform';
import { Toast } from '../ui/Toast';

export class LoginView {
  static show(onLoggedIn: () => void): void {
    Platform.showLoginForm({
      onSubmit: async (username, password) => {
        let result: AuthResult | null = null;

        try {
          result = await Api.login(username, password);
        } catch (loginErr) {
          if (!(loginErr instanceof ApiError)) throw loginErr;
          try {
            result = await Api.register(username, password, username);
            Toast.info('账号不存在，已自动注册');
          } catch (regErr) {
            const msg = regErr instanceof ApiError ? regErr.message : String(regErr);
            throw new ApiError(-1, `登录失败：${msg}（若账号已存在，请检查密码）`);
          }
        }

        Session.save(result);
        Platform.hideLoginForm();
        Toast.info(`登录成功：playerId=${result.playerId}`);
        onLoggedIn();
      },
    });
  }
}
```

- [ ] **Step 7: Main 接入登录（仍不连 WS）**

`src/boot/Main.ts` 整体替换为：

```ts
import { Boot } from './Boot';
import { LoginView } from './LoginView';
import { Session } from '../net/Session';

async function afterLogin(): Promise<void> {
  console.log(`[S1] afterLogin playerId=${Session.playerId}（Task 8 起在此处连接 WS 并进场景）`);
}

async function main(): Promise<void> {
  await Boot.start();
  Session.load();

  if (Session.token) {
    console.log('[S1] 复用本地 token');
    await afterLogin();
    return;
  }

  LoginView.show(() => {
    void afterLogin();
  });
}

main().catch((err) => {
  console.error('[S1] 启动失败', err);
});
```

- [ ] **Step 8: 重新构建并验证（验收 #2）**

cwd = `e:\code\nest\packages-game\game-client`

```
node tools/build-fallback.mjs
```

浏览器打开 `http://localhost:5173/`（后端 3000 与静态服务 5173 都需在运行）。

Expected：
1. 页面出现登录框（账号/密码已预填 `spike01` / `spike123456`）；
2. 点「登录 / 自动注册」后出现提示 `登录成功：playerId=N`；
3. 控制台输出 `[S1] 登录成功 playerId=N token=…` 与 `[S1] afterLogin playerId=N`；
4. 打开 DevTools → Application → Local Storage，可见 `s1.token`；
5. 刷新页面 → 控制台输出 `[S1] 复用本地 token`（不再弹登录框）。

- [ ] **Step 9: Commit**

```
git add packages-game/game-client
git commit -m "feat(game-client): HTTP 层与登录流程（复用现有客户端认证接口）"
```

---

### Task 8: WS 层（对齐后端帧结构）

**Files:**
- Create: `packages-game/game-client/src/net/socketio.d.ts`
- Create: `packages-game/game-client/src/net/ws.ts`

- [ ] **Step 1: vendor 库的最小类型声明**

新建 `src/net/socketio.d.ts`：

```ts
/** vendored socket.io-client 4.x（vendor/socket.io.min.js，全局 io）的最小声明 */
declare function io(url: string, opts?: any): any;
```

- [ ] **Step 2: WS 客户端**

新建 `src/net/ws.ts`：

```ts
import { AppConfig } from '../config/AppConfig';

export interface WsMessage {
  cmd: string;
  seq: number;
  code: number;
  msg: string;
  data: any;
}

interface Pending {
  resolve: (m: WsMessage) => void;
  reject: (e: Error) => void;
  timer: any;
}

const ACK_TIMEOUT_MS = 8000;

export class WsClient {
  private socket: any = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, (m: WsMessage) => void>();

  async connect(token: string): Promise<void> {
    if (typeof io !== 'function') {
      throw new Error('socket.io 未加载：请确认 index.html 引入了 /vendor/socket.io.min.js');
    }
    this.socket = io(AppConfig.wsUrl, {
      transports: ['websocket'],
      query: { token },
      reconnection: true,
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WS 连接超时（8s）')), ACK_TIMEOUT_MS);
      this.socket.on('connect', () => {
        clearTimeout(timer);
        console.log('[S1] WS connected');
        resolve();
      });
      this.socket.on('connect_error', (err: any) => {
        clearTimeout(timer);
        reject(new Error(`WS 连接失败：${err?.message ?? err}`));
      });
    });

    this.socket.on('message', (m: WsMessage) => this.dispatch(m));
    this.socket.on('disconnect', (reason: string) => {
      console.warn(`[S1] WS disconnected: ${reason}`);
    });
  }

  /** 注册某类应答/广播的处理函数（非应答式广播用 onBroadcast） */
  on(cmd: string, handler: (m: WsMessage) => void): void {
    this.handlers.set(cmd, handler);
  }

  /** 所有非应答事件（seq 不可匹配 pending 的）都回调到这里 */
  onBroadcast(handler: (m: WsMessage) => void): void {
    this.handlers.set('*', handler);
  }

  /**
   * 发送请求。expectAck=false 时不登记 pending（用于 world.move 这类高频上报）。
   * 服务端 ack 与广播共用 'message' 事件；异常走 WsExceptionFilter 时也用同 cmd+seq 返回。
   */
  send<T = any>(cmd: string, data: unknown, expectAck = true): Promise<WsMessage & { data: T }> {
    if (!this.socket) throw new Error('WS 未连接');
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      if (expectAck) {
        const timer = setTimeout(() => {
          this.pending.delete(seq);
          reject(new Error(`WS 请求超时：${cmd}`));
        }, ACK_TIMEOUT_MS);
        this.pending.set(seq, {
          resolve: resolve as (m: WsMessage) => void,
          reject,
          timer,
        });
      }
      this.socket.emit('message', { cmd, seq, data });
    });
  }

  private dispatch(m: WsMessage): void {
    if (m && typeof m.seq === 'number' && this.pending.has(m.seq)) {
      const p = this.pending.get(m.seq)!;
      this.pending.delete(m.seq);
      clearTimeout(p.timer);
      p.resolve(m);
      return;
    }
    const h = this.handlers.get(m?.cmd) ?? this.handlers.get('*');
    if (h) h(m);
  }
}
```

> 心跳 `player.heartbeat` 在 S1 **不主动发送**（服务端 `pingInterval=30000/pingTimeout=90000` 已维持连接），标记为 S3 补。

- [ ] **Step 3: Node 侧验证 WS 握手与进场景（不依赖浏览器）**

cwd = `e:\code\nest\packages-game\game-server`

```
node -e "const{io}=require('socket.io-client');const s=io('http://localhost:3000/game',{transports:['websocket'],query:{token:process.argv[1]}});s.on('connect',()=>{console.log('connected');s.emit('message',{cmd:'world.enter-scene',seq:1,data:{sceneId:1}})});s.on('message',m=>{console.log(JSON.stringify(m).slice(0,300));process.exit(0)});setTimeout(()=>{console.log('timeout');process.exit(1)},8000)" "<把 Task 1 Step 6 的 token 粘到这里>"
```

Expected：先 `connected`，随后打印一条含 `"cmd":"world.enter_scene_sync"` 与 `"spawns":[…]` 的消息。
> 若打印 `timeout` → 检查 token 是否是最新登录所得（登录会使旧 token 失效）。
> 若打印 `"code":401` 类消息 → token 无效，重新登录取新的。

> **实测偏离（2026-09-21，已修复后通过）**：① ack 不走 `message` 事件——handler 直接 `return` 的对象走 socket.io ack 回调（`emit(cmd, payload, cb)`），只有 `player.heartbeat` 等主动 `client.emit('message')` 的才在 `message` 上；`WsClient.send` 已同时兼容两条路径。② 网关 `jwtService.verify(token)` 未传 secret，而 `AuthModule` 注册的 global `JwtModule` 无 secret → 握手必然 `invalid token`；已改为 `JwtModule.registerAsync({global:true, secret: config.get('jwt.secret')})`。③ `handleConnection` 在 `await validateToken` 之后才写 `client.data.playerId`，客户端 connect 后立即发消息会被判「未认证」；已改为先落身份再 await。④ dev 用 `scripts/mock-redis.js` 的 `SET` 不支持 `EX`（值被拼成 `"1 EX 60"` 且永不过期）→ 登录限流计数永久累积，已修。

- [ ] **Step 4: Commit**

```
git add packages-game/game-client/src/net/socketio.d.ts packages-game/game-client/src/net/ws.ts
git commit -m "feat(game-client): WS 客户端封装（seq 应答 + 广播分发）"
```

---

### Task 9: 配置包加载 + 静态层渲染（验收 #3）

**Files:**
- Create: `packages-game/game-client/src/config/schema.ts`
- Create: `packages-game/game-client/src/config/validate.ts`
- Create: `packages-game/game-client/src/config/loader.ts`
- Create: `packages-game/game-client/src/entity/Entity.ts`
- Create: `packages-game/game-client/src/entity/EntityFactory.ts`
- Create: `packages-game/game-client/src/world/SceneBuilder.ts`
- Modify: `packages-game/game-client/src/boot/Main.ts`

- [ ] **Step 1: 配置包类型**

新建 `src/config/schema.ts`：

```ts
export interface SceneEntry {
  x: number;
  y: number;
}

export interface SceneMeta {
  name: string;
  mapResKey: string;
  mapWidth: number;
  mapHeight: number;
  minLevel: number;
  maxPlayers: number;
  sceneType: string;
  entry: SceneEntry;
}

export interface StaticEntityInteract {
  type: string;
  cd: number;
  oneTime: boolean;
}

export interface StaticEntity {
  kind: 'object';
  spawnId: number;
  templateId: number;
  resKey: string;
  x: number;
  y: number;
  rotation: number;
  interact: StaticEntityInteract;
}

export interface FixedNpc {
  spawnId: number;
  npcTemplateId: number;
  resKey: string;
  x: number;
  y: number;
  anim: string;
}

export interface ConfigTrigger {
  id: number;
  type: string;
  area: { x: number; y: number; w: number; h: number };
  targetSceneId: number | null;
  onceOnly: boolean;
}

export interface SceneConfig {
  schemaVersion: number;
  sceneId: number;
  version: number;
  hash: string;
  scene: SceneMeta;
  layers: Record<string, unknown>;
  staticEntities: StaticEntity[];
  fixedNpcs: FixedNpc[];
  triggers: ConfigTrigger[];
}

export interface ManifestScene {
  sceneId: number;
  version: number;
  hash: string;
  file: string;
}

export interface SceneManifest {
  generatedAt?: string;
  scenes: ManifestScene[];
}

/** 服务端 world.enter_scene_sync 下发的 spawn 记录（TypeORM 行，字段为驼峰） */
export interface ServerSpawn {
  id: string;
  sceneId: string;
  entityType: 'npc' | 'monster' | 'object';
  templateId: string;
  spawnX: number;
  spawnY: number;
  spawnRotation: number;
  spawnCount: number;
  spawnRadius: number;
  isActive: boolean;
}
```

- [ ] **Step 2: 轻量校验（不引入 zod）**

新建 `src/config/validate.ts`：

```ts
import type { SceneConfig } from './schema';

export class ConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ConfigError';
  }
}

function isInt(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v);
}

/** 手写轻量校验：只校验客户端渲染必需字段，不做完整 JSON Schema 实现（S2 换正式 schema） */
export function validateSceneConfig(raw: any, file: string): SceneConfig {
  if (!raw || typeof raw !== 'object') throw new ConfigError(`${file} 不是对象`);

  for (const key of ['schemaVersion', 'sceneId', 'version']) {
    if (typeof raw[key] !== 'number') throw new ConfigError(`${file} 缺少数值字段 ${key}`);
  }
  const scene = raw.scene;
  if (!scene || typeof scene !== 'object') throw new ConfigError(`${file} 缺少 scene`);
  for (const key of ['mapWidth', 'mapHeight']) {
    if (!isInt(scene[key])) throw new ConfigError(`${file} scene.${key} 必须是整数`);
  }
  if (!scene.entry || !isInt(scene.entry.x) || !isInt(scene.entry.y)) {
    throw new ConfigError(`${file} 缺少整数出生点 scene.entry`);
  }
  if (!Array.isArray(raw.staticEntities)) throw new ConfigError(`${file} staticEntities 必须是数组`);
  if (!Array.isArray(raw.fixedNpcs)) throw new ConfigError(`${file} fixedNpcs 必须是数组`);
  if (!Array.isArray(raw.triggers)) throw new ConfigError(`${file} triggers 必须是数组`);

  for (const e of raw.staticEntities) {
    if (!isInt(e?.spawnId) || !isInt(e?.templateId) || !isInt(e?.x) || !isInt(e?.y)) {
      throw new ConfigError(`${file} staticEntities 项缺少整数 spawnId/templateId/x/y`);
    }
    if (!e.interact || typeof e.interact.type !== 'string') {
      throw new ConfigError(`${file} staticEntities[${e.spawnId}] 缺少 interact.type`);
    }
  }
  for (const n of raw.fixedNpcs) {
    if (!isInt(n?.spawnId) || !isInt(n?.npcTemplateId) || !isInt(n?.x) || !isInt(n?.y)) {
      throw new ConfigError(`${file} fixedNpcs 项缺少整数 spawnId/npcTemplateId/x/y`);
    }
  }
  for (const t of raw.triggers) {
    if (!isInt(t?.id) || !t?.area) throw new ConfigError(`${file} triggers 项缺少 id/area`);
  }

  return raw as SceneConfig;
}
```

- [ ] **Step 3: 加载器（manifest → hash 校验 → 校验）**

新建 `src/config/loader.ts`：

```ts
import { AppConfig } from './AppConfig';
import type { ManifestScene, SceneConfig, SceneManifest } from './schema';
import { validateSceneConfig } from './validate';

export class ConfigLoader {
  static async loadManifest(): Promise<SceneManifest> {
    const res = await fetch(`${AppConfig.configBase}/manifest.json`);
    if (!res.ok) throw new Error(`配置清单加载失败 HTTP ${res.status}`);
    const manifest = (await res.json()) as SceneManifest;
    if (!manifest || !Array.isArray(manifest.scenes) || manifest.scenes.length === 0) {
      throw new Error('配置清单为空（请先执行 npm run seed:scene-spike）');
    }
    return manifest;
  }

  /** 按 sceneId 取配置；sceneId 缺省时取清单第一项（S1 只有一个场景） */
  static async loadScene(sceneId?: number): Promise<SceneConfig> {
    const manifest = await ConfigLoader.loadManifest();
    const item: ManifestScene =
      manifest.scenes.find((s) => s.sceneId === sceneId) ?? manifest.scenes[0];

    const res = await fetch(`${AppConfig.configBase}/${item.file}`);
    if (!res.ok) throw new Error(`配置包加载失败 HTTP ${res.status}（${item.file}）`);
    const text = await res.text();

    await ConfigLoader.verifyHash(text, item.hash, item.file);

    const cfg = validateSceneConfig(JSON.parse(text), item.file);
    console.log(
      `[S1] 配置包就绪 ${item.file} sceneId=${cfg.sceneId} v${cfg.version} 静态物件=${cfg.staticEntities.length} NPC=${cfg.fixedNpcs.length} 触发器=${cfg.triggers.length}`,
    );
    return cfg;
  }

  /** manifest.hash = 场景文件原始文本的 sha256（与 seeds/scene-spike.seed.ts 的算法一致） */
  private static async verifyHash(text: string, expected: string, file: string): Promise<void> {
    const subtle = (globalThis.crypto as any)?.subtle;
    if (!subtle || typeof TextEncoder === 'undefined') {
      console.warn(`[S1] 当前环境无 crypto.subtle，跳过 ${file} 哈希校验`);
      return;
    }
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const actual = `sha256:${hex}`;
    if (actual !== expected) {
      throw new Error(`配置包哈希校验失败 ${file}：实际 ${actual.slice(0, 20)}… 期望 ${expected.slice(0, 20)}…`);
    }
    console.log(`[S1] 配置包哈希校验通过 ${file}`);
  }
}
```

- [ ] **Step 4: 实体基类**

新建 `src/entity/Entity.ts`：

```ts
export type EntityKind = 'player' | 'npc' | 'object';

/**
 * 实体 = 唯一可寻址的逻辑单元。
 * 原点在「脚底中心」：贴图绘制在 (x-16, y-32)，与后端 spawn_x/spawn_y 直接对齐，不做坐标换算。
 */
export class Entity {
  readonly sprite: Laya.Sprite;
  private readonly label: Laya.Text | null = null;

  constructor(
    readonly entityId: string,
    readonly kind: EntityKind,
    readonly spawnId: number | null,
    readonly templateId: number | null,
    readonly interactType: string | null,
    displayName: string,
    x: number,
    y: number,
    color: string,
    texture: Laya.Texture | null,
  ) {
    this.sprite = new Laya.Sprite();
    this.sprite.pos(x, y);

    const size = kind === 'player' ? 36 : 32;
    this.sprite.graphics.drawRect(-size / 2, -size, size, size, color);
    if (texture) this.sprite.graphics.drawTexture(texture, -size / 2, -size, size, size);

    const text = new Laya.Text();
    text.text = displayName;
    text.fontSize = 12;
    text.color = '#ffffff';
    text.stroke = 2;
    text.strokeColor = '#000000';
    text.pos(-size, 2);
    this.sprite.addChild(text);
    this.label = text;
  }

  get x(): number {
    return Math.round(this.sprite.x);
  }

  get y(): number {
    return Math.round(this.sprite.y);
  }

  setPos(x: number, y: number): void {
    this.sprite.pos(Math.round(x), Math.round(y));
  }

  distanceTo(other: Entity): number {
    return Math.hypot(this.x - other.x, this.y - other.y);
  }
}
```

- [ ] **Step 5: 实体工厂**

新建 `src/entity/EntityFactory.ts`：

```ts
import { AppConfig } from '../config/AppConfig';
import { Entity } from './Entity';
import type { FixedNpc, ServerSpawn, StaticEntity } from '../config/schema';

const PLACEHOLDER_URL = `${AppConfig.assetBase}resources/placeholder.png`;

const COLORS: Record<string, string> = {
  player: '#2f81f7',
  npc: '#f5a524',
  object: '#7ee787',
  monster: '#ff7b72',
};

export class EntityFactory {
  private static texture: Laya.Texture | null = null;

  /** 一次性加载占位贴图（验证引擎 loader 与静态资源路径） */
  static async loadPlaceholder(): Promise<void> {
    await Laya.loader.load(PLACEHOLDER_URL);
    EntityFactory.texture = Laya.Loader.getRes(PLACEHOLDER_URL) as Laya.Texture;
    console.log(`[S1] 占位贴图加载完成：${PLACEHOLDER_URL}`);
  }

  static createPlayer(playerId: string, x: number, y: number): Entity {
    return new Entity(
      `player:${playerId}`,
      'player',
      null,
      null,
      null,
      `我(${playerId})`,
      x,
      y,
      COLORS.player,
      EntityFactory.texture,
    );
  }

  static createFromStatic(e: StaticEntity): Entity {
    return new Entity(
      `object:${e.spawnId}`,
      'object',
      e.spawnId,
      e.templateId,
      e.interact.type,
      `物${e.spawnId}`,
      e.x,
      e.y,
      COLORS.object,
      EntityFactory.texture,
    );
  }

  static createFromFixedNpc(n: FixedNpc): Entity {
    return new Entity(
      `npc:${n.spawnId}`,
      'npc',
      n.spawnId,
      n.npcTemplateId,
      'talk',
      `NPC${n.spawnId}`,
      n.x,
      n.y,
      COLORS.npc,
      EntityFactory.texture,
    );
  }

  static createFromServerSpawn(sp: ServerSpawn): Entity {
    const id = Number(sp.id);
    const kind = sp.entityType === 'monster' ? 'npc' : sp.entityType;
    return new Entity(
      `${kind}:${id}`,
      kind,
      id,
      Number(sp.templateId),
      kind === 'npc' ? 'talk' : null,
      `${sp.entityType}${id}`,
      sp.spawnX,
      sp.spawnY,
      COLORS[sp.entityType] ?? COLORS.object,
      EntityFactory.texture,
    );
  }
}
```

- [ ] **Step 6: 场景装配（含服务端 spawn 去重）**

新建 `src/world/SceneBuilder.ts`：

```ts
import type { SceneConfig, ServerSpawn } from '../config/schema';
import { Entity } from '../entity/Entity';
import { EntityFactory } from '../entity/EntityFactory';
import { EntityRegistry } from '../entity/EntityRegistry';

export class SceneBuilder {
  /** 世界层：child[0] = 背景层（地形/网格/触发器区域），child[1..] = 实体层（按 y 升序） */
  static layer: Laya.Sprite | null = null;

  static build(cfg: SceneConfig): Laya.Sprite {
    const layer = new Laya.Sprite();
    SceneBuilder.layer = layer;

    const bg = new Laya.Sprite();
    bg.graphics.drawRect(0, 0, cfg.scene.mapWidth, cfg.scene.mapHeight, '#2f6b3a');
    for (let x = 0; x <= cfg.scene.mapWidth; x += 100) {
      bg.graphics.drawLine(x, 0, x, cfg.scene.mapHeight, '#3d7a4a', 1);
    }
    for (let y = 0; y <= cfg.scene.mapHeight; y += 100) {
      bg.graphics.drawLine(0, y, cfg.scene.mapWidth, y, '#3d7a4a', 1);
    }
    for (const t of cfg.triggers) {
      bg.graphics.drawRect(t.area.x, t.area.y, t.area.w, t.area.h, null, '#f5c542', 2);
    }
    layer.addChild(bg);

    const entityLayer = new Laya.Sprite();
    entityLayer.name = 's1-entities';
    layer.addChild(entityLayer);

    const statics: Entity[] = [
      ...cfg.staticEntities.map((e) => EntityFactory.createFromStatic(e)),
      ...cfg.fixedNpcs.map((n) => EntityFactory.createFromFixedNpc(n)),
    ];
    statics.sort((a, b) => a.y - b.y);
    for (const e of statics) {
      EntityRegistry.add(e);
      entityLayer.addChild(e.sprite);
    }

    console.log(
      `[S1] 静态层渲染完成：地形 ${cfg.scene.mapWidth}x${cfg.scene.mapHeight}，物件 ${cfg.staticEntities.length}，NPC ${cfg.fixedNpcs.length}，触发器 ${cfg.triggers.length}，出生点 (${cfg.scene.entry.x},${cfg.scene.entry.y})`,
    );
    return layer;
  }

  /**
   * 总纲 §6.5 去重规则：按 spawnId 求交，配置包优先。
   * - entity_type='object' 一律忽略（静态物件已在配置包，避免同屏双份与坐标漂移）
   * - entity_type='npc' 且 spawnId 已在配置包 fixedNpcs 中 → 忽略（位置以服务端为准的规则留给 S4 的巡逻/随机 NPC）
   * 返回被保留的动态 spawn，供调用方生成实体。
   */
  static mergeServerSpawns(cfg: SceneConfig, spawns: ServerSpawn[]): ServerSpawn[] {
    const staticNpcSpawnIds = new Set(cfg.fixedNpcs.map((n) => n.spawnId));
    const accepted: ServerSpawn[] = [];
    let ignored = 0;

    for (const sp of spawns) {
      const id = Number(sp.id);
      if (sp.entityType === 'object') {
        ignored++;
        continue;
      }
      if (sp.entityType === 'npc' && staticNpcSpawnIds.has(id)) {
        ignored++;
        continue;
      }
      accepted.push(sp);
    }

    console.log(
      `[S1] 服务端 spawns=${spawns.length}，去重忽略=${ignored}（静态物件/已在配置包的 NPC），接受动态=${accepted.length}`,
    );
    return accepted;
  }

  /** 每 N 帧按 y 升序重排实体层，实现伪 3D 遮挡（n ≤ 150，成本可忽略） */
  static resort(): void {
    const layer = SceneBuilder.layer;
    if (!layer) return;
    const entityLayer = layer.getChildByName('s1-entities') as Laya.Sprite | null;
    if (!entityLayer) return;

    const list = EntityRegistry.all().slice().sort((a, b) => a.y - b.y);
    for (let i = 0; i < list.length; i++) {
      if (entityLayer.getChildIndex(list[i].sprite) !== i) {
        entityLayer.setChildIndex(list[i].sprite, i);
      }
    }
  }
}
```

- [ ] **Step 7: 实体登记表**

新建 `src/entity/EntityRegistry.ts`：

```ts
import type { Entity } from './Entity';

const byId = new Map<string, Entity>();

export const EntityRegistry = {
  add(entity: Entity): void {
    byId.set(entity.entityId, entity);
  },

  remove(entityId: string): void {
    const e = byId.get(entityId);
    if (e && e.sprite.parent) e.sprite.parent.removeChild(e.sprite);
    byId.delete(entityId);
  },

  get(entityId: string): Entity | undefined {
    return byId.get(entityId);
  },

  all(): Entity[] {
    return Array.from(byId.values());
  },

  /** 按 entityId upsert：已存在则仅更新坐标（§9 的广播 upsert 语义），否则交付给传入的创建函数 */
  upsert(entityId: string, position: { x: number; y: number }, create: () => Entity): Entity {
    const existing = byId.get(entityId);
    if (existing) {
      existing.setPos(position.x, position.y);
      return existing;
    }
    const created = create();
    EntityRegistry.add(created);
    return created;
  },

  clear(): void {
    for (const e of byId.values()) {
      if (e.sprite.parent) e.sprite.parent.removeChild(e.sprite);
    }
    byId.clear();
  },
};
```

- [ ] **Step 8: Main 接入配置包与静态层**

`src/boot/Main.ts` 整体替换为：

```ts
import { Boot } from './Boot';
import { LoginView } from './LoginView';
import { AppConfig } from '../config/AppConfig';
import { ConfigLoader } from '../config/loader';
import { EntityFactory } from '../entity/EntityFactory';
import { Session } from '../net/Session';
import { SceneBuilder } from '../world/SceneBuilder';
import { Platform } from '../platform/Platform';
import { Toast } from '../ui/Toast';

async function afterLogin(): Promise<void> {
  if (Platform.isMiniGame()) {
    // S1 微信端只验收「配置包 + 静态层 + HTTP 登录」，WS 适配见 S7
    const cfg = await ConfigLoader.loadScene();
    await EntityFactory.loadPlaceholder();
    Laya.stage.addChild(SceneBuilder.build(cfg));
    Toast.info('微信端 S1：静态场景已渲染（WS 待 S7）');
    return;
  }

  const cfg = await ConfigLoader.loadScene();
  await EntityFactory.loadPlaceholder();
  const layer = SceneBuilder.build(cfg);
  Laya.stage.addChild(layer);

  // Task 10 起在此处接 WS 进场景与实体合并
  Laya.timer.frameLoop(10, null, () => SceneBuilder.resort());
  console.log(`[S1] 客户端版本 ${AppConfig.clientVersion}，配置包 v${cfg.version}`);
}

async function main(): Promise<void> {
  await Boot.start();
  Session.load();

  if (Session.token) {
    console.log('[S1] 复用本地 token');
    await afterLogin();
    return;
  }

  LoginView.show(() => {
    void afterLogin().catch((err) => Toast.error(err instanceof Error ? err.message : String(err)));
  });
}

main().catch((err) => {
  console.error('[S1] 启动失败', err);
});
```

> 从本步起一直到最后，`afterLogin()` 都补上 `.catch(...)` 保护，避免登录后异常只在控制台静默。

- [ ] **Step 9: 构建并验证（验收 #3）**

```
node tools/build-fallback.mjs
```

浏览器打开 `http://localhost:5173/` 并登录。

Expected：
1. 出现 1280×960 的绿色地形 + 100px 网格；
2. 出现 10 个绿色物件方块与 3 个橙色 NPC 方块，每个带名称标签；
3. 左上角 (0,0) 有 120×120 的黄色边框（transport 触发器区域），(600,200) 有 160×120 黄框（story）；
4. 控制台输出：
```
[S1] 配置包哈希校验通过 scene-1-v1.json
[S1] 配置包就绪 scene-1-v1.json sceneId=1 v1 静态物件=10 NPC=3 触发器=2
[S1] 占位贴图加载完成：/assets/resources/placeholder.png
[S1] 静态层渲染完成：地形 1280x960，物件 10，NPC 3，触发器 2，出生点 (640,480)
[S1] 客户端版本 0.1.0-s1，配置包 v1
```

- [ ] **Step 10: Commit**

```
git add packages-game/game-client
git commit -m "feat(game-client): 配置包加载与静态层渲染（地形/物件/NPC/触发器）"
```

---

### Task 10: 进场景 + 服务端 spawn 合并（验收 #4、#5）

**Files:**
- Modify: `packages-game/game-client/src/world/SceneBuilder.ts`（新增 `entityLayer()` / `addEntity()`）
- Modify: `packages-game/game-client/src/boot/Main.ts`

- [ ] **Step 1: SceneBuilder 增加幂等挂载入口**

在 `src/world/SceneBuilder.ts` 里，`mergeServerSpawns()` 之前插入两个方法，并把 `resort()` 的取层逻辑换成复用 `entityLayer()`：

```ts
  private static entityLayer(): Laya.Sprite | null {
    const layer = SceneBuilder.layer;
    if (!layer) return null;
    return (layer.getChildByName('s1-entities') as Laya.Sprite) ?? null;
  }

  /** 幂等挂载：同一实体重复调用不会重复 addChild */
  static addEntity(entity: Entity): void {
    const target = SceneBuilder.entityLayer();
    if (!target) return;
    EntityRegistry.add(entity);
    if (entity.sprite.parent !== target) target.addChild(entity.sprite);
  }
```

`resort()` 改为：

```ts
  static resort(): void {
    const entityLayer = SceneBuilder.entityLayer();
    if (!entityLayer) return;

    const list = EntityRegistry.all().slice().sort((a, b) => a.y - b.y);
    for (let i = 0; i < list.length; i++) {
      if (entityLayer.getChildIndex(list[i].sprite) !== i) {
        entityLayer.setChildIndex(list[i].sprite, i);
      }
    }
  }
```

- [ ] **Step 2: Main 接入 WS 进场景与实体合并**

`src/boot/Main.ts` 整体替换为：

```ts
import { Boot } from './Boot';
import { LoginView } from './LoginView';
import { AppConfig } from '../config/AppConfig';
import { ConfigLoader } from '../config/loader';
import type { SceneConfig, ServerSpawn } from '../config/schema';
import { Entity } from '../entity/Entity';
import { EntityFactory } from '../entity/EntityFactory';
import { EntityRegistry } from '../entity/EntityRegistry';
import { Session } from '../net/Session';
import { WsClient } from '../net/ws';
import { Platform } from '../platform/Platform';
import { SceneBuilder } from '../world/SceneBuilder';
import { Toast } from '../ui/Toast';

const state = {
  cfg: null as SceneConfig | null,
  ws: null as WsClient | null,
  me: null as Entity | null,
};

interface EnterSceneSync {
  scene: { id: string; name: string; mapWidth: number; mapHeight: number };
  spawns: ServerSpawn[];
  triggers: Array<{ id: string; triggerType: string }>;
}

async function afterLogin(): Promise<void> {
  if (Platform.isMiniGame()) {
    // S1 微信端只验收「配置包 + 静态层 + HTTP 登录」，WS 适配见 S7（Task 13）
    const cfg = await ConfigLoader.loadScene();
    await EntityFactory.loadPlaceholder();
    Laya.stage.addChild(SceneBuilder.build(cfg));
    Toast.info('微信端 S1：静态场景已渲染（WS 待 S7）');
    return;
  }

  // ① 配置包 → 静态层
  const cfg = await ConfigLoader.loadScene();
  await EntityFactory.loadPlaceholder();
  Laya.stage.addChild(SceneBuilder.build(cfg));
  state.cfg = cfg;

  // ② WS 连接
  const ws = new WsClient();
  await ws.connect(Session.token!);
  state.ws = ws;

  // ③ 进场景（应答 cmd 为 world.enter_scene_sync）
  const sync = await ws.send<EnterSceneSync>('world.enter-scene', { sceneId: cfg.sceneId });
  if (sync.code !== 0) throw new Error(`进场景失败：${sync.msg}`);
  console.log(
    `[S1] 进场景应答 cmd=${sync.cmd} scene=${sync.data.scene?.name} 服务端 spawns=${sync.data.spawns.length} triggers=${sync.data.triggers.length}`,
  );

  // ④ 合并实体表（配置包优先，去重后再生成动态实体）
  const accepted = SceneBuilder.mergeServerSpawns(cfg, sync.data.spawns);
  for (const sp of accepted) {
    SceneBuilder.addEntity(EntityFactory.createFromServerSpawn(sp));
  }

  // ⑤ 自己（addEntity 内部已登记到 EntityRegistry，无需重复 add）
  const me = EntityFactory.createPlayer(Session.playerId!, cfg.scene.entry.x, cfg.scene.entry.y);
  SceneBuilder.addEntity(me);
  state.me = me;
  console.log(`[S1] 本地玩家 ${me.entityId} 出生于 (${me.x},${me.y})`);

  Laya.timer.frameLoop(10, null, () => SceneBuilder.resort());
  console.log(`[S1] 客户端版本 ${AppConfig.clientVersion}，配置包 v${cfg.version}`);
}

async function main(): Promise<void> {
  await Boot.start();
  Session.load();

  if (Session.token) {
    console.log('[S1] 复用本地 token');
    await afterLogin();
    return;
  }

  LoginView.show(() => {
    void afterLogin().catch((err) => Toast.error(err instanceof Error ? err.message : String(err)));
  });
}

main().catch((err) => {
  console.error('[S1] 启动失败', err);
  Toast.error(err instanceof Error ? err.message : String(err));
});
```

- [ ] **Step 3: 构建并验证（验收 #4、#5）**

```
node tools/build-fallback.mjs
```

浏览器刷新 `http://localhost:5173/`（登录态会被复用）。

Expected：
1. NPC 色块的像素坐标与配置包一致：打开 `http://localhost:5173/config/scene-1-v1.json`，把 `fixedNpcs[i].x/y` 与画面中「NPC21 / NPC22 / NPC23」标签方块（原点=方块底边中心）位置目视比对，应完全一致（如 `(600,380)` 在 600px 网格线右侧 0px、380px 处）。
2. 控制台输出：
```
[S1] WS connected
[S1] 进场景应答 cmd=world.enter_scene_sync scene=新手村（Spike） 服务端 spawns=13 triggers=2
[S1] 服务端 spawns=13，去重忽略=13（静态物件/已在配置包的 NPC），接受动态=0
[S1] 本地玩家 player:N 出生于 (640,480)
```
> `去重忽略=13` 是**预期正确结果**：seed 播的 10 物件 + 3 NPC 都在配置包里，服务端下发的全被忽略，避免同屏双份。
3. 屏幕上出现 1 个蓝色玩家方块 + 10 物件 + 3 NPC。

- [ ] **Step 4: Commit**

```
git add packages-game/game-client
git commit -m "feat(game-client): 进场景与服务端 spawn 合并（按 spawnId 去重，配置包优先）"
```

---

### Task 11: 移动 + 双窗口互见（验收 #7）

**Files:**
- Create: `packages-game/game-client/src/world/PlayerControl.ts`
- Modify: `packages-game/game-client/src/entity/EntityFactory.ts`（新增 `createOtherPlayer`）
- Modify: `packages-game/game-client/src/boot/Main.ts`

- [ ] **Step 1: EntityFactory 增加其他玩家工厂**

在 `src/entity/EntityFactory.ts` 的 `createPlayer` 之后插入：

```ts
  static createOtherPlayer(playerId: string, x: number, y: number): Entity {
    return new Entity(
      `player:${playerId}`,
      'player',
      null,
      null,
      null,
      `玩家${playerId}`,
      x,
      y,
      COLORS.player,
      EntityFactory.texture,
    );
  }
```

- [ ] **Step 2: 移动控制**

新建 `src/world/PlayerControl.ts`：

```ts
import { AppConfig } from '../config/AppConfig';
import type { Entity } from '../entity/Entity';
import type { WsClient } from '../net/ws';

const KEY_W = 87;
const KEY_A = 65;
const KEY_S = 83;
const KEY_D = 68;
const KEY_UP = 38;
const KEY_LEFT = 37;
const KEY_DOWN = 40;
const KEY_RIGHT = 39;
const SPEED_PX_PER_FRAME = 4;

export class PlayerControl {
  private readonly pressed = new Set<number>();
  private sinceReport = 0;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private readonly me: Entity,
    private readonly ws: WsClient,
    private readonly bounds: { width: number; height: number },
  ) {}

  attach(): void {
    this.lastX = this.me.x;
    this.lastY = this.me.y;
    Laya.stage.on(Laya.Event.KEY_DOWN, this, this.onKeyDown);
    Laya.stage.on(Laya.Event.KEY_UP, this, this.onKeyUp);
    Laya.timer.frameLoop(1, this, this.onFrame);
    console.log('[S1] 移动控制就绪：WASD / 方向键；移动中约 10Hz 上报 world.move');
  }

  private onKeyDown(e: Laya.Event): void {
    this.pressed.add(e.keyCode);
  }

  private onKeyUp(e: Laya.Event): void {
    this.pressed.delete(e.keyCode);
  }

  private onFrame(): void {
    let dx = 0;
    let dy = 0;
    if (this.pressed.has(KEY_A) || this.pressed.has(KEY_LEFT)) dx -= 1;
    if (this.pressed.has(KEY_D) || this.pressed.has(KEY_RIGHT)) dx += 1;
    if (this.pressed.has(KEY_W) || this.pressed.has(KEY_UP)) dy -= 1;
    if (this.pressed.has(KEY_S) || this.pressed.has(KEY_DOWN)) dy += 1;
    if (!dx && !dy) return;

    const len = Math.hypot(dx, dy);
    const nx = this.me.x + (dx / len) * SPEED_PX_PER_FRAME;
    const ny = this.me.y + (dy / len) * SPEED_PX_PER_FRAME;
    this.me.setPos(
      Math.min(Math.max(nx, 8), this.bounds.width - 8),
      Math.min(Math.max(ny, 16), this.bounds.height - 8),
    );

    const now = Date.now();
    const moved = Math.hypot(this.me.x - this.lastX, this.me.y - this.lastY);
    if (now - this.sinceReport >= AppConfig.moveReportIntervalMs && moved >= AppConfig.moveReportThreshold) {
      this.sinceReport = now;
      this.lastX = this.me.x;
      this.lastY = this.me.y;
      // fire-and-forget：expectAck=false 的 Promise 永不 settle，不要 await
      this.ws.send('world.move', { x: this.me.x, y: this.me.y, rotation: 0, state: 'move' }, false);
    }
  }
}
```

- [ ] **Step 3: Main 接入移动与广播**

`src/boot/Main.ts` 的三处修改（其余保持 Step Task 10 的版本不变）：

1) 新增导入：

```ts
import { PlayerControl } from '../world/PlayerControl';
```

2) 在 Task 10 的 `// ⑤ 自己` 段落（`SceneBuilder.addEntity(me); state.me = me; console.log(...)` 三行）之后插入：

```ts
  // ⑥ 世界广播：其他玩家（服务端 world.move 广播含自己，必须忽略自己）
  ws.onBroadcast((m) => {
    if (m.cmd !== 'world.entity_update') return;
    const d = m.data;
    if (!d || d.entityType !== 'player') return;
    if (String(d.playerId) === String(Session.playerId)) return;

    const pos = d.pos ?? { x: 0, y: 0 };
    const entity = EntityRegistry.upsert(d.entityId, pos, () =>
      EntityFactory.createOtherPlayer(String(d.playerId), pos.x, pos.y),
    );
    SceneBuilder.addEntity(entity);
  });

  // ⑦ 本地移动 → 10Hz 上报
  new PlayerControl(me, ws, { width: cfg.scene.mapWidth, height: cfg.scene.mapHeight }).attach();
```

- [ ] **Step 4: 构建 + 双窗口验证（验收 #7）**

```
node tools/build-fallback.mjs
```

打开**两个浏览器窗口**（推荐普通窗口 + 隐身窗口，避免共用同一 localStorage 里的 token）：
- 窗口 A：`http://localhost:5173/`，用 `spike01` 登录；
- 窗口 B：`http://localhost:5173/`，用**另一个账号**（在登录框把账号改成 `spike02`，密码 `spike123456`，会自动注册）登录。

Expected：
1. A 窗口用 WASD 移动时，B 窗口出现一个蓝色「玩家N」方块并跟着移动（有 100ms 级延迟）；
2. B 窗口移动时，A 窗口同样能看到；
3. A 窗口**不会**出现第二个代表自己的方块（忽略自己广播的规则生效）；
4. 控制台可见 `[S1] WS connected`、以及（可选）`[S1] 服务端 spawns=...`；
5. 松手后停止上报（`world.move` 不再发出）—— 可用 DevTools → Network → WS 帧观察。

- [ ] **Step 5: Commit**

```
git add packages-game/game-client
git commit -m "feat(game-client): 移动上报与多人互见（忽略自身广播）"
```

---

### Task 12: 交互（采集 + NPC 对话，验收 #6）

**Files:**
- Modify: `packages-game/game-server/src/modules/world/world.service.ts`（新增 `talkNpc` + `NpcTalkResult`）
- Modify: `packages-game/game-server/src/modules/world/world.client.controller.ts`（新增路由）
- Test: `packages-game/game-server/src/modules/world/world.service.spec.ts`
- Create: `packages-game/game-client/src/world/InteractController.ts`
- Modify: `packages-game/game-client/src/boot/Main.ts`

- [ ] **Step 1: 后端失败测试**

在 `world.service.spec.ts` 顶部 `@constants/enums` 的导入里补上 `NpcInteractType`：

```ts
import {
  SceneStatus,
  SceneType,
  EntityType,
  ObjectType,
  InteractType,
  TriggerType,
  GameSessionStatus,
  NpcInteractType,
} from '@constants/enums';
```

然后在 `describe('WorldService', ...)` 内追加：

```ts
  describe('talkNpc', () => {
    it('返回 NPC 模板 attr.greeting 作为对话文案', async () => {
      (spawnRepo.findOne as jest.Mock).mockResolvedValue({
        id: '21',
        entityType: EntityType.NPC,
        templateId: '5',
      });
      (npcRepo.findOne as jest.Mock).mockResolvedValue({
        id: '5',
        name: '村长',
        interactType: NpcInteractType.TALK,
        dialogueId: 3,
        attr: { greeting: '远来的客人，先四处看看吧。' },
      });

      const result = await service.talkNpc('2', '21');

      expect(result.spawnId).toBe('21');
      expect(result.npcTemplateId).toBe('5');
      expect(result.name).toBe('村长');
      expect(result.dialogueId).toBe(3);
      expect(result.text).toBe('远来的客人，先四处看看吧。');
    });

    it('对非 NPC 的 spawn 抛 PARAM_INVALID', async () => {
      (spawnRepo.findOne as jest.Mock).mockResolvedValue({
        id: '22',
        entityType: EntityType.OBJECT,
        templateId: '5',
      });

      await expect(service.talkNpc('2', '22')).rejects.toMatchObject({
        response: { code: ErrorCodes.PARAM_INVALID },
      });
    });

    it('spawn 不存在时抛 PARAM_INVALID', async () => {
      (spawnRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.talkNpc('2', '99')).rejects.toMatchObject({
        response: { code: ErrorCodes.PARAM_INVALID },
      });
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

cwd = `e:\code\nest\packages-game\game-server`

```
npm test -- src/modules/world/world.service.spec.ts
```

Expected：FAIL，`service.talkNpc is not a function`。

- [ ] **Step 3: 后端实现 `talkNpc`**

确认 `world.service.ts` 顶部 `@constants/enums` 导入已含 `EntityType` 与 `NpcInteractType`，缺则补上。

在 `world.service.ts` 里 `getNpcTemplate()` 之后插入（若文件顶部已有 `SceneEnterResult` 之类的结果接口，就挨着它加 `NpcTalkResult`）：

```ts
export interface NpcTalkResult {
  spawnId: string;
  npcTemplateId: string;
  name: string;
  talkType: NpcInteractType;
  dialogueId: number | null;
  text: string;
  options: Array<{ text: string; next: string | null }>;
}
```

在 `interactObject()` 之前插入方法：

```ts
  /**
   * NPC 对话（S1 最小实现）：
   * - spawnId 是 scene_entity_spawns.id
   * - 文案先取 npc_templates.attr.greeting；S5 接入 dialogues 表后改为按 dialogueId 返回节点树
   * - playerId 目前仅用于后续「按任务状态过滤/对话 CD」，S1 不产生副作用
   */
  async talkNpc(playerId: string, spawnId: string): Promise<NpcTalkResult> {
    const spawn = await this.spawnRepo.findOne({ where: { id: spawnId } });
    if (!spawn || spawn.entityType !== EntityType.NPC) {
      throw new GameException(ErrorCodes.PARAM_INVALID, 'NPC 不存在');
    }

    const template = await this.npcRepo.findOne({ where: { id: spawn.templateId } });
    if (!template) {
      throw new GameException(ErrorCodes.PARAM_INVALID, 'NPC 模板不存在');
    }
    if (template.interactType !== NpcInteractType.TALK) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '该 NPC 当前无法对话');
    }

    const attr = (template.attr ?? {}) as Record<string, any>;
    const greeting = typeof attr.greeting === 'string' ? attr.greeting : '';

    return {
      spawnId: spawn.id,
      npcTemplateId: template.id,
      name: template.name,
      talkType: template.interactType,
      dialogueId: template.dialogueId ?? null,
      text: greeting || `${template.name}：……`,
      options: Array.isArray(attr.options) ? attr.options : [],
    };
  }
```

> `playerId` 参数在 S1 未使用是有意保留（S5 会用它做对话条件过滤），不需要 `_` 前缀。

- [ ] **Step 4: 加路由**

在 `world.client.controller.ts` 的 `interactObject()` 之后插入：

```ts
  @Post('npcs/:spawnId/talk')
  @ApiOperation({ summary: 'NPC 对话（返回对话文案与可选项）' })
  async talkNpc(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('spawnId') spawnId: string,
  ) {
    return this.worldService.talkNpc(player.playerId, spawnId);
  }
```

- [ ] **Step 5: 跑测试确认通过**

```
npm test -- src/modules/world/world.service.spec.ts
```

Expected：PASS，含 3 个新增 `talkNpc` 用例。

- [ ] **Step 6: 手动验证新接口（未登录应 401，登录应 200 + code 0）**

```
(Invoke-WebRequest -Uri http://localhost:3000/api/client/v1/world/npcs/1/talk -Method Post -UseBasicParsing).StatusCode
```

Expected：`401`（未带 token 时被 `JwtAuthGuard` 拦下）。

带 token 验证（token 取 Task 1 Step 6 或浏览器 localStorage 中的最新值）：

```
Invoke-RestMethod -Uri http://localhost:3000/api/client/v1/world/npcs/1/talk -Method Post -Headers @{Authorization="Bearer <TOKEN>"}
```

Expected：`code=0`，`data.text` 为中文问候语。
> spawnId 请用真实存在的 `scene_entity_spawns.id`（可从 `http://localhost:5173/config/scene-1-v1.json` 的 `fixedNpcs[].spawnId` 取）。
> 若返回 `code!=0` 且 msg 为「NPC 不存在」，说明 id 用错了 —— 用配置包里的 `spawnId`，不是 `npcTemplateId`。

- [ ] **Step 7: 客户端交互控制器**

新建 `src/world/InteractController.ts`：

```ts
import { AppConfig } from '../config/AppConfig';
import type { Entity } from '../entity/Entity';
import { EntityRegistry } from '../entity/EntityRegistry';
import { Api } from '../net/api';
import { ApiError } from '../net/http';
import { Session } from '../net/Session';
import { Toast } from '../ui/Toast';

/** 70 = 键盘 F 键（不依赖 Laya.Keyboard 的字母常量，避免版本差异） */
const KEY_F = 70;

export class InteractController {
  private busy = false;
  private lastHintId: string | null = null;

  constructor(private readonly me: Entity) {}

  attach(): void {
    Laya.stage.on(Laya.Event.KEY_DOWN, this, this.onKeyDown);
    Laya.timer.frameLoop(6, this, this.updateHint);
    console.log(
      `[S1] 交互控制就绪：靠近 ${AppConfig.interactRadius}px 内按 F（NPC → npcs/:spawnId/talk；物件 → objects/:id/interact）`,
    );
  }

  nearest(): Entity | null {
    let best: Entity | null = null;
    let bestDist = AppConfig.interactRadius;
    for (const e of EntityRegistry.all()) {
      if (e.kind === 'player') continue;
      const d = this.me.distanceTo(e);
      if (d <= bestDist) {
        best = e;
        bestDist = d;
      }
    }
    return best;
  }

  private updateHint(): void {
    const target = this.nearest();
    const id = target ? target.entityId : null;
    if (id !== this.lastHintId) {
      this.lastHintId = id;
      if (target) Toast.info(`按 F 交互：${target.entityId}`);
    }
  }

  private async onKeyDown(e: Laya.Event): Promise<void> {
    if (e.keyCode !== KEY_F || this.busy) return;

    const target = this.nearest();
    if (!target) {
      Toast.info('附近没有可交互目标');
      return;
    }

    this.busy = true;
    try {
      if (target.kind === 'npc') {
        const res = await Api.talkNpc(target.spawnId!, Session.token);
        Toast.info(`${res.name}：${res.text}`);
        console.log(`[S1] 对话返回 ${JSON.stringify(res)}`);
      } else {
        const res = await Api.interactObject(
          target.templateId!,
          target.interactType ?? 'collect',
          Session.token,
        );
        const amount = res?.reward?.amount;
        Toast.info(
          amount
            ? `采集成功，获得 ${amount} ${res.reward?.currencyType ?? ''}`
            : '交互成功',
        );
        console.log(`[S1] 采集返回 ${JSON.stringify(res)}`);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message}（code=${err.code}）` : String(err);
      Toast.error(msg);
    } finally {
      this.busy = false;
    }
  }
}
```

- [ ] **Step 8: Main 接入交互**

`src/boot/Main.ts` 两处修改（其余保持 Task 11 的版本不变）：

1) 新增导入：

```ts
import { InteractController } from '../world/InteractController';
```

2) 在 `new PlayerControl(...).attach();` 之后插入：

```ts
  // ⑧ 就近交互（F 键）
  new InteractController(me).attach();
```

- [ ] **Step 9: 构建并验证（验收 #6）**

```
node tools/build-fallback.mjs
```

浏览器刷新（保留登录态）→ 用 WASD 走到 `(560,480)` 附近的物件或 `(600,380)` 的 NPC 旁（提示条会显示 `按 F 交互：object:N` / `npc:M`）→ 按 F。

Expected：
1. 靠近物件按 F → 提示 `采集成功，获得 3 gold`（草药丛）或 8/20 gold（矿脉/木箱）；控制台输出 `[S1] 采集返回 {"ok":true,"reward":{...}}`；
2. 靠近 NPC 按 F → 提示 `村长：远来的客人，先四处看看吧。`；控制台输出 `[S1] 对话返回 {...}`；
3. 没有目标时按 F → `附近没有可交互目标`。

- [ ] **Step 10: 后端全量回归 + Commit**

```
npm test
```

Expected：全绿。

```
git add packages-game/game-client packages-game/game-server/src/modules/world
git commit -m "feat(world): 新增 NPC 对话接口并接入客户端 F 键交互"
```

---

### Task 13: 微信小游戏端最小验收（验收 #8，含偏差）

**Files:**
- Modify: `packages-game/game-client/src/platform/Platform.ts`（新增 `readLocalText`）
- Modify: `packages-game/game-client/src/config/loader.ts`（小游戏端改读包内文件）
- Modify: `packages-game/game-client/README.md`（记录导出目录与结果）

> ⚠️ **本任务的验收口径与总纲 §13#8 有偏差，见 §4 待确认项**：S1 的微信端**不跑通多人/WS**（WS 适配已明确推迟到 S7），只验收「导出 wxgame 产物 + 开发者工具打开 + 配置包加载渲染静态场景 + HTTP 登录」。

- [ ] **Step 1: 小游戏端文件读取适配**

`src/platform/Platform.ts` 的 `isMiniGame()` 之后插入：

```ts
  /**
   * 读取小游戏包内文本文件（相对于小游戏根目录）。
   * 小游戏环境没有 fetch 与 DOM，配置包随包分发后用本方法读取。
   */
  readLocalText(relPath: string): string | null {
    const wx = (globalThis as any).wx;
    if (!wx || typeof wx.getFileSystemManager !== 'function') return null;
    try {
      return wx.getFileSystemManager().readFileSync(relPath, 'utf8') as string;
    } catch (e) {
      console.warn(`[S1] 读取包内文件失败 ${relPath}`, e);
      return null;
    }
  },
```

- [ ] **Step 2: loader 小游戏分支**

`src/config/loader.ts` 两处修改：

1) 顶部导入增加：

```ts
import { Platform } from '../platform/Platform';
```

2) 新增私有方法并在 `loadManifest` / `loadScene` 里改用它取文本：

```ts
  /** 小游戏端读包内文件（config/xxx.json），H5 端走 HTTP */
  private static async readText(file: string): Promise<string> {
    if (Platform.isMiniGame()) {
      const text = Platform.readLocalText(`config/${file}`);
      if (text === null) throw new Error(`小游戏包内缺少 config/${file}（请把 assets/config 复制进导出目录）`);
      return text;
    }
    const res = await fetch(`${AppConfig.configBase}/${file}`);
    if (!res.ok) throw new Error(`配置加载失败 HTTP ${res.status}（${file}）`);
    return res.text();
  }
```

`loadManifest()` 的 fetch 段替换为：

```ts
    const manifest = JSON.parse(await ConfigLoader.readText('manifest.json')) as SceneManifest;
```

`loadScene()` 的 fetch 段替换为：

```ts
    const text = await ConfigLoader.readText(item.file);
```

- [ ] **Step 3: H5 回归（确认这次改动没破坏 H5）**

```
node tools/build-fallback.mjs
```

浏览器刷新 `http://localhost:5173/`。

Expected：控制台仍输出 `[S1] 配置包哈希校验通过 …` 与 `[S1] 进场景应答 …`（行为与 Task 12 一致）。

- [ ] **Step 4: 导出 wxgame 产物**

1. 打开 LayaAir IDE → 打开工程 `e:\code\nest\packages-game\game-client`；
2. 「构建/发布」选择「微信小游戏」并执行；
3. 记录实际输出目录（IDE 面板会显示，常见为 `e:\code\nest\packages-game\game-client\release\wxgame`）；
4. 把配置包复制进产物目录：

```
Copy-Item -Recurse -Force assets\config (Join-Path (Resolve-Path .\release\wxgame).Path 'config')
```

Expected：`release\wxgame\config\manifest.json` 与 `release\wxgame\config\scene-1-v1.json` 存在。
> 若产物目录不是 `release\wxgame`，把上面命令的目标改成实测目录，并把实测路径写进 README。

- [ ] **Step 5: 微信开发者工具打开**

1. 微信开发者工具 → 导入项目 → 目录选上一步的产物根目录 → AppID 选「测试号」；
2. 详情 → 本地设置 → 勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」。

Expected：
1. 编译无致命错误（`Laya.init` 成功）；
2. 屏幕上出现绿色地形 + 100px 网格 + 10 个物件方块 + 3 个 NPC 方块；
3. 出现提示「微信端 S1：静态场景已渲染（WS 待 S7）」。

- [ ] **Step 6: HTTP 登录验证（小游戏端）**

在小游戏端登录需要把 `AppConfig.apiBase` 指向本机后端且不校验域名。为免改代码，本步**用开发者工具的 Console 直接验证网络能力**：

在开发者工具 Console 执行：

```js
wx.request({ url: 'http://localhost:3000/health', success: (r) => console.log('health', r.statusCode, r.data), fail: (e) => console.log('fail', e) })
```

Expected：打印 `health 200 {...}`。
> 若失败：确认后端在运行、开发者工具已勾选「不校验合法域名」。

并把结果（成功/失败 + 原始输出）写进 README 的「S1 工具链实证」小节。

- [ ] **Step 7: 判断结论**

- 若 Step 4/5 都成功 → 验收 #8 按**降级口径** PASS（静态场景 + 开发者工具 + HTTP 可达），并在 README 写明「WS/多人未在小游戏端验收，属 S7」。
- 若 IDE 导出 wxgame 失败 → 验收 #8 记 **BLOCKED**，把原始报错写进 README，**不阻塞 #1-#7**，并在交付说明里告知用户。

- [ ] **Step 8: Commit**

```
git add packages-game/game-client
git commit -m "feat(game-client): 微信小游戏端最小适配（包内配置读取）与验收记录"
```

---

### Task 14: 冒烟脚本 + 全量回归 + 验收判定（验收 #9）

**Files:**
- Create: `packages-game/game-server/scripts/smoke-laya2d-s1.mjs`
- Create: `packages-game/game-client/README.md`（若 Task 5 已创建则追加 S1 验收结论小节）

- [ ] **Step 1: 写冒烟脚本**

新建 `packages-game/game-server/scripts/smoke-laya2d-s1.mjs`：

```js
// S1 冒烟：HTTP 登录 → 进场景 → 双端移动互见 → 物件采集 → NPC 对话
// 用法：node scripts/smoke-laya2d-s1.mjs     （需先启动 mock-redis 与 game-server）
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const here = dirname(fileURLToPath(import.meta.url));
const API = process.env.SMOKE_API || 'http://localhost:3000';
const CONFIG_DIR = join(here, '..', '..', 'game-client', 'assets', 'config');
const USER_A = { username: 'spike01', password: 'spike123456', nickname: 'spike01', deviceId: 'smoke-s1-a' };
const USER_B = { username: 'spike02', password: 'spike123456', nickname: 'spike02', deviceId: 'smoke-s1-b' };

let failed = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` :: ${extra}` : ''}`);
  if (!cond) failed++;
}

async function call(method, path, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { code: -1, msg: `非 JSON 响应: ${text.slice(0, 80)}` };
  }
  return { status: res.status, payload };
}

// deviceId 必须传（DTO 无 @IsOptional）；login 不能带 nickname（forbidNonWhitelisted）
async function auth(user) {
  const cred = { username: user.username, password: user.password, deviceId: user.deviceId };
  const login = await call('POST', '/api/client/v1/auth/login', { body: cred });
  if (login.payload?.code === 0) return login.payload.data;
  const reg = await call('POST', '/api/client/v1/auth/register', { body: user });
  if (reg.payload?.code !== 0) throw new Error(`登录/注册失败：${JSON.stringify(reg.payload)}`);
  return reg.payload.data;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(`${API}/game`, { transports: ['websocket'], query: { token } });
    const timer = setTimeout(() => reject(new Error('WS 连接超时')), 8000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (e) => {
      clearTimeout(timer);
      reject(new Error(`WS 连接失败：${e?.message ?? e}`));
    });
  });
}

function send(socket, cmd, data) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WS 请求超时：${cmd}`)), 8000);
    const seq = Math.floor(Math.random() * 1e9);
    const handler = (m) => {
      if (m?.seq !== seq) return;
      clearTimeout(timer);
      socket.off('message', handler);
      resolve(m);
    };
    socket.on('message', handler);
    socket.emit('message', { cmd, seq, data });
  });
}

async function main() {
  // 0. 依赖
  const health = await call('GET', '/health').catch(() => null);
  check('后端 /health 可达', Boolean(health));
  if (!health) throw new Error('后端未启动，请先运行 mock-redis 与 npm run start:dev');

  // 1. 配置包
  const manifest = JSON.parse(readFileSync(join(CONFIG_DIR, 'manifest.json'), 'utf8'));
  const item = manifest.scenes[0];
  const cfg = JSON.parse(readFileSync(join(CONFIG_DIR, item.file), 'utf8'));
  check('配置包含静态物件与 NPC', cfg.staticEntities.length > 0 && cfg.fixedNpcs.length > 0,
    `物件=${cfg.staticEntities.length} NPC=${cfg.fixedNpcs.length} 触发器=${cfg.triggers.length}`);

  // 2. 登录
  const a = await auth(USER_A);
  const b = await auth(USER_B);
  check('HTTP 登录拿到 token/playerId', Boolean(a.token && a.playerId && b.token && b.playerId),
    `A=${a.playerId} B=${b.playerId}`);

  // 3. 进场景
  const sa = await connect(a.token);
  const sb = await connect(b.token);
  const enterA = await send(sa, 'world.enter-scene', { sceneId: cfg.sceneId });
  check('world.enter-scene 应答 world.enter_scene_sync',
    enterA?.cmd === 'world.enter_scene_sync' && enterA?.code === 0, `cmd=${enterA?.cmd} code=${enterA?.code}`);
  const sync = enterA?.data ?? {};
  check('进场景返回 scene/spawns/triggers',
    Boolean(sync.scene) && Array.isArray(sync.spawns) && Array.isArray(sync.triggers),
    `spawns=${sync.spawns?.length} triggers=${sync.triggers?.length}`);
  check('触发器按场景过滤未串场（总数等于配置包 triggers）',
    (sync.triggers?.length ?? -1) === cfg.triggers.length,
    `服务端=${sync.triggers?.length} 配置包=${cfg.triggers.length}`);

  // 4. 双端移动互见
  const broadcastSeen = new Promise((resolve) => {
    const handler = (m) => {
      if (m?.cmd === 'world.entity_update' && String(m.data?.playerId) === String(a.playerId)) {
        sb.off('message', handler);
        resolve(m);
      }
    };
    sb.on('message', handler);
  });
  await send(sb, 'world.enter-scene', { sceneId: cfg.sceneId });
  sa.emit('message', { cmd: 'world.move', seq: 999001, data: { x: 700, y: 500, rotation: 0, state: 'move' } });
  const seen = await Promise.race([
    broadcastSeen,
    new Promise((r) => setTimeout(() => r(null), 6000)),
  ]);
  check('B 端收到 A 的 world.entity_update 广播', Boolean(seen),
    seen ? `entityId=${seen.data.entityId} pos=${JSON.stringify(seen.data.pos)}` : '6s 内未收到');

  // 5. 物件采集
  const target = cfg.staticEntities[0];
  const interact = await call('POST', `/api/client/v1/world/objects/${target.templateId}/interact`,
    { token: a.token, body: { interactType: target.interact.type } });
  check('物件采集接口返回 code=0', interact.payload?.code === 0,
    `templateId=${target.templateId} type=${target.interact.type} → ${JSON.stringify(interact.payload).slice(0, 120)}`);

  // 6. NPC 对话
  const npc = cfg.fixedNpcs[0];
  const talk = await call('POST', `/api/client/v1/world/npcs/${npc.spawnId}/talk`, { token: a.token });
  check('NPC 对话接口返回非空文案', talk.payload?.code === 0 && Boolean(talk.payload?.data?.text),
    `spawnId=${npc.spawnId} → text=${talk.payload?.data?.text}`);

  sa.close();
  sb.close();

  console.log(failed === 0 ? '\\nS1 冒烟全部通过' : `\\nS1 冒烟失败 ${failed} 项`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`冒烟脚本异常：${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 2: 跑冒烟**

cwd = `e:\code\nest\packages-game\game-server`（mock-redis 与后端都需在运行）

```
node scripts/smoke-laya2d-s1.mjs
```

Expected：
```
PASS 后端 /health 可达
PASS 配置包含静态物件与 NPC :: 物件=10 NPC=3 触发器=2
PASS HTTP 登录拿到 token/playerId :: A=6 B=7
PASS world.enter-scene 应答 world.enter_scene_sync :: cmd=world.enter_scene_sync code=0
PASS 进场景返回 scene/spawns/triggers :: spawns=13 triggers=2
PASS 触发器按场景过滤未串场（总数等于配置包 triggers） :: 服务端=2 配置包=2
PASS B 端收到 A 的 world.entity_update 广播 :: entityId=player:6 pos={"x":700,"y":500}
PASS 物件采集接口返回 code=0 :: templateId=1 type=collect → {"code":0,...}
PASS NPC 对话接口返回非空文案 :: spawnId=1 → text=村长：…
S1 冒烟全部通过
```
> 注意：脚本里的固定 `seq=999001` 只用于 `world.move`（服务端广播的 `seq` 固定为 0），不影响其他请求。

> **实测偏离（2026-09-21，已修复后 9/9 通过）**：原稿的 `send()` 用 `socket.emit('message', {cmd,seq,data})` 等 `message` 事件——真实契约是服务端 `@SubscribeMessage(cmd)` 订阅，**事件名即 cmd**，且 handler 直接 `return` 的应答走 **socket.io ack 回调**（`emit(cmd, payload, ack)`，与 `game-client/src/net/ws.ts` 一致）；否则 `world.enter-scene` 必然 8s 超时。`world.move` 同样要按事件名 `world.move` 发（广播仍走 `message` 事件，`on('message')` 端不变）。修复后实测：`A=1 B=3`、`spawns=13 triggers=2`、`entityId=player:1`、采集 `amount:3`、对话 `spawnId=11 → 村长：…`。

- [ ] **Step 3: 后端全量回归（验收 #9）**

```
npm test
```

Expected：全部通过；在输出里确认 `Tests: N passed` 且 `Test Suites:` 无 failed。

- [ ] **Step 4: 确认旧接口契约零改动**

```
git diff bbe550903 -- packages-game/game-server/src/modules/world/world.client.controller.ts packages-game/game-server/src/modules/gateway
```

Expected：`world.client.controller.ts` 只有**新增** `npcs/:spawnId/talk` 的 diff（无删除/修改既有路由）；`gateway/` 无任何 diff。

- [ ] **Step 5: 逐条判定 9 项验收并写入 README**

在 `packages-game/game-client/README.md` 追加「S1 验收结论」小节，按下表填 PASS/FAIL/BLOCKED 与实测证据（命令输出或控制台截图描述）：

| # | 验收项 | 判定 | 证据 |
|---|---|---|---|
| 1 | 命令行产出 H5 产物并在浏览器打开 | | Task 6 Step 9 的控制台输出 |
| 2 | 登录拿到 token | | Task 7 Step 8 |
| 3 | 配置包加载并渲染地形 + 静态物件 | | Task 9 Step 9 |
| 4 | 进场景拿到 `{scene, spawns, triggers}` 并生成实体 | | Task 10 Step 3 |
| 5 | NPC 位置与配置一致 | | Task 10 Step 3 |
| 6 | 1 次采集 + 1 次 NPC 对话 | | Task 12 Step 9 |
| 7 | 双窗口互见移动 | | Task 11 Step 4 |
| 8 | 小游戏端（**降级口径**） | | Task 13 Step 7 |
| 9 | 后端回归全绿、旧契约零改动 | | Task 14 Step 3 + Step 4 |

- [ ] **Step 6: 收尾提交**

```
git add packages-game/game-server/scripts/smoke-laya2d-s1.mjs packages-game/game-client/README.md
git commit -m "test(game-client): S1 冒烟脚本与验收结论记录"
```

---

## 3. 风险与回退

| # | 风险 | 触发信号 | 回退动作 |
|---|---|---|---|
| 1 | LayaAir IDE 命令行构建不通 | Task 5 Step 4 输出 `unknown script` | 直接走 Task 6 兜底构建（已保证 #1-#7 全可验收），IDE 仅用于 Task 13 的 wxgame 导出 |
| 2 | `laya.core.js` 与 `.d.ts` 版本与运行时不一致（如 `Laya.init` 重载差异） | tsc 报错或运行时报 `Laya.init is not a function` | 以 IDE 实测运行结果为准改源码；`.d.ts` 只用于类型提示，必要时在该处 `as any` 收口 |
| 3 | 浏览器 ESM 解析失败 | 控制台 `Failed to load module script` / 404 | 检查 `tools/build-fallback.mjs` 的扩展名重写是否覆盖到该文件，确认 `bin/js` 下产物路径与 import 路径一致 |
| 4 | `Laya.Stage` / `Laya.Text` 等类名与运行时不符 | `Cannot read property of undefined` | 用浏览器控制台直接 `Laya.` 补全确认实际 API 名，改源码（不引入新依赖） |
| 5 | 端口 5173 / 3000 被占用 | 启动即报 `EADDRINUSE` | 客户端设 `S1_PORT` 环境变量换端口（记得同步 `.env` 的 `CORS_ORIGINS`） |
| 6 | wxgame 导出失败 | IDE 报错 | 验收 #8 记 BLOCKED，不阻塞其余 8 项 |

---

## 4. 待用户确认项（✅ 2026-09-21 已全部确认）

> **确认结果（生效，执行时以此为准）**：① #8 降级口径 → **接受**；② Task 5 → **保留**（会在 IDE GUI 弹窗需用户点几下）；③ `scene.entry` → **沿用配置包字段**（默认 `(640,480)`）；④ 执行方式 → **Subagent-Driven**。

1. **验收 #8 的口径偏差（必须确认）**
   总纲 §13#8 写的是「开发者工具中可跑通同一场景」，但用户名下的决策是「微信端 WS 适配推迟到 S7」，且 S1 登录 UI 是 H5 DOM（小游戏无 DOM）。两者矛盾，本计划的处理是**把 #8 降级**为：
   - 用 IDE 导出 wxgame 产物；
   - 微信开发者工具能打开并渲染**静态场景**（配置包 + 地形 + 物件 + NPC）；
   - HTTP 可达性验证（`wx.request` 打通 `localhost:3000`）；
   - **不验收**：小游戏端多人/WS/登录表单/完整闭环（移交 S7）。
   请确认是否接受该降级口径；若不接受，需要把 S7 的一部分（WS 适配）提前到 S1，计划需相应扩写。

2. **Task 5 的人工介入点**
   IDE 的 CLI 脚本白名单需要在 GUI 里一次性设置（并需要打开工程手动构建一次）。执行时我会在你本机弹出 IDE 窗口，需要你点几下；如果你希望完全无人值守，我可以**直接跳过 Task 5**（只走 Task 6 兜底 + Task 13 用 IDE GUI 导出 wxgame），请选择。

3. **`scene.entry`（出生点）作为配置包字段**
   总纲 §5.1 的配置包结构里没有出生点字段，本计划新增了 `scene.entry`（默认 `(640,480)`）。S2 的正式 schema 会把它固化。若你希望改用「服务端下发进入坐标」，请在开工前说，计划要改 Task 4/Task 10。

---

## 5. 执行方式（✅ 已选：1. Subagent-Driven）

> 已确认采用 **Subagent-Driven**：每个 Task 派全新 subagent 执行，Task 之间做两阶段评审（先看 diff 是否符合计划，再看验收输出是否达标）。

**1. Subagent-Driven（推荐）** — 每个 Task 派一个全新的 subagent 执行，我在 Task 之间做两阶段评审（先看 diff 是否符合计划，再看验收输出是否达标），适合本计划这种「14 个任务、每步都有明确命令与期望输出」的场景；出错时只需回滚单个任务。

**2. Inline Execution** — 在当前会话里按 executing-plans 逐 Task 批量执行，在关键检查点（Task 6、Task 10、Task 13）暂停让你确认。

请回复 **1** 或 **2**（并一并回答 §4 的三个确认项）。在你确认之前我不动任何代码。