# LayaAir 2D 微信小游戏适配 S7 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（沿用 S2/S3/S4 的既定方式）。

**Goal:** 把客户端从「只能跑 H5」变成**双端出包**：补齐平台适配层（存储 / http / WS / UI / 登录），打通小游戏端「登录 → 进场景 → 移动 → 交互 → 对话」闭环，并建立**可重复执行的双端发布流程**；同时结清 S1 遗留的 **#8 BLOCKED**（小游戏端验收）。

**Architecture:** 唯一出口是 `src/platform/Platform.ts`（业务代码零 `wx`/`document` 触达）→ 三个域扩展：**存储**（`wx.setStorageSync`）、**网络**（`wx.request` + `wx.connectSocket` 适配 socket.io）、**UI**（引擎内自绘，禁用 DOM）→ 配置包随包分发（小游戏无 `fetch`，沿用 S2 的 `readLocalText` 分支）→ `tools/publish.mjs` 一键产出/同步双端产物。

---

## 0. 执行前必读（硬约束）

1. **不准碰 vendure**；2G 服务器（odoo, 39.106.99.9，game.joho.cn）**禁止构建**，构建本地完成、只上传产物。
2. **不新增依赖**（含小游戏端）：socket.io 继续用已 vendored 的 UMD；不得引入 `weapp-adapter`、`miniprogram-*` 等新包。
3. **不改后端契约**：本批**默认零后端改动**（若选 `wx.login` 路线才需新增接口，见 §4 待确认 1）。
4. **UI 必须引擎内自绘**：小游戏无 DOM，`Platform.toast`/登录页不得再依赖 `document`（沿用 S3 的「引擎内自绘 UI」决策）。
5. **不改 H5 既有行为**：所有平台分支必须保持 H5 路径与 S1/S2 验收一致（H5 回归是门禁）。
6. 全部提交遵守 commitlint，单次提交聚焦一个任务。

---

## 1. 设计

### 1.1 缺口盘点

| # | 缺口 | 现状（已核实） | S7 处置 |
|---|---|---|---|
| 1 | 存储在小游戏端**静默失效** | [Platform.ts:10-23](file:///e:/code/nest/packages-game/game-client/src/platform/Platform.ts#L10-L23) 只认 `localStorage`，无 `wx` 分支 → 小游戏端 `storageGet` 恒 `null`、`storageSet` 无操作 | 加 `wx.setStorageSync/getStorageSync` 分支 |
| 2 | HTTP 走 `fetch` | [http.ts:22-40](file:///e:/code/nest/packages-game/game-client/src/net/http.ts#L22-L40) 直接 `fetch(...)`，小游戏无 `fetch` | 改走 `Platform.request`（H5=`fetch` / wx=`wx.request`） |
| 3 | WS 走 socket.io 浏览器实现 | [ws.ts:29-33](file:///e:/code/nest/packages-game/game-client/src/net/ws.ts#L29-L33) `io(wsUrl,{transports:['websocket'],query:{token}})` | 保持 socket.io，注入 `wx.connectSocket` 的 WebSocket 适配（**需实测**，见 Task 2） |
| 4 | 登录页依赖 DOM | [Platform.ts:59-104](file:///e:/code/nest/packages-game/game-client/src/platform/Platform.ts#L59-L104) `showLoginForm` 在无 `document` 时**直接抛错** | 引擎内自绘登录页 |
| 5 | toast 小游戏端只有 console | [Platform.ts:40-57](file:///e:/code/nest/packages-game/game-client/src/platform/Platform.ts#L40-L57) 无 `document` → `console.log` | 引擎内自绘提示条（S3 `Hud` 复用；未就绪则本批自绘最小版） |
| 6 | 配置包依赖 `fetch` | S2 已为小游戏预留 `Platform.readLocalText` 分支（[Platform.ts:29-38](file:///e:/code/nest/packages-game/game-client/src/platform/Platform.ts#L29-L38)） | 打包脚本把 `gamedata/` 复制为 `wxgame/config/`，并做 hash 一致性校验 |
| 7 | 无 wxgame 产物 | `release/` 下只有 `web/`（已核实），CLI 导出不可行 | GUI 导出（人工）+ 脚本补齐 config/ 与包体检查 |
| 8 | 地址硬编码 localhost | [AppConfig.ts:5-7](file:///e:/code/nest/packages-game/game-client/src/config/AppConfig.ts#L5-L7) `apiBase/wsUrl` 为 `http://localhost:3000`，无环境切换 | 引入 `ENV` 常量 + 构建期替换（不改依赖：用脚本注入） |
| 9 | 证书链告警 | 总纲 §11.2：`https://game.joho.cn` 浏览器实测 `ERR_CERT_AUTHORITY_INVALID` | 运维修复（补中间证书）+ `wss` 验证 |
| 10 | 无发布脚本 | `tools/` 只有 assemble/build-fallback/serve/check-config | 新增 `tools/publish.mjs` 双端发布 |

### 1.2 已核实的事实（实现时不要再猜）

**平台层现状**：`Platform` 当前只有 `isMiniGame()` / `storageGet|Set|Remove` / `readLocalText` / `toast` / `showLoginForm` / `hideLoginForm`（[Platform.ts](file:///e:/code/nest/packages-game/game-client/src/platform/Platform.ts)），文件头注释已写明「平台差异唯一出口：业务代码不得直接访问 document / localStorage / wx；S1 只实现 H5 分支；微信小游戏分支在 S7 补齐」——**S7 就是兑现这条注释**。

**构建与产物（已核实）**
- `tools/assemble.mjs`：从 LayaAir IDE 安装目录装配工程壳（模板文件 + 引擎类型声明 `src/types/laya.d.ts` + vendored socket.io UMD + `game-client.laya` + 写 `settings/BuildSettings.json`）。
- `tools/build-fallback.mjs`：借用**后端已有 tsc** 把 `src/` 编译到 `bin/js/`，以 `bin/index.html` 为 H5 入口（S1 的验收路径，不依赖 IDE）。
- `tools/serve.mjs`：`:5173` 静态服务，`/libs/` 指向 IDE 引擎目录；S2 起 `/gamedata` 反代 `:3000`。
- `release/web/` 由 **IDE GUI 手动构建**产出（含 `js/index.js`、`libs/laya.core.js|laya.webgl_2D.js|laya.ui2.js`、`fileconfig.json`）。
- H5 可用性依赖两件发布期契约：引擎脚本**顺序固定** `laya.core.js → laya.webgl_2D.js → laya.ui2.js`；`Laya.PlayerConfig` 必须在 init 前注入（`bin/js/player-config.js`）——小游戏端**同样需要**（wxgame 产物由 IDE 生成时自带，需在验收中确认）。

**#8 现状原文（[README.md:129-149](file:///e:/code/nest/packages-game/game-client/README.md#L129-L149)）**：CLI 导出报 `login failed Error: Interactive account login is unavailable in CLI mode.` + `unknown script 'Build.buildWxgame'` → **必须人工 GUI 导出**；人工步骤 4 步（IDE 导出 → 复制 `assets/config` → 开发者工具导入 → `wx.request` 验 `/health`）。S7 完成后需把该行由 **BLOCKED 改为 PASS**。

**登录链路**：`POST /api/client/v1/auth/login`（S1 用账号密码，含自动注册；`deviceId` 是必传字段，[AppConfig.ts:20-21](file:///e:/code/nest/packages-game/game-client/src/config/AppConfig.ts#L20-L21)）。

**运维事实**：game.joho.cn 部署在 **odoo 服务器 39.106.99.9**（`/opt/game-server`，systemd `game-server`，OpenResty 反代 `/` 到 node，静态站点目录 `/opt/1panel/apps/openresty/openresty/www/sites/game.joho.cn/`）；2G 内存，**禁止构建**。

### 1.3 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **`Platform` 扩展为 5 域**：`storage`（wx 分支）、`request`、`socket`（WS 适配）、`ui`（提示/登录，引擎内）、`env`（地址解析） | 业务代码零平台判断；小游戏适配集中在 1 个文件 |
| D2 | **保留 socket.io**，小游戏端注入 WebSocket 适配（`wx.connectSocket` → 兼容 `WebSocket` 子集） | 改后端 WS 实现=动既有契约（S1 已验证的双端互见）；适配层风险局限在客户端 |
| D3 | **配置包随包分发**（不请求网络）：`gamedata/scene-*.json` + `manifest.json` 复制进 wxgame 包 `config/` | 小游戏无 `fetch`；S2 已实现 `readLocalText` 分支；顺带降低首屏（不走网络） |
| D4 | **登录先走引擎内账号密码表单**（零后端改动）；`wx.login` 路线后置 | `wx.login` 需 AppID+secret+后端 `code2session` 接口，属新契约；本批先打通「同一套账号体系双端可登」 |
| D5 | **构建期注入环境**：`tools/inject-env.mjs` 按 `--env dev|prod` 生成 `AppConfig` 覆盖文件（`apiBase=https://game.joho.cn`、`wsUrl=wss://game.joho.cn/game`） | 不改依赖、不引入打包器；产物可复现 |
| D6 | **证书链修复作为 S7 的硬前置**（Task 5），修复前不做小游戏端 WS 验收 | 总纲 §11.2 已列为前置条件；wx 对证书严格，链不全会直接连不上 |
| D7 | **本批不做真分包**（`subpackages`） | 无美术资源，当前包体远低于上限；虚分包是空转。只保证「config/ 独立目录」便于将来搬运 |
| D8 | **`publish.mjs` 统一双端发布**：H5 产物与 gamedata 同步到 OpenResty 站点目录；wxgame 产物由 GUI 生成后由脚本补齐 config/ 并检查包体 | 把 S1 的人工 4 步压缩为「GUI 导出 + 1 条命令」 |

### 1.4 文件结构

**修改（客户端 `packages-game/game-client/`）**

| 路径 | 动作 |
|---|---|
| `src/platform/Platform.ts` | 扩 5 域；`isMiniGame` 判定保留；删除 `showLoginForm/hideLoginForm` 的 DOM 实现（改为引擎内 UI 调用） |
| `src/platform/wx-socket.ts` | **新增**：`wx.connectSocket` → WebSocket 兼容适配（onopen/onmessage/onclose/onerror/send/close） |
| `src/net/http.ts` | `fetch` → `Platform.request`（返回体解析、`ApiError` 语义不变） |
| `src/net/ws.ts` | 连接前若 `Platform.isMiniGame()` 则注入适配；URL 由 `AppConfig.wsUrl`（prod=`wss://`） |
| `src/ui/Hud.ts` | **新增/扩展**：引擎内自绘提示条（替代 `Platform.toast` 的 DOM 实现） |
| `src/ui/LoginView.ts` | **新增**：引擎内自绘登录页（账号/密码/提交/错误行；无 DOM） |
| `src/boot/Boot.ts` / `Main.ts` | 入口分支：H5 用 DOM 表单、小游戏用 `LoginView`（统一走 `Platform.ui.showLogin`） |
| `src/config/AppConfig.ts` | 保留默认值（dev），新增 `ENV` 覆盖入口（由 `js/env-config.js` 在入口页先于 bundle 加载注入） |
| `tools/inject-env.mjs` | **新增**：生成 env 覆盖文件 + 打印生效地址 |
| `tools/publish.mjs` | **新增**：双端发布（H5 + gamedata 上传；wxgame 校验与 config 补齐） |
| `tools/check-package.mjs` | **新增**：包体与关键文件检查（主包大小、`config/manifest.json` 存在、引擎 3 脚本顺序） |
| `README.md` | 更新 S1 验收表（#8 → PASS）+ 双端发布步骤 |

**新增（产物约定，不入库）**

| 路径 | 说明 |
|---|---|
| `release/wxgame/` | GUI 导出产物（`.gitignore`） |
| `release/wxgame/config/` | 由 `publish.mjs` 从 `game-server/gamedata/` 复制 |

### 1.5 验收映射

| # | 验收项 | 判定方式 |
|---|---|---|
| A1 | H5 不回归 | `node tools/build-fallback.mjs` + `node scripts/smoke-laya2d-s1.mjs` → 9/9 PASS |
| A2 | 平台层无越界 | `grep -n 'document\|localStorage\|wx\.' src/ --include=*.ts` 的命中**只在 `src/platform/**`**（引擎目录除外） |
| A3 | 小游戏端登录 | 开发者工具 Console 出现 `[S7] 登录成功 playerId=…`（无 DOM 表单） |
| A4 | 小游戏端进场景 | 出现 `[S7] 静态层渲染完成…` 与 `进场景应答 cmd=world.enter_scene_sync` |
| A5 | 小游戏端移动与互见 | 开发者工具本地起两个实例（或 H5 + 小游戏各一）互相看到移动 |
| A6 | 小游戏端交互/对话 | 采集成功 + 对话视图出现并可选择分支（验证引擎内 UI 无 DOM） |
| A7 | 配置包来自包内 | 断网（关闭网络代理）仍能进场景（说明没走 `fetch`） |
| A8 | 证书链与 `wss` | `curl -v https://game.joho.cn/health` 无证书告警；小游戏端 WS 连接成功（非 `wss` 失败） |
| A9 | 双端发布可重复 | `node tools/publish.mjs --env prod` 连续两次结果一致；`check-package.mjs` 通过 |
| A10 | S1 #8 结清 | `README.md` 验收表 #8 由 BLOCKED 改 PASS + 证据 |

### 1.6 测试基线

- **H5 回归**：`scripts/smoke-laya2d-s1.mjs` 9/9 PASS（门禁，每 Task 后跑）。
- **纯逻辑断言**：`scripts/smoke-platform-s7.mjs`（零依赖 node）——断言「平台层方法在小游戏模拟环境（注入假 `wx` + 删 `document`）下不抛错」：假 `wx` 需实现 `getFileSystemManager/setStorageSync/getStorageSync/request/connectSocket`。
- **小游戏端**：微信开发者工具人工验收（§1.5 A3–A7），无自动化框架（不引入新依赖）。
- **后端**：本批**不改后端**，`npm test` 仅作回归确认（≥998）。

### 1.7 已知限制（S7 明确不覆盖）

1. **不做真机验收**（无 AppID）：只保证开发者工具闭环；真机与正式 AppID 属发布批次。
2. 不做 `wx.login` 静默登录（D4）。
3. 不做真分包（D7）、不做音频/字体适配（无素材）。
4. 不做微信支付/分享/排行榜（属后续运营批次）。
5. 不做包体极致压缩（当前无美术，压缩无标的）。

---

## 2. Tasks

> 客户端 cwd = `e:\code\nest\packages-game\game-client`；后端 cwd = `e:\code\nest\packages-game\game-server`。

### Task 1: 平台层扩展（storage / ui / env 三域，不含网络）

- [ ] **Step 1** `Platform.storageGet/Set/Remove`：小游戏分支走 `wx.getStorageSync/setStorageSync/removeStorageSync`（**保留 localStorage 分支**）。
- [ ] **Step 2** `Platform.ui.toast(text)`：优先调用 `Hud`（引擎内），无 `Hud` 时降级 `console`；**删除 DOM 实现**依赖（`#s1-toast` 保留给 H5 亦可，但必须不影响小游戏）。
- [ ] **Step 3** `Platform.env`：`apiBase/wsUrl` 读取优先级 `全局注入(window/wx 上的 __ENV__)` → `AppConfig` 默认（dev）。
- [ ] **Step 4** `scripts/smoke-platform-s7.mjs`：注入假 `wx`、删 `document` 后调用全部 Platform 方法 → Expected：全 PASS、无抛出。
- [ ] **Step 5** H5 回归：`node tools/build-fallback.mjs` + `node scripts/smoke-laya2d-s1.mjs` → 9/9 PASS。
- [ ] **Step 6** commit：`feat(game-client): 平台层存储/UI/环境三域适配`

### Task 2: 网络层双端适配（HTTP + WS）

- [ ] **Step 1** `Platform.request(opts)`：H5=`fetch`、wx=`wx.request`（统一成 `{status, text}` 返回，`http.ts` 的 `ApiError` 语义不变）。
- [ ] **Step 2** `src/platform/wx-socket.ts`：把 `wx.connectSocket` 包成 WebSocket 兼容对象（`readyState/onopen/onmessage/onclose/onerror/send/close`；`message` 的 `data` 字符串直接透传）。
- [ ] **Step 3** `ws.ts` 连接前：`if (Platform.isMiniGame()) globalThis.WebSocket = createWxWebSocket()`，其余逻辑（`io(..., {transports:['websocket']})`、seq/pending、`expectAck=false`）**零改动**。
- [ ] **Step 4** 手工验证（**关键风险点**）：微信开发者工具 Console 执行 `wx.connectSocket` 连接 `ws://localhost:3000/game?token=<t>`，确认 socket.io 握手成功（开发者工具需勾「不校验合法域名」）。若 socket.io 客户端在 wx 环境仍失败 → 触发 §3 风险 2 的回退。
- [ ] **Step 5** H5 回归（9/9 PASS）+ 小游戏端 HTTP 连通（`/health` 200）。
- [ ] **Step 6** commit：`feat(game-client): HTTP 与 WebSocket 平台适配`

### Task 3: 引擎内登录页（无 DOM）

- [ ] **Step 1** `src/ui/LoginView.ts`：引擎内自绘（标题/账号输入/密码输入/登录按钮/错误行）；键盘输入依赖 Laya 键盘事件（**已知限制**：小游戏无物理键盘 → 使用 `wx.showKeyboard`/`Laya` 输入弹窗；实现时优先试 `Laya` 原生输入，失败则用 `wx.showKeyboard`）。
- [ ] **Step 2** `Platform.ui.showLogin(handlers)`：H5 走 DOM 表单（现状保留）、小游戏走 `LoginView`。
- [ ] **Step 3** `Boot`/`Main` 改为只调 `Platform.ui.showLogin`，不再直接触达 DOM。
- [ ] **Step 4** 手工验证：小游戏端出现可输入登录页，登录成功进入场景；H5 端表单行为不变。
- [ ] **Step 5** commit：`feat(game-client): 引擎内登录页，移除小游戏端 DOM 依赖`

### Task 4: 配置包随包分发 + 打包脚本

- [ ] **Step 1** `tools/publish.mjs`（子命令 `h5` / `wxgame-config`）：把 `game-server/gamedata/manifest.json` 与全部 `scene-*-v*.json`（**只复制 manifest 指向的版本**）复制到目标目录。
- [ ] **Step 2** 一致性校验：复制后**重算文件 sha256**，与 manifest 的 `hash` 对比，不一致直接 exit 1（沿用 S2 的 hash 双层语义，不得混用）。
- [ ] **Step 3** 小游戏端 loader 分支确认：`ConfigLoader` 在小游戏端读 `config/manifest.json` + `config/scene-*.json`（S2 已实现的 `readLocalText` 分支），**不发起网络请求**。
- [ ] **Step 4** 手工验证：开发者工具中断开网络（或把 `apiBase` 指到不可达地址仅测配置包路径）→ 静态层仍渲染（A7）。
- [ ] **Step 5** commit：`feat(game-client): 配置包随包分发与校验脚本`

### Task 5: 证书链修复 + `wss` + 生产部署（硬前置）

- [ ] **Step 1** 诊断：`openssl s_client -showcerts -connect game.joho.cn:443 -servername game.joho.cn` 确认是否缺中间证书（预期：链不完整）。
- [ ] **Step 2** 在 **odoo 服务器**（39.106.99.9）的 1Panel/OpenResty 证书配置中补全 `fullchain`（**只改证书文件与 nginx 证书指令，不改反代规则**）；重载 OpenResty。
- [ ] **Step 3** 验证：`curl -v https://game.joho.cn/health` 无 `unable to verify` 告警；浏览器无 `ERR_CERT_AUTHORITY_INVALID`。
- [ ] **Step 4** `wss` 验证：`https://game.joho.cn` 下 WS 连接成功（浏览器 H5 页面用 prod 地址跑通「进场景 + 互见」）。
- [ ] **Step 5** H5 产物与环境变量发布：`node tools/inject-env.mjs --env prod` → `publish.mjs h5 --env prod`（上传 `bin/` 与 `gamedata/` 到站点目录；**服务器零构建**）。
- [ ] **Step 6** commit（脚本/文档）：`chore(game-client): 生产环境注入与 h5 发布脚本`

### Task 6: 双端发布与包体检查

- [ ] **Step 1** `tools/check-package.mjs`：检查（a）主包大小 ≤ 4MB、（b）`config/manifest.json` 与对应场景文件存在且 hash 匹配、（c）入口页引擎脚本顺序为 `laya.core.js → laya.webgl_2D.js → laya.ui2.js`、（d）`js/player-config.js` 在 init 前加载。
- [ ] **Step 2** `publish.mjs wxgame`：对 GUI 导出的 `release/wxgame/` 执行「补齐 config/ + 注入 env + 跑 check-package」。
- [ ] **Step 3** 记录 GUI 手工步骤（**不可自动化**，S1 已实证 CLI 不可用）：IDE 打开工程 → 构建/发布 → 微信小游戏 → 记录产物目录。
- [ ] **Step 4** 连续执行两次 `publish.mjs`，产物文件清单与 hash 一致（A9）。
- [ ] **Step 5** commit：`feat(game-client): 双端发布脚本与包体检查`

### Task 7: 小游戏端验收 + S1 #8 结清

- [ ] **Step 1** 微信开发者工具导入 `release/wxgame/`（测试号 AppID，勾「不校验合法域名」）→ 逐项验收 A3–A7，把 Console 证据贴进 README。
- [ ] **Step 2** 双端互见：H5 窗口 + 开发者工具各一个客户端，互见移动（A5）。
- [ ] **Step 3** 更新 `README.md`：S1 验收表 **#8 由 BLOCKED 改 PASS**（附证据）+ 新增「S7 双端适配」小节（发布命令、包体、已知限制）。
- [ ] **Step 4** 回归：`npm test`（后端 ≥998）+ `smoke-laya2d-s1.mjs` 9/9 + `smoke-platform-s7.mjs` 全 PASS。
- [ ] **Step 5** commit：`docs(game-client): S7 双端验收记录，#8 转为 PASS`

---

## 3. 风险与回退

| # | 风险 | 触发信号 | 回退动作 |
|---|---|---|---|
| 1 | **socket.io 在 wx 环境握不上手**（本批最大不确定性） | Task 2 Step 4 失败 | 回退 1：换 `weapp-adapter` 式最小 shim（**不得引入新依赖**，需手写 WebSocket/`navigator`/`location` 兜底）；回退 2：小游戏端改用**原生 `wx.connectSocket` + 自写极简帧协议**（需后端加一个 WS 适配层，属契约变更 → 必须单独确认后再做） |
| 2 | 小游戏无键盘 → 登录输入不可用 | Task 3 无法输入账号 | 用 `wx.showKeyboard`（官方 API，零依赖）承接输入；H5 不受影响 |
| 3 | 证书链修复影响线上其他站点 | 改证书后其他域名告警 | 只改本站点证书指令；改动前备份 nginx conf 与证书文件，失败即刻还原 |
| 4 | 配置包 hash 校验失败 | 小游戏端「哈希校验失败」 | 复制后**重算比对**（Task 4 Step 2）兜住；两端算法仍遵循 S2 §1.2 的 D4 |
| 5 | H5 行为被平台分支破坏 | `smoke-laya2d-s1.mjs` FAIL | 每个 Task 后强制跑 H5 冒烟；平台分支必须 `isMiniGame()` 前置判断 |
| 6 | 包体超限（主包 > 4MB） | `check-package.mjs` FAIL | 先查是否把 `release/web/libs` 混进小游戏包（应使用 IDE 生成的 wxgame 引擎文件） |
| 7 | 误在 odoo 上构建 | 服务器负载飙升/SSH 卡死 | 发布脚本**只允许**上传与重载；禁止在脚本里出现 `npm run build`（代码评审时检查） |
| 8 | GUI 导出步骤被遗忘导致 `wxgame/` 陈旧 | 验收现象与代码不符 | `check-package.mjs` 比对产物时间戳与 `src/` 最近提交时间，陈旧即告警 |

---

## 4. 待确认项（动手前请回答；无异议则按【默认】执行）

1. **小游戏登录方式**：【默认：引擎内账号密码表单（零后端改动）】——是否需要本批做 `wx.login`（`code2session`）？若需要，请确认已有 **AppID + AppSecret**（否则后端无法兑换 openid，只能延后）。
2. **证书链修复授权**：允许我按 Task 5 在 **odoo 服务器（39.106.99.9）** 修改 game.joho.cn 的证书文件与 OpenResty 证书指令（仅本站点、改动前备份）？【默认：是】
3. **验收口径**：【默认：微信开发者工具闭环（无真机）】——是否需要真机验收（需正式 AppID 与已备案域名白名单）？
4. **兜底路线预案**：若 socket.io 在 wx 环境失败且手写 shim 也不通，是否允许走「小游戏端原生 `wx.connectSocket` + 后端新增 WS 适配层」（会动后端契约）？【默认：**先不允许**，遇到再单独确认】。
5. **本批是否上线生产**（H5 产物 + 证书修复）？【默认：是（Task 5 执行）】。

---

## 5. 执行方式

沿用 **Subagent-Driven**：每 Task 派新 subagent，Task 间两阶段评审（先 diff 后验收），每 Task 后跑 H5 冒烟作回归门禁（S7 的 H5 回归必须每 Task 都跑）。

任务依赖：Task 1 → Task 2 →（Task 4 可与 Task 2/3 并行）→ Task 3 → Task 5 → Task 6 → Task 7。
若 Task 2 触发风险 1，**立即停下向用户确认**（不擅自改后端契约）。