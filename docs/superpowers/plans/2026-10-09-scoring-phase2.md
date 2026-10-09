# 对话分支评分系统（阶段 2）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ① 评分状态持久化（内存 Map → PG jsonb，重启/多实例不丢）② 结局分支接线（`resolveBranch` 接入对话树，评分规则驱动跳转）③ admin 配置管理（ScoringConfig 入库 + CRUD + 热更新）④ 客户端展示（DialogueView 携带 visible 轴 + ScorePanel）。

**依据:** 本功能无独立 spec 文档，**本计划 §2 即设计定稿（契约）**。阶段 1 已落地代码（`src/modules/scoring/` 全套引擎 + 6 策略 + 对话 `action:'score'`/`condition.score` 接线，**当前在工作区未提交**，见 Task 0）。

**Architecture:** `ScoringService` 内存 Map 降级为 L1 缓存，write-through 落 `player_scoring_states`（state jsonb **仅存值**，加载时与当前 config 合并——配置改了不坏档）；对话选项新增 `branch: { gameId, fallback? }` 字段，`choose()` 在动作执行后调 `resolveBranch` 决定跳转；`ScoringConfig` 持久化到 `scoring_configs`，模块初始化从库加载，admin CRUD 后即时 `registerGame` 热更新；`DialogueView` 增可选 `score` 字段（仅 `visible: true` 轴），客户端 ScorePanel 静态单例展示。

**Tech Stack:** NestJS 11 + TypeORM + PostgreSQL 16 + Jest/ts-jest + Laya（game-client）。

---

## 1. 现状盘点（阶段 1 已有 / 缺口）

| 已有（阶段 1，未提交） | 缺口（本计划） |
|---|---|
| `ScoringModule`(@Global) + `ScoringService`（内存 Map）+ `ScoreEngine` + 6 策略（axis/dual-axis/affinity/hidden-flag/faction/ideology） | 状态重启即丢、多实例不共享（service 注释已明示延后项） |
| 对话 `action:'score'`（dispatch）+ `condition.score`（快照门控）+ `buildContext` 携带快照 | `resolveBranch()` 无生产调用点（仅单测） |
| 示例配置 `history-teach` / `demo-rpg`（硬编码 `config/*.ts`，`onModuleInit` 注册） | 配置无法运营修改，无 admin |
| `scoring.service.spec.ts` 4 例 | dialogue 侧 score 测试为零（spec.ts 的 M 是 CRLF 噪音，无内容差异） |

## 2. 设计定稿（契约）

### 2.1 数据模型（一次 migration 0009，DDL 双轨）

```sql
-- 玩家评分状态（key = player_id + game_id）
CREATE TABLE IF NOT EXISTS player_scoring_states (
  id BIGSERIAL PRIMARY KEY,
  player_id VARCHAR(64) NOT NULL,
  game_id VARCHAR(64) NOT NULL,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_player_scoring UNIQUE (player_id, game_id)
);

-- 评分配置（每游戏一份 ScoringConfig）
CREATE TABLE IF NOT EXISTS scoring_configs (
  id BIGSERIAL PRIMARY KEY,
  game_id VARCHAR(64) NOT NULL,
  config JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
ALTER TABLE scoring_configs ADD CONSTRAINT uq_scoring_game UNIQUE (game_id);
```

seeds：migration 内 `INSERT ... ON CONFLICT (game_id) DO NOTHING` 灌入 `history-teach`、`demo-rpg` 两份 JSON（与 `config/*.ts` 逐字一致），保证行为不变。

### 2.2 持久化语义（Task 1）

- **序列化仅存值**：`{ axes: Record<id, number>, flags: string[], affinity, reputation, ideology }`——label/min/max 不入库，加载时 `freshState(cfg)` 后按值合并（缺轴丢弃、越界钳制到 `[min,max]`、config 删掉的 flag 保留但仅当匹配已有 key 才写回……对齐最简：**未知 key 一律丢弃**）
- `ScoringService` API 全部 async 化：`dispatch / compute / snapshot / snapshotFor / resolveBranch / reset` 返回 `Promise`；内存 Map 作 L1 缓存
- `ensure` miss 时查库加载；首次 dispatch 后 `upsert` write-through（TypeORM `upsert(..., ['playerId','gameId'])` 依赖 2.1 唯一约束）；读多写少，**load-on-miss 不落库**（首次写才建行）
- `reset` = 删内存 + 删行
- 波及面（全部已有调用点均兼容）：`dialogue.service.buildContext`（`Promise.all` 内，天然兼容）、`dispatchAction`（async）、`choose`（async）

### 2.3 结局分支语义（Task 2）

```ts
// dialogue.types.ts DialogueOption 增：
branch?: { gameId: string; fallback?: string };
```

- 选中该选项后按 `scoring_configs` 的 `branches` 规则跳转：**命中 → goto 节点 key；未命中 → `fallback`（缺省 = 结束对话）**
- `branch` 与 `next` **互斥**（同用 → 结构校验失败）
- `resolveBranch` 返回 `'default'` 表示未命中（阶段 1 契约，不改）→ 取 `fallback ?? null`
- goto 解析出的 key 不在树内 → `DIALOGUE_NODE_INVALID`（配置错误不伪装成结束，沿用既有注释精神）；普通 `next` 条件挡仍是 `DIALOGUE_CONDITION_NOT_MET`
- `assertDialogueNodes` 扩展：`branch.gameId` 非空字符串、`fallback` 为 undefined 或非空字符串、与 `next` 互斥
- `collectScoreGameIds` 同步纳入 `option.branch.gameId`（客户端展示用）
- **goto 与对话树节点 key 的对齐是内容约定**，admin 校验不做跨表检查（风险表记录）

### 2.4 admin 配置管理（Task 3）

- 路由 `api/admin/v1/scoring`（`AdminGuard`，对齐 `quiz-admin`）：

| 方法 | 路径 | 语义 |
|---|---|---|
| GET | `/list` | 分页列表（含 config 全量） |
| GET | `/:id` | 详情 |
| POST | `/` | 创建（`game_id` 冲突检查**含软删行**，对齐 apps 46102 做法）→ 校验 → 落库 → `registerGame` 热更新 |
| PUT | `/:id` | 更新 → 校验 → 落库 → `registerGame` 热更新 |
| DELETE | `/:id` | 软删 → `unregister(gameId)`（内存 configs Map 移除；玩家状态行保留） |

- `validateScoringConfig` 纯函数（`scoring-config.validator.ts`）：`enabled` 非空且 ⊆ 六策略 id（`axis/dual/affinity/flag/faction/ideology`）；`axes` 各 def `min < max`；`npcs/factions/ideologies` 为字符串数组；`branches[].when` 非空、`op ∈ >=/<=/>/<(== 仅 axis/flag 类合法集)`、`goto` 非空
- 错误码 **47001-47099**（45/46/80/95/96 段已占，47 空闲）：
  ```ts
  // 评分系统 47001-47099
  SCORING_GAME_NOT_FOUND: 47001,   // gameId 未注册
  SCORING_CONFIG_INVALID: 47002,   // 配置校验失败
  SCORING_GAME_EXISTS: 47003,      // game_id 已存在（含软删）
  ```
- admin-web 页面**本期不做**（对齐 quiz 惯例：后端 CRUD 先行）

### 2.5 客户端展示契约（Task 4）

- 服务端 `DialogueView` 增（start 与 choose 都带，树内无 score 引用时缺省不带）：

```ts
score?: Record<string, Array<{ id: string; label: string; value: number }>>;
// key = gameId；数组仅含该游戏配置里 visible:true 的轴，按 config 声明顺序
```

- `ScoringService` 增纯函数 `toVisibleView(snapshot, gameId)`（`ensure` 后从 config 过滤 visible 轴）
- client `api.ts`：`DialogueStepResult` 增 `score?`（类型逐字对齐后端）；`DialogueView.normalizeTalk / normalizeChoose` 透传；Esc 互斥链加 `ScorePanel.isOpen`
- 新 `ui/ScorePanel.ts`：静态单例对齐 `QuizPanel`（`init/isOpen/open/close/destroy`），zOrder 10009（QuizPanel 10008 相邻），展示「label + value」（Laya 最简文本行）
- 接线：`InteractController` 对响应 `res.score` → `ScorePanel.open`；`Main.ts` `afterLogin` 装配 init + `shutdownClient` destroy

## 3. 调研结论（执行者必读，避免重复调研）

| 主题 | 关键事实 |
|---|---|
| 阶段 1 足迹 | `src/modules/scoring/`（13 文件，untracked）；`dialogue/samples/`（untracked）；真实 diff：`dialogue.resolver.ts`(+53 score 条件求值)、`dialogue.service.ts`(+47 dispatch/buildContext)、`dialogue.types.ts`(+23 score 类型)、`enums.ts`(+1 `SCORE='score'`)、`app.module.ts`（**混合并行改动**，见环境须知）；`error-codes.ts`、client `api.ts/ws.ts/world/*`、`auth.service.ts` 的 M 均 CRLF 噪音（`git diff` 空） |
| scoring service | `dispatch/compute/snapshot/snapshotFor/resolveBranch/reset` 全同步；`states` Map key=`${playerId}:${gameId}`；`resolveBranch` 未命中返回 `'default'`；`registerGame` 直写 Map；`ScoringModule` @Global 已注册（app.module L86） |
| 对话接线点 | `choose()`：动作执行 L327-335 → `option.next` 为空即 finished L338-346 → 重组 ctx L349-353 → `resolveNode(option.next)` L354-361（null → `DIALOGUE_CONDITION_NOT_MET`）；`DialogueView` 定义在 **dialogue.service.ts L63**（不在 types）；`matchCondition` score 分支在 resolver L96 起；`collectScoreGameIds` resolver L180 |
| 迁移惯例 | 时间戳前缀 + 序号：最新 `1791460000000_SanguoshaTables0008.ts` → 本期 `1791470000000_ScoringTables0009.ts`；DDL 双轨 `scripts/ddl/2026-10-09-scoring-0009.sql`；quiz 0006 是 jsonb 表范本 |
| admin 模式 | `quiz-admin.controller.ts`：`@UseGuards(AdminGuard)` + `@Controller('api/admin/v1/quiz')` + `assertId` 纯函数；软删 code 冲突含软删查（apps 46102 同法） |
| 错误码 | 已占：45xxx 邮件、46xxx quiz/apps、80xxx 麻将、95xxx 掼蛋、96xxx 三国杀；**47xxx 空闲** |
| client | `api.ts`：类型 + `Api` 方法（路径与后端逐字一致）；`DialogueView.ts`：`normalizeTalk/normalizeChoose` 纯函数 + Esc 互斥链 L346；`QuizPanel.ts`（10008）是面板范本；`InteractController.choose` 处理 `res.quiz → QuizPanel.openFromHandout`；装配在 `Main.ts afterLogin` |
| 测试基线 | 阶段 3 收尾 1480 例 / 123 套件全绿；**执行时先实跑一次记录当前基线**（并行会话可能已变化） |

## 4. 环境须知（执行者必读）

- 工作目录 `e:\code\nest\packages-game\game-server`（git 仓库根 `e:\code\nest`）；PowerShell 不支持 `&&`，用 `;`
- tsc：`& ".\node_modules\.bin\tsc.cmd" --noEmit -p tsconfig.json`；测试：`npx jest <pattern> --silent`（已配 forceExit）
- 本机 PG16：`pg_ctl -D E:\PostgreSQL\16\data start`（服务启动权限受限，需手动拉起跑迁移相关验证）
- **并行开发警告（本计划最高风险）**：工作区混有大量并行未提交改动（sanguosha/sichuanmajiang/tenant/guandan-replay 全套、app.module.ts 的 `MahjongModule→SichuanMahjongModule` 改名与 `SanguoshaModule` 注册、guandan/sanguosha-web 等）。**只允许 add 本计划文件清单内的文件**；每 Task 提交前逐文件 `git diff --stat` 核对
- `app.module.ts` 属**混合文件**：本功能只有 2 行（`ScoringModule` import + imports 数组注册）。提交时用 quiz 阶段 2 验证过的选择性暂存手法：`git checkout HEAD -- <file>` → Edit 重放本功能增量 → `git add <file>` → 恢复工作区版（把 checkout 前内容先存副本）。其余文件均为本功能独占，可整文件 add
- commit 只 add 本任务文件；每 Task 结束即 commit + push

---

### Task 0: 阶段 1 基线提交（前置，必须最先做）

**Files:**
- Add: `src/modules/scoring/`（全部 13 文件）、`src/modules/world/dialogue/samples/`
- Modify（已改好，提交即可）: `src/modules/world/dialogue/dialogue.resolver.ts`、`dialogue.service.ts`、`dialogue.types.ts`、`src/constants/enums.ts`、`src/app.module.ts`（选择性暂存 2 行）

- [ ] **Step 0.1**: 确认 `git diff` 上述 dialogue/enums 文件内容均为 score 相关（enums 仅 `SCORE = 'score'` 1 行）；`dialogue.service.spec.ts` 无内容差异，跳过
- [ ] **Step 0.2**: `app.module.ts` 选择性暂存（见环境须知），只纳入 `ScoringModule` 2 行
- [ ] **Step 0.3**: 全量 add 上述文件（**不含** sanguosha/mahjong/tenant 任何文件），commit `feat(game-server): 对话分支评分系统阶段1（引擎+6策略+对话接线，内存态）`，push

### Task 1: 状态持久化（migration 0009 + entity + service async 化）

**Files:**
- Create: `scripts/ddl/2026-10-09-scoring-0009.sql`、`src/migrations/1791470000000_ScoringTables0009.ts`、`src/modules/scoring/entities/player-scoring-state.entity.ts`
- Modify: `src/modules/scoring/scoring.module.ts`（forFeature + 移除硬编码示例注册→改由 DB 加载**挪到 Task 3**，本 Task 保留硬编码注册不动）、`src/modules/scoring/scoring.service.ts`（async 化 + 持久化）、`src/modules/scoring/scoring.service.spec.ts`
- Test: 同上 spec

- [ ] **Step 1.1**: DDL + migration（§2.1 建表 SQL 逐字；seeds 两份 JSON 与 `config/*.ts` 逐字一致，`ON CONFLICT (game_id) DO NOTHING`）
- [ ] **Step 1.2**: entity `PlayerScoringState`（id/playerId/gameId/state(jsonb)/createdAt/updatedAt，映射唯一约束）
- [ ] **Step 1.3**: `ScoringService` 改造——注入 repo（`@Optional` 不引入，直接构造器注入）；`ensure` 加载合并逻辑：

```ts
private merge(cfg: ScoringConfig, raw: Record<string, any>): ScoreState {
  const st = freshState(cfg);
  for (const [id, v] of Object.entries(raw?.axes ?? {})) {
    const ax = st.axes.get(id);
    if (ax) ax.value = Math.min(ax.max, Math.max(ax.min, Number(v) || 0));
  }
  for (const f of raw?.flags ?? []) st.flags.add(String(f));
  for (const [k, v] of Object.entries(raw?.affinity ?? {})) if (k in st.affinity) st.affinity[k] = Number(v) || 0;
  for (const [k, v] of Object.entries(raw?.reputation ?? {})) if (k in st.reputation) st.reputation[k] = Number(v) || 0;
  for (const [k, v] of Object.entries(raw?.ideology ?? {})) if (k in st.ideology) st.ideology[k] = Number(v) || 0;
  return st;
}
```

- [ ] **Step 1.4**: 6 个方法签名加 `Promise`；`dispatch` 末尾 `upsert` write-through；`reset` 删行；`snapshotFor` 保持一次 Promise.all 语义
- [ ] **Step 1.5**: spec 改造——fake repo（Map 底座实现 find/upsert/delete），原 4 例改 async + 新增 3 例：重启恢复（新建 service 同 fake repo 数据 → snapshot 一致）、越界钳制、未知 key 丢弃
- [ ] **Step 1.6**: `npx jest scoring --silent` 绿 → 全量测试基线实测记录 → commit `feat(game-server): 评分状态持久化（PG jsonb + write-through）`，push

### Task 2: 结局分支接线（branch 字段 + choose 解析）

**Files:**
- Modify: `src/modules/world/dialogue/dialogue.types.ts`（branch 字段 + assert）、`dialogue.resolver.ts`（collectScoreGameIds 纳入 branch.gameId）、`dialogue.service.ts`（choose 接线 + resolveBranch 调用）、`samples/history-teach.dialogue.json`（加演示选项）
- Test: `dialogue.service.spec.ts`（本 Task 起真实修改，新增分支用例）

- [ ] **Step 2.1**: types + `assertDialogueNodes` 扩展（§2.3 校验规则）
- [ ] **Step 2.2**: `choose()` 接线：

```ts
let nextKey: string | null = option.next ?? null;
if (option.branch) {
  const goto = await this.scoringService.resolveBranch(playerId, option.branch.gameId);
  nextKey = goto === 'default' ? option.branch.fallback ?? null : goto;
  if (nextKey && !nodes.some((n) => n.key === nextKey)) {
    throw new GameException(ErrorCodes.DIALOGUE_NODE_INVALID, `分支 goto 不在该对话树：${nextKey}`);
  }
}
if (!nextKey) { /* 原 finished 返回 */ }
// 下方原 resolveNode 逻辑不动（普通 next 条件挡仍 CONDITION_NOT_MET）
```

- [ ] **Step 2.3**: sample 的 `imagine` 节点加演示选项 `{"text":"听天由命（按评分定结局）","branch":{"gameId":"history-teach","fallback":null}}`（孔子好感≥50 → confucius_route；wealth≥500 → rich_end；wisdom≥100 → wise_end；否则结束）
- [ ] **Step 2.4**: spec 新增：命中 goto（dispatch 后 choose branch 选项 → confucius_route）、未命中走 fallback、goto 不在树 → NODE_INVALID、branch+next 同用 → 结构校验失败
- [ ] **Step 2.5**: `npx jest dialogue --silent` 绿 → commit `feat(game-server): 对话选项 branch 字段接入评分分支规则`，push

### Task 3: admin 配置管理（error-codes + validator + CRUD + DB 加载）

**Files:**
- Modify: `src/constants/error-codes.ts`（47001-47003）、`src/modules/scoring/scoring.module.ts`（forFeature 加 ScoringConfigEntity + providers/controllers + onModuleInit 改 DB 加载）
- Create: `src/modules/scoring/entities/scoring-config.entity.ts`、`src/modules/scoring/scoring-config.validator.ts`、`src/modules/scoring/scoring-admin.service.ts`、`src/modules/scoring/scoring-admin.controller.ts`
- Test: `src/modules/scoring/scoring-config.validator.spec.ts`、`scoring-admin.service.spec.ts`
- Modify: `src/modules/scoring/scoring.service.ts`（增 `unregister(gameId)`）

- [ ] **Step 3.1**: error-codes 47001-47003（§2.4 逐字）
- [ ] **Step 3.2**: `validateScoringConfig(cfg): string[]`（错误消息数组，空=通过；规则见 §2.4）
- [ ] **Step 3.3**: entity + admin service（list/get/create/update/delete 软删；冲突检查含软删行；create/update 成功即 `registerGame`，delete 即 `unregister`）+ controller（对齐 quiz-admin：`assertId`、swagger 装饰）
- [ ] **Step 3.4**: `ScoringModule.onModuleInit` 删除两行硬编码 `registerGame`，改查 `is_active` 行逐个注册；`config/*.ts` 保留（单测 fixture + 类型来源）
- [ ] **Step 3.5**: spec——validator 全规则 + admin service（冲突 47003、非法 47002、CRUD 热更新断言 configs Map 变化）
- [ ] **Step 3.6**: `npx jest scoring --silent` 绿 → commit `feat(game-server): scoring 配置入库 + admin CRUD + 热更新`，push

### Task 4: 客户端展示（DialogueView.score + ScorePanel）

**Files:**
- Modify（server）: `src/modules/scoring/scoring.service.ts`（`toVisibleView(snapshot, gameId)`）、`src/modules/world/dialogue/dialogue.service.ts`（DialogueView 增 `score?` + start/choose 组装）、`dialogue.types.ts`（`DialogueScoreAxisView` 类型）
- Modify（client）: `src/net/api.ts`（类型 + 透传字段）、`src/ui/DialogueView.ts`（normalize 透传 + Esc 链）、`src/world/InteractController.ts`（res.score → ScorePanel.open）、`src/boot/Main.ts`（装配）
- Create: `src/ui/ScorePanel.ts`
- Test: `dialogue.service.spec.ts`（score 视图断言：visible 轴才出现、顺序同 config）

- [ ] **Step 4.1**: server `toVisibleView` + `buildStartView`/`choose` 返回值组装 `score`（`collectScoreGameIds` 为空则不带字段）
- [ ] **Step 4.2**: client `api.ts` 类型（逐字对齐 §2.5）
- [ ] **Step 4.3**: `ScorePanel.ts`——照抄 QuizPanel 的 Laya 骨架（静态单例、init/isOpen/open/close/destroy），zOrder 10009，仅文本行渲染 `{id: label: value}`
- [ ] **Step 4.4**: DialogueView normalizeTalk/normalizeChoose 透传 + Esc 互斥链 `ScorePanel.isOpen`；InteractController 打开面板；Main.ts 装配
- [ ] **Step 4.5**: client tsc 零错 + smoke：扩展 `scripts/smoke-s5-dialogue.mjs`（或新 `smoke-scoring.mjs`）断言 choose 响应含 score 字段 → commit `feat(game): 评分轴客户端展示（DialogueView.score + ScorePanel）`，push

### Task 5: 全量验收与回填

- [ ] 全量 `npx jest --silent`（对比 Task 1 记录的基线，零回归）
- [ ] server tsc：本功能文件零新增错误（全仓基线实测记录，勿以麻将侧历史错误为由放过本功能文件）
- [ ] 迁移实测：本机 PG 起库跑 0009 up（`seeds` 落地两行）；HTTP curl 冒烟若服务可启动则跑（admin CRUD + choose branch），不可启动则脚本留档延后（沿用 quiz 阶段 3 惯例）
- [ ] 回填本计划 §6 执行记录，commit `docs: 评分系统阶段2 计划执行记录回填`，push

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| app.module.ts 混合并行改动，误提交麻将/三国杀行 | Task 0 选择性暂存手法 + 每 Task `git diff --stat` 核对提交范围 |
| scoring API async 化漏改同步调用点 | 波及面仅 dialogue.service（3 处，均 async 上下文）；全量测试兜底 |
| branches[].goto 与对话树 key 不对齐 | 运行时 NODE_INVALID 快速暴露（不伪装成结束）；admin 校验不做跨表检查（文档明示内容约定） |
| 状态行与 config 漂移（轴删除/改名） | merge 时未知 key 丢弃、越界钳制；单测覆盖 |
| 并行会话同文件再改（dialogue/enums/app.module） | 每 Task 开始前重跑 `git status` + `git diff` 复核，发现新增并行改动即停下核对范围 |
| HTTP 冒烟被并行改动阻断 | 脚本随计划留档，延后补跑（quiz 阶段 3 惯例） |

## 6. 执行记录（回填区）

- [ ] Task 0 基线提交：commit ____
- [ ] Task 1 持久化：commit ____，全量基线 ____
- [ ] Task 2 分支接线：commit ____
- [ ] Task 3 admin 配置：commit ____
- [ ] Task 4 客户端展示：commit ____
- [ ] Task 5 验收：全量 ____ 例 / ____ 套件；tsc 口径 ____；冒烟 ____
