# 2026-09-20 养成长线闭环（境界突破 + 成长里程碑）— Plan 6

> Phase: 内容/长线完善 · 给玩家长期养成目标的「成长线 + 里程碑奖励」闭环
> Repo: `E:/code/nest` · game-server in `packages-game/game-server`
> 规则：无新 npm 依赖；严格 TDD；逐任务 commit；**先探查养成现状再写**

## 设计

战斗/社交/生态很厚，但「玩家为什么长期玩」的成长主线偏薄。本计划做成长线闭环：**境界突破**（消耗养成资源推进境界，属性加成）→ **成长里程碑**（到达关键境界即发奖，形成长线正反馈）。同时复用既有战斗/技能/经济底座，不新造轮子。

**先探查（必须）**：
- `characters` / `character_statuses` / `character_martial_arts` / `character_qualifications` 里是否已有「境界/修为/等级」类字段（避免重复建列）；惯例境界是否由 `remote_configs` 配、属性加成走 buff 还是 character attribute。
- 既有消耗/发奖通道：`inventory` 消耗道具、`economy` 发金/资源、`mail` 发奖、`quest` 里程碑挂钩——确认真实接入方法。

**新增**：
- 表 `realm_templates`（境界档位模板）：`realm_level`、`realm_name`、`required_value`（突破所需修为/养成值）、`consume_items_json`（突破消耗的养成道具）、`stat_bonus_json`（境界属性加成：攻/防/血等）、`milestone_reward_json`（首次到达该境界的奖励）。
- 玩家侧：`characters` 或 `character_statuses` 加 `realm_level`（默认 1）与 `realm_value`（修为累计）。
- `BreakThroughService`：
  - `cultivate(playerId, commonValue)`：日常玩法给修为累加（接入既有玩法产出渠道，如任务/战斗结算回调）。
  - `breakThrough(playerId)`：校验达标 + 消耗 `consume_items_json`（inventory）→ realm_level+1 → 上 buff 属性加成（或更新 character attribute）→ 触发里程碑发奖；失败/未到阈值给明确错误码。
  - 属性加成以「覆盖式」叠到 `stat_bonus_json`，避免旧境界加成残留。
- 里程碑奖励：达到新境界首次 → 解析 `milestone_reward_json`，经既有发奖通道发放（mail/items/economy），幂等（按 realm_level 去重，防重复领）。

约束：
- 不新增错误码除非必要（若需用空 94xxx——先检查空闲再定）。
- 属性加成不得与既有 buff 系统冲突；不动战斗结算核心。
- 里程碑奖励复用既有发奖，不做新发奖系统。

## 任务（TDD，逐任务 commit）

### T1 探查 + 表 + 玩家字段 + 失败用例
探查境界现状后建 `RealmTemplate` 实体 + `characters.status` 加 `realm_level`/`realm_value`（若已存在则复用不重建）；`breakthrough.service.ts` 起骨架；`breakthrough.service.spec.ts` 先写用例（突破达标→消耗→升级→奖励 断言；未达标抛错），FAIL。注册模块。tsc 0 错误提交。
提交 `feat(realm): plan6 T1 模板表+玩家字段+失败用例`

### T2 breakThrough 核心
实现消耗校验 + 升级 + 属性加成覆盖 + 里程碑发奖（幂等）+ cultivate 累加；接 inventory/economy/mail 真实方法。spec 全 PASS。tsc + spec PASS 提交。
提交 `feat(realm): plan6 T2 突破服务`

### T3 controller + 用例
`BreakThroughController`：`GET api/client/v1/realm/my`（境界/修为/下一档）、`POST api/client/v1/realm/cultivate`（投入修为，来源参数）、`POST api/client/v1/realm/breakthrough`；admin 模板 CRUD（复用既有 admin 模板模式）。controller spec 用例。tsc + 全 spec PASS 提交。
提交 `feat(realm): plan6 T3 接口`

### T4 冒烟 + 手册 + 回归 + 推送
- 冒烟第 18 段：cultivate + breakthrough 到档位 2 断言 realm_level 与奖励已发（幂等不重复）。
- 手册：字典补 `realm_templates`（表数 +1）；characters 若加列则相应补字段；api 补 client 3 + admin CRUD；开发手册补「养成长线（境界突破/里程碑）」小节（16.x，编号用 max+1）。
- merge/check 全过；game-server 全量 jest 全绿；push。
提交 `feat(realm): plan6 T4 冒烟+手册+回归+推送`

## 完成验收
1. 境界突破消耗+升级+属性覆盖+里程碑奖励闭环、幂等
2. client/admin 接口可用
3. 全量 jest 全绿、文档同步、推送 origin/main