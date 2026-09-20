# 2026-09-20 世界探索与奇遇（探索足迹 + 奇遇事件 + 昼夜天气）— Plan 7

> Phase: 内容/可探索世界完善 · 把场景/资源点做成「可探索的环境互动」
> Repo: `E:/code/nest` · game-server in `packages-game/game-server`
> 规则：无新 npm 依赖；严格 TDD；逐任务 commit；**先探查世界现状再写**

## 设计

`world` 模块已有 scene/object_templates/npc/monster/场地点/street_games/scene_triggers/资源点，但「探索感」弱：到地只是一键采集，无发现/奇遇/环境变化。本计划补三层环境互动：**探索足迹**（到访点亮收集）、**奇遇事件**（场景随机触发、选择→结果）、**昼夜天气**（周期性环境态影响产物/奇遇概率）。

**先探查（必须）**：
- `world.service` / `world.client.controller` 现有交互路由（object-interact/interact/scene 查询）与 `scene_entity_spawns`/`object_templates`/`scene_triggers` 结构，确认触发的自然挂点。
- 是否已有探索/足迹/图鉴类字段或表（避免重复）。
- 昼夜/天气是否已有雏形（是否有日夜状态或仅纯逻辑）。

**新增**：
- 表 `encounter_templates`（奇遇模板）：`scene_id`（可选全场景）、`trigger_rate`（触发率）、`cd_seconds`（CD）、`choices_json`（选项→结果：options[{label, effects_json}]）、`is_one_time`、`reward_json`。
- 表 `player_explorations`（探索足迹）：`player_id`、`scene_id`、`discovered_at`、`times`；`uk (player_id, scene_id)`。`exploration_milestones`（足迹里程碑配置，可用 `remote_configs` 的 `explore.*` 键或单表）。
- 世界服务加 `worldState()`：**昼夜（白天/夜晚，按 SQL `now()` 时区安全分时）** 与 **天气（晴朗/阴雨，伪随机+固定种子）**，影响奇遇触发率与部分产出（`explore.weather` 配置键）。
- `ExploreService`：
  - `discover(playerId, sceneId)`：到访点亮足迹（幂等 upsert + times 递增）+ 首次里程碑发奖。
  - `triggerEncounter(playerId, sceneId)`：按触发率+CD+is_one_time 判定是否出奇遇，出则返回当前选项；`resolveEncounter(playerId, encounterId, choice)` 结算 effects（发奖/扣资源/上 buff）并写游玩记录。
  - `worldState()` 供客户端拉取当前昼夜/天气。

约束：
- 奇遇结果 effects 复用既有 inventory/economy/buff 发放；不新造结算。
- 昼夜/天气用 SQL `now()` 分时（沿用 3-A 时区经验），不依赖服务器本地时区。
- 足迹里程碑发奖幂等（uk 防重复）。
- 不用新错误码（能复用就用；确需则用空闲 94 5xx——先查）。

## 任务（TDD，逐任务 commit）

### T1 探查 + 表 + 失败用例
探查后建 `EncounterTemplate`/`PlayerExploration` 实体与注册；`explore.service.ts` 骨架；`explore.service.spec.ts` 先写用例（discover 幂等 + 首次里程碑；trigger 命中/未命中/CD 拦截；resolve 发奖），FAIL。tsc 0 错误提交。
提交 `feat(explore): plan7 T1 表+骨架+失败用例`

### T2 探索足迹 discover + 里程碑
实现 `discover()`（幂等 times 递增 + 首次里程碑经既有发奖通道）、`worldState()` 昼夜/天气（SQL now()）。spec PASS。tsc + spec PASS 提交。
提交 `feat(explore): plan7 T2 探索足迹与世界态`

### T3 奇遇事件 encounter
实现 `triggerEncounter()`（触发率/CD/is_one_time）+ `resolveEncounter()`（choice→effects 经既有结算）+ 游玩记录幂等。spec PASS。tsc + spec PASS 提交。
提交 `feat(explore): plan7 T3 奇遇事件`

### T4 controller + 用例
`explore` client controller：`GET api/client/v1/explore/state`（worldState）、`POST api/client/v1/explore/scene/:sceneId/discover`、`POST api/client/v1/explore/scene/:sceneId/encounter`（返回当前奇遇）、`POST api/client/v1/explore/encounter/:id/resolve`；admin 奇遇模板 CRUD。controller spec 用例。tsc + 全 spec PASS 提交。
提交 `feat(explore): plan7 T4 接口`

### T5 冒烟 + 手册 + 回归 + 推送
- 冒烟第 19 段：discover 幂等、encounter 可选状态、worldState 返回昼夜。
- 手册：字典补 `encounter_templates`/`player_explorations`（表数 +2）；api 补 client 4 + admin CRUD；开发手册补「世界探索与奇遇」小节（编号 max+1）。
- merge/check 全过；game-server 全量 jest 全绿；push。
提交 `feat(explore): plan7 T5 冒烟+手册+回归+推送`

## 完成验收
1. 探索足迹幂等、首探里程碑奖励
2. 奇遇触发/选择/结算闭环、CD/一次性生效
3. 昼夜天气基于 SQL now() 时区安全
4. 全量 jest 全绿、文档同步、推送 origin/main