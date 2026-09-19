# 社交经济闭环与商业化完善设计（阶段 5 · 批 2）

- 版本：v1.0
- 日期：2026-09-20
- 项目：game-server（NestJS 11 + TypeORM + PostgreSQL + Redis，game.joho.cn）
- 依据：《游戏服务器开发手册》第 2.6（封禁与社交治理联动）/ 8.15（名声与恩怨）/ 9.6（签到社交化）/ 12（充值与 VIP）/ 15（新手引导与初始数值）章；阶段 5 批 1 spec（2026-09-20-social-moderation-discovery-design.md）；探索盘点（social/chat/community/vip/payment/matchmaking/player/ranking 模块现状）
- 决策记录（用户确认 2026-09-20）：**封禁社交后果三项全做**（称号收回 / 帮派除名 / 榜单移除）；**社交经济闭环范围积分+宝箱+补签全做**；**VIP 特权全量实现**（12.4 五特权 + 帮派受益）；**新增 PVP（天梯竞技）+ 新手保护期**

## 1. 背景与目标

阶段 5 批 1 已交付举报治理闭环的「提交→台账→处置→禁言生效」主线与图谱协同推荐。经缺口盘点，社交体系仍有四类盲区：

1. **封禁只打在登录上，未打在社交上**：批 1 处置 BAN 仅调 `applyPenalty` 落库 + 登录被拒，手册 2.6 要求的「违规者被社会性除名」（称号收回 / 帮派除名 / 榜单移除）未落地，威慑缺乏社会性。
2. **社交动作无经济闭环**：社交行为（好友/亲缘/送礼/帮贡/签到）产出无沉淀、无消费出口，手册 8.15③（信用分）、9.6（断签补签）、13.2（周活跃宝箱）未实现；社交动力依赖单一奖励。
3. **VIP 特权停留在展示层**：`vip_configs.privilege_json` 仅被 `getVipInfo` 原样返回，五特权（好友位扩容/送礼上限/专属拍卖室/称号/帮派建筑加速）与帮派受益均未在实际玩法链路生效；充值状态机缺失败/取消/超时分支，充值不加 VIP 经验。
4. **新手引导只读、PVP 无护栏**：七日引导 `getDailyGuide` 按注册天数只读展示，任务完成状态硬编码（escort/gift 恒 false），无进度追踪、无奖励；PVP 仅有匹配无段位赛季，新手保护期（15.5/15.6：伤害衰减 + 红名不可主动攻击）未落地。

**目标**：补全社交经济闭环（积分→宝箱/补签）、封禁社交后果三项、VIP 特权全量生效 + 充值状态机、天梯竞技 + 新手保护期、引导进度追踪 + 奖励，形成「社交行为有沉淀、违规有社会代价、付费有便利回报、新手有保护」的完整闭环。

## 2. 总体架构

```
社交动作事件（FRIEND_ADDED/KINSHIP_FORMED/GIFT_SENT/…）
   │  订阅
   ▼
social 模块（社交经济）               chat 模块（补签）
  social_point_records 积分流水         POST chat/sign-in/makeup
  social_chests 宝箱（周活跃/积分兑换）  └→ 扣积分补签 chat_sign_ins

community 模块（BAN 社交后果联动）     vip 模块（特权全量生效）
  handleReport BAN ─┬→ 称号收回        privilege_json 键约定
                    ├→ 帮派除名        ├→ social 好友位/送礼上限
                    └→ 榜单移除        ├→ trade 专属拍卖室
                                       ├→ character 称号发放
payment 模块（状态机完善）             ├→ guild 建筑加速/帮贡加成
  PENDING→PAID→DELIVERED              └→ addVipExp（充值 1:1）
  /FAILED/CANCELLED/EXPIRED
                                       matchmaking + combat（PVP 天梯）
player 模块（新手保护期判定）             ladder_records 段位/赛季
  createdAt ≤ 7 天 → 伤害衰减/红名拦截    新手保护期伤害衰减钩子
social 模块（引导深化）
  guide_progresses 进度追踪 + 奖励领取（事件驱动完成）
```

## 3. 决策记录

| 决策点 | 结论 | 理由 |
|---|---|---|
| 封禁社交后果 | 三项全做：称号收回 / 帮派除名 / 榜单移除 | 手册 2.6「违规者被社会性除名」；BAN 为最终手段，威慑需打在社交关系上 |
| 社交经济范围 | 积分 + 宝箱 + 补签全做 | 手册 8.15③ / 9.6 / 13.2；三者构成「产出→沉淀→消费」闭环，缺一不成环 |
| 社交积分载体 | 新增 `social_point_records` 流水表，事件驱动记账 | 独立货币与金币/钻石隔离，防通胀扩散；流水可审计、可对账 |
| 宝箱形态 | 周活跃宝箱（10/30/60/100 分档）+ 积分兑换宝箱 | 手册 8.16③ 人气值与 1647 周结算宝箱；分档激励持续性活跃 |
| 补签对象 | 聊天签到（chat_sign_ins）断签补签，消耗社交积分 | 手册 9.6「断签保护」；签到在 chat 模块，补签就近扩展 |
| 补签消耗 | 社交积分（非人情值） | 人情值属 8.13 未落地货币；社交积分本期刚建，消费出口之一，闭环自洽 |
| VIP 特权 | 全量实现（5 项便利性特权 + 帮派受益） | 手册 12.4；全部为便利/展示/集体受益，不碰战力（12.3 哲学） |
| VIP 特权驱动 | `privilege_json` 结构化键约定，各落地点读取 | 配置驱动，无发版可调（13.2 同思路）；vip 服务暴露 `getPrivilege(playerId)` |
| 充值状态机 | PENDING→PAID→DELIVERED，补 FAILED/CANCELLED/EXPIRED | 手册 12.2 状态机；回调即发奖（PAID+发奖+DELIVERED 原子完成），FAILED 为回调异常留痕，取消/超时面向 PENDING |
| 充值→VIP 经验 | `handleCallback` 成功后 `addVipExp(amount)`（1:1，可配置） | 手册 12.3「VIP 经验来源：充值 + 活跃行为」；addVipExp 已 emit VIP_LEVEL_UP |
| PVP 形态 | 天梯竞技（matchmaking mode='ladder' + 段位分 + 赛季榜） | 手册 9.7；匹配/战力体系已具备，补胜负结算与段位沉淀 |
| 天梯胜负判定 | 轻量判定（战力 + 随机因子 + 新手保护衰减），不引入完整战斗流 | combat 为 PVE 结构，复用成本高；天梯核心是「排名」而非战斗演出（最简方案） |
| 新手保护期 | 注册 ≤7 天：PVP 伤害衰减 30% + 红名不可主动攻击 | 手册 15.5/15.6；参数进 remote_configs 可调 |
| 引导深化 | 只读展示 → `guide_progresses` 进度追踪 + 事件驱动完成 + 奖励领取 | 手册 15.3；补齐 escort/gift 硬编码完成状态缺口 |
| 新增依赖 | 不新增 npm 依赖 | 惯例；全部使用既有框架能力 |

## 4. A 部分 · 社交经济闭环（积分 + 宝箱 + 补签）

### 4.1 社交积分

**数据模型（新增 1 表）**

`social_point_records` 积分流水

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | |
| player_id | bigint | |
| type | varchar(16) | 枚举：EARN / SPEND |
| amount | int | 正数，EARN 加 / SPEND 减 |
| balance_after | int | 记账后余额（快照，审计用） |
| reason | varchar(32) | 枚举：FRIEND_ADDED / KINSHIP_FORMED / GIFT_SENT / GUILD_CONTRIB / INTEL_GAINED / CHAT_SIGN_IN / GUIDE_TASK / CHEST_EXCHANGE / SIGN_IN_MAKEUP / CHEST_OPEN（兑换返还场景）/ ADMIN |
| ref_id | varchar(64) | 关联业务 ID（好友ID/订单ID/任务ID 等），可空 |
| created_at | timestamp | |

索引：`(player_id, created_at)`、`(player_id, reason)`。

**积分来源（事件驱动，social 模块订阅 GameEvents）**

| 事件 | 积分 | 说明 |
|---|---|---|
| FRIEND_ADDED | +10 | 首次建立好友（对双方各记一次？——仅对发起方+被加方各 +10，防互刷：同对好友只计一次，用 ref_id=friendId 去重） |
| KINSHIP_FORMED | +30 | 结义/拜师（同对只计一次） |
| GIFT_SENT | +5 | 送礼（每日上限内） |
| GUILD_CONTRIB_GAINED | +5 | 帮贡获得时 |
| INTEL_GAINED | +10 | 获取情报 |
| CHAT_SIGN_IN | +3 | 聊天频道签到 |
| GUIDE_TASK | +20/任务 | 引导任务完成（见 E 部分） |

- **每日上限**：`remote_configs social.point_daily_cap`（默认 100），达上限当日不再累计（防刷，手册 8.17 社交配额同口径）
- **防互刷**：好友/亲缘类按关系对去重（同一 `(player_a, player_b)` 仅首次双方计分）

**接口（social 模块，均 JwtAuthGuard）**

- `GET /api/client/v1/social/point/info` → `{ balance, todayEarned, dailyCap }`
- `GET /api/client/v1/social/point/records?page=&pageSize=` 积分流水（分页）
- `POST /api/client/v1/social/point/exchange` `{ chestType }` 消耗积分兑换宝箱（见 4.2）

### 4.2 宝箱

**数据模型（新增 1 表）**

`social_chests` 宝箱

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | |
| player_id | bigint | |
| chest_type | varchar(24) | 枚举：WEEKLY_ACTIVITY / POINT_EXCHANGE |
| tier | int | 周活跃分档（10/30/60/100）或兑换档位（1/2/3） |
| cost | int | 兑换消耗积分（周活跃=0） |
| status | varchar(16) | 枚举：PENDING / OPENED，默认 PENDING |
| reward_json | jsonb | 开启后写入实际奖励 |
| source_week | varchar(10) | 周活跃宝箱归属周（YYYY-Www），防重复结算 |
| opened_at | timestamp | 可空 |
| created_at | timestamp | |

索引：`(player_id, status)`、`(player_id, source_week)`。

**周活跃宝箱（手册 8.16③ 人气值 + 1647 周结算分档）**

- 活跃值 = 近 7 日社交动作加权计数（好友+3/亲缘+5/送礼+1/帮贡+1/签到+1/情报+2，动作口径复用 4.1）
- 每周一 00:00 结算（定时任务，复用 config 模块既有调度模式或惰性结算——首次查询上周活跃时结算，最简）：活跃值 ≥100 发 4 档（10/30/60/100，每档一个宝箱）、≥60 发 3 档、≥30 发 2 档、≥10 发 1 档；档位奖励递增
- 领取接口：`POST /api/client/v1/social/chest/:id/open`（校验 status=PENDING）
- 奖励配置：`remote_configs social.chest_rewards`（json：分档/档位 → 概率权重表，奖励为钻石/金币/礼物/修炼资源）

**积分兑换宝箱**

- `POST /point/exchange` `{ chestType: POINT_EXCHANGE, tier }`：消耗积分（档位 1/2/3 对应 50/150/400），创建 PENDING 宝箱，写 SPEND 流水
- 开启同上 `POST /chest/:id/open`

### 4.3 补签（聊天签到断签保护）

- 接口：`POST /api/client/v1/chat/sign-in/makeup` `{ date }`（chat 模块）
- 校验：
  1. `date` 为过去日期（非今日、非未来），格式 YYYY-MM-DD
  2. 该日无签到记录（已签到报 `CHAT_SIGN_IN_DONE`）
  3. 补签次数未超月度上限（`remote_configs chat.makeup_monthly_limit`，默认 3 次，按自然月计数）
  4. 社交积分余额 ≥ 补签消耗（`remote_configs chat.makeup_cost`，默认 50）
- 成功：扣积分（SPEND 流水 reason=SIGN_IN_MAKEUP）→ 写 chat_sign_ins（sign_in_date=补签日，reward_json 标记 `{ makeup: true }`，奖励照常）→ emit `CHAT_SIGN_IN`
- 月度次数统计：Redis key `chat:makeup:{playerId}:{YYYYMM}` 计数

## 5. B 部分 · 封禁社交后果（三项全做）

### 5.1 联动时机

`community.service.handleReport` 处置 `action=BAN` 时，`applyPenalty` 落库后自动执行三项社交后果（按序，任一失败不影响其他，记录 GM 日志）：

1. **称号收回**：删除该玩家 `character_title` 全部记录（含大使/成就/VIP 称号），GM 日志留痕「称号收回 N 条」；玩家重新获得需重新达成条件
2. **帮派除名**：删除 `guild_members` 记录；若为帮主：先触发帮主移交（存在副帮主则按职位顺序移交，否则帮派解散并广播），写入帮派日志；成员除名发通知
3. **榜单移除**：调用 ranking 服务移除该玩家全部榜单（Redis zset 删除 + `ranking_records` 标记 removed），GM 日志留痕

### 5.2 接口

- 既有 `POST /api/admin/v1/community/reports/:id/handle`：action=BAN 时自动执行（无新接口）
- 新增 `POST /api/admin/v1/community/players/:playerId/social-cleanup`：对历史封禁玩家补执行三项后果（幂等：执行前检查该玩家是否已无称号/无帮派/无榜单记录，全空则报 `CLEANUP_ALREADY_DONE`）

### 5.3 幂等与审计

- 三项后果均记录 GM 操作日志（复用 adminService.logOperation），重复执行以现状为准（无记录可删则跳过，不报错）
- BAN 处置本身仍受批 1 幂等约束（已处理举报拒绝重复处理）

## 6. C 部分 · VIP 特权全量实现 + 充值状态机

### 6.1 特权键约定（privilege_json 结构化）

| 键 | 类型 | 默认（非 VIP） | 说明 | 落地点 |
|---|---|---|---|---|
| friendSlots | int | 50 | 好友位上限 | social friend/apply 校验上限时读该键 |
| dailyGiftCap | int | 20 | 每日送礼上限 | social gift/send 校验 GIFT_DAILY_CAP 时读该键 |
| vipAuction | bool | false | 专属拍卖室 | trade 拍卖列表/竞价按 `vipAuction` 过滤 VIP 专属场 |
| vipTitleId | string | null | VIP 称号模板 ID | character_title 发放（vip 服务在达到等级时发放） |
| guildBuildBoost | number | 0 | 帮派建筑加速（0~0.9） | guild building 升级时长 × (1 - boost) |
| guildContribBonus | number | 0 | 帮贡加成（0~1） | social 帮贡获得时 × (1 + bonus) |

- `vip.service` 新增 `getPrivilegeValue(playerId, key, fallback)`：读玩家当前等级 privilege_json 的键，缺省返回 fallback；各落地点只调该方法，不感知 VIP 结构
- **帮派受益**（手册 12.4）：帮派内任一 VIP 成员的 `guildContribBonus` 同时加成自己帮贡；建筑加速对全帮生效（成员发起升级时取帮内最高 boost）

### 6.2 充值状态机完善

**状态机**：`PENDING 待支付 → PAID 已支付（奖励已发）→ DELIVERED 已发货`；`PENDING → CANCELLED 已取消 / EXPIRED 已超时`；`PAID → FAILED 发货失败（异常留痕）`

- **回调即发奖**：保持现状——`handleCallback` 验证签名 → 发奖励 → `addVipExp` → 状态置 `DELIVERED`（PAID 仅作为回调成功后的中间态存在，不单独驻留；历史 PAID 记录视为已发货）
- **取消**：`POST /api/client/v1/payment/order/:orderNo/cancel`：仅 PENDING 可取消（否则 `ORDER_CANCEL_INVALID`）
- **超时**：PENDING 超 30 分钟自动置 EXPIRED（惰性：查询/取消时校验 createdAt，命中则先置 EXPIRED 再报 `ORDER_EXPIRED`；不引入定时任务）
- **admin 补单**：`POST /api/admin/v1/payment/orders/:id/deliver`：对 PENDING/PAID 订单手动发货（校验金额与商品，发奖励 + addVipExp + 置 DELIVERED + GM 日志），用于支付成功但回调丢失场景
- `getAdminOrderList` 补 `status` 筛选参数（可选）

### 6.3 充值 → VIP 经验

- `handleCallback` 发奖后：`vipService.addVipExp(order.playerId, floor(amount) * vipExpPerCny)`；`vipExpPerCny` 默认 1，`remote_configs payment.vip_exp_per_cny` 可调
- `addVipExp` 已处理升级判断并 emit `VIP_LEVEL_UP`（player.service 既有能力），VIP 称号发放监听该事件：达到等级且有 `vipTitleId` 且未持有 → 发放

## 7. D 部分 · PVP 天梯竞技 + 新手保护期

### 7.1 天梯竞技（手册 9.7 简化落地）

**数据模型（新增 1 表）**

`ladder_records` 天梯段位

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | |
| player_id | bigint | |
| season | varchar(16) | 赛季号（`remote_configs ladder.season`，默认 1） |
| score | int | 段位分（初始 1000） |
| wins | int | 胜场 |
| losses | int | 负场 |
| streak | int | 连胜（负归零） |
| updated_at | timestamp | |

唯一索引 `(player_id, season)`；索引 `(season, score)`。

**玩法流程**

1. 进队：`matchmaking` 支持 `mode='ladder'`（复用既有队列机制，无需改匹配内核）
2. 结算：匹配成功（MATCH_SUCCESS）→ 天梯服务按双方战力 + 随机因子判定胜负（胜者 60% 基础概率，战力差每 ±10% 修正 ±10%，新手保护期作为防御方时胜率 +15%）→ 更新段位分：胜 +20 + 连胜 ×5（上限 +50），负 -15（保底 100）；写 wins/losses/streak
3. 榜单：`GET /api/client/v1/ladder/rank?limit=` 当前赛季 score 降序（复用 ranking 机制或直接查表）
4. 赛季：`GET /api/client/v1/ladder/info` 返回 `{ season, score, rank, wins, losses, streak, tier }`（tier 由分数区间映射：青铜 <1100 / 白银 <1300 / 黄金 <1600 / 宗师 ≥1600，纯展示）；admin `POST /api/admin/v1/ladder/settle` 结算当前赛季（按段位发称号/奖励，写入 GM 日志，score 重置 1000，season +1）

### 7.2 新手保护期（手册 15.5/15.6）

- **判定**：`player.createdAt` 距今 < `remote_configs pvp.newbie_protect_days`（默认 7 天）
- **效果**：
  1. **伤害衰减**：保护期玩家作为防御方时，攻击方对其 PVP 伤害 × (1 - `pvp.newbie_damage_reduction` 默认 0.3)——天梯判定与既有 PVP 入口（切磋/恩怨战）统一在 combat 结算钩子读取该规则
  2. **红名不可主动攻击新手**：恶名玩家（恶名值 > 0，即通缉/红名状态）对新手发起 PVP/仇人战/劫镖等攻击类动作时拦截，错误码 `RED_NAME_TARGET_PROTECTED`；新手主动攻击不受限（互殴从新手意愿）
- **接口**：`GET /api/client/v1/player/protection` 返回 `{ protected: bool, daysLeft }`（前端展示新手护盾）

## 8. E 部分 · 新手引导深化（进度追踪 + 奖励）

### 8.1 数据模型（新增 1 表）

`guide_progresses` 引导进度

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | |
| player_id | bigint | |
| day | int | 1-8（对应 getDailyGuide 天数） |
| task_id | varchar(24) | kinship / friend / intel / guild / escort / gift / sworn / daily |
| status | varchar(16) | 枚举：TODO / DONE / REWARDED |
| completed_at | timestamp | 可空 |
| claimed_at | timestamp | 可空 |
| created_at | timestamp | |

唯一索引 `(player_id, day, task_id)`。

### 8.2 事件驱动完成（补齐硬编码缺口）

| day | task_id | 完成事件 | 说明 |
|---|---|---|---|
| 1 | kinship | KINSHIP_FORMED | 拜师/结义 |
| 2 | friend | FRIEND_ADDED | 添加好友 |
| 3 | intel | INTEL_GAINED | 获取情报 |
| 4 | guild | GUILD_JOINED | 入帮/建帮 |
| 5 | escort | QUEST_COMPLETED（运镖/悬赏类）或 BOUNTY_COMPLETED | 首次运镖/悬赏（原硬编码 false） |
| 6 | gift | GIFT_SENT | 首次送礼（原硬编码 false） |
| 7 | sworn | KINSHIP_FORMED（type=结义或拜师传承） | 结义/拜师传承 |
| 8 | daily | PLAYER_ONLINE（每日登录一次） | 日常循环 |

- 完成写入：social 模块订阅上述事件，校验任务未 DONE → 置 DONE + 发奖励（社交积分 +20/任务，见 4.1）→ `claimed` 状态由玩家领取（见 8.3）；D7 额外发里程碑奖励（`remote_configs guide.milestone_reward`，默认钻石 50）

### 8.3 接口

- `GET /api/client/v1/social/guide/daily`（升级既有）：返回 `{ day, title, tasks: [{ id, desc, done, rewarded }], stats, rewardReady }`
- `POST /api/client/v1/social/guide/tasks/:taskId/claim`：领取已完成任务奖励（status DONE→REWARDED，写 GUIDE_TASK 积分流水 + 发基础奖励，幂等：已 REWARDED 报 `GUIDE_REWARD_CLAIMED`）
- 老玩家（注册 >7 天）访问：按原逻辑返回 day=8 日常循环视图，不补建历史进度

## 9. 错误处理

新增错误码（constants/error-codes.ts，按既有分区编排）：

| 分区 | 错误码 | 场景 |
|---|---|---|
| 社交经济 92301-92399 | `POINT_NOT_ENOUGH` | 积分不足（兑换/补签） |
| | `CHEST_NOT_FOUND` | 宝箱不存在 |
| | `CHEST_ALREADY_OPENED` | 宝箱已开启 |
| | `WEEKLY_CHEST_EMPTY` | 本周无待结算活跃宝箱 |
| | `MAKEUP_LIMIT_EXCEEDED` | 补签超月度上限 |
| | `MAKEUP_INVALID_DATE` | 补签日期非法（今日/未来/已签到） |
| 封禁后果 92401-92499 | `CLEANUP_ALREADY_DONE` | 社交后果已执行（无待清理项） |
| VIP/充值 92501-92599 | `ORDER_CANCEL_INVALID` | 订单不可取消（非 PENDING） |
| | `ORDER_EXPIRED` | 订单已超时（自动置 EXPIRED） |
| PVP 92601-92699 | `RED_NAME_TARGET_PROTECTED` | 红名不可主动攻击新手 |
| 引导 92701-92799 | `GUIDE_TASK_NOT_DONE` | 任务未完成不可领奖 |
| | `GUIDE_REWARD_CLAIMED` | 奖励已领取 |

## 10. 测试策略

- **单元（TDD，批 1 同风格）**：
  - social：积分来源记账/每日上限/关系对去重/流水查询、宝箱兑换扣分/开启概率奖励/周活跃分档结算、引导事件驱动完成/领奖幂等/里程碑奖励
  - chat：补签校验（日期/已签到/月度限次/积分扣减）、补签写记录
  - community：BAN 处置联动三项后果（称号删除/帮派除名含帮主移交/榜单移除）、补执行幂等
  - vip：getPrivilegeValue 键读取/缺省 fallback、VIP 称号发放（VIP_LEVEL_UP 监听）
  - payment：状态机流转（取消/超时惰性/补单发货）、充值加 VIP 经验、deliver 幂等
  - matchmaking/combat：天梯胜负判定（战力修正/保护期胜率加成/保底分）、新手保护伤害衰减/红名拦截
  - player：protection 接口（protected/daysLeft）
- **冒烟**：新增 `scripts/smoke-stage5b.sh`（复用 smoke-stage5.sh 结构），覆盖：社交动作积分累计→兑换宝箱→开启、周活跃宝箱结算、签到补签、BAN 处置后称号/帮派/榜单三项验证、VIP 特权生效（送礼上限提高/好友位扩容）、充值取消/超时/补单/加经验、天梯匹配→结算→榜单、新手保护（伤害衰减/红名拦截）、引导任务完成→领奖
- **回归**：阶段 1~5 批 1 既有冒烟（111 + 54 + 57 + smoke-stage5.sh）不回归——本批新增积分/特权/保护均为增量校验，不改既有放行逻辑

## 11. 风险与护栏

| 风险 | 缓解 |
|---|---|
| 积分通胀（社交动作刷分） | 每日上限 + 关系对去重 + 消费出口（宝箱/补签）回笼 |
| 宝箱随机奖励失衡 | 概率权重表进 remote_configs，可热调；奖励为展示/资源类，不碰硬战力 |
| 补签滥用 | 月度限次 + 积分消耗，Redis 计数防绕 |
| BAN 社交后果不可逆 | GM 日志全留痕 + 台账透明；称号/帮派/榜单均为可重建数据 |
| 帮主除名引发帮派动荡 | 副帮主按职位移交，无副帮主则解散并广播；与既有弹劾机制一致 |
| VIP 特权改数值平衡 | 特权仅便利/展示/集体受益，不提供战力加成（手册 12.3 哲学） |
| 充值状态机补单重复发货 | deliver 幂等（DELIVERED 拒绝重发）+ 签名校验 + GM 日志 |
| 天梯判定随机性争议 | 战力修正 + 保护期加成公开透明；段位分只进不退（保底）安抚挫败 |
| 新手保护被绕过 | 判定统一收敛 player 模块 `isNewbie(playerId)`，各入口调用，不留直查 |

## 12. 验收标准

1. 社交动作事件驱动累计积分（关系对去重 + 每日上限生效），流水可查；积分可兑换宝箱、补签
2. 周活跃宝箱按分档（10/30/60/100）结算，开启获得配置概率奖励；积分兑换宝箱扣分正确
3. 聊天签到断签可补签（扣积分 + 月度限次），补签记录可查
4. BAN 处置自动执行称号收回/帮派除名（含帮主移交）/榜单移除，GM 日志留痕；历史封禁可补执行（幂等）
5. VIP 五特权 + 帮贡加成全部在玩法链路生效（配置驱动），充值成功加 VIP 经验并可升级
6. 充值状态机完整（PENDING/PAID/DELIVERED/FAILED/CANCELLED/EXPIRED），取消/超时/补单可用且幂等
7. 天梯匹配→胜负判定→段位分/连胜/榜单全链路可用，赛季结算可开新赛季
8. 新手保护期生效：PVP 伤害衰减 + 红名不可主动攻击新手（保护期天数/衰减率可配置）
9. 引导任务事件驱动完成（含原硬编码 escort/gift），奖励可领取（幂等），D7 里程碑奖励发放
10. smoke-stage5b.sh 全绿，阶段 1~5 批 1 既有冒烟全量回归通过
