# LayaAir 2D 配置契约与导出管线 S2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「DB 配置表 → 导出配置包 → 服务端静态托管 → 客户端按 hash 拉取渲染」做成**可重复执行的管线**，并让**发布 / 回滚**只需改 manifest 指向（真热更），无需重建、无需重启服务。

**Architecture:** 配置包由 game-server 侧导出（纯函数 builder + service + admin 接口），产物落到与 `/admin` 同级的静态目录 `gamedata/`（生产 `/opt/game-server/gamedata`），由 Nest `useStaticAssets` 以 `/gamedata` 前缀托管；版本真源是新增表 `scene_config_versions`；发布/回滚 = 改版本状态 + 重生成 `manifest.json`。客户端只按 `manifest.json` 拉取并校验 hash。

**Tech Stack:** NestJS 11 + TypeORM + PostgreSQL（后端，**零新增依赖**）、ts-node（CLI，复用现有 `seed:*` 套路）、LayaAir 3.4 客户端（**零新增依赖**）、OpenResty/Nest 静态托管。

---

## 0. 执行前必读（硬约束）

1. **不准碰 vendure**：任何命令不得进入 vendure / vcash 相关目录。
2. **不新增依赖**：后端与客户端均不新增 npm 包（校验用手写 + 复用现有 `node:crypto`）。
3. **2G 服务器禁止构建**：`odoo`（39.106.99.9，game.joho.cn）只做「上传产物 + 重启」，构建一律本地完成。
4. **规划阶段可提问，执行阶段不要反复问**：执行中若与 §1.2 已核实事实冲突，按事实修正并在 commit message 写明。
5. **S2 范围只做管线**：GM「场景与实体配置」面板=S2b（另批）；建造、NPC 巡逻/出现规则=S4/S6（不进本批 schema）。
6. 全部提交遵守 commitlint，单次提交聚焦一个任务。

**S2 完成定义（总纲 §16）**：配置包 DB → 导出 → 客户端渲染链路**可重复执行**，**发布/回滚可操作**。

---

## 1. 设计

### 1.1 缺口盘点（本批要动的东西）

| # | 缺口 | 现状 | S2 处置 |
|---|---|---|---|
| 1 | 配置契约未固化 | 契约只存在于客户端 `src/config/schema.ts` 与 seed 代码里 | 新增 `packages-game/config-schema/scene-config.schema.json`（单一来源，只含 S1 已验证字段） |
| 2 | 无版本真源 | 版本号硬编码 `version: 1`，无表 | 新增表 `scene_config_versions` + 枚举 `SceneConfigStatus` |
| 3 | 「发布」= seed 顺手写文件 + 手工复制 | `seeds/scene-spike.seed.ts` 既播种又生成配置包，落到 `game-client/assets/config`，无版本/无回滚/无托管 | 拆成**数据播种**与**导出发布**两件事；seed 只播种 |
| 4 | 无服务端托管 | 客户端 `configBase='/config'` 只在本机 `tools/serve.mjs` 存在 | game-server 新增 `/gamedata` 静态托管（与 `/admin` 同级）+ 程序化导出 |
| 5 | 无发布/回滚入口 | 无 | admin 接口 5 个（列表 / 导出 / 发布 / 回滚 / 版本历史）+ CLI 脚本 |
| 6 | 客户端无版本缓存 | 每次全量拉取；无缓存语义 | 按 `scene-<id>-v<n>` 缓存，命中且 hash 一致即跳过拉取 |

### 1.2 已核实的事实（实现时不要再猜）

**静态托管（关键）**
- 现有写法：`app.useStaticAssets(join(__dirname,'..','..','admin'), { prefix:'/admin' })`（[main.ts:115](file:///e:/code/nest/packages-game/game-server/src/main.ts#L115)），`__dirname = dist/src` → 生产路径 **`/opt/game-server/admin`，不在 dist 内**；改静态文件**不需要重启、不需要重建 dist**，但目录要单独同步（[P0-8 计划](file:///e:/code/nest/docs/superpowers/plans/2026-09-21-gm-admin-panels-p0-8.md) 已核实）。
- 生产 `https://game.joho.cn/admin` 浏览器实测可用（P0-8 验收 12/12 PASS）→ **OpenResty 把 `/` 转发到 node**，因此新增 `/gamedata` 前缀同样可达。
- ⚠️ `useStaticAssets` 注册在 `helmet`/`enableCors` **之前**（main.ts:115 → 121 → 140）→ 静态响应**不带 CORS 头**。生产同源（客户端页面与 `/gamedata` 同域）无影响；本地开发走 `tools/serve.mjs` 同源代理（见 Task 6），**不改 main.ts 中间件顺序**。

**配置侧数据（S1 已核实，沿用）**
- 5 张表实体：`scenes`（[scene.entity.ts](file:///e:/code/nest/packages-game/game-server/src/modules/world/entities/scene.entity.ts)）、`scene_entity_spawns`（`entityType/templateId/spawnX/spawnY/spawnRotation/spawnCount/spawnRadius/isActive`）、`object_templates`（`type:ObjectType/interactCd/reward/animOpen/isOneTime`）、`npc_templates`（`interactType:NpcInteractType/dialogueId/moveRange/isAutoWander/attr`）、`scene_triggers`（`triggerType/areaX/Y/W/H/targetSceneId/storyId/condition/onceOnly`）。
- 主键与 `sceneId`/`templateId`/`targetSceneId` 全是 `bigint` → **TS 里是 string**，导出时必须 `Number()`。
- 枚举真值（[enums.ts:187-234](file:///e:/code/nest/packages-game/game-server/src/constants/enums.ts#L187-L234)）：`SceneType(town/dungeon/arena/wild)`、`SceneStatus(open/maintenance)`、`NpcInteractType(talk/shop/quest/transport)`、`ObjectType(chest/collect/stone/plant/landmark)`、`TriggerType(transport/story/battle/activity/puzzle/gate/trap)`、`EntityType(npc/monster/object)`。
  - ⚠️ 总纲 §5.1 示例里的 `"type":"portal"` 是笔误，实际值 `transport`。
- **hash 双层语义（必须保留）**：包内 `hash` = `sha256(canonicalJson(payload))`（键排序后哈希，不含 hash 自身）；`manifest.hash` = **文件原始文本**的 sha256。算法在 [scene-spike.seed.ts:55-64](file:///e:/code/nest/packages-game/game-server/seeds/scene-spike.seed.ts#L55-L64) 与 [loader.ts:46-62](file:///e:/code/nest/packages-game/game-client/src/config/loader.ts#L46-L62) 两端实现，S2 必须逐字保留（否则客户端校验全红）。
- `INTERACT_BY_OBJECT_TYPE` 映射（[seed:23-29](file:///e:/code/nest/packages-game/game-server/seeds/scene-spike.seed.ts#L23-L29)）：`collect/stone/plant/chest → collect`、`landmark → read`。
- `seeds/*.seed.ts` 必须 `synchronize:false`（实体子集同步会 drop 其他表）→ 依赖 `.env` 的 `DB_SYNCHRONIZE=true` 先建表。

**后端可复用件**
- `AdminGuard`（[admin.guard.ts:31-74](file:///e:/code/nest/packages-game/game-server/src/common/guards/admin.guard.ts#L31-L74)）+ `@CurrentAdmin()` 取 `adminId`；`AdminService.logOperation({adminId, operation, changeBefore, changeAfter})`。
- 版本表 + 回滚的现成范式（**语义不同，仅供参考、不直接复用**）：`remote_configs` + `config_versions` + [config.service.ts](file:///e:/code/nest/packages-game/game-server/src/modules/config/config.service.ts) 的 `rollbackConfig`。
- admin 侧已存在 WorldController（[world.controller.ts](file:///e:/code/nest/packages-game/game-server/src/modules/world/world.controller.ts)，前缀 `api/admin/v1/world`，全量 `AdminGuard`）→ S2 新接口挂同一控制器。
- admin 登录：`POST /api/admin/v1/login`，body `{username,password}` → `data.token`（本地密码见 `seeds/admin.seed.ts`；生产取自 `/opt/game-server/.env.prod` 的 `ADMIN_DEFAULT_PASSWORD`）。
- 错误信封：`GameException` 一律 **HTTP 200 + body `{code,msg,data}`**；客户端/冒烟必须判 `body.code`。
- 现有 npm scripts：`seed:scene-spike`、`typeorm:run`、`build`、`start:dev`、`test`（[package.json:9-24](file:///e:/code/nest/packages-game/game-server/package.json)）。
- jest `rootDir=src`、`testRegex=.*\.spec\.ts$` → 单测必须放 `src/**`。

**本机环境**：后端 `:3000`（`npm run start:dev`）、mock-redis `:6379`、H5 静态服务 `:5173`（`node tools/serve.mjs`）、PostgreSQL 16 本地库 `game_server`。

### 1.3 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **发布入口 = 后端 admin 接口**（不是本地脚本 + 手工 scp） | 后端与静态目录同机，「导出即写文件」天然生效；S2b 面板可零后端改动接同一套接口；回滚只是改状态 + 重写 manifest |
| D2 | **静态托管落点 = game-server `gamedata/`，前缀 `/gamedata`**（生产 `/opt/game-server/gamedata`） | 与 `/admin` 完全同级、同一机制；总纲 §3「走现有静态托管（与 /admin 同级）」。**不塞进 dist**，发布配置无需重建/重启 |
| D3 | **版本状态机 `draft → published → archived`** | 导出只产出 `draft`（不对外）；`publish` 置 `published` 并把同场景旧版本置 `archived`；`rollback` = 目标置 `published`、当前置 `archived`。文件**只增不删**，manifest 永远只列每个场景的 `published` 版本 |
| D4 | **两端 hash 算法逐字冻结** | 客户端已在跑，改算法=配置包全部校验失败 |
| D5 | **客户端配置来源改为服务端 URL**，删除 `game-client/assets/config/` 手工副本 | S1 的「seed 写进客户端 assets」是临时手段；S2 只有一份产物（`gamedata/`），小游戏包内文件由脚本复制 |
| D6 | **schema 只覆盖 scene 一支** | 总纲 §4 列了 3 个 schema 文件，但 `npc-behavior` / `building` 属 S4/S6，本批不写空壳 |

### 1.4 文件结构（S2 全部新增/修改）

**新增（后端）**

| 路径（相对 `packages-game/game-server/`） | 职责 |
|---|---|
| `src/modules/world/config/entities/scene-config-version.entity.ts` | `scene_config_versions` 表 |
| `src/modules/world/config/scene-package.builder.ts` | **纯函数**：由 5 张表的行聚合出配置包 payload（含 canonicalJson/sha256），不依赖 Nest DI |
| `src/modules/world/config/scene-config.service.ts` | 导出/发布/回滚/版本列表 + 文件落盘 + manifest 重建 + 操作日志 |
| `src/modules/world/config/scene-config.service.spec.ts` | 单测（版本自增、hash 稳定、manifest 只含 published、回滚语义） |
| `src/modules/world/dto/scene-config.dto.ts` | 发布/回滚 DTO |
| `scripts/scene-config-cli.mjs` | CLI：`export` / `publish` / `rollback` / `list`（调 admin 接口） |

**新增（契约）**

| 路径 | 职责 |
|---|---|
| `packages-game/config-schema/scene-config.schema.json` | 配置包契约单一来源（S1 已验证字段） |
| `packages-game/game-server/gamedata/.gitkeep` | 静态托管目录（产物本身不入库，只入库 `.gitkeep`） |

**修改（后端）**

| 路径 | 动作 |
|---|---|
| `src/modules/world/world.controller.ts` | +5 个 admin 接口 |
| `src/modules/world/world.service.ts` | +导出相关委托（或直接由新 service 承接，二选一，实现时定） |
| `src/modules/world/world.module.ts` | 注册新实体与 service |
| `src/constants/enums.ts` | +`SceneConfigStatus` |
| `src/main.ts` | +`useStaticAssets(gamedata, {prefix:'/gamedata'})` |
| `seeds/scene-spike.seed.ts` | **删掉配置包生成段**（只留播种） |
| `package.json` | +`config:*` scripts |

**修改（客户端 `packages-game/game-client/`）**

| 路径 | 动作 |
|---|---|
| `src/config/AppConfig.ts` | `configBase` → `${apiBase}/gamedata` |
| `src/config/loader.ts` | +按 `scene-<id>-v<n>` 的本地缓存（命中且 hash 一致即跳过拉取）；小游戏端保持读包内 `config/` |
| `src/config/validate.ts` | 与 schema 逐字段对齐（含 `scene.entry`） |
| `tools/serve.mjs` | `/gamedata/*` 代理到 `:3000`（同源，规避静态响应无 CORS 头） |
| `tools/check-config.mjs` | 改为校验 `game-server/gamedata/`（原指向 `assets/config`） |
| `assets/config/` | **删除**（S1 手工副本） |

### 1.5 验收映射（S2 完成定义 → 任务）

| # | S2 验收项 | 落点 | 判定方式 |
|---|---|---|---|
| A1 | 导出可重复执行、同输入同产物 | Task 3/5 | 连续导出两次，`hash` 与文件文本完全一致 |
| A2 | 版本表为真源 | Task 2/3 | `psql` 查 `scene_config_versions`：version 自增、status 与 manifest 一致 |
| A3 | 发布：manifest 指向新版本并被客户端渲染 | Task 4/6/7 | `/gamedata/manifest.json` 的 version/hash 与客户端控制台打印一致，场景渲染出图 |
| A4 | 回滚：manifest 指回旧版本并被客户端渲染 | Task 3/4/7 | 回滚到 v1 后客户端拉到 v1、旧文件仍在（404 不出现） |
| A5 | 客户端零手工复制 | Task 6 | `game-client/assets/config/` 已删除，链路仍通 |
| A6 | 后端回归全绿、旧契约零改动、零新增依赖 | Task 7 | `npm test` 全绿（基线 80 suites / 998 tests 不下降）；`git diff` 无旧接口签名变更；无 `package.json` 依赖变更 |
| A7 | 生产可达 | Task 8 | `curl https://game.joho.cn/gamedata/manifest.json` → 200 且 hash 与库内一致 |
| A8 | 2G 服务器零构建 | Task 8 | 服务器上只做解包/上传/重启，无 `npm run build` |

### 1.6 测试基线

- **后端**：`npm test` 必须全绿；本批新增 1 个 spec（≥8 用例），基线不下降。
- **契约**：`scene-package.builder` 的纯函数必须有「同输入同 hash」的断言（防 D4 回归）。
- **冒烟**：`node scripts/smoke-scene-config-s2.mjs` 覆盖「admin 登录 → 导出 → 发布 → 静态拉取 → hash 校验 → 回滚 → 再拉取」，退出码 0 为通过。
- **客户端**：延续 S1 口径（浏览器点检 + 冒烟），不引入单测框架。

### 1.7 已知限制（S2 明确不覆盖）

1. **无 GM 面板**：S2 只有接口与 CLI，配置编辑/发布按钮在 S2b。
2. **无鉴权分级的配置编辑**：本批不做「谁能发布」的角色区分（沿用 `AdminGuard`）。
3. **无多场景批量**：管线支持按 sceneId 逐个导出；批量导出场景留到有第二个场景时。
4. **不做客户端资源热更**：只热更**配置包**，美术资源热更属 S3+。
5. **不做 CDN/缓存头**：静态目录走默认响应头；`immutable` 缓存头留到客户端正式部署时再定。

---

## 2. Tasks

> 命令一律给出 **cwd**。后端 cwd = `e:\code\nest\packages-game\game-server`，客户端 cwd = `e:\code\nest\packages-game\game-client`。

### Task 1: 契约固化（`config-schema/scene-config.schema.json`）

**Files:**
- Create: `packages-game/config-schema/scene-config.schema.json`

- [x] **Step 1** 按 S1 已验证产物（[scene-1-v1.json](file:///e:/code/nest/packages-game/game-client/assets/config/scene-1-v1.json)）逐字段写 schema：顶层 `schemaVersion/sceneId/version/hash/scene/layers/staticEntities/fixedNpcs/triggers`；`scene` 含 `name/mapResKey/mapWidth/mapHeight/minLevel/maxPlayers/sceneType/entry{x,y}`；`staticEntities[]` 含 `kind/spawnId/templateId/resKey/x/y/rotation/interact{type,cd,oneTime}`；`fixedNpcs[]` 含 `spawnId/npcTemplateId/resKey/x/y/anim`；`triggers[]` 含 `id/type/area{x,y,w,h}/targetSceneId/onceOnly`。
- [x] **Step 2** 枚举用 `enum` 约束，取值**必须**与 `src/constants/enums.ts` 一致（`SceneType` / `TriggerType` / interact.type 用 `collect|read`）。
- [x] **Step 3** 校验 JSON 语法：`node -e "JSON.parse(require('fs').readFileSync('e:/code/nest/packages-game/config-schema/scene-config.schema.json','utf8'));console.log('ok')"` → Expected `ok`。
- [x] **Step 4** 人工比对：schema 字段 ⊇ S1 配置包字段，多一个字段或漏一个字段都算不通过（S1 配置包是唯一事实）。
- [x] **Step 5** commit：`feat(game-config): 固化场景配置包 schema（S1 已验证字段）`

### Task 2: 版本表与枚举

**Files:**
- Create: `src/modules/world/config/entities/scene-config-version.entity.ts`
- Modify: `src/constants/enums.ts`、`src/modules/world/world.module.ts`

- [x] **Step 1** 加枚举 `SceneConfigStatus { DRAFT='draft', PUBLISHED='published', ARCHIVED='archived' }`。
- [x] **Step 2** 建实体 `SceneConfigVersion`（表 `scene_config_versions`）：`id bigint PK`、`scene_id bigint`、`version int`、`hash varchar(80)`、`file_path varchar(255)`、`status enum(SceneConfigStatus)`、`published_at timestamptz nullable`、`payload_hash varchar(80)`、`created_by bigint nullable`、`created_at/updated_at/deleted_at`；唯一索引 `(scene_id, version)`，普通索引 `(scene_id, status)`。
  - `hash` = 文件文本 sha256（与 manifest 一致）；`payload_hash` = 包内 `hash` 字段（两者不同，见 §1.2）。
- [x] **Step 3** 在 `world.module.ts` 的 `TypeOrmModule.forFeature([...])` 注册实体。
- [x] **Step 4** 起服务后核对列：`psql -U postgres -h localhost -d game_server -c "\d scene_config_versions"` → Expected：列齐且 `status` 为 enum 类型。
- [x] **Step 5** commit：`feat(game-config): 新增场景配置版本表 scene_config_versions`

### Task 3: 导出与发布服务（含纯函数 builder）

**Files:**
- Create: `src/modules/world/config/scene-package.builder.ts`、`src/modules/world/config/scene-config.service.ts`、`src/modules/world/config/scene-config.service.spec.ts`

- [x] **Step 1** `scene-package.builder.ts`：`canonicalJson()`（键排序）+ `sha256()`（**逐字照搬** [seed:55-64](file:///e:/code/nest/packages-game/game-server/seeds/scene-spike.seed.ts#L55-L64)）+ `buildScenePayload({scene, spawns, objectTemplates, npcTemplates, triggers})` → 返回 payload（不含 hash）与 `payloadHash`。**不依赖 Nest**，供 service 与单测直接调用。
- [x] **Step 2** `scene-config.service.ts`：
  - `exportScene(sceneId, adminId)`：取数 → builder → `version = max(version)+1`（同场景）→ 写 `gamedata/scene-<id>-v<n>.json`（`JSON.stringify(withHash,null,2)+'\n'`）→ 入库 `status=draft` → 返回版本行。
  - `publishScene(sceneId, version, adminId)`：目标置 `published` + `published_at=now()`；同场景其他 `published` → `archived`；→ `rebuildManifest()`。
  - `rollbackScene(sceneId, version, adminId)`：校验目标是既存且 `version < 当前 published.version`；置 `published`、当前置 `archived` → `rebuildManifest()`。
  - `rebuildManifest()`：查所有场景的 `published` 行（每个场景至多一条）→ 写 `gamedata/manifest.json`（含 `generatedAt/scenes[{sceneId,version,hash,file}]`）。
  - `listVersions(sceneId, page, limit)`、`listScenes()`（每个场景 + 当前 published 版本）。
  - 写操作用 `adminService.logOperation({operation:'scene-config.publish'|'rollback'|'export', ...})`。
  - 目录解析（**不要凭猜相对层级**）：优先级 `process.env.GAMEDATA_DIR` → `join(process.cwd(),'gamedata')` → 启动时 `console.log` 打印实际解析路径。理由：`__dirname` 在 **dev/prod（dist）与 jest（src）下层级不同**，cwd 在 nest 与 systemd 下都应是 `game-server` 根；测试里显式设 `GAMEDATA_DIR` 指向临时目录（不污染仓库）。生产 systemd 若未设 `WorkingDirectory`，必须在 unit 里显式设置 `GAMEDATA_DIR=/opt/game-server/gamedata`。
- [x] **Step 3** 单测（≥8 用例）：同输入同 hash；`version` 自增；`publish` 后旧版本变 `archived`；manifest 只含 published；`rollback` 到旧版本后 manifest 指向旧版本；回滚到当前版本应报错；`file_path` 与 `hash` 与写出的文件一致；空场景的 triggers/staticEntities 为 `[]` 而非 `null`。
- [x] **Step 4** `npm test` → Expected：全绿（新增用例计入）。
- [x] **Step 5** commit：`feat(game-config): 场景配置导出/发布/回滚服务`

### Task 4: 静态托管 + admin 接口

**Files:**
- Modify: `src/main.ts`、`src/modules/world/world.controller.ts`、`src/modules/world/dto/scene-config.dto.ts`

- [x] **Step 1** `main.ts` 加：`app.useStaticAssets(join(__dirname,'..','..','gamedata'), { prefix:'/gamedata' })`（紧随 `/sandbox` 那条；**不动** helmet/CORS 顺序）。
- [x] **Step 2** DTO：`PublishSceneConfigDto{ version: number }`、`RollbackSceneConfigDto{ version: number }`（`@IsInt` + `@Min(1)`）。
- [x] **Step 3** 接口（全部 `AdminGuard`，前缀沿用 `api/admin/v1/world`）：
  - `GET  scene-config/list` → 场景 + 当前发布版本
  - `GET  scene-config/:sceneId/versions?page&limit`
  - `POST scene-config/:sceneId/export`
  - `POST scene-config/:sceneId/publish`（body `{version}`）
  - `POST scene-config/:sceneId/rollback`（body `{version}`）
- [x] **Step 4** 手工验证（后端已起，需 admin token）：
```
BASE=http://localhost:3000
TOKEN=$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"<本地密码>"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -s -X POST $BASE/api/admin/v1/world/scene-config/1/export -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/api/admin/v1/world/scene-config/1/versions" -H "Authorization: Bearer $TOKEN"
curl -s $BASE/gamedata/manifest.json
```
  Expected：export 返回 `code=0` 且 `version>=1`；versions 含新行；**静态 manifest 在 publish 前不出现该版本**（draft 不进 manifest）。
- [x] **Step 5** 未授权校验：不带 token 访问 `scene-config/*` → **401/403**（不是 404）；`GET /gamedata/manifest.json` 无 token 也应 **200/404**（静态目录特性，404 表示目录未生成）。
- [x] **Step 6** commit：`feat(game-config): /gamedata 静态托管与配置发布 admin 接口`

### Task 5: CLI 脚本 + 与 seed 解耦

**Files:**
- Create: `scripts/scene-config-cli.mjs`
- Modify: `seeds/scene-spike.seed.ts`、`package.json`

- [x] **Step 1** `scripts/scene-config-cli.mjs`（零依赖，用内置 fetch）：子命令 `list` / `export --scene 1` / `publish --scene 1 --version 2` / `rollback --scene 1 --version 1`；admin 凭据取自 `--base`（默认 `http://localhost:3000`）+ 环境变量 `ADMIN_USERNAME`/`ADMIN_PASSWORD`（缺省 `admin`/本地密码）；输出统一打印 `code/msg`，**`code!==0` 时 exit 1**。
- [x] **Step 2** package.json 加：`"config:list"`/`"config:export"`/`"config:publish"`/`"config:rollback"`（均 `node scripts/scene-config-cli.mjs <子命令>`）。
- [x] **Step 3** `seeds/scene-spike.seed.ts`：删除「生成配置包」整段（`CONFIG_DIR`/`canonicalJson`/`sha256`/写文件/manifest），只保留播种；末尾打印一句「配置包请用 `npm run config:export`」。
- [x] **Step 4** 验证解耦：`npm run seed:scene-spike` → Expected：只打印播种日志，**不再写任何文件**；`git status` 无 `game-client/assets/config` 变更。
- [x] **Step 5** 端到端：先 `seed:scene-spike`（幂等，已存在场景会跳过播种）→ `npm run config:export` → `npm run config:publish -- --version <n>` → `curl /gamedata/manifest.json` 命中新版本。
- [x] **Step 6** commit：`refactor(game-config): 导出发布移出 seed，改为 CLI 驱动`

### Task 6: 客户端改造（配置来源 + 版本缓存）

**Files:**
- Modify: `src/config/AppConfig.ts`、`src/config/loader.ts`、`src/config/validate.ts`、`tools/serve.mjs`、`tools/check-config.mjs`
- Delete: `assets/config/`（S1 手工副本）

- [x] **Step 1** `AppConfig.configBase` → `${apiBase}/gamedata`（保留字段名，避免散落改动）。
- [x] **Step 2** `tools/serve.mjs`：加 `/gamedata/*` → 反向代理 `http://localhost:3000`（同源，规避 §1.2 的 CORS 事实）；移除 `/config` 映射。
- [x] **Step 3** `loader.ts`：加版本缓存——拉取前先读本地 `scene-<id>-v<n>`（key 含 manifest 的 version+hash），命中则校验 hash 后直接用；未命中/不符则拉取并写缓存（存储走现有 `Platform`）。小游戏端分支（读包内 `config/`）保持不变。
- [x] **Step 4** `validate.ts` 与 Task 1 的 schema 逐字段对齐（特别是 `scene.entry`、`layers` 允许 `{}`）。
- [x] **Step 5** 删除 `assets/config/`；重跑 S1 兜底构建 `node tools/build-fallback.mjs` → Expected：构建成功，无引用 `assets/config` 的残留（`Grep` 确认）。
- [x] **Step 6** 浏览器点检（`node tools/serve.mjs` + Chrome）：控制台出现 `配置包就绪`（版本号 = 当前 published 版本）+ 静态层渲染完成 + NPC 坐标与配置包一致。
- [x] **Step 7** commit：`feat(game-client): 配置包改为服务端拉取并按版本缓存`

### Task 7: 冒烟脚本 + 全量回归

**Files:**
- Create: `scripts/smoke-scene-config-s2.mjs`
- Modify: `scripts/smoke-laya2d-s1.mjs`（配置包路径由 `game-client/assets/config` 改指 `game-server/gamedata`）

- [x] **Step 1** 写 `smoke-scene-config-s2.mjs`，断言（每条打印 `PASS/FAIL` + 证据，任一 FAIL 则 exit 1）：
  1. admin 登录拿到 token
  2. `config:list` 返回场景与当前发布版本
  3. `export` 返回 `version = 原版本+1` 且 `status=draft`
  4. 导出后 manifest **未**指向 draft 版本（draft 不对外）
  5. `publish` 后 `GET /gamedata/manifest.json` 指向新版本，且 `hash` 与该文件文本 sha256 **一致**（脚本自算）
  6. 新版本文件内 `hash`（payload hash）由 canonicalJson 重算一致
  7. `rollback` 到旧版本后 manifest 指回旧版本，旧文件仍可 200 拉取
  8. 客户端可拉取的 manifest 中每个 entry 的 file 均可 200 + hash 校验通过
  9. 版本历史接口含 export/publish/rollback 全过程记录（status 变化可追溯）
- [x] **Step 2** `node scripts/smoke-scene-config-s2.mjs` → Expected：`9/9 PASS`（或实际条数全 PASS），退出码 0。
- [x] **Step 3** 修 `smoke-laya2d-s1.mjs` 的配置包路径并重跑 → Expected：`9/9 PASS`（S1 闭环不回归）。
- [x] **Step 4** 全量回归：`npm test` → Expected：全绿且 ≥998 tests；`git diff <基线> -- src/modules/world/world.client.controller.ts src/modules/gateway/game.gateway.ts` → Expected：无旧接口签名变更。
- [x] **Step 5** 依赖自检：`git diff <基线> -- packages-game/game-server/package.json packages-game/game-client/package.json` → Expected：**无 dependencies 变更**（仅 scripts 允许）。
- [x] **Step 6** commit：`test(game-config): S2 配置管线冒烟脚本 + S1 冒烟改指 gamedata`

### Task 8: 生产部署与线上验收

**Files:** 无（部署动作）

- [x] **Step 1** 本地构建：`npm run build`（cwd = game-server）→ Expected：`dist/` 更新且无 TS 错误。
- [x] **Step 2** 打包上传：
```
tar -czf dist-s2.tar.gz -C E:/code/nest/packages-game/game-server/dist .
scp dist-s2.tar.gz odoo:/tmp/
```
- [x] **Step 3** 服务器替换并重启（复杂命令用 base64 传递）：
```
cd /opt/game-server
cp -r dist dist_prev_$(date +%Y%m%d_%H%M%S)
rm -rf dist && mkdir dist && tar -xzf /tmp/dist-s2.tar.gz -C dist
mkdir -p gamedata
systemctl restart game-server
journalctl -u game-server --since '-1 min' | grep 'Nest application successfully started'
```
  Expected：出现 `successfully started`；`gamedata/` 存在。
- [x] **Step 4** 建表核对：`psql`（容器 `1Panel-postgresql-4LsS`，用户 game/库 game_server）`\d scene_config_versions` → Expected：列齐。
- [x] **Step 5** 线上发布：用 CLI 指向 `https://game.joho.cn`（或服务器内 curl 127.0.0.1）执行 `export` → `publish`，再验：
```
curl -s -o /dev/null -w '%{http_code}\n' https://game.joho.cn/gamedata/manifest.json
curl -s https://game.joho.cn/gamedata/manifest.json
```
  Expected：`200`；manifest 指向新版本；hash 与库内一致。
- [x] **Step 6** 静态 404 兜底判断：若 `/gamedata/manifest.json` 返回 **404 而 `/admin` 仍 200**，说明 OpenResty 未透传该前缀 → 触发 §3 风险 3 的回退（把产物目录改放 OpenResty www 静态站点目录，前端 URL 不变）。
- [x] **Step 7** 回滚演练（线上）：`rollback` 到上一版本 → manifest 指回旧版本 → 客户端（本地页面指线上 `/gamedata`）拉到旧版本并渲染。
- [x] **Step 8** commit（若有脚本/文档改动）：`chore(game-config): S2 部署与线上验收记录`

### Task 9（可选，待 §4 确认）: 《游戏服务器开发手册》同步

**Files:** `manual-src/`（dict-part / api-part / main-part）→ `deploy-manual.ps1`

- [ ] **Step 1** 数据字典：补 `scene_config_versions` 表（字段/类型/注释）与 `SceneConfigStatus` 枚举。
- [ ] **Step 2** 接口索引：补 5 个 `api/admin/v1/world/scene-config/*` 接口。
- [ ] **Step 3** 主体：新增一节「场景配置包导出与发布」（产物路径 `/gamedata`、发布/回滚语义、客户端拉取契约）。
- [ ] **Step 4** `node merge.js` → `node check.js`（四类校验全过）→ `powershell -ExecutionPolicy Bypass -File e:\code\nest\deploy-manual.ps1` → 线上 `curl -H 'Host: game.joho.cn' http://127.0.0.1/manual/` 验 200 + grep 新关键字。

---

## 3. 风险与回退

| # | 风险 | 触发信号 | 回退动作 |
|---|---|---|---|
| 1 | 客户端 hash 校验失败 | 控制台「配置包哈希校验失败」 | 比对两端算法（D4）：必须 `canonicalJson(payload)` 与「文件文本 sha256」分别落到 `hash`/`manifest.hash`，不得混用 |
| 2 | `gamedata` 目录路径算错（`__dirname` 层级） | export 报 ENOENT / 文件出现在 dist 内 | 用 `console.log(GAMEDATA_DIR)` 实测后改层级；必要时引入 `GAMEDATA_DIR` 环境变量并在部署时显式设置 |
| 3 | 生产 `/gamedata` 404（OpenResty 未透传） | Step 6 现象 | 产物改放 OpenResty 静态站点目录（`/opt/1panel/apps/openresty/openresty/www/sites/game.joho.cn/gamedata/`），发布脚本改 scp；客户端 URL 不变 |
| 4 | 本地静态拉取被 CORS 拦 | 浏览器 `blocked by CORS policy` | 走 `tools/serve.mjs` 的 `/gamedata` 同源代理（Task 6 Step 2）；**不改** main.ts 中间件顺序 |
| 5 | 删 `assets/config` 后 S1 冒烟失败 | Task 7 Step 3 FAIL | 先改 S1 冒烟路径再删目录；顺序不可颠倒 |
| 6 | 生产误把 draft 当已发布 | manifest 出现未发布版本 | `rebuildManifest()` 只查 `status='published'`，单测必须覆盖（Task 3 Step 3） |
| 7 | 回滚破坏了线上 | 回滚后客户端白屏 | 文件**只增不删**且 manifest 可回指，任一时点都能回退到上一个 published 版本 |

---

## 4. 待用户确认项（✅ 2026-09-21 已全部确认）

> **确认结果（生效，执行时以此为准）**：① 发布入口 → **后端 admin 接口**；② schema → **写 `config-schema/scene-config.schema.json`**；③ 生产 → **本批上线并做发布/回滚演练**（Task 8 执行）；④ 执行方式 → **Subagent-Driven**；⑤ 手册同步 Task 9 → **后置**（本批不做）。

**原始待确认项（存档）**

1. **发布入口（D1）**：走后端 admin 接口（推荐：导出即写文件，S2b 面板零后端改动），还是走「本地脚本 + 手工 scp」？
2. **schema 落型（Task 1）**：写 `config-schema/scene-config.schema.json` 作为契约单一来源（推荐，总纲 §4 已定），还是只保留客户端 `validate.ts` 手写校验（省一个文件，但契约只活在代码里）？
3. **生产部署是否本批执行（Task 8）**：S2 完成定义含「发布/回滚可操作」，建议本批就在 `game.joho.cn` 做一次线上发布 + 回滚演练；若你想先只在本机验完再上线，Task 8 可后置。
4. **手册同步（Task 9）**：是否本批顺手同步《游戏服务器开发手册》（表 + 5 接口 + 1 小节）？可后置。

---

## 5. 执行方式（✅ 已选：1. Subagent-Driven）

> 已确认采用 **Subagent-Driven**：每个 Task 派全新 subagent 执行，Task 之间做两阶段评审（先看 diff 是否符合计划，再看验收输出是否达标）。

**1. Subagent-Driven（推荐）** — 每个 Task 派一个全新的 subagent 执行，我在 Task 之间做两阶段评审（先看 diff 是否符合计划，再看验收输出是否达标），适合本计划这种「9 个任务、每步都有明确命令与期望输出」的场景；出错时只需回滚单个任务。

**2. Inline Execution** — 在当前会话里按 executing-plans 逐 Task 批量执行，在关键检查点（Task 4 发布接口、Task 6 客户端切源、Task 8 线上发布）暂停让你确认。