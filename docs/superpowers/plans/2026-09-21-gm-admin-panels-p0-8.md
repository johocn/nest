# P0-8 GM 后台处置类面板（封禁 / 举报 / 风控回收）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 让运营在 `/admin` 页面内完成三类处置——对玩家施加/查询处置、处理玩家举报、查看风控线索并处置/确认回收/回滚——不再依赖 curl。

**Architecture:** 把单文件 `admin/index.html` 拆成「框架 + 共享层 + 面板」三层，**保持零构建、零新依赖**（继续用 CDN Vue3 全量构建，顺序 `<script src>` 加载）。共享层封装 api/toast/危险动作二次确认；每个面板自注册一个 Vue 组件定义（`template` + `setup`），框架按注册表渲染导航与内容区。**后端零改动**：6 个域的路由已全部存在（见盘点），本批只补 UI。

**Tech Stack:** 静态 HTML + Vue3 CDN（`vue.global.prod.js`，含模板编译器）+ Tabler Icons CDN；后端 NestJS 11（不改动）。

---

## 设计

### 缺口盘点（本批 3 个面板 → 后端路由已全存在）

| 面板 | 后端路由（已存在） | UI 现状 |
|---|---|---|
| 封禁处置 | `POST /api/admin/v1/auth/penalties`、`GET /api/admin/v1/auth/penalties/:playerId`、`POST /api/admin/v1/auth/players/:accountId/logout` | 无 |
| 举报处置 | `GET /api/admin/v1/community/reports`、`POST /api/admin/v1/community/reports/:id/handle`、`POST /api/admin/v1/community/players/:playerId/social-cleanup` | 无 |
| 风控回收 | `GET /api/admin/v1/risk/cases`、`POST /api/admin/v1/risk/cases/:id/dispose`、`POST /api/admin/v1/risk/cases/:id/recover`、`POST /api/admin/v1/risk/recover/:rid/rollback`、`POST /api/admin/v1/risk/cases/:id/lock` | 无 |

### 已核实的事实（实现时不要再猜）

- **枚举**：`PenaltyLevel` = `warning|mute|guild_remove|trade_limit|ban`（[enums.ts:325-331](file:///e:/code/nest/packages-game/game-server/src/constants/enums.ts#L325-L331)）；`ReportStatus` = `pending|processed|ignored`、`ReportHandleAction` = `IGNORE|WARN|MUTE|BAN`（**大写**，[enums.ts:736-747](file:///e:/code/nest/packages-game/game-server/src/constants/enums.ts#L736-L747)）；`RiskCaseStatus` = `open|frozen|ignored`（[enums.ts:812-816](file:///e:/code/nest/packages-game/game-server/src/constants/enums.ts#L812-L816)）。
- **DTO 契约**：`ApplyPenaltyDto{ playerId, accountId, level: PenaltyLevel, reason(1-255), durationSeconds?(正整数) }`（[penalty.dto.ts:5-28](file:///e:/code/nest/packages-game/game-server/src/modules/auth/dto/penalty.dto.ts#L5-L28)）；`RiskDisposeDto{ action: RiskCaseStatus, note? }`、`RiskRecoverDto{ note? }`、`RiskLockDto{ level: PenaltyLevel, reason? }`（[risk-admin.dto.ts:5-47](file:///e:/code/nest/packages-game/game-server/src/modules/risk/dto/risk-admin.dto.ts#L5-L47)）。
- **鉴权**：所有 admin 路由统一 `AdminGuard`（[admin.guard.ts:31-74](file:///e:/code/nest/packages-game/game-server/src/common/guards/admin.guard.ts#L31-L74)），前端只需 `Authorization: Bearer <token>`；401 应触发登出。
- **静态托管**：`useStaticAssets(join(__dirname,'..','..','admin'), { prefix:'/admin' })`（[main.ts:115](file:///e:/code/nest/packages-game/game-server/src/main.ts#L115)）→ 生产路径 **`/opt/game-server/admin`，不在 `dist` 内**。改前端**不需要重启服务、也不需要重建 dist**，但 `admin/` 目录必须单独同步（子目录会被一并托管）。
- **现有渲染模式**：侧边栏由 `navItems` 渲染、内容区 `v-show="page === 'xxx'"`（[index.html:187-211](file:///e:/code/nest/packages-game/game-server/admin/index.html#L187-L211)）；列表页参考实现（reactive 状态 + 分页 + loading/empty）在 [index.html:482-572](file:///e:/code/nest/packages-game/game-server/admin/index.html#L482-L572)。`BASE_URL = '/api/admin/v1'`（[index.html:391-465](file:///e:/code/nest/packages-game/game-server/admin/index.html#L391-L465)）。

### 关键设计决策

1. **三层拆分**：`index.html`（框架：登录/布局/导航/内容容器）→ `core.js`（共享层）→ `panels/*.js`（面板）。面板以顺序 `<script src>` 引入，无构建步骤。
2. **面板注册协议**：面板文件挂 `window.XGamePanels['<id>'] = { label, icon, order, component }`；`component` 是标准 Vue 组件定义（`template` 字符串 + `setup()`，依赖 Vue 全量构建的运行时编译器）。框架导航 = 旧 4 项 + 按 `order` 排序的注册表项，内容区用 `<component :is="activeComponent">` 渲染。
3. **旧 4 个面板本次不迁移**（保持内联、逻辑零改动），避免无谓回归；后续可单独迁移。这是「拆多文件」与「最小回归风险」的折中，已确认。
4. **危险动作统一走 `confirmDanger()`**：弹窗必须展示「目标账号/记录 + 将执行的处置 + 影响范围」，**理由必填（≥2 字）**；取消不发请求。理由字段映射：封禁类 → `reason`；风控类（DTO 里只有可选 `note`）→ 复用同一输入框提交为 `note`。
5. **不可逆动作分级提示**：`ban`/`guild_remove` 用红色高危样式并二次强调「不可撤销」，其余处置用普通确认。
6. **渲染安全**：所有玩家可控内容（昵称、举报理由、备注、风控摘要）**一律用 `{{ }}` 文本插值，禁止 `v-html`**，避免管理端 XSS。
7. **不改后端、不新增依赖、不引入构建**；本批**不做**：对账/经济看板/活动灰度 3 个面板、后端权限分级、i18n、移动端响应式优化。
8. **分页/筛选参数**：沿用现有列表页既有命名（实现者需先读 [index.html:482-572](file:///e:/code/nest/packages-game/game-server/admin/index.html#L482-L572) 与对应控制器对齐，不新造约定）。

### 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `admin/index.html` | 修改 | 引入 `core.js` 与 3 个面板脚本；导航改为「旧 4 项 + 注册表」；内容区增加注册表驱动的 `<component :is>` 容器；其余逻辑不动 |
| `admin/core.js` | 创建 | `window.XGameCore`：`api()`（Bearer 注入 + 401 登出 + 错误码/中文消息提取）、`toast()`、`confirmDanger()`（含理由必填校验）、`fmtTime()`、分页状态工厂 |
| `admin/panels/penalties.js` | 创建 | 封禁处置：按玩家/账号查询处置记录 + 施加处置（level/duration/reason）+ 踢下线 |
| `admin/panels/reports.js` | 创建 | 举报处置：举报台账（按状态筛选、分页）+ 处置（IGNORE/WARN/MUTE/BAN + 备注）+ 社交后果补执行 |
| `admin/panels/risk-recover.js` | 创建 | 风控回收：线索列表（按状态筛选、分页）+ 处置（open/frozen/ignored）+ 确认回收 + 回收回滚 + 封禁联动 |

### 完成验收

- 侧边栏出现 3 个新面板，逐个可：列表加载、筛选、翻页、查看详情。
- 每个写动作弹二次确认（显示目标与影响），理由缺失时**前端拦截**且不发出请求；成功后刷新列表 + toast。
- 错误路径有明确中文提示（后端业务错误码透出，不吞错）。
- 现有 4 个面板功能不回归。
- 生产部署后由浏览器子代理点检通过并留证（含一次真实 `warning` 级处置落在冒烟测试账号上，核对 `GET /penalties/:playerId` 记录）。
- 零新增依赖、零构建步骤。

### 测试基线

前端静态页无单测框架，本批**不引入** jest/jsdom（避免新增依赖）——验证靠「生产部署 + 浏览器点检 + 后端记录核对」。后端基线不受影响：**80 suites / 994 tests 全绿**、`npx tsc --noEmit` 0 error。

---

## Tasks

### Task 1：共享层与注册表机制

- [x] 新建 `admin/core.js`，导出 `window.XGameCore`：`api(url, opts)`（复用现有实现语义）、`toast(msg, type)`、`confirmDanger({ title, target, action, impact, danger, onConfirm })`、`fmtTime`、`createPager()`。
- [x] 改 `admin/index.html`：`<script src="core.js">` + 3 个 `panels/*.js` 依次引入；导航项 = 旧 4 项 + `Object.entries(window.XGamePanels)` 按 `order` 排序；内容区保留旧面板 `v-show`，新增注册表驱动的 `<component :is>` 容器。
- [x] 验收：页面可加载（浏览器控制台无报错），旧 4 个面板功能不变（登出、玩家列表分页正常）。

### Task 2：封禁处置面板（`admin/panels/penalties.js`）

- [x] 查询区：输入 `playerId` 或 `accountId` → `GET /api/admin/v1/auth/penalties/:playerId` 展示处置历史（等级/理由/生效时间/到期时间）。
- [x] 施加处置表单：`level` 下拉（5 个枚举值，中文标签）、`durationSeconds`（可选，正整数，仅 `mute`/`trade_limit`/`ban` 显示）、`reason`（1-255）；提交走 `POST /api/admin/v1/auth/penalties`，包在 `confirmDanger` 内（`ban`/`guild_remove` 为高危样式）。
- [x] 踢下线按钮：`POST /api/admin/v1/auth/players/:accountId/logout`，同样二次确认。
- [x] 验收：对冒烟测试账号施加一次 `warning`，列表刷新可见该记录；提交前清空理由应被前端拦截。

### Task 3：举报处置面板（`admin/panels/reports.js`）

- [x] 列表：`GET /api/admin/v1/community/reports`，状态筛选（`pending|processed|ignored`）、分页；列展示举报人/被举报人/类型/理由/时间/状态；理由用文本插值。
- [x] 处置：`POST /api/admin/v1/community/reports/:id/handle`，动作 `IGNORE|WARN|MUTE|BAN`（**提交值用大写**）+ 备注；包在 `confirmDanger` 内（`BAN` 高危）。
- [x] 社交后果补执行：`POST /api/admin/v1/community/players/:playerId/social-cleanup`，二次确认。
- [x] 验收：空列表显示空态；有数据时可筛选、翻页、完成一次处置并刷新状态。

### Task 4：风控回收面板（`admin/panels/risk-recover.js`）

- [x] 列表：`GET /api/admin/v1/risk/cases`，状态筛选（`open|frozen|ignored`）、分页；展示线索等级/状态/涉及玩家/摘要。
- [x] 动作四件套，逐个 `confirmDanger`（回收/回滚为高危）：`dispose`（`action` 取 `RiskCaseStatus`）、`recover`、`recover/:rid/rollback`（`rid` 取自该线索回收记录，需先读接口返回结构）、`lock`（`level: PenaltyLevel` + `reason`）。
- [x] 可逆性提示：回滚动作需在弹窗内显示「原回收记录 id + 影响玩家」。
- [x] 验收：列表/筛选/分页正常；对一条测试线索执行 `dispose`（如 `ignored`）并核对状态变化。

### Task 5：部署与浏览器点检

- [x] 同步：`scp -r admin odoo:/opt/game-server/`（**不重启服务、不重建 dist**）；`ssh odoo curl -sI http://127.0.0.1/admin/` 验 200，并 `curl /admin/core.js`、`/admin/panels/penalties.js` 验 200（证明子目录被托管）。
- [x] 浏览器子代理点检 `https://game.joho.cn/admin`：登录 → 3 个新面板逐个打开 → 列表/筛选/翻页 → 打开任一写动作确认框（校验理由必填拦截）→ 执行 Task 2 的 `warning` 处置并用后端记录核对。
- [x] 留证：截图或逐条 PASS/FAIL 文字记录；失败项修完重跑。
- [x] 回滚预案：`admin/` 旧文件备份在服务器（`cp -r admin admin_bak_<时间戳>`），异常时还原旧目录即可，不涉及服务重启。

---

## 风险与已知限制

1. **管理端 XSS**：面板渲染玩家可控文本，必须文本插值；Code Review 时逐处检查有无 `v-html`。
2. **`admin/` 不在 dist 内**：部署脚本若只同步 dist 会漏掉本次改动——部署清单里必须显式包含 `admin/`。
3. **`recover/:rid/rollback` 的 `rid` 来源**未在盘点中确认，Task 4 需先读控制器/DTO 再定 UI（不允许猜字段）。
4. **高危动作不可逆**：`ban`/`guild_remove` 无解封路由（盘点未见），点检时只用 `warning` 级，避免污染真实账号。
5. **空数据面板**：若生产 `risk_cases` / `community_reports` 为空，写动作无法端到端验证，将如实记录为「仅空态验收」。

---

## 执行记录（2026-09-21）

**产物**：`admin/core.js`（新建，共享层）、`admin/panels/{penalties,reports,risk-recover}.js`（新建）、`admin/index.html`（改：引入 4 个脚本、导航=旧 4 项+注册表、内容区 `<component :is="activePanel">`、新增确认框/toast/面板通用样式）。后端零改动、零新增依赖、零构建步骤。

**部署**：服务器备份 `admin_bak_20260921_132605` → `scp -r admin odoo:/opt/game-server/`；**未重启服务、未重建 dist**；`curl` 验证 `/admin/`、`/admin/core.js`、`/admin/panels/*.js` 全部 200。

**浏览器点检（生产 https://game.joho.cn/admin，PASS 12/12）**：
- 登录后侧边栏 7 项（旧 4 + 新 3）；封禁处置查询玩家 62 命中既有「禁言」记录；
- 施加处置：理由留空点「确认执行」被前端拦截（红字「请填写操作理由（至少 2 个字）」且弹框不关闭，未发请求）；补理由后成功；
- 举报处置：1 条已处理记录正常渲染 + 分页文案 + 状态筛选「待处理」正确显示空态；
- 风控回收：2 条线索 → 状态筛选「待处置」剩 1 条 → 「回收建议」返回只读建议额 → 「忽略线索」同样是理由必填拦截 + 成功后状态刷新为「已忽略」；
- 旧 4 面板回归：玩家管理分页（118 条 / 6 页，翻页正常）、操作日志（25 条）、仪表盘 3 卡片均正常；
- 控制台无 JS 运行时报错（仅 HTTPS 证书类网络告警与 harness 的 MaxListeners 警告）。

**生产真实写入核对（后端记录）**：
- `account_penalties` id=4：`player_id=1 / account_id=1 / level=warning / reason=「P0-8 面板点检验证」/ created_by=admin`；
- `risk_cases` id=2：`status=ignored / handled_by=admin / detail_json.note=「P0-8 点检忽略线索」`。

**实现中对计划的偏离（均已落地，不含后端改动）**：
1. `core.js` 未实现 `createPager()`：3 个面板分别用后端分页（reports）与固定 limit（risk），无复用点，按「不做冗余抽象」省略。
2. 风控线索列表**无分页**：后端 `GET /risk/cases` 固定 `take=50` 且无 total，面板改为「状态 + 类型」筛选并在空态注明最多 50 条，未做假分页。
3. `recover/:rid/rollback` 的 `rid` 来源：后端无「回收记录列表」接口（仅 `recover` 返回记录实体）。UI 采用「本页确认回收后行内直接出现回滚按钮（rid 取自返回值）」+「手工回滚」卡片输入 rid（跨会话），未扩展后端路由。
4. 举报处置的**写动作未能端到端验证**：生产 `player_reports` 仅 1 条且已是 `processed`（面板按设计只对 `pending` 显示处置按钮），未新建测试举报数据；已验证列表/筛选/空态与确认框拦截。
5. 生产 `risk_cases` 存在 legacy `case_type='wash'`（不在 `RiskCaseType` 枚举内，源码已无写入路径）；类型筛选只覆盖枚举 3 值，wash 行在「全部」下可见。
6. 新增「社交后果补执行」「手工回滚」两个前台入口（计划已列 T3/T4 动作，此处记录为一级卡片，均为二次确认 + 理由必填）。