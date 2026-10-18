# 财商沙盘（financial-sandbox）

3D 理财体验型财商教育小游戏：用 2022-01-01 ~ 2026-07-01 的历史回放行情，驱动「存款 / 现金理财 / 封闭理财 / 基金」四类资产的买入赎回，60 个自然日一局，走完自动出结算成绩单。

> ⚠ 本沙盘仅财商教育演示，历史回放数据不等于未来收益，不构成投资建议。

## 启动

```bash
cd nest/packages-game/game-server/sandbox
npm install          # three + vite + typescript
npm run server       # 排行榜后端 http://localhost:8787
npm run dev          # http://localhost:5173（/api 已代理到后端）
                     # 同时监听所有网卡，启动后还会打印 Network: http://<本机IP>:5173
                     # 在 IDE / 远程 / 容器环境下，用 Network 地址（而非 localhost）才能从外部浏览器访问
npm run build        # 产物 dist/
npm run test:server  # 排行榜后端本地 HTTP 单测（无需浏览器/构建，快速定位后端问题）
npm run check        # typecheck + 核心冒烟 + 后端单测 + build + 页面冒烟
```

> 开发时先 `npm run server` 启动排行榜后端，`npm run dev` 的 `/api` 会自动代理到 `localhost:8787`。`npm run check` 会自动拉起临时后端，无需手动启动。后端逻辑另有 `server/leaderboard-server.test.mjs` 纯 Node 单测（`npm run test:server`），比 `page:check` 更轻、更快定位问题。

单独校验：

| 命令 | 说明 |
|---|---|
| `npm run typecheck` | `tsc --noEmit`，全量 TS 严格模式 |
| `npm run smoke` | 核心层无头冒烟（不依赖 DOM / three），152 项 |
| `npm run page:check` | 构建 + `vite preview` + Playwright 页面冒烟，94 项，截图 `shots/page-check.png`（桌面）+ `page-check-mobile.png`（390×844 竖屏） |

## URL 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `seed` | `20260101` | 行情随机种子，**同种子行情完全可复现**，适合课堂对照 |
| `speed` | `3` | 速度倍率 0.5~10，页面上 1x / 3x / 5x 可切换 |
| `level` | `balanced` | 难度档位 `conservative` / `balanced` / `aggressive`，影响任务卡阈值与点评；首次引导里也可选，选定后写回 URL 与存档 |
| `scenario` | `standard` | 行情情景 `standard`(60天) / `long`(120天) / `mid`(2023-06起) / `recent`(2025-06起)，决定回放起点与天数上限；首次引导里也可选，写回 URL |
| `dca` | 关 | 定投计划：`on`（默认基金 ¥2,000 / 每 5 交易日）或 `金额:间隔:资产`（如 `1000:3:fund`）；也可用操作条「定投」按钮开关 |

例：`http://localhost:5173/?seed=42&speed=5&level=aggressive&scenario=long`

## 玩法

- 期初本金 ¥100,000 = 现金 2 万 + 四类资产各 2 万；总资产、总收益率实时显示在顶部。
- 右侧面板：选资产 → 填金额（或点 5 千 / 1 万 / 5 万 / **全部**）→ 买入 / 赎回。买入/赎回按钮标签随资产变化（存款=存入/取出，理财=申购/赎回，基金=买入/卖出），封闭期内赎回按钮禁用。
- **键盘快捷键**（输入框/按钮聚焦或浮层打开时不拦截）：`1`~`4` 选资产、`B` 买入、`S` 赎回、`空格` 暂停/继续、`Esc` 关成绩单、`?` 打开玩法说明。
- 金额超过现金时自动**夹取为全部现金**并提示，不会“点了没反应”。
- **定投计划**：操作条「定投」按钮开关（默认基金 ¥2,000 / 每 5 个交易日），每到期日在收盘后自动扣款买入并记流水，现金不足则跳过本期——用来体会“定期定额、平滑波动”。成绩单显示定投扣款次数。
- 时间轴：每个交易日 52 个切片（对应盘内 5 分钟/切片），休市日（周末 + 元旦/春节/五一/国庆）自动跳过，切片可能临时停牌（停牌时段禁止交易）。
- 计息口径：**按日**计息——存款年化 1.75%、现金理财 ~2.5%（每日浮动）、封闭理财 3.8% 锁定 90 个交易日（到期自动兑付到现金，未到期不可赎回）、基金随行情净值波动。
- 顶部左上为总资产曲线（实线为实际，叠加**全存款 / 全基金**两条策略基准虚线与图例，并用绿▲/红▼**标注你的买卖点**，一眼看出是否“高买低卖”），左下为最近 5 条操作流水，底部左侧为**资产配置饼图**（现金/存款/现金理财/封闭理财/基金占比环形，桌面端），右侧为四类资产 + 现金的市值、收益率与**迷你走势曲线**（末值≥首值绿、否则红）。
- **资产百科**：点击底部资产名旁的 "?"（存款/现金理财/封闭理财/基金）弹出知识卡，讲解它是什么、风险/收益/流动性与财商要点；`Esc` 或点遮罩/× 关闭。
- 60 个自然日走完自动弹出**结算成绩单**：期末总资产、总收益率、年化收益、最大回撤、资产明细、综合评级（A~D）与点评、**市场环境点评**（亏损市/高波动市/震荡市/低波动慢牛 + 财商建议）、**教学目标达成 n/7**、**“全额存存款”基准对比**、**行为点评**（交易频率/集中度/定投习惯/回撤/是否跑赢存款）、**对比历史最佳**（收益率/回撤/教学目标的百分点差）、**多局成长轨迹**（近局收益率走势 + 平均/最佳收益，跨局留存看进步），可「再来一局」重置，也可**导出复盘 CSV**（成绩单 + 收益归因 + 存款基准 + 行为点评 + 完整交易流水，文件名含种子与情景）。
- **教学目标任务卡**（左上曲线图下方，可收起）：分散配置 / 控制权益仓位 / 留足流动性 / 走完封闭期 / 守住回撤 / 认识停牌 / 稳健增值，每张卡带进度条与财商教学点，达成时 toast 提示。**阈值随难度档位变化**（如控制权益仓位：保守 ≤35% / 稳健 ≤40% / 进取 ≤50%）。
- **新手引导**：首次进入弹出四步引导 + 难度选择 + 行情情景选择（localStorage 记忆，`sandbox:intro-seen`）。控制面板「玩法说明」可随时重看（`force` 模式，不重选难度、点「知道了」仅关闭）。
- **行情情景**：`standard`(60天) / `long`(120天) / `mid`(2023-06 起) / `recent`(2025-06 起)，决定回放起点与天数上限，可在引导里选或 `?scenario=` 指定；`standard` 的天数动态跟随 `GameConfig.PLAY_DAYS`。
- **实时财商干预**（`src/core/Advisor.ts`）：演练中对偏离目标的配置即时给出教学提示——权益仓位 ≥60%、可动用资金 ≤10%、单一资产 ≥70% 触发 ⚠ 风控告警，基金单日跌超 3% 给出低吸知识点，配置均衡时给正向提示。**每条一局只提示一次**（去重），告警以红色 toast 呈现。
- **真实 UI 巡览**：引导卡片的「📍 带我逛逛」会用聚光灯高亮操作区 / 任务卡 / 资产面板并配文字说明（`.tour-overlay` / `.tour-spot`），可上一步/下一步/跳过。
- 控制面板含「复制课堂链接」：把当前难度/情景/定投同步到 URL 并复制到剪贴板（失败回退为显示链接），市场种子固定（`DEFAULT_SEED`），故分享链接可让同学玩到**同一局行情**，适合课堂教学。
- 调试出口：`window.__sandbox`（`game` / `invest` / `redeem` / `setSpeed` / `pause` / `resume` / `summary` / `level` / `setLevel` / `scenario` / `dca` / `setDca` / `evaluateAdvisor` / `adviceTriggered` / `exportReplay` / `tradeMarkers` / `recordRun` / `copyClassroomLink`）。
- 手机竖屏（<720px）自动切底部操作条布局：HUD/曲线/任务面板/资产面板/操作条分五段排布，互不遮挡。

## 目录结构

```
sandbox/
├── index.html                 加载遮罩 + #game-container
├── src/
│   ├── config/GameConfig.ts   常量、类型（AssetHolding / TradeRecord / GameSummary / LEVELS 难度 / SCENARIOS 行情情景 …）
│   ├── core/
│   │   ├── MarketDataLoader.ts  种子化行情生成 + 日历推进
│   │   ├── TimeSliceEngine.ts   52 切片时间轴（速度 / 暂停 / 停止）
│   │   ├── TradingStateMachine.ts 交易阶段流转（idle→pre_open→trading→…）
│   │   ├── MissionSystem.ts   教学任务卡（阈值随难度 createMissions(caps)）
│   │   ├── Advisor.ts         实时财商干预（高风险配置提示，一局去重）
│   │   ├── BehaviorReview.ts  结算行为点评 + 全额存款基准（纯函数）
│   │   ├── Benchmarks.ts      策略基准曲线（全存款/全基金，纯函数）
│   │   ├── TradeMarkers.ts    交易买卖点到曲线的映射（纯函数）
│   │   ├── Allocation.ts       资产配置占比归一化（纯函数）
│   │   ├── ShareLink.ts         课堂分享链接 query 构造（纯函数）
│   │   ├── ProgressStore.ts   本地存档（历史最佳曲线/局数/累计达成/上次难度 + compareToBest）
│   │   ├── ReplayExport.ts    复盘报告 CSV 生成（纯函数）
│   │   └── SandboxGame.ts     门面：买入/赎回/清算/净值曲线/难度/情景/结算/导出
│   ├── entities/PortfolioEntities.ts 存款/现金理财/封闭理财/基金账户模型
│   ├── scene/SandboxScene3D.ts  three.js 建筑可视化 + HUD（现金/曲线/流水/资产迷你曲线）
│   ├── ui/SummaryPanel.ts     结算成绩单浮层（归因/时间线/环境点评/对比）
│   ├── ui/MissionPanel.ts     教学目标任务卡面板
│   ├── ui/KnowledgeCard.ts    资产百科知识卡（风险/收益/流动性科普）
│   ├── ui/IntroOverlay.ts     新手引导 + 难度选择 + 真实 UI 巡览（spotlight）
│   └── main.ts                入口：控制面板、速度、重置、玩法说明、toast、难度路由
├── server/
│   └── leaderboard-server.mjs  排行榜后端（Node 内置 http，零依赖）
└── scripts/
    ├── smoke.ts               核心层无头冒烟
    └── page-check.mjs         页面级 Playwright 冒烟
```

## 本轮（M2 可玩化）修复与新增

### M21（2026-10-17）：后端排行榜（跨设备成绩与排名）

新增：

- `server/leaderboard-server.mjs`：零依赖 Node 内置 `http` 排行榜服务，监听 `PORT=8787`（默认），JSON 文件持久化。接口：
  - `POST /api/sandbox/v1/leaderboard` —— 提交一局成绩，返回 `{ ok, entry, rank }`
  - `GET /api/sandbox/v1/leaderboard?scope=all|scenario|level&scenario=&level=&limit=` —— 拉取榜单
  - `GET /api/sandbox/v1/leaderboard/me?scope=&returnRate=&maxDrawdown=&rating=` —— 计算指定成绩的排名
  - 启动：`npm run server`；默认数据文件 `server/data/leaderboard.json`（可用 `DATA_FILE` 覆盖）
- `src/core/Leaderboard.ts`：前端客户端 `LeaderboardClient`（`submitScore` / `fetchLeaderboard` / `fetchMyRank`），所有网络失败优雅降级；导出纯函数 `sortEntries` / `rankInList` / `rankInScope` / `submissionFromSummary`。
- `src/ui/LeaderboardPanel.ts`：排行榜浮层，含昵称输入、「提交我的成绩」、全部 / 按情景 / 按难度范围切换、榜单列表与「我」的高亮。
- `main.ts`：结算后自动上传本局成绩；操作条新增「排行榜」按钮；昵称记忆在 `localStorage`；调试出口新增 `__sandbox.leaderboard`。
- `vite.config.ts`：`/api` 代理到 `http://localhost:8787`（dev 与 preview 一致），前端请求天然落到排行榜后端。
- `smoke` 新增 [24]：排行榜排序、排名、范围过滤、成绩单→提交对象映射。
- `page:check` 新增 [22]：拉起排行榜后端，通过 `__sandbox.leaderboard.submit/fetch/myRank` 与 UI 浮层做完整 E2E 校验。
- `server/leaderboard-server.test.mjs` + `npm run test:server`：纯 Node HTTP 单测（提交/拉取/范围过滤/排名/非法 JSON 400/只读 403/CORS），无需浏览器，比 `page:check` 更快定位后端问题。
- 同服务顺手新增 `GET /api/sandbox/v1/market-data?page=&pageSize=`（与前端 `MarketDataItem` 同形、同种子生成，分页返回），把"对接真实后端行情"做成**免编译**方案——直接在零依赖的 8787 服务上扩展，无需跑重的 Nest 工程。前端 `MarketDataLoader` 新增 `fetchMarketData()`；访问前端加 `?backend=1` 即从后端拉取行情（失败自动回退内置行情）。`page:check` 新增 [23] 校验代理联通与 `?backend=1` 接入。复制课堂链接时若处于后端模式，分享链接自动带上 `backend=1`，同学点开即用同一份后端行情。
- 顺手修复：`allocationFractions` 负数先归零再求和（避免 `-5+5=0` 时全归零）；`buildShareQuery` 保留 `dca=amount:interval:asset` 的冒号字面量。

### M20（2026-10-17）：复制课堂链接（教师分享）

新增：

- `src/core/ShareLink.ts`：`buildShareQuery({level, scenarioId, dca})` 纯函数，构造分享 query（难度/情景必带，定投仅开启时带 `dca=amount:interval:asset`）。
- `main`：`_updateUrlLevel` 升级为 `_syncUrl()`，把难度/情景/**定投**一并写回 URL（`history.replaceState`）；`_toggleDca` 与引导回调、难度切换均触发同步；新增「复制课堂链接」按钮（`_shareBtn`）调用 `_copyClassroomLink()`——先同步 URL，再 `navigator.clipboard` 复制，失败回退 `textarea`+`execCommand`，最终 toast 提示「已复制课堂链接…」或展示链接；`__sandbox.copyClassroomLink` 同效。市场种子固定（`DEFAULT_SEED`），故链接可让同学玩到同一局行情。
- `smoke` 新增 [23]：基础含难度与情景、定投开启带 dca、定投关闭不带、缺省不算。
- `page:check` 新增 [20]：点击「复制课堂链接」后弹出含「课堂链接」的 toast。

### M19（2026-10-17）：资产配置实时饼图

新增：

- `src/core/Allocation.ts`：`allocationFractions(values)` 纯函数把各桶金额归一化为占比（和为 1，含 0/负数稳健）。
- `SandboxScene3D`：模块级 `donutSvg(segments, size)` 用 stroke-dasharray 环形渲染；资产面板（仅桌面端，避免移动端换行重叠）左侧前置「资产配置」环形饼图（现金/存款/现金理财/封闭理财/基金各有配色，`cash` 灰、其余蓝/紫/琥珀）。
- `smoke` 新增 [22]：占比和为 1、零值项 0、正项正确、全 0 返全 0、负数当 0。
- `page:check` 新增 [19]：桌面端存在 `.alloc-donut` SVG 且含 ≥1 段环形。

### M18（2026-10-17）：多局成长轨迹（跨局留存）

新增：

- `ProgressStore`：`SandboxProgress` 增 `runs: RunRecord[]`（近局轨迹，最多 `MAX_RUNS=12` 条）；`RunRecord{returnRate,maxDrawdown,rating,missions,total,days,level,date}`；`recordRun(summary)` 追加并持久化；`runsStats(runs)` 纯函数返回 `{count,avgReturn,bestReturn}`；`save()` 改为复用 `_persist()`；`_read` 解析 `runs`，`_readRuns` 校验非法项。
- `SummaryPanel`：新增「● 多局成长轨迹」块（共 N 局 + 平均/最佳收益 + 收益率迷你折线 `runsSpark`，≥2 局才出线，<2 局给提示），`show` 增 `runs` 参数。
- `main`：`onFinish` 结算时先 `recordRun` 再展示成绩单并传入 `runs`；成绩单按钮与 `__sandbox.recordRun` 同样传入。
- `smoke` 新增 [21]：初始无轨迹、记录两条、统计正确（平均/最佳/计数）、超上限只留 12、空轨迹返回 null。
- `page:check` 新增 [18]：调用 `recordRun` 后成绩单含「多局成长轨迹」且含平均与最佳收益。

### M17（2026-10-17）：交易决策标注（曲线买卖点）

新增：

- `src/core/TradeMarkers.ts`：`mapTradesToCurve(trades, curve)` 把流水按日期映射到净值曲线索引，只保留买卖类动作（买入/存入/申购→buy，卖出/取出/赎回/到期兑付→sell），同日多笔都保留，早于起点归 0、晚于末点归末点。
- `SandboxGame.getTradeMarkers()`；`__sandbox.tradeMarkers`。
- `SandboxScene3D._drawEquityChart`：在实际曲线上按买卖点画绿▲（点上）/红▼（点下），仅可见窗口内。
- `smoke` 新增 [20]：仅映射买卖类、买入/卖出归到当日点、同日多笔保留、起止点夹取、空曲线。
- `page:check` 新增 [17]：买卖点已映射且同时含买入与卖出。

### M16（2026-10-17）：策略基准曲线（实际 vs 全存款 / 全基金）

新增：

- `src/core/Benchmarks.ts`：`buildBenchmarks(curve, principal)` 由实际净值曲线反推两条“简单策略”基准（与曲线等长）——全额存存款（按 `DEPOSIT_RATE` 日复利）、全额买基金（按起点至今净值比）。
- `SandboxScene3D._drawEquityChart`：实际曲线（实线，涨绿跌红）下方叠加两条淡色虚线基准，min/max 纳入基准值防出界；新增 `.equity-legend` 图例（实际/全存款/全基金），实际点颜色随涨跌更新；曲线标题去掉会豆腐块的 `📈`。
- `smoke` 新增 [19]：基准等长、全存款复利增长、全基金按净值比例、空曲线不报错。
- `page:check` [1] 增：曲线图含策略基准图例（实际/全存款/全基金）。

### M15（2026-10-17）：行为点评 + 存款基准

新增：

- `src/core/BehaviorReview.ts`：`depositBaseline(summary)` 计算“本金全额存存款到期末”的资产/收益率/超额（按日复利，衡量主动操作是否划算）；`reviewBehavior(summary)` 纯函数返回 ≤5 条财商反馈（交易频率、期末集中度、定投习惯、回撤、是否跑赢存款、教学目标），每条带 `tone`（good/warn/info）。
- `SummaryPanel`：成绩单新增「🏦 若全额存存款」基准行与「🧭 行为点评」列表（按 tone 着色）。
- `ReplayExport` CSV：追加存款基准三行与「# 行为点评」段。
- `smoke` 新增 [18]：存款基准≈年化、beatBy 计算、高频/少操作/定投/大回撤/跑赢/跑输/集中度各点评、条数 ≤5。
- `page:check` 新增 [16]：成绩单含“全额存存款”基准、行为点评块且至少一条结论。

### M14（2026-10-17）：资产百科知识卡

新增：

- `GameConfig.ASSET_GUIDE`：四类资产的 `AssetGuide`（风险/预期收益/流动性 + 简介 + 3 条财商要点）。
- `src/ui/KnowledgeCard.ts`：点击资产弹出的知识卡（`.knowledge-card`，遮罩/×/Esc 关闭，不阻塞游戏）。
- `SandboxScene3D`：资产单元格加 `data-guide` + cursor + 圆形 "?" 徽标（font-safe，无 emoji 豆腐块）。
- `main`：容器委托监听 `[data-guide]` 打开知识卡；`Esc` 关闭浮层逻辑移到焦点守卫**之前**（避免焦点在按钮上时 Esc 失效）；知识卡打开时拦截交易类快捷键。
- `smoke` 新增 [17]：四类资产百科齐全、要点≥3、含风险/收益/流动性、基金高风险/存款低风险/封闭理财低流动性。
- `page:check` 新增 [15]：点基金单元格弹卡并含科普字段、Esc 关闭、可开封闭理财卡、关闭按钮可关。

### M13（2026-10-17）：定投计划（DCA）

新增：

- `GameConfig.DcaPlan` / `DEFAULT_DCA`（关闭；基金 ¥2,000 / 每 5 交易日）。
- `SandboxGame`：`_dca` / `_dcaCounter` / `_dcaCount`；`dca` / `dcaCount` getter、`setDca(partial)`（amount<0→0、interval<1→1 夹取）；`_runDca()` 在**每个交易日收盘后**按间隔扣款（现金不足跳过），复用抽出的 `_applyBuy`（手动与定投共用，规避 `canTrade` 限制）；`GameSummary.dcaCount`。**注意**：`init()` 不清空 `_dca`（保留开局前经 URL/按钮设定的计划），只重置计数。
- `invest()` 重构：抽出 `_applyBuy(assetType, amount, description)`，手动买入传 `null` 用默认文案，定投传「定投扣款 ¥X」。
- `main`：`?dca=on` 或 `金额:间隔:asset` 解析（`_readDca`）；操作条新增「定投」chip（`_toggleDca` / `_paintDcaBtn`，开启显示「定投 N日」）；`__sandbox.dca` / `setDca`。
- `SummaryPanel` / CSV：定投扣款次数展示与导出。
- `smoke` 新增 [16]：按间隔扣款、流水记录、金额正确、现金不足跳过、参数夹取、成绩单记录。
- `page:check` 新增 [14]：回笼现金后开启定投、按钮反映、按日扣款、流水含定投扣款、点按钮关闭且不再扣款。
- 视觉修正：`📈` emoji 在无头环境渲染为豆腐块，定投按钮/toast/成绩单改用无 emoji 稳定文案。

### M12（2026-10-17）：复盘对照（本局 vs 历史最佳）

新增：

- `ProgressStore`：`SandboxProgress.best` 存历史最佳一局快照（收益率/回撤/评级/教学目标/天数 + 总资产曲线，`downsample` 等间隔降采样至 ≤80 点控制体积）；`save()` 增 `curve` 参数，仅刷新最佳时更新 `best`；`_read` 校验读回。
- `compareToBest(summary, best)` 纯函数：收益率/回撤/教学目标差（百分点）+ 是否更优。
- `SummaryPanel`：`show` 增 `best` 参数，渲染「📊 对比历史最佳」块（本局 vs 最佳 + 差值，绿=更好）；`main` 结算时用**上一局最佳**作对比基准（`prevBest`），成绩单按钮用当前历史最佳。
- `smoke` 新增 [15]：`compareToBest` 各项差值与判定、首局新纪录存曲线、更差局不刷新、曲线降采样 ≤80。
- `page:check` 新增 [13]：存入历史最佳后打开成绩单，断言对比块含总收益率/最大回撤/教学目标与 pp 差值；[6] 缩放重排由固定等待改为 `waitForFunction` 等面板宽度切换，消除防抖竞态。

### M11（2026-10-17）：操作体验完善（快捷键 / 动态标签 / 全部 / 现金夹取）

新增：

- **键盘快捷键**（`main._onKey`）：`1`~`4` 选资产、`B` 买入、`S` 赎回、`空格` 暂停/继续、`Esc` 关成绩单、`?` 玩法说明；输入框/按钮聚焦或引导/巡览浮层打开时自动不拦截。
- **按钮标签动态化**（`_updateActionButtons`）：买入/赎回动词随选中资产变化（存入/取出、申购/赎回、买入/卖出），封闭期内赎回按钮禁用置灰；每次 `_refresh` 刷新以在封闭理财到期后自动解禁。
- **「全部」快捷金额**：按当前可投入现金填入金额框。
- **现金夹取**（`_buy`）：金额超现金且现金 >0 时夹取为全部现金并提示，现金为 0 才提示不足。
- 抽出 `_selectAsset` / `_setAmount` / `_togglePause` / `_verbOf` 复用；资产配置加 `buy`/`sell` 动词（`_assetCfg`）。
- `page:check` 新增 [12]：按 1/2 选资产验证标签变化、空格暂停/继续、「全部」填入全部现金、超大金额买入夹取为全部现金（重试避开停牌窗口）；[2] 基金卖出按钮名随动态标签改为「卖出」。

### M10（2026-10-17）：复盘报告导出（CSV）

新增：

- `src/core/ReplayExport.ts`：`buildReplayCsv(summary, records)` 纯函数，输出成绩单摘要 + 收益归因表 + 期末资产明细 + 完整交易流水；CSV 字段按需加引号转义（描述里的千分位逗号等）。
- `SandboxGame.exportReplayCsv()`；`main._exportReplay()` / `_download()`（Blob + `<a download>`，加 BOM 便于 Excel 识别中文）；成绩单新增「导出复盘 CSV」按钮（`SummaryPanel.show` 增 `onExport` 参数），文件名 `sandbox-replay-<seed>-<scenario>.csv`。
- 调试出口新增 `exportReplay`。
- `smoke` 新增 [14]：报告标题/归因表头/流水表头/关键字段、流水行数 = 交易记录数、含逗号描述已加引号。
- `page:check` 新增 [11]：调试出口生成 CSV、成绩单含导出按钮、点击触发下载、文件名含种子与情景、下载内容为复盘 CSV（原手机竖屏顺延为 [12]）。

### M9（2026-10-16）：资产迷你走势曲线

新增：

- `GameConfig.AssetHistoryPoint` + `SandboxGame._assetHistory`：日完成回调里与 `equityCurve` 同步采样现金/四类资产市值；`assetHistory` getter；`init()` 重置。
- `SandboxScene3D`：模块级 `sparkSvg(values,w,h)` 生成内联 SVG polyline（末值≥首值绿、否则红；不足 2 点返回空），资产面板每个单元格（现金 + 四类）嵌入迷你曲线，尺寸随 compact 自适应（48/64 × 14）。
- `smoke` 新增 [13]：分资产历史与总资产曲线等长、分资产合计 = 当日总资产、采样含日期、重置清空。
- `page:check` 新增：分资产历史采样 ≥2 天（`waitForFunction` 等**游戏状态**而非 DOM）、资产面板 5 条 `.asset-spark`、折线 points 非空。

### M8（2026-10-16）：行情情景（回放起点 / 时长）

新增：

- `GameConfig.SCENARIOS` / `resolveScenario`：4 个情景预设——`standard`(60天) / `long`(120天) / `mid`(2023-06 起) / `recent`(2025-06 起)；`standard` 天数动态跟随 `GameConfig.PLAY_DAYS`（保留课堂/测试调节标准局长度的能力）。
- `MarketDataLoader`：构造支持 `startDate`，新增 `indexOfDate` / `setStart` / `startIndex` / `startDate`；`reset()` 回到 startDate 偏移而非 0。
- `SandboxGame`：构造增 `scenarioId` 参数；`_scenario` 取代 `GameConfig.PLAY_DAYS` 作为天数上限（`dayProgress` 与 `_runDayCycle` 停止条件均改读它）；`setScenario(id)`（仅开局前，重设 loader 起点与天数）；`scenario` / `playDays` getter；`GameSummary.scenario`。
- `IntroOverlay`：新增行情情景选择区（2 列 chips + 描述），`onStart(level, scenarioId)`；回顾模式隐藏难度与情景选择。
- `main.ts`：`?scenario=` 读取，intro 选定后 `setScenario` + 写回 URL；`__sandbox.scenario`。
- `SummaryPanel` 副标题加情景名。
- `smoke` 新增 [12]：未知 id 回落默认、起点/天数、回放从 2023-06 起、进度上限、成绩单记录情景、加长 120 天、切换情景 loader 重定位、近期情景数据充足。
- `page:check` [1] 增：引导含“行情情景”选择、选“加长”后 scenario.id/天数/URL 断言。

### M7（2026-10-16）：实时财商干预（Advisor）

新增：

- `src/core/Advisor.ts`：纯函数式规则引擎，输入 `MissionContext` + `MarketSnapshot`，输出 `Advice{id,level,text,lesson}`。规则：权益仓位 ≥60% / 可动用资金 ≤10% / 单一资产 ≥70% → `warn`；基金单日跌 ≤-3% → `info`（低吸）；均衡配置 → `info`。**一局去重**（`_fired` Set + `_list` 顺序记录），`reset()` 清空。
- `SandboxGame`：`readonly advisor`，`init()` 里 `advisor.reset()`；`evaluateAdvisor()` 用当前快照评估。
- `main.ts`：`_refresh()` 在任务评估后调用 `evaluateAdvisor()`，优先弹 warn（红色边框 toast），否则 info；toast 加稳定类名 `.sandbox-toast`，`_toast(msg, warn)` 支持告警配色。
- 调试出口新增 `evaluateAdvisor` / `adviceTriggered`。
- `smoke` 新增 [11]：仓位过重 / 应急垫 / 集中度 / 均衡 / 大跌低吸各规则、等级、去重、reset、沙盘初始即触发均衡。
- `page:check` 新增 [10]：盘面自动触发均衡提示；暂停下调到高风险仓位（赎回存款+现金理财后全买基金，权益≈80%/现金 0）→ 放行后切片 tick 触发 ⚠ 告警 toast、`adviceTriggered` 含 equity-heavy/liquidity-thin 且等级 warn、重复评估不再触发。

### M6（2026-10-16）：引导增强（真实 UI 巡览 + 可重看）

新增：

- `IntroOverlay` 重写为支持选项：`{ force, review }`。`review` 模式隐藏难度选择、主按钮变「知道了」仅关闭不重开对局。
- **真实 UI 巡览**（`startTour`）：聚光灯（`box-shadow: 0 0 0 9999px` 挖洞）依次高亮 `.control-panel` → `.mission-panel` → `#asset-panel`，配文字说明与「上一步 / 下一步 / 跳过」；用 `getBoundingClientRect` 定位，目标缺失自动跳过该步。
- 控制面板新增「玩法说明」按钮 → `this._intro.show(()=>{}, { force:true, review:true })` 重看引导。
- 构造期即创建 `_intro`（`private _intro!: IntroOverlay`），供控制面板挂载时引用；首启逻辑不变（未看过才弹）。
- `page:check` 新增 [8]：点「玩法说明」再弹引导、回顾卡片「知道了」可关闭、重开后进「带我逛逛」出现 `.tour-overlay`/`.tour-spot`、下一步切到任务卡、跳过结束巡览；原手机竖屏顺延为 [9]。

### M5（2026-10-16）：难度档位 + 新手引导 + 环境点评

新增：

- **难度档位**（`GameConfig.LEVELS`：保守/稳健/进取）：`createMissions(caps)` 按档位生成任务卡阈值（权益仓位上限 35/40/50%、流动性下限 30/25/15%、收益目标 2/3/5%、回撤上限 5/8/12%）；`SandboxGame.setLevel` 运行中可切（重建任务卡），难度写回 URL `?level=` 与存档 `lastLevel`。
- **新手引导**（`src/ui/IntroOverlay.ts`）：四步财商要点 + 难度选择浮层，localStorage（`sandbox:intro-seen`）记忆，开始后才启动日循环。
- **市场环境点评**（`GameSummary.environment`）：按收益/回撤生成本局市场标签（亏损市 / 高波动市 / 震荡市 / 低波动慢牛）与对应财商建议，成绩单展示；成绩单副标题带难度名。
- `page:check` 新增：首启引导出现并可关闭、竖屏同样关闭引导后截图、`setLevel('aggressive')` 生效、点评非空、难度写入 URL；`smoke` 新增 [10] 难度阈值差异（同一 45% 权益仓位：保守不达标 / 进取达标）、summary.level、environment、存档 lastLevel。

### M4（2026-10-16）：结算复盘 + 本地存档 + 窗口缩放重排

新增：

- **收益归因**（`GameSummary.attribution`）：按交易流水 + 期末市值拆出每类资产贡献（贡献 = 期末市值 + 赎回回流 − 累计投入），结算面板条形图展示。
- **操作时间线**（`GameSummary.timeline`）：最近 12 条操作随成绩单展示。
- **本地存档**（`src/core/ProgressStore.ts`）：localStorage 记录历史最佳收益率/评级、完成局数、累计达成任务集合；不可用时静默降级为内存态；任务面板与成绩单展示「🏆 历史最佳」；新纪录 toast。
- **窗口缩放重排**：resize 防抖 180ms 后重算 compact/桌面两套布局（操作条位置、任务面板重定位、toast 位置），横竖屏切换即生效。
- `page:check` 新增：成绩单归因/时间线断言、存档写入与历史最佳展示、宽屏→缩窄→还原三段缩放重排断言。

修复：

- `ProgressStore` 写入误用全局 `safeStorage()` 而非注入实例 → 注入的 fake storage 无法读回（冒烟抓出）。
- 任务卡面板 DOM 增加稳定类名（`.mission-header` / `.mission-list`）避免测试选择器漂移。

### M3（2026-10-16）：教学目标任务卡 + 移动端竖屏适配

新增：

- `src/core/MissionSystem.ts`：7 张任务卡的定义与评估（进度 0~1、达成事件多播、reset），教学点随卡展示。
- `src/ui/MissionPanel.ts`：任务卡面板（进度条/达成打勾/达成高亮/可收起），达成时 toast。
- 结算成绩单增加「教学目标达成 n/7」。
- 手机竖屏（<720px）布局：控制面板变底部操作条、曲线/任务面板下移、资产面板与风险提示动态抬到操作条上方（渲染期实测高度）、交易流水在窄屏隐藏。
- `page:check` 增加 390×844 竖屏页（操作条贴底铺满、面板不越界、无报错）与桌面任务卡交互断言。

修复（布局量测引出的**重要架构 bug**）：

- **回调单槽覆盖**：`SandboxGame.init()` 注册的 `onSliceTick` 会覆盖 UI 注册的回调（引擎回调是单槽）→ HUD 冻结在首帧、休市日/停牌等状态永不刷新。改为 `TimeSliceEngine` 多播（监听器数组 + 发射方法）。
- **休市回调永不触发**：`_runDayCycle` 处理休市日时只改状态机、未调用休市回调 → 改为 `SandboxGame.onHoliday` 自持监听器列表并在休市分支触发。
- 窄屏风险提示位置在资产面板填充内容前量测（恒为 0）→ 移到内容写入后量测。
- 开局误弹「达成」toast → 挂载任务面板时先静默评估一次。

### M2（2026-10-16）：可玩化

修复：

1. 加载遮罩永不消失 → 场景初始化完成后淡出移除；WebGL 失败改为降级提示而非白屏。
2. 速度倍率 1x/3x/5x 形同虚设（`setSpeed` 未接入等待逻辑）→ 切片等待按倍率缩放，并支持暂停 / 继续。
3. 休市日 `while(true)` 空转刷屏 → 休市日按 `HOLIDAY_SKIP_MS` 停留后跳过。
4. 现金理财 / 存款按**切片**计息（一年被放大数十倍）→ 改为每日计息。
5. 存款收益率恒为 0 → 记录累计存入本金，收益率按本金基数计算。
6. 手动买入不写交易流水、赎回金额不入账 → 买入/赎回/到期兑付全部落流水并回笼现金。
7. 脚本化操作每个交易日重复执行 → 增加执行去重。
8. 收盘清算后无法进入下一交易日（状态机缺 `settlement → pre_open`）→ 补齐转移规则。
9. 一局无限长（1643 天 × 52 切片 × 5s）走不到结算 → 切片时长改为 400ms、一局 60 个自然日，走完自动结算。
10. 收益为负后建筑颜色永久变红、高度归一化异常 → 正负收益均可恢复，缩放比限幅。
11. `totalReturn` 硬编码 100000 → 改用 `initialPrincipal`。

新增：

- 种子化行情（`?seed=`），同种子完全可复现。
- 现金展示、总资产曲线、休市/暂停状态、交易日进度 `D n/60`。
- 赎回入口（封闭理财未到期拦截）与「重置」按钮。
- 结算成绩单：年化收益、最大回撤、资产明细、A~D 评级与点评。
- `npm run smoke`（31 项）、`npm run page:check`（16 项）、`npm run check` 一键校验。

## 待办

- 与后端 `src/modules/sandbox`（`/api/sandbox/v1`）对接，替换前端内置行情。
- ✅ 存档上传后端，实现跨设备成绩与排行榜（M21 已完成）。
