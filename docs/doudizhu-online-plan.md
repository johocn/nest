# 斗地主联机 P0 + 单机亮点 实施计划

> 状态：已确认，待执行（craft 模式）
> 跨度：服务端 `packages-game/game-server`（Nest） + 客户端 `tour-game`（Laya2D）
> 配套文档：部署交接文档见 `nest/docs/doudizhu-deploy.md`（执行阶段产出）

---

## 1. 背景与目标

依托自有 Nest 游戏引擎，为斗地主补齐**联机 P0**（能否"上线对标"的核心门槛），并把**残局闯关 + 癞子玩法 + 本地复盘**作为不依赖联机的单机亮点并行推进；最终产出一份可交付他人执行的 odoo 增量部署交接文档。

- 联机是"能不能上线对标"的门槛：当前斗地主是 2 AI 陪打的单机，缺真人对战。
- 单机亮点是**可先于联机上线**的差异化点，零部署风险，直接对标市面"单机斗地主"。
- P1 社交/排位在联机稳定后紧跟（不在本计划范围）。

---

## 2. 核心约束

- **不修改共享引擎内部逻辑**（`matchmaking` / `room.service` / 各网关实现），仅在**枚举/配置层做最小增量**，新增**独立的 `doudizhu` 模块**。
- **部署目标**：沿用 odoo 同实例（`39.106.99.9`，`/opt/game-server`，systemd `game-server`，Postgres 库 `game_server`，Redis，`DB_SYNCHRONIZE=true` 自动建表），不新建服务器环境。
- **引擎先更新到最新**：当前本地在 `werewolf` 分支，`main` 落后 `origin/master` 141 个提交。先 `git fetch origin` → 切 `main` 合并 `origin/master` → 切特性分支 `feat/doudizhu-online`。
- 形成的部署交接文档**交由他人执行**，本次不自行部署。

---

## 3. 核心交付

1. 服务端新增 `modules/doudizhu`（网关 `/doudizhu` + 权威桌态服务 + 引擎 + 实体）。
2. Laya 客户端 `socket.io-client` 联网适配（含登录/取 token 流程、`NetGame` 适配器驱动现有渲染层）。
3. 单机：癞子玩法、残局闯关、本地复盘。
4. odoo 增量部署交接文档（含 nginx `/doudizhu` WS 反代、CORS/CSP 域名补充、冒烟与回滚）。

---

## 4. 引擎现状与不足（规划须弥补）

> 以下为只读核查结论，未改动任何代码。

1. **匹配仅 2 人配对、无斗地主模式**：`matchmaking.service.ts:57` `tryMatch` 只取相邻两个战力在 20% 区间内的玩家成局；`MatchMode` 枚举（`enums.ts:639`）仅 `ranked/casual/practice`。斗地主要 **3 人同局**。
2. **房间角色模型无「3 座位 + 地主/农民」概念**：`RoomService` 的 `RoomPlayer.role` 仅 `attacker/defender/pve/spectator`；房间 `players` 虽是数组可塞 3 人，但地主/农民身份须游戏内分配，引擎未提供。
3. **无斗地主模块**：`app.module.ts` 仅注册 werewolf/majiang/sanguosha/guandan 等，需按 guandan 模板从零新增。
4. **Laya 客户端无 socket.io / Token 流程**：现有联网前端（guandan-web）是 Vue；斗地主客户端是 Laya2D，无 `socket.io-client` 接入示例，且是游客态；而所有网关（`guandan.gateway.ts:50`）强制握手 `?token=` JWT 校验。
5. **经济（欢乐豆/积分/段位）仅客户端**：目前是 `tour-game` 本地逻辑，服务端 `PlayerService`/`EconomyModule` 虽在，但斗地主服务端结算（`DoudizhuRecord` + 改 beans/points/tier）未接通。
6. **复盘仅 guandan 有**：`GuandanReplay` 实体 + `replay()` 是 guandan 专属，斗地主需自建（模式可照搬）。
7. **ladder 按 1v1 写**：`ladder.service.ts:208` 监听 `MATCH_SUCCESS` 后按胜负双方记账；斗地主是"1 地主 vs 2 农民"、3 方各有得失，ladder 写入逻辑需扩。
8. **服务端无规则引擎（防作弊硬缺口）**：权威牌型校验 `rules.legalPlay` 现在只在 `tour-game/core`（客户端），服务端没有斗地主规则引擎——不搬上服务器就不能信任客户端出牌。
9. **运维接入未覆盖**：新增 WS 命名空间 `/doudizhu` 需同步 nginx 反代 WebSocket 升级；`main.ts` 的 `helmet` CSP `connectSrc:['self']` 与 `CORS_ORIGINS` 默认仅 localhost，上线要补斗地主客户端域名，否则浏览器 WS/fetch 被拦。

---

## 5. 技术方案

### 5.1 服务端（P0，非侵入式扩展）

- **新模块 `modules/doudizhu`**：完全镜像 `guandan` 模板——
  - `doudizhu.gateway.ts`：命名空间 `/doudizhu`，握手 JWT 校验，消息 `create/join/start/bid/play/pass/view/emoji/replay/leave/host`。
  - `doudizhu-table.service.ts`：权威桌态存 Redis，含 `members[3]`、socket 映射、30s 出牌倒计时、bot 座位、断线重连、托管。
  - `doudizhu.service.ts` / `doudizhu.types.ts` / `doudizhu.module.ts`。
  - `entities/{DoudizhuRoom,DoudizhuRecord,DoudizhuReplay}.ts`。
  - `engine/`：从 `tour-game/src/doudizhu/core` **原样移植**纯 TS 逻辑（`cards/rules/deck/game`）。
- **权威校验**：每次 `play/pass/bid` 经服务端 `rules.legalPlay` 校验，绝不信任客户端（防作弊核心）。
- **3 人匹配（最小增量，不改共享逻辑）**：在 `MatchMode` 枚举加 `DOUDIZHU_RANKED` / `DOUDIZHU_CASUAL`；复用 `matchmaking` 队列与 `RoomService.create`（其 `players` 为数组、已支持 3 人），仅在调度/`MATCH_SUCCESS` 处理里按 3 人成局建 Room（模块内或 matchmaking 配置化，不改动既有 1v1 路径）。
- **结算与段位**：局结束调 `RoomService.finish` + 写 `DoudizhuRecord`，经 `PlayerService` 改 beans/points/tier（春天/反春天倍数已在 core 算好）；`ladder` 扩写支持「1 地主 vs 2 农民」3 方得失记账。
- **注册**：`app.module.ts` imports 增 `DoudizhuModule`（仿 `GuandanModule`）。

### 5.2 客户端联网（Laya）

- 给 esbuild bundle 增加 `socket.io-client` 依赖；首次进入联网模式补「登录/游客 token 领取」流程（拿 JWT）。
- 新增 `NetGame` 控制器：`connect(token)` → `doudizhu:create/join` → 监听 `doudizhu:update` 拿 `view`（本座全手牌 + 另两座张数/最后出牌/轮到谁/倍数/地主标识）→ **驱动现有渲染层**（手牌/出牌/地主/倍数/结算全部复用，仅换数据来源）；出牌/叫分经 `doudizhu:action` 上行，动画复用 `cardFly`。**不重画 UI**。

### 5.3 单机亮点（可先行、零部署）

- **癞子玩法**：`core/cards.ts` 增加癞子 rank、`rules.ts` 牌型识别百搭；`matchMode.ts` 加 `laizi` 变体入口；补牌型单测（最易错）。
- **残局闯关**：新增 `core/campaign.ts` + 预设残局数据（固定 `Game` 初始态 + 必胜约束）；客户端「闯关」模式加载预设态走现有引擎并校验达成。
- **本地复盘**：复用引擎 `actionLog` 记录整局，客户端加「本局回放」入口按记录重放 view 序列到渲染层。

---

## 6. 架构图

```mermaid
flowchart LR
  C[Laya 客户端 / 浏览器] -- WebSocket /doudizhu ?token -- G[DoudizhuGateway]
  G -- 校验/转发 -- T[DoudizhuTableService 权威桌态 Redis]
  T -- 调用 -- E[engine 规则引擎 rules.legalPlay]
  T -- 开局通知 -- MM[Matchmaking + RoomService]
  T -- 结算 -- P[PlayerService 改 beans/points/tier]
  T -- 完成事件 -- L[Ladder 3 方段位结算]
  T -- 记录 -- R[(DoudizhuRoom / DoudizhuRecord / DoudizhuReplay)]
```

---

## 7. 目录结构与关键文件

```
nest/packages-game/game-server/src/modules/doudizhu/   # [NEW] 联机斗地主模块（非侵入，独立新增）
  doudizhu.gateway.ts        # [NEW] /doudizhu 命名空间网关，JWT 鉴权，create/join/start/bid/play/pass/view/emoji/replay/leave/host
  doudizhu.module.ts         # [NEW] Nest 模块定义
  doudizhu.service.ts        # [NEW] 业务编排（建房/入座/动作/结算）
  doudizhu-table.service.ts  # [NEW] 权威桌态（Redis），倒计时/断线/托管/bot
  doudizhu.types.ts          # [NEW] ActionDto / View 协议
  entities/                  # [NEW] DoudizhuRoom / DoudizhuRecord / DoudizhuReplay
  engine/                    # [NEW] 从 tour-game/core 移植的纯 TS 规则引擎（cards/rules/deck/game）
nest/.../src/app.module.ts           # [MODIFY] imports 增 DoudizhuModule
nest/.../src/constants/enums.ts      # [MODIFY] MatchMode 增斗地主模式（最小增量）
nest/.../src/main.ts                 # [MODIFY] CORS_ORIGINS / helmet CSP connectSrc 补客户端域名
tour-game/src/doudizhu/
  core/cards.ts               # [MODIFY] 癞子 rank
  core/rules.ts               # [MODIFY] 百搭牌型识别
  core/campaign.ts            # [NEW] 残局数据与校验
  net/NetGame.ts              # [NEW] socket.io 联网适配器（驱动现有渲染层）
  DoudizhuMain.ts             # [MODIFY] 接入 NetGame / 闯关入口 / 复盘入口 / 登录引导
nest/docs/doudizhu-deploy.md  # [NEW] odoo 增量部署交接文档（含 nginx 反代 / 冒烟 / 回滚 / checklist）
```

---

## 8. 里程碑 / 执行顺序

| 阶段 | 任务 | 依赖 |
|---|---|---|
| P0-0 | 拉取 `origin/master` 最新 + 切 `feat/doudizhu-online` 分支 | — |
| P0-1 | 新增 `modules/doudizhu`（网关/权威桌态/实体/引擎移植）并注册 `app.module` | P0-0 |
| P0-2 | 3 人匹配最小增量 + ladder 3 方段位 + 经 `PlayerService` 的 beans/points/tier 结算 | P0-1 |
| P0-3 | Laya 接入 `socket.io-client` + 登录/取 token + `NetGame` 适配器驱动现有渲染层 | P0-1 |
| S1 | 癞子玩法（`cards/rules` 百搭 + 牌型单测） | P0-0 |
| S2 | 残局闯关（`campaign` 数据）与本地复盘（`actionLog` 回放） | P0-0 |
| DOC | 编写 odoo 增量部署交接文档 | P0-1, P0-3 |

---

## 9. 设计说明（UI）

- 客户端为 Laya2D 游戏，新增少量 UI 均复用现有斗地主视觉语言（木质暖色调、圆角卡片、金色描边、轻量引导），不引入新组件库。
- 新增界面：联网登录引导（首次进入「联网对战」弹轻量面板，提供账号/微信登录或游客领取 Token）、闯关模式选择页（复用 `matchMode` 卡片网格）、复盘回放器（结算面板「查看回放」按钮，复用 `CardView`/`playZones`/`cardFly` 逐帧重放）、联网牌桌 HUD（复用现有手牌区/出牌区/地主标识/倍数显示，仅数据来源切换；新增「托管 / 断线重连中」轻提示条）。
- 全部沿用现有 360 设计高布局与竖屏旋转提示（`orientationGuard`），新增面板均做顶部钳制（避免标题被裁，已修复的 `openPanel` 逻辑复用）。

---

## 10. 备注

- 服务端纯逻辑引擎（`tour-game/src/doudizhu/core`）现有 **101 个 vitest 通过**，可直接搬上服务器做权威校验，移植风险低。
- 现有部署范式见 `nest/docs/deploy-checklist-2026-09-20-7plans.md`（odoo 增量流程：本地 `npm run build` → tar dist → scp → 备份 → 替换 → `systemctl restart game-server` → journalctl 验启动 → 冒烟）。
- 本计划为**非侵入式**扩展：所有对共享引擎的改动限制在枚举/配置层，新增逻辑全部落在独立 `doudizhu` 模块内。
