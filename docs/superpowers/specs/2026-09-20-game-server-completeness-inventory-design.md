# 社交游戏服务器 · 功能完备度盘点（以《江湖录》手册为基线）

> 日期：2026-09-20
> 状态：盘点报告（非设计方案，不含实施步骤）
> 盘点对象：`nest/packages-game/game-server`（NestJS 11 + TypeORM + PostgreSQL + Redis/BullMQ + Socket.IO）
> 设计基线：`nest/manual-src/main-part.html`（18 章正文）

## 1. 方法与判定口径

### 1.1 基线选取

手册由四个源文件合并生成，其中两类内容性质不同，必须区分：

| 手册部分 | 性质 | 是否可作基线 |
|---|---|---|
| main-part.html 章节正文（18 章） | 人写的机制设计 | ✅ 是基线 |
| api-part.html 附录 A 接口索引 | 由代码 `routes.txt` 逆向生成 | ❌ 是代码快照，非设计 |
| dict-part.html 附录 B 数据字典 | 由代码 `entities-summary.txt` 逆向生成 | ❌ 是代码快照，非设计 |

因此本盘点的做法是：**以章节正文描述的机制为基线，逐条到代码中验证**，而不是用附录 A/B 自证。

### 1.2 判定四态

| 状态 | 定义 |
|---|---|
| 已实现 | 实体表 + service 业务逻辑 + 对外接口（客户端 `/api/client/v1` 或 GM `/api/admin/v1`）三者齐备 |
| 部分 | 有表或部分逻辑，但缺关键分支或缺对外接口 |
| 仅表 | 实体存在，但无 service 逻辑或无任何对外接口 |
| 缺失 | 设计中有，代码中无表/逻辑/接口 |

机械校验的两个前提事实：全仓 `src/` 无 TODO/空实现残留（仅 `social-guide.service.ts` 的 `GuideTaskStatus.TODO` 属业务枚举）；`app.module.ts` 已注册全部 39 个模块，无"写了没接线"的模块。因此下述缺口均为**未写**，而非**未接**。

## 2. 总账

**414 个可落地机制点**（跨 18 章逐条统计）：

| 状态 | 数量 | 占比 |
|---|---|---|
| 已实现 | 141 | 34% |
| 部分 | 137 | 33% |
| 仅表 | 12 | 3% |
| 缺失 | 124 | 30% |

一句话结论：**骨架完整、末梢大量缺失**。基础表结构与主链路接口覆盖度高（39 模块/103 客户端接口/60+ admin 接口），但"机制细则"层成片空白；第 5、6、8 三章合计 178 项（占 43%），恰是完备度最低的三章。

### 分章分布

| 章 | 已实现/部分/仅表/缺失 | 合计 | 章 | 已实现/部分/仅表/缺失 | 合计 |
|---|---|---|---|---|---|
| 2 账号与权限 | 5/6/1/4 | 16 | 11 交易与拍卖 | 5/9/0/11 | 25 |
| 3 玩家与角色 | 6/4/6/2 | 18 | 12 充值与 VIP | 5/2/0/1 | 8 |
| 4 背包与道具 | 5/3/0/6 | 14 | 13 运营与数据 | 11/3/0/1 | 15 |
| 5 世界与场景 | 12/25/2/17 | 56 | 14 实时通信 | 8/12/0/11 | 31 |
| 6 战斗与技能 | 7/22/0/27 | 56 | 15 新手引导 | 7/7/0/6 | 20 |
| 7 任务与成就 | 10/6/1/5 | 22 | 16 生态联动 | 19/3/0/3 | 25 |
| 8 社交系统 | 18/30/1/17 | 66 | 17 养成长线 | 8/0/0/0 | 8 |
| 9 活动与签到 | 4/2/1/6 | 13 | 18 探索与奇遇 | 8/0/0/0 | 8 |
| 10 排行 | 3/3/0/7 | 13 | — | — | — |

完备度最高的三章：17 养成长线（8/8 全实现）、18 探索与奇遇（8/8 全实现）、16 生态联动（19/25 已实现）。

## 3. 六条横切问题（优先级高于单章缺口）

### 3.1 成就系统是死功能

- 成就进度推进逻辑不存在：`event-bus/event-listeners.service.ts:106-125` 两处仅剩注释占位 `// Achievement progress update would go here`（币变、获得道具两个事件）。
- 领奖不发奖：`achievement/achievement.service.ts:97-105` 把 `isRewardClaimed` 置真后**只把 `rewardJson` 回显给前端**，未走任何货币/道具/邮件发放链路。
- 影响：玩家领奖 = 标记已领 + 什么都拿不到；且状态不可回滚。10.7 荣誉系统、7.7 成就墙/称号/分享一并缺失。

### 3.2 排行榜数据是假的

- `ranking/ranking.service.ts:46-54` `getTopN` 中 `score: 0` 硬编码；`createSnapshot`（同文件 74-87）据此把 `rankValue` 写成 `'0'` 落库。
- 榜单类型仅 战力/等级/财富 三类（`constants/enums.ts:496-500`），设计中的社交榜（人气/帮贡/情义/谍报）、新手榜、帮派榜、荣誉墙全缺。
- 无发奖邮件、无上榜播报、无围观打赏等社交互动接口。

### 3.3 成批"有字段无逻辑"（后台能填、代码不读）

运营配置后静默不生效，是最容易踩雷的一类。已知清单：

| 位置 | 字段 | 现状 |
|---|---|---|
| `activity/entities/activity-template.entity.ts:45-49` | `condition_json`、`max_participants` | 参与校验不读取 |
| `quest/entities/quest-template.entity.ts:42-55` | `prerequisite_ids`、`accept_limit`、`auto_reward` | 前置链/限次/自动发奖无逻辑 |
| `notice/entities/notice.entity.ts:22-48` | 生效时间窗 | 时间窗未生效 |
| `item-template.entity.ts` | 强化上限、耐久 | 字段缺失（4.10 整节） |
| `analytics/analytics.service.ts:103` | 行为日志 IP | 恒为 `null` |
| `auth/entities/auth-account.entity.ts:41-45`、`player.entity.ts:42-48` | `bind_phone`/`bind_email`/安全密码 | 无接口无校验 |
| `scene-trigger.entity.ts:38-40` | `condition`、`once_only` | `once_only` 未落地 |
| `scene.entity.ts:48` | 进入人数上限 | 无校验 |

### 3.4 GM 后台 UI 严重欠账

代码侧 `@Controller('api/admin...')` 共 19 个控制器、**60+ 个 admin 路由处理器**（另有部分 admin 路由内嵌在客户端控制器中）；而 GM 后台 `admin/index.html:435-446` 只有 **4 个菜单**：仪表盘 / 玩家管理 / 道具管理 / 操作日志。

无 UI 入口的运营能力（只能 curl 调用）包括：风控工单与回收（risk-admin）、对账（reconcile-admin）、经济宏观看板（economy-admin）、活动灰度与回滚、举报处置、封禁分级处置、天梯赛季、奇遇/境界模板 CRUD、余额审计。

### 3.5 账号安全缺口（第 2 章相关）

- GM token 无过期：`auth/admin-auth.service.ts:57-59` 签发时未传 `expiresIn`，签发即永久有效。
- 无 logout、无改密/找回密码、无账号级失败锁定（仅有 IP 维度 60s/5 次限流）。
- 无会话表 → 无法查看在线设备、无法踢下线；现为 `tokenVersion` 每次登录自增（`auth.service.ts:151-155`），实际效果是**强制单端登录**，且这是隐性行为、未在任何文档中声明。
- 防沉迷只有开关（`auth.service.ts:447-449`），无时长/时段限制；实名已实现（AES + 身份证 hash）。
- 登录日志有 `region` 字段但恒空；异地登录仅记事件、不拦截。

### 3.6 经济泵没有装

- 交易链路无手续费、无成交税：`trade/trade.service.ts:156-188` 拍卖上架只过风控闸（riskGate），不扣费。
- 无钻石→金币回收路径；货币兑换仅开放 钻石↔绑定钻石（`economy/economy.service.ts:173-192`）。
- 结果：手册 11.13「投放有门、回收有泵」的通胀治理只有看板（`economy-dashboard.service.ts:51`）与阈值指标，泵端为空。

## 4. 分章明细

> 证据列省略公共前缀 `nest/packages-game/game-server/src/`；行号为盘点时点快照。

### 第 2 章 · 账号与权限

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 2.1 | 普通/游客/SSO 账号注册登录 | 已实现 | modules/auth/auth.service.ts:74-190,197-255 | — |
| 2.1 | 游客转正绑定引导 | 缺失 | modules/auth/auth.service.ts:163-190 | 无绑定转化接口 |
| 2.2 | 封禁原因 + 到期自动解封 | 已实现 | modules/auth/auth.service.ts:123-135 | — |
| 2.2 | token_version 全员下线 | 部分 | modules/auth/auth.service.ts:151-155,291-299 | 无 GM 强制下线 |
| 2.3-2.4 | 双令牌/四级角色/GM 留痕表 | 已实现 | common/guards/admin.guard.ts:41-58；auth/entities/admin-user.entity.ts:23；admin/entities/gm-operate-log.entity.ts:9 | — |
| 2.3 | 管理员账号管理（增删改） | 缺失 | modules/auth/admin-auth.controller.ts:12-17 | 仅登录接口 |
| 2.4 | 登录日志 IP/设备/地区 | 部分 | modules/auth/auth.service.ts:485-491 | region 恒空 |
| 2.5 | 异地登录风控二次验证 | 部分 | modules/auth/auth.service.ts:494-513 | 只记事件未拦截 |
| 2.5 | 安全密码/手机邮箱找回 | 仅表 | player/entities/player.entity.ts:42-48；auth/entities/auth-account.entity.ts:41-45 | 无校验与接口 |
| 2.5 | 冻结与申诉 | 缺失 | modules/auth/auth.service.ts:364-369 | 无冻结/申诉流程 |
| 2.6 | 分级处置警告→封禁 + 留痕 | 部分 | modules/auth/auth.service.ts:305-362；modules/admin/admin.service.ts:28-37 | GUILD_REMOVE 无执行 |
| 2.6 | 封禁社交后果清理 | 已实现 | modules/community/community.service.ts:361-409 | — |
| 2.6 | 封禁公示 + 信用分修复 | 缺失 | modules/community/community.service.ts:361-409 | 无公示与信用分 |
| 2.7 | 社交仲裁/战斗调解 | 部分 | modules/combat/combat.client.controller.ts:203-224 | 非 GM 权限路由 |
| 2.8 | 实名认证 | 已实现 | modules/auth/auth.service.ts:405-419；auth.controller.ts:87-96 | — |
| 2.8 | 防沉迷时长/时段 | 部分 | modules/auth/auth.service.ts:447-449 | 仅开关无时长限制 |

本章小结：已实现 5 / 部分 6 / 仅表 1 / 缺失 4

### 第 3 章 · 玩家与角色

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 3.1 | 档案（等级/经验/VIP/充值/在线） | 已实现 | player/entities/player.entity.ts:27-57；player.service.ts:142-190 | — |
| 3.1 | 安全密码二次验证 | 仅表 | player/entities/player.entity.ts:42-48 | 无校验逻辑 |
| 3.2 | 职业（19 种）与特长效率 | 部分 | character/character.service.ts:139,212-219 | 效率系数无产出结算 |
| 3.3 | 五大属性/忠诚 | 已实现 | character/character.controller.ts:66-79 | — |
| 3.3 | 战力合成 | 部分 | realm/realm.service.ts:185-190 | 无属性/装备综合式 |
| 3.4 | 五类需求（马斯洛） | 仅表 | character/entities/character-needs.entity.ts:23-31 | 无满足/下降逻辑 |
| 3.5 | 资质与特长配置 | 仅表 | character/character.service.ts:204-219 | 无变更接口 |
| 3.6 | 关系网络（好感/等级/历史） | 已实现 | character/character.service.ts:428-510 | — |
| 3.6 | 角色记忆表 | 仅表 | character/character.service.ts:242-252 | 无读写接口 |
| 3.7 | 阵营/阵营等级 | 已实现 | character/character.controller.ts:111-124 | — |
| 3.7 | 阵营关系联动（组队/交易） | 缺失 | character/character.service.ts:174-181 | 无组队/交易联动 |
| 3.8 | 入魔体系（×1.5/魔名/猎杀） | 仅表 | character/entities/character-darkened.entity.ts:22-56 | 无入魔/猎杀逻辑 |
| 3.9 | 谍报体系（刺探/渗透/升级） | 已实现 | social/social.service.ts:1453-1466；social.controller.ts:298-334 | — |
| 3.10 | 生存消耗/饥饿/离线结算 | 仅表 | character/character.service.ts:233-241 | 无离线结算 |
| 3.11 | 状态/位置/资源/伙伴/特效 | 部分 | character/character.controller.ts:81-139；character.service.ts:261-268 | 伙伴/特效无逻辑接口 |
| 3.12 | 形象/时装/挂件/展示模式 | 缺失 | character/entities/character-profile.entity.ts:22-32 | 无捏脸时装挂件 |
| 3.12③-3.13① | 称号显示/名号诗号 | 已实现 | character/character.service.ts:512-576 | — |
| 3.13 | 传记/魔名/世代家族 | 部分 | character-profile.entity.ts:40-41；character-status.entity.ts:46-50 | 传记无生成逻辑 |

本章小结：已实现 6 / 部分 4 / 仅表 6 / 缺失 2

### 第 4 章 · 背包与道具

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 4.1 | 物品模板（类型/稀有度/堆叠/交易掉落/绑定） | 已实现 | inventory/entities/item-template.entity.ts:19-48；inventory-admin.controller.ts:40-47 | — |
| 4.2 | 背包（数量/格子/绑定/过期/附加属性） | 已实现 | inventory/entities/inventory-item.entity.ts:22-46；inventory.controller.ts:18-22 | — |
| 4.3-4.4 | 五槽位装备唯一 + 道具变更审计 | 已实现 | inventory/entities/character-equipment.entity.ts:14-28；inventory.service.ts:84-93,138-147 | — |
| 4.5 | 社交标签/道具来处 | 缺失 | inventory/entities/item-template.entity.ts:19-54 | 无社交标签与来源字段 |
| 4.6① | 稀有度特效分级 | 部分 | constants/enums.ts:107 | 无外观光效逻辑 |
| 4.6② | legendary 全服播报 | 缺失 | item-drop/drop.service.ts:20-75 | 掉落无播报 |
| 4.6③④ | 套装称号/炫耀橱窗 | 缺失 | inventory/entities/item-template.entity.ts:53-54 | 无套装与展示模式 |
| 4.7 | 礼物体系（权重/送礼/防刷） | 已实现 | social/entities/gift-template.entity.ts:11-14；social.service.ts:1490-1515 | — |
| 4.7 | 红包道具/节日彩礼场景 | 缺失 | social/social.service.ts:1479-1571 | 无红包与场景分型 |
| 4.8 | 限定绝版/防通胀/复刻投票 | 部分 | activity/entities/activity-template.entity.ts:49 | 无绑定限量联动与复刻 |
| 4.9 | 容量扩充/仓库/整理/套装方案 | 缺失 | inventory/entities/inventory-item.entity.ts:22-46 | 无容量与整理能力 |
| 4.9 | 帮派仓库/家园展示柜 | 缺失 | social/social.controller.ts:268-296 | 仅帮贡兑换无共享仓 |
| 4.9 | 赠予与转交 | 部分 | social/social.service.ts:1509-1514 | 送礼不转移对方库存 |
| 4.10 | 强化上限/耐久/迭代平衡 | 缺失 | inventory/entities/item-template.entity.ts:19-54 | 无强化耐久字段 |

本章小结：已实现 5 / 部分 3 / 仅表 0 / 缺失 6

### 第 5 章 · 世界与场景

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 5.1 | 场景表/类型/尺寸/图层/等级门槛/进入接口 | 已实现 | world/entities/scene.entity.ts:12；world.service.ts:110,133；gateway/game.gateway.ts:159 | — |
| 5.1 | 人数上限 max_players | 仅表 | world/entities/scene.entity.ts:48 | 无进入人数校验 |
| 5.2 | region 区域枚举与位置更新 | 部分 | character/entities/character-location.entity.ts:29；character.controller.ts:81 | 未联动资源产出/安全等级 |
| 5.3 | NPC/怪物模板（交互/掉落/AI/仇恨） | 部分 | world/entities/npc-template.entity.ts:12；monster-template.entity.ts:12；world.service.ts:154,158 | 无 admin CRUD/刷怪运行时 |
| 5.3 | 物件模板（采集/CD/一次性/奖励） | 已实现 | world/entities/object-template.entity.ts:12；world.service.ts:166 | — |
| 5.3 | 刷怪点 scene_entity_spawns | 部分 | world/entities/scene-entity-spawn.entity.ts:14；world.controller.ts:49 | 仅查询，缺增删改 |
| 5.4 | 触发器四类 transport/story/battle/activity | 仅表 | world/entities/scene-trigger.entity.ts:16；world.service.ts:248 | 激活接口仅支持机关类 |
| 5.4 | 条件 condition / 单次 once_only | 部分 | scene-trigger.entity.ts:38,40；world.service.ts:255 | once_only 未落地 |
| 5.4 | 剧情社交条件（情报/好感/帮贡） | 缺失 | scene-trigger.entity.ts:37 | 无社交条件判定 |
| 5.5 | 城镇功能区布局（茶楼/擂台/摆摊等） | 缺失 | world/entities/scene.entity.ts:11 | 无功能区表/配置 |
| 5.6 | 附近频道/区域广播/手势+聚集召集/分线 | 缺失 | constants/enums.ts:442；gateway/game.gateway.ts:194 | 仅 world/private/guild，无分线 |
| 5.6 | 偶遇机制（场景移动触发） | 已实现 | explore/explore.service.ts:182 | — |
| 5.7 | 采集区同点多人采集/共享加成 | 部分 | world/world.service.ts:177 | 冷却按玩家，无共享加成 |
| 5.7 | 猎杀区入魔者/帮派资源点/镖线对峙 | 缺失 | social/community.controller.ts:28 | 无入魔者、据点、运镖 |
| 5.8 | 副本类型与秘境入口集结 | 部分 | constants/enums.ts:189 | 仅 SceneType.DUNGEON 枚举 |
| 5.8 | 组队自动匹配 | 已实现 | matchmaking/matchmaking.service.ts:21 | — |
| 5.8 | 副本首通播报/周通关榜 | 缺失 | ranking/ranking.service.ts:38 | 排行仅战力/等级/财富 |
| 5.9① | 定时社交事件排期 | 部分 | activity/entities/activity-template.entity.ts:25 | 有活动排期，无场景事件 |
| 5.9② | 动态世界事件（BOSS/商队/通缉播报） | 缺失 | activity/activity.controller.ts:30 | 无世界事件编排 |
| 5.9③ | 社交条件触发器 | 部分 | quest/quest.service.ts:176 | 仅任务前置社交条件 |
| 5.10① | 手势/表情动作（作揖/招手/挑衅） | 缺失 | constants/enums.ts:245 | InteractType 无手势类 |
| 5.10② | 坐席系统（落座/占用/同席频道） | 部分 | constants/enums.ts:249；world/world.client.controller.ts:38 | 无占用与同席频道 |
| 5.10③ | 装饰留言（祈福墙/留言板/涂鸦） | 部分 | world/entities/landmark-message.entity.ts:10 | 仅地标留言 |
| 5.11 | NPC 社交媒介（情报/悬赏/牵线） | 部分 | social/social.controller.ts:298,316；trade/trade.controller.ts:232 | 能力有，未绑定到 NPC |
| 5.11 | NPC 好感影响场景功能 | 缺失 | world/entities/npc-template.entity.ts:12 | 模板无好感字段 |
| 5.11 | NPC 传话/随机委托 | 部分 | offline/offline-sync.service.ts:75；quest/quest.controller.ts:39 | 无 NPC 传话/场景委托入口 |
| 5.12 | 昼夜/天气状态 | 已实现 | explore/explore.service.ts:85 | — |
| 5.12 | 天气影响/场景氛围标识 | 部分 | explore/explore.service.ts:204 | 仅奇遇触发率，无氛围字段 |
| 5.13 | 安全区禁 PK/红名不可入 | 缺失 | combat/face.service.ts:147 | 仅红名新手保护 |
| 5.13 | 决斗流程（邀请/围观/入 combat_logs） | 部分 | combat/combat.controller.ts:13 | 无决斗邀请与围观 |
| 5.13 | 场景仇恨记忆/执法公示 | 部分 | combat/face.service.ts:140 | 仇人按玩家记，无场景留痕 |
| 5.14 | 场景剧情舞台/NPC 大事件 | 缺失 | quest/quest.controller.ts:39 | 剧情无场景上演机制 |
| 5.14 | 玩家自办活动（婚礼/庆典租场） | 缺失 | activity/activity.controller.ts:44 | 活动仅运营发布 |
| 5.14 | 场景留痕与地图故事线 | 部分 | world/entities/landmark-message.entity.ts:10；quest/quest.service.ts:176 | 仅留言，无纪念碑/场景主线 |
| 5.15①② | 物件互动（采集/藏身/坐/躺/刻字） | 已实现 | world/world.client.controller.ts:38；world.service.ts:166 | — |
| 5.15② | 人工物件互动（床/桌/灶台/告示板） | 部分 | world/entities/object-template.entity.ts:12 | 无床/灶台等专属动作 |
| 5.15③④ | 家具制造与摆放 | 缺失 | constants/enums.ts:52 | 无制造/摆放/家园机制 |
| 5.16 | 机关类型（石门/棋盘/密道/陷阱/暗洞） | 部分 | scene-trigger.entity.ts:16；world.service.ts:248 | 仅 puzzle/gate/trap |
| 5.16 | 多人机关配合/全场景广播 | 部分 | world/world.service.ts:255 | 有配合人数，无广播 |
| 5.16 | 机关情报买卖/解谜掉落分赃 | 缺失 | social/social.controller.ts:347；combat/combat.client.controller.ts:181 | 无机关情报与掉落绑定 |
| 5.17 | 坐骑骑乘/切换 | 已实现 | world/entities/player-mount.entity.ts:11；world.client.controller.ts:66 | — |
| 5.17 | 信鸽传书（异步书信） | 部分 | mail/mail.controller.ts:63 | 仅系统发放，无互发信 |
| 5.17 | 宠物伙伴/动物奇遇 | 部分 | character/entities/character-companion.entity.ts:11；explore.service.ts:182 | 有宠物表，无互动/奇遇绑定 |
| 5.18 | 街头小游戏（垂钓/对弈/投壶等） | 已实现 | world/entities/street-game.entity.ts:10；world.service.ts:313 | 类型枚举 5 种，无点位绑定 |
| 5.18 | 围观下注/房主开局结算 | 已实现 | world/world.service.ts:343,379 | — |
| 5.18 | 玩家摆摊开小游戏局/图内排行 | 缺失 | world/world.client.controller.ts:90；ranking/ranking.service.ts:38 | 仅官方配置，排行无小游戏 |
| 5.19 | 资源点位（药草园/矿脉/渔点/农田/酒窖） | 部分 | object-template.entity.ts:22；constants/enums.ts:212 | 无渔点/酒窖等专属类型 |
| 5.19 | 点位社交性（让点/抢点/帮派资源田） | 缺失 | world/world.service.ts:177 | 无让点/帮派资源田 |
| 5.19 | 产出接生产链/区域特产跑商 | 部分 | world.service.ts:223；trade/trade.controller.ts:50 | 有产出与交易，无特产跑商 |
| 5.20 | 路牌留言与查看 | 已实现 | world/entities/landmark-message.entity.ts:10；world.client.controller.ts:121 | — |
| 5.20 | 瞭望塔/驿站换马/组队同程 | 缺失 | world/world.service.ts:270 | 无瞭望塔/驿站机制 |
| 5.20 | 地标打卡合影/地标定时事件 | 缺失 | world/entities/landmark-message.entity.ts:10 | 无打卡展示与地标事件 |
| 5.21①② | 资源分类/供给节奏/可再生度 | 已实现 | object-template.entity.ts:22,25,34 | — |
| 5.21③⑥ | 效率递减/生态退化恢复/日产量上限 | 已实现 | world/resource-balance.policy.ts:41,51,66,73；world.service.ts:203 | — |
| 5.21②③ | 供需比值/价格联动/密度调节/事件注入 | 部分 | world/resource-balance.policy.ts:78 | 纯函数，未接行情/事件 |
| 5.21④⑤ | 采集上限/帮派配额/防挂机/经济回收 | 部分 | world.service.ts:205；resource-balance.policy.ts:73 | 有计数，无帮派配额/回收泵 |

本章小结：已实现 12 / 部分 25 / 仅表 2 / 缺失 17

### 第 6 章 · 战斗与技能

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 6.1 | 技能模板字段 + 释放（CD/内力/伤害/Buff） | 部分 | skill/entities/skill-template.entity.ts:19-51；skill.service.ts:39-101；skill.controller.ts:19 | 无客户端释放接口 |
| 6.2 | 武学熟练（类别独立等级 + 已学技能 + 兼修） | 部分 | character-martial-art.entity.ts:28-32；character.service.ts:403-426 | 等级不约束技能上限 |
| 6.2 | 熟练度成长来源与「拳法第几重」判定 | 缺失 | character.service.ts:403 | 无熟练度成长来源 |
| 6.3 | Buff（增益/减益/目标/时长/属性修正） | 已实现 | buff-template.entity.ts:19-28；buff.service.ts:37-109 | — |
| 6.4 | 三级境界战斗定位 + 伤害分档 | 缺失 | skill.service.ts:76 | 无境界分档与机制差异 |
| 6.5 | 战斗风格四种 | 部分 | character-combat-style.entity.ts:23；matchmaking.service.ts:82 | 无切换接口/无匹配联动 |
| 6.6 | 战斗日志（队伍/类型/结果/伤害明细） | 已实现 | combat/entities/combat-log.entity.ts:26-42 | — |
| 6.6 | 战斗结算写入与查询接口 | 部分 | combat.service.ts:48-121；combat.controller.ts:13 | 无客户端结算入口 |
| 6.7 | 三级武学技能池（境界×类别配置/热更） | 部分 | skill.controller.ts:35-48；skill-template.entity.ts:27 | 无技能池数据与热更 |
| 6.8 | 类别×境界正交 | 部分 | skill-template.entity.ts:19-51 | 无境界维度字段 |
| 6.8 | 兼修取舍（属性分散致单类强度下降） | 缺失 | character.service.ts:403-426 | 无论强度取舍逻辑 |
| 6.9 | 晋升流程（阈值+材料+属性覆盖+里程碑） | 已实现 | realm/realm.service.ts:85-152；realm.controller.ts:37 | — |
| 6.9 | 晋升仪式（突破副本/悟道）+ 三件套资源 | 部分 | realm.service.ts:101-110 | 无副本与专属资源 |
| 6.10①② | 命中/闪避 + 暴击 | 缺失 | skill.service.ts:76 | 无命中暴击计算 |
| 6.10③ | 破防与穿透 | 缺失 | formation.service.ts:303 | 无破防穿透机制 |
| 6.10④ | 五行克制 + 五行附魔 | 缺失 | constants/enums.ts:616 | 无五行属性与克制 |
| 6.10⑤ | 机制克制三层剪刀石头布 | 缺失 | combat.service.ts:73 | 无境界层克制 |
| 6.10⑥ | 连击与合击 | 部分 | rescue.service.ts:28-71；combat.client.controller.ts:108 | 无连击/同步窗口/失衡 |
| 6.10⑦ | 情报弱点（易伤/破防/反制） | 缺失 | combat.service.ts:68 | 情报未接入战斗 |
| 6.10⑧ | 助威与气势（观战加成） | 缺失 | combat.client.controller.ts:240 | 无助威气势系统 |
| 6.10⑨ | 战斗模式（点到为止/生死斗） | 缺失 | constants/enums.ts:620-623 | 枚举未落地 |
| 6.10⑩ | 社交化解（谈判/求饶/劝降） | 缺失 | combat.client.controller.ts:52-244 | 无化解接口 |
| 6.11① | 六种战斗模式准入 | 部分 | combat-log.entity.ts:29；combat.service.ts:82 | 仅日志类型无模式入口 |
| 6.11②③ | 社交化战斗与实时动作 | 缺失 | rescue.service.ts:73 | 无助战求援借力 |
| 6.12 | 成长曲线与平衡校验清单 | 缺失 | skill.service.ts:76 | 无成长与校验口径 |
| 6.13① | 助战能量/并肩标记/组队默契值 | 部分 | formation.service.ts:221-225,249-277 | 仅阵内默契无助战标记 |
| 6.13② | 战斗人情闭环 | 部分 | economy.service.ts:24；rescue.service.ts:101 | 战斗侧未接人情值 |
| 6.13③ | 战斗声望（连击/救场/助战折算） | 缺失 | combat/face.service.ts:27-59 | 无声望折算 |
| 6.13④ | 数值护栏（境界差收益减半/求援冷却） | 部分 | rescue.service.ts:14,89 | 仅援护日限 5 |
| 6.14 | 内功心法槽位 + 打坐/冥想/双修 | 缺失 | — | 心法与修炼缺失 |
| 6.15 | 秘籍获取/残页交易/参悟/师徒传承 | 缺失 | combat.client.controller.ts:52-244 | 秘籍经济全缺 |
| 6.16① | 武学奇遇（触发源/类型/每日上限） | 部分 | explore.service.ts:181,254；encounter-template.entity.ts:17-20 | 通用奇遇非武学类 |
| 6.16②③ | 玄学机缘分级 + 悟道任务链 | 缺失 | explore.service.ts:299 | 无机缘分级与悟道链 |
| 6.17 | 木人桩（练熟练度）+ 演武场切磋 | 缺失 | character.service.ts:403 | 无练功场所 |
| 6.17 | 练功房离线挂机修炼 + 每日软上限 | 缺失 | constants/enums.ts:390 | 无离线修炼结算 |
| 6.18① | 炼丹（药材/配方/属性丹） | 缺失 | combat.client.controller.ts:52-244 | 无炼丹与配方 |
| 6.18②③ | 制毒/淬毒/解毒 + 救死扶伤声望 | 缺失 | — | 无制毒与治疗声望 |
| 6.19① | 阵法（三才/五行/北斗 + 克制 + 默契） | 已实现 | formation.service.ts:22-50,227-306；combat.client.controller.ts:54-98 | — |
| 6.19① | 就位同步（阵型图/10 秒限时） | 部分 | formation.service.ts:201-207 | 仅满员校验无限时 |
| 6.19② | 合击谱/2 秒窗口/失败失衡 | 部分 | rescue.service.ts:28-71 | 仅关系等级加成 |
| 6.20① | 援护挡刀（情谊门槛/日上限） | 部分 | rescue.service.ts:73-104 | 未接入伤害承受 |
| 6.20②③ | BOSS 分工 + 沟通工具（信号盘/标点） | 缺失 | combat.client.controller.ts:52-244 | 无分工与信号盘 |
| 6.21① | 恩怨对决自动触发 + 围观押注 | 部分 | face.service.ts:140-168；arbitration.service.ts:115-124 | 仅恩怨标记无恩怨战 |
| 6.21②③ | 阵前挑战下战书 + 观战情报支援 | 缺失 | combat.client.controller.ts:52-244 | 无挑战与观战情报 |
| 6.22①② | 战后互动 + 江湖快报深化 | 部分 | face.service.ts:170-198；combat.client.controller.ts:234 | 仅战报无榜单/雪耻 |
| 6.22③ | 战败保护「重整旗鼓」Buff | 部分 | face.service.ts:200-205 | 仅缓存标记无加成 |
| 6.23① | 颜面值 + 面子榜 | 部分 | face.service.ts:61-118；player.service.ts:66 | 初始 0/无榜与折扣 |
| 6.23② | 羞辱机制（广播/可拒绝/举报） | 部分 | face.service.ts:120-138 | 无拒绝与举报护栏 |
| 6.24① | 分配模式（贡献/ROLL/队长/均分） | 已实现 | loot.service.ts:58-101；combat.client.controller.ts:181 | — |
| 6.24② | 过目/谢队红包 + 争议仲裁 + 失信 | 部分 | arbitration.service.ts:35；combat.client.controller.ts:217 | 无 GM 守卫与失信 |
| 6.25 | 说和人调解 | 已实现 | arbitration.service.ts:35-137；combat.client.controller.ts:203-230 | — |
| 6.25 | 系统仲裁（声望门槛/GM 审计/广播收益） | 缺失 | combat.client.controller.ts:217 | 无 GM 审计与广播 |
| 6.26 | 三层克制循环 + 五行相生相克 | 缺失 | formation.service.ts:281 | 无流派克制循环 |
| 6.26 | 境界差/装等衰减 + 胜负护栏 + PVP/PVE 分离 | 缺失 | combat.service.ts:68 | 无衰减与分离 |
| 6.26 | 反互刷护栏 + 流派胜率监控 | 缺失 | ladder.service.ts:131 | 无反刷与胜率监控 |

本章小结：已实现 7 / 部分 22 / 仅表 0 / 缺失 27

> 备注：本章现状是"社交化战斗子系统已成型（阵法/合击/援护/颜面/战利品分配/调解仲裁，6 张表），战斗核心数值与武学养成线基本空白"。`CombatMode` 枚举与 `GuildBuildingType.TRAINING_ROOM` 枚举为孤立定义，无任何 service 引用。

### 第 7 章 · 任务与成就

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 7.1 | 模板字段与 Admin CRUD | 已实现 | quest/entities/quest-template.entity.ts:19-55；quest.service.ts:514-543；quest.controller.ts:98-126 | — |
| 7.1 | min_level/accept_limit/auto_reward 生效 | 部分 | quest.controller.ts:52；quest.service.ts:107 | 等级未校验、限次/自动发奖无逻辑 |
| 7.1 | prerequisite_ids 前置任务链 | 仅表 | quest-template.entity.ts:42-43 | 无前置校验逻辑 |
| 7.2 | 四态状态机 + complete_times | 已实现 | player-quest.entity.ts:26-30；quest.service.ts:248-251 | — |
| 7.2 | repeatable / 日常周常周期重置 | 部分 | quest.service.ts:121；scheduler.service.ts:25-37 | 无日/周重置 |
| 7.3 | 成就模板五类七条件 | 已实现 | constants/enums.ts:551-567；achievement-template.entity.ts:22-29 | — |
| 7.3 | 成就进度自动推进 | 缺失 | event-listeners.service.ts:116,124 | 无条件→事件映射（空占位） |
| 7.3 | 成就领奖发奖 | 部分 | achievement.service.ts:97-105 | 仅置标记未实际发奖 |
| 7.4 | 任务类型体系 | 部分 | constants/enums.ts:303-308 | 缺支线/奇遇/悬赏 |
| 7.5 | 社交目标推进 / 社交奖励倾斜 / 社交门槛 | 已实现 | enums.ts:640-675；quest.service.ts:145-211,259-276,354-404 | — |
| 7.6 | 社交解锁节点 | 已实现 | quest.service.ts:157-210 | — |
| 7.6 | 剧情分叉 / 见证 / 回响 | 缺失 | quest-template.entity.ts:42-55 | 无分支、观礼、记忆回写 |
| 7.7 | 成就进度可视 | 已实现 | player-achievement.entity.ts:22-23；achievement.controller.ts:36-40 | — |
| 7.7 | 成就墙 / 称号 / 分享 | 缺失 | achievement.controller.ts:28-50 | 无公开墙、称号、分享 |
| 7.8 | 卡关求助任务 | 已实现 | quest.controller.ts:65-93；quest.service.ts:408-510 | — |
| 7.8 | 组队共享 / 帮派全员 / 师徒带教 | 缺失 | quest.service.ts:332-352 | 无共享与带教任务 |
| 7.9 | 社交配额 | 部分 | quest.service.ts:69-79,358-363 | 仅生态浏览限 10 次 |
| 7.9 | 投放节奏 / 远程配置 | 缺失 | — | 无错峰与占比配置 |
| 7.10 | 游戏内补充目标 | 部分 | quest/quest-event.listener.ts:40-152 | 交易类 6 事件未订阅 |
| 7.10 | 生态行为上报 + 防刷 | 已实现 | eco/eco-events.controller.ts:24-39；quest.service.ts:69-79 | — |

本章小结：已实现 10 / 部分 6 / 仅表 1 / 缺失 5

### 第 8 章 · 社交系统

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 8.1 | 三频道 world/private/guild 收发落库 | 已实现 | chat/chat.service.ts:91-171,198 | — |
| 8.1 | 敏感词过滤 | 已实现 | chat/chat.service.ts:96,207 | — |
| 8.1 | 频道权限校验 + 发言限频 | 部分 | chat/chat.service.ts:262-320 | 缺每分钟上限、广告折叠、付费置顶 |
| 8.2 | 好友状态机 pending→accepted 双向 | 已实现 | social/social.service.ts:124-187；constants/enums.ts:319 | — |
| 8.2 | 备注/最近聊天时间；blocked 状态 | 部分 | social/entities/friend.entity.ts:26-30；social.service.ts:256,299 | 字段无写入接口，拉黑走另表 |
| 8.3 | 帮派基础（名唯一/帮主/等级/人数/公告/解散） | 已实现 | social/entities/guild.entity.ts:14-50；social.service.ts:420-456 | — |
| 8.3 | 成员职位 + 帮贡；捐献三类型 | 部分 | social.service.ts:441-447,544-616；enums.ts:333-347 | 仅金币入资金，钻石/物品不扣 |
| 8.3 | 帮派 Buff 全员加成 | 仅表 | social/entities/guild.entity.ts:29 | 无设置/应用逻辑 |
| 8.4 | 系统/玩家发件 + 附件领取 + 批量发送 | 已实现 | mail/mail.service.ts:61-131；mail.controller.ts:27-85 | — |
| 8.4 | 模板发送 + 过期未领消失 | 部分 | mail/entities/mail.entity.ts:43-53 | 模板字段无写入，无过期清理 |
| 8.5 | 摆摊叫卖底座（trade_orders） | 已实现 | trade/trade.controller.ts:50-91 | 缺摊位 UI 与叫卖广播 |
| 8.5 | 切磋扬名（combat + matchmaking） | 部分 | matchmaking.service.ts:57-102；gateway:50 | 无擂台场景、排名彩头 |
| 8.5 | 红包打赏（economy + transactions） | 缺失 | — | 无表无逻辑 |
| 8.6 | 刺探/打听/窃听三入口 + 冷却 | 已实现 | social/social.service.ts:1169-1227,1230-1315 | — |
| 8.6 | 谍报成长曲线 + 保鲜期 | 已实现 | social/social.service.ts:1318-1339,1453-1472 | — |
| 8.6 | 情报 E~A 分级产出 | 部分 | social/social.service.ts:1195-1196,1245,1292 | 无 E/A 来源与高难任务 |
| 8.6 | 情报挂单/市场/购买 + 来源留痕 | 已实现 | social/social.service.ts:1342-1432 | — |
| 8.6 | 战斗弱点消费（破防）、假情报惩戒 | 部分 | social/social.service.ts:1435-1447 | 无调用接口，无伪造机制 |
| 8.7 | 好感度五阶段阈值 | 已实现 | character/character.service.ts:443-462 | — |
| 8.7 | 好感度来源（送礼/助战/借贷） | 部分 | social.service.ts:1510；combat/rescue.service.ts:101 | 缺组队/剧情来源与负面扣减 |
| 8.7 | 结义（3-8 人 + 互为知己） | 部分 | social/social.service.ts:1635-1668 | 缺结拜技/属性加成/播报 |
| 8.7 | 师徒/侠侣 | 部分 | social/social.service.ts:1643-1651,1679-1861 | 缺徒经验加成、师徒任务、情侣技 |
| 8.8 | 帮派任务（建设/采购/护送） | 部分 | social/social.service.ts:876-926 | 仅建设，采购/护送缺 |
| 8.8 | 帮派宴会 + 宴席 Buff | 部分 | social/social.service.ts:974-988；enums.ts:396-401 | 仅排期，无场景/Buff |
| 8.8 | 捐献排行 + 帮贡商店兑换 | 已实现 | social/social.service.ts:1054-1085,1154-1161 | 缺帮主配置技能树/折扣 |
| 8.8 | 帮战（周常/报名/奖励/日志） | 缺失 | constants/enums.ts:282 | 仅 CombatType 枚举，无逻辑 |
| 8.9 | 镖局运镖（接镖/护镖/劫镖/红名） | 缺失 | social/social.service.ts:1782 | 仅引导占位 done:false |
| 8.9 | 通缉悬赏 | 部分 | trade/trade.service.ts:791-930；trade.controller.ts:232-285 | 无红名自动上榜、正义值、入狱 |
| 8.9 | 入魔 hunting_target/powerBoost | 部分 | character/entities/character-darkened.entity.ts:53-56 | 仅建号初始化，无猎杀/净化 |
| 8.10 | 皇榜悬赏 | 缺失 | — | 无表无逻辑 |
| 8.10 | 茶楼听书 | 缺失 | — | 无表无逻辑 |
| 8.10 | 庙会集市 | 缺失 | — | 无表无逻辑 |
| 8.11 | 每日社交任务模板化 | 部分 | quest/quest.service.ts:354-404；enums.ts:640-660 | 缺茶楼/组队目标，待策划配置 |
| 8.11 | 社交活跃度周宝箱 + 积分兑换宝箱 | 已实现 | social/social-economy.service.ts:195-301 | — |
| 8.11 | 反挂机真实交互校验 | 缺失 | — | 无校验逻辑 |
| 8.12 | 路人甲 NPC 池 + 街头随机事件 | 缺失 | — | 无字段、无表、无接口 |
| 8.12 | 逛街产出（情报/功德值/好人缘） | 部分 | character/character.service.ts:464-502 | 无街头产出接口与功德值 |
| 8.13 | 礼物档位公式 + 每日上限 | 部分 | social/social.service.ts:1479-1546 | 无全服广播，非邮件送达 |
| 8.13 | 红包（定额/拼手气/人情值） | 缺失 | — | 无表无逻辑 |
| 8.13 | 情义相助求助 + 打赏/人情值 | 部分 | quest/quest.service.ts:408-510；trade.service.ts:599-604 | 求助无打赏，人情值仅作赊账门槛 |
| 8.14 | 组队流程（发起/匹配/收益分配） | 部分 | matchmaking.service.ts:21-102；combat.client.controller.ts:181-193 | 无队伍容器、角色定位、进度共享 |
| 8.14 | 默契度（team_bonds） | 部分 | combat/rescue.service.ts:40-51 | 无默契值表，用好感等级替代 |
| 8.14 | 集合求助/守护模式 | 缺失 | — | 无支援机制 |
| 8.15 | 名声分层（侠义/恶名/声望） | 部分 | constants/enums.ts:21-29；character.service.ts:168 | 无侠义值，动作无入账逻辑 |
| 8.15 | 结仇寻仇（宣战/复仇标记/化解） | 部分 | combat/face.service.ts:120-168；arbitration.service.ts | 无上线同场景提醒、赠礼化解 |
| 8.15 | 江湖信用分 | 缺失 | — | 无表无逻辑 |
| 8.16 | 称号授予/佩戴/名片展示 | 部分 | character/character.service.ts:578-631；character.controller.ts:219,238 | 无来源自动授予、炫耀推送 |
| 8.16 | 家园拜访/留言 | 缺失 | — | 无 homes 表与接口 |
| 8.16 | 观战打赏 + 人气值/人气榜 | 缺失 | constants/enums.ts:496-500 | RankingType 仅战力/等级/财富 |
| 8.17 | 举报四类 + 留证 + GM 复核处置 | 已实现 | social/social.service.ts:203-254；community/community.service.ts:240-321 | — |
| 8.17 | 拉黑屏蔽（私聊/组队/求助） | 部分 | social/social.service.ts:256-307；chat/chat.service.ts:246-254 | 组队/求助未拦，无信用观察 |
| 8.17 | 敏感词库 + 发言限频 | 部分 | chat/chat.service.ts:96,311-320 | 缺广告模板识别折叠 |
| 8.17 | 信用分联动/申诉/修复任务/时段治理 | 缺失 | — | 无实现 |
| 8.18 | 建帮条件（30 级/声望/银两/3 联名） | 部分 | social/social.service.ts:420-456 | 仅查重名，无条件校验 |
| 8.18 | 组织结构五职位 + 任命权限 | 已实现 | constants/enums.ts:333-341；social.service.ts:632-708 | 堂主分堂管理缺 |
| 8.18 | 弹劾（7 日未上线/过半联署/移交） | 已实现 | social/social.service.ts:710-808；social.controller.ts:149-171 | — |
| 8.18 | 帮规/记过与帮派日志 | 部分 | social/social.service.ts:503-532,659-670 | 无帮规发布与记过 |
| 8.19 | 建筑体系五类 + 1-5 级升级 | 部分 | constants/enums.ts:388-394；social.service.ts:876-933 | 升级不解锁离线修炼/折扣/产出 |
| 8.19 | 驻地参观/繁荣度榜 | 缺失 | — | 无实现 |
| 8.20 | 活动日历（宴会/答题/副本/远征） | 部分 | social/social.service.ts:974-997；enums.ts:396-401 | 仅排期，无执行/奖励 |
| 8.20 | 活动前邮件提醒/错峰排期 | 缺失 | — | 无提醒调度 |
| 8.21 | 外交状态（友好/中立/敌对） | 已实现 | social/social.service.ts:999-1050；social.controller.ts:246-264 | — |
| 8.21 | 帮派信誉 + 联谊/资源点争夺/阵前挑战 | 部分 | social/entities/guild-diplomacy.entity.ts | 信誉字段无变更逻辑，其余缺失 |
| 8.22 | 资金池 + 资金流水 | 已实现 | social/social.service.ts:834-874,935-956；guild.entity.ts:43 | — |
| 8.22 | 职位周薪（活跃发放） | 已实现 | social/social.service.ts:1060-1152 | — |
| 8.22 | 分红/互助基金/内部拍卖 | 缺失 | trade/trade.service.ts:158-174,593-634 | 仅有 VIP 专属拍卖与好友赊账 |

本章小结：已实现 18 / 部分 30 / 仅表 1 / 缺失 17

### 第 9 章 · 活动与签到

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 9.1 | 模板字段（类型/起止/周期/奖励） | 已实现 | activity-template.entity.ts:19-49；activity.controller.ts:75-97 | — |
| 9.1 | 状态机与定时发布 | 已实现 | activity.service.ts:271-307 | 无 published 态，用 active 替代 |
| 9.1 | condition_json / max_participants | 仅表 | activity-template.entity.ts:45-49 | 条件与人数上限不生效 |
| 9.2 | 参与与进度 | 已实现 | player-activity.entity.ts:24-31；activity.controller.ts:36-51 | — |
| 9.3 | 签到与连续天数（断签重置） | 已实现 | activity.service.ts:186-226；sign-in-record.entity.ts:22-32 | — |
| 9.4 | 社交型活动分类 | 缺失 | activity-template.entity.ts:19-49 | 无社交参与度分类 |
| 9.5 | 活动日历 / 社交目标联动 | 缺失 | activity.service.ts:59-77 | 无 slot 与社交目标 |
| 9.5 | 活动回收（回顾/榜单留档） | 缺失 | activity.service.ts:413-505 | 无对外回顾入口 |
| 9.6 | 断签保护（补签） | 部分 | chat.service.ts:361-403；chat.controller.ts:48 | 耗社交积分非人情值、月限 3 |
| 9.6 | 好友帮签 / 组队签到 / 帮派签到 | 缺失 | activity.service.ts:172-226 | 无好友与集体维度 |
| 9.7 | 天梯赛季制 | 部分 | ladder/ladder.service.ts:33-38,157-181 | 无赛季称号与播报 |
| 9.7 | 组队天梯 | 缺失 | ladder.service.ts:114-116 | 限 2 人 1v1，无双/三人天梯 |
| 9.7 | 观战应援 / 榜上恩怨 | 缺失 | ladder/ladder.controller.ts:15-34 | 无观战押彩与挑战 |

本章小结：已实现 4 / 部分 2 / 仅表 1 / 缺失 6

### 第 10 章 · 排行

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 10.1 | 基础榜（战力/等级/财富） | 已实现 | constants/enums.ts:496-500；ranking.controller.ts:23-39 | — |
| 10.1 | 社交榜（人气/帮贡/情义/谍报） | 缺失 | constants/enums.ts:496-500 | 四类社交榜全缺 |
| 10.2 | 快照制与续期字段 | 已实现 | ranking.service.ts:74-95；ranking-record.entity.ts:23-33 | — |
| 10.2 | 结算节奏（日/周/月） | 部分 | scheduler.service.ts:25-37 | 仅日榜战力 |
| 10.2 | 榜单奖励邮件 / 上榜广播 | 缺失 | ranking.service.ts:15-135 | 无发奖与播报 |
| 10.3 | 榜墙 / 点榜看人 | 缺失 | ranking.controller.ts:23-39 | 无榜墙与名片联动 |
| 10.3 | 称号联动 | 缺失 | character/entities/title-template.entity.ts:8 | 称号无榜单来源 |
| 10.4 | 围观打赏/好友应援/竞逐提醒/榜上约战 | 缺失 | ranking.controller.ts:23-39 | 榜单无社交互动 |
| 10.5 | 帮派榜 / 全员分红 | 缺失 | social.service.ts:618-628 | 无帮派榜与分红 |
| 10.5 | 帮派竞争宣战 | 部分 | social.service.ts:999 | 无榜位差触发 |
| 10.6 | 快照防刷 | 已实现 | ranking.service.ts:74-87 | — |
| 10.6 | 行为审计 / 分榜公平 / 社交榜防刷 | 部分 | analytics.controller.ts:42-52；balance-audit.controller.ts:13 | 无榜单异常预警与分榜 |
| 10.7 | 荣誉头衔/荣誉墙/荣誉商店/身份联动 | 缺失 | — | 荣誉系统整体缺失 |

本章小结：已实现 3 / 部分 3 / 仅表 0 / 缺失 7

### 第 11 章 · 交易与拍卖

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 11.1 | 挂单/下单选货/取消/市场列表 | 已实现 | trade/trade.service.ts:83,100,125,141；trade.controller.ts:50,66,75,87 | — |
| 11.1 | accepted 中间态与"接受"动作 | 部分 | constants/enums.ts:536；trade.service.ts:113 | buy 直接 pending→completed |
| 11.2 | 上架/竞价/到期成交或流拍/列表 | 已实现 | trade.service.ts:156,190,235,256；trade.controller.ts:95,112,126 | — |
| 11.2 | 绑定道具禁止交易流通 | 缺失 | trade 链路无 bindStatus 校验 | 未拦绑定道具 |
| 11.2 | 上架手续费与成交税回收 | 缺失 | trade.service.ts:156-188 | 无手续费/成交税 |
| 11.3 | 议价出价/还价/次数上限锁定 | 已实现 | trade.service.ts:279,312,340,377；trade.controller.ts:142-191 | — |
| 11.3 | 折扣加成（好感/结义/颜面/熟客） | 部分 | trade.service.ts:391-419 | 仅好友同帮 +5、颜面 +3 |
| 11.3 | 议价附言/恶意压价记信用/围观广播 | 缺失 | trade.service.ts:307 | 无附言与信用联动 |
| 11.4 | 叫卖广播/宝光/名气溢价/偶遇/黄金铺位 | 缺失 | — | 五项机制均无 |
| 11.5 | 托管扣款/验货放款/违约赔付 | 已实现 | trade.service.ts:424,476,521；trade.controller.ts:195-228 | — |
| 11.5 | 担保资格口径与费率可配（1%–3%） | 部分 | trade.service.ts:469,564-588 | 费率硬编码 2 |
| 11.5 | 双方确认/信用分/失信取消/中介声望/仲裁衔接 | 缺失 | trade.service.ts（仅 escrow.releasedAt 供对账） | 无信用与仲裁联动 |
| 11.6 | 以物易物双方确认成交 | 部分 | trade.service.ts:718,736 | 无实物交割与金币结算 |
| 11.6 | 赊账（好友 + 人情担保 + 逾期扣） | 已实现 | trade.service.ts:593,636,674 | — |
| 11.6 | 帮派互助基金/帮贡借贷/绑定道具代购 | 缺失 | — | 三项均无 |
| 11.7 | 围观/挑衅附言/匿名竞价/捡漏场/周榜 | 缺失 | — | 五项均无 |
| 11.8 | 物价指数/税收反哺/囤积治理/黑市 | 缺失 | world/resource-balance.policy.ts:77 | 无成交均价/税收/黑市 |
| 11.9 | 发布/接单/结算/取消/托管返还/悬赏榜 | 已实现 | trade.service.ts:776,809,829,873,900；trade.controller.ts:232-285 | — |
| 11.9 | 悬赏四类（寻人/找物/报仇/带副本） | 部分 | trade/dto/bounty.dto.ts:4；trade.service.ts:913-949 | 仅 kill/intel/collect |
| 11.9 | 契约信用担保/双向违约扣分/猎人榜 | 缺失 | trade.service.ts:776 | 无信用契约 |
| 11.10 | 区域特产价差/信息差/劫镖/商队/商帮声望 | 缺失 | — | 五项均无 |
| 11.11 | 请客包场/豪爽标签/护栏/彩礼婚礼 | 缺失 | social.service.ts:1518 | 无请客与婚礼 |
| 11.12 | 六币种定义 + 兑换关系 | 部分 | constants/enums.ts:21-29；economy.service.ts:23-27,173-192 | 仅钻石↔绑定钻，金币/社交币禁兑 |
| 11.13 | 流水审计与投放/回收泵 | 部分 | economy.service.ts:77,146 | 无拍卖税、钻石→金币回收 |
| 11.13 | 通胀监控指标与阈值联动 | 部分 | economy-dashboard.service.ts:51 | 有看板，无阈值触发下调 |

本章小结：已实现 5 / 部分 9 / 仅表 0 / 缺失 11

### 第 12 章 · 充值与 VIP

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 12.1 | 商品名/金额/reward_json/热门/排序 | 已实现 | payment/entities/recharge-product.entity.ts:15-27；payment.service.ts:252 | — |
| 12.2 | 唯一订单号/CNY/mock/状态机/回调发货留痕 | 已实现 | recharge-order.entity.ts:18,30,40,43；payment.service.ts:36,85,186；payment.controller.ts:33,78 | — |
| 12.3 | 唯一等级/required_exp/每日奖励/特权 json | 已实现 | vip/entities/vip-config.entity.ts:14,17,20,23；vip.service.ts:35,58 | — |
| 12.3 | VIP 经验来源（充值 + 活跃） | 部分 | payment.service.ts:211-219 | 仅充值计入，无活跃来源 |
| 12.4 | 专属拍卖室/称号/送礼上限/建筑加速/好友位/帮贡加成 | 已实现 | trade.service.ts:160；vip.service.ts:139；social.service.ts:133,559,902,1494 | — |
| 12.5 | 打赏送礼/帮派捐献/悬赏金 | 部分 | social.service.ts:544,1518；trade.service.ts:784 | 无钻石悬赏/彩礼/红包 |
| 12.5 | 社交消费流水可对账 | 已实现 | economy.service.ts:77,146 | — |
| 12.6 | 首充/社交礼包/周月卡/婚典礼包/皮肤/纪念道具 | 缺失 | recharge-product.entity.ts:21 | 无首充双倍与社交形态 |

本章小结：已实现 5 / 部分 2 / 仅表 0 / 缺失 1

### 第 13 章 · 运营与数据

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 13.1 | popup/marquee/mail 三类型 + 开关/排序/时间窗 | 部分 | notice/entities/notice.entity.ts:22-48；enums.ts:450 | 类型为 popup/banner/login，时间窗未生效 |
| 13.2 | 键值/类型/版本热更/版本回滚 | 已实现 | config/config.service.ts:28,68,120,143；config.controller.ts:28-75 | — |
| 13.3 | 六类行为事件 + 明细 JSON + IP | 部分 | analytics.service.ts:94；enums.ts:571 | IP 恒为 null（:103） |
| 13.4 | cohort + stat_date + 周期人数/留存率 | 已实现 | analytics.service.ts:166,216；analytics.controller.ts:63,76 | — |
| 13.5 | 操作人/目标/类型/前后快照 + 审计列表 | 已实现 | admin.service.ts:28,58；admin.controller.ts:28 | — |
| 13.6 | 预配置 draft→published→ended + 白名单灰度 + 回滚 | 已实现 | activity.service.ts:271,326,367；activity-template.entity.ts:52 | — |
| 13.6 | 活动数据看板（参与/留存） | 已实现 | activity.service.ts:413；analytics.controller.ts:35 | — |
| 13.7 | 公告回执/点赞 | 已实现 | notice.service.ts:20；notice.controller.ts:36 | 快报扩散未落地 |
| 13.7 | 建议箱/Bug 反馈闭环 + GM 留痕 | 已实现 | community.service.ts:63,115；community.controller.ts:35,73 | — |
| 13.7 | 玩家大使认证 + 称号发放 | 已实现 | community.service.ts:152,325；community.controller.ts:91 | — |
| 13.7 | 社区外联/直播联动 | 缺失 | — | 无外联能力 |
| 13.8 | 关系图谱/社交枢纽/流失预警/社交漏斗 | 已实现 | analytics.service.ts:238,317,354,405；analytics.controller.ts:85-110 | — |
| 13.8 | 核心指标（组队/送礼密度/帮派活跃/时长） | 部分 | analytics.service.ts:477-508 | 仅好友/人情流水/频道发言 |
| 13.9 | 只读经济宏观看板接口 | 已实现 | economy-dashboard.service.ts:51；economy-admin.controller.ts:18 | — |
| 13.10 | 日终对账 + 手动触发 + 三类异常 + 幂等 | 已实现 | reconcile.service.ts:65,81,211,262；reconcile-admin.controller.ts:26,33；scheduler.service.ts:50 | — |

本章小结：已实现 11 / 部分 3 / 仅表 0 / 缺失 1

### 第 14 章 · 实时通信（聊天频道）

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 14.1 | 全服/帮派/私聊频道 + 准入校验 | 已实现 | chat/chat.service.ts:262-309；enums.ts:442-446 | — |
| 14.1 | 附近/队伍/系统频道 + 频道权限可配 | 部分 | chat/chat.service.ts:269 | 缺附近/队伍/系统频道与开放开关 |
| 14.2 | 头顶气泡弹幕 / 情景聊天（黑话模板/诗号） | 部分 | character/entities/character-profile.entity.ts:37 | 仅诗号字段，无模板与气泡 |
| 14.2 | 语音转文字 / 表情包收藏 | 缺失 | — | 无表无接口 |
| 14.3 | 消息携带动作按钮（求援/组队/约战/摊位/红包） | 缺失 | chat/entities/chat-message.entity.ts:10-37 | 消息无动作字段 |
| 14.4 | 发言限频（按频道独立）+ 扩音喇叭破限 | 部分 | chat/chat.service.ts:311-320 | 全局单键限频，无喇叭 |
| 14.4 | 敏感词分级（替换/拦截/留证）+ 禁言/拉黑/举报闭环 | 部分 | chat/utils/sensitive-word.util.ts:10-27；social.service.ts:209 | 仅替换；无帮派禁言与留证 |
| 14.5 | /game 底座（heartbeat/enter-scene/move/chat.send）+ 场景广播 | 已实现 | gateway/game.gateway.ts:24,140,159,211,246,222-235 | 无区域分片 |
| 14.5 | combat.attack 战斗指令 + 观战实时推送 | 缺失 | gateway/game.gateway.ts:140-327 | 网关无战斗/观战事件 |
| 14.5 | 心跳驱动在线状态/在线列表 | 部分 | gateway/connection.service.ts:29-85 | onlineStatus 未写入，列表未联动 |
| 14.5 | 断线重连 + 离线结算补发收益 | 部分 | offline/offline-sync.service.ts:45-87 | 仅存消息，无收益结算 |
| 14.6 | 离线私信（限条数/次日送达） | 部分 | offline/offline-sync.service.ts:75-87 | 无限条数与次日规则 |
| 14.6 | 离线送礼与留言 / 邮件通道 | 已实现 | world/world.client.controller.ts:121；mail/mail.controller.ts:27-77 | — |
| 14.6 | 推送设置（免打扰/关键词提醒） | 缺失 | — | 无推送偏好配置 |
| 14.7 | 广播分级（全服/场景/队伍）+ 事件开关 | 缺失 | constants/enums.ts:450-454 | 仅公告类型，无分级推送 |
| 14.7 | 世界事件直播/江湖快报/场景氛围播报 | 缺失 | — | 无 WS 广播通道 |
| 14.8 | 频道签到（发言打卡）+ 补签 | 已实现 | chat/chat.service.ts:222-224,324-406；chat.controller.ts:32 | — |
| 14.8 | 频道幸运星抽取 + GM 审计 | 已实现 | chat/chat.service.ts:465-503；chat.controller.ts:145 | — |
| 14.8 | 频道红包 / 频道活动（答题/接龙/口令） | 缺失 | — | 无表无接口 |
| 14.9 | 江湖热搜榜（#话题/@提及） | 已实现 | chat/chat.service.ts:417-461；chat.controller.ts:69 | — |
| 14.9 | 话题标签聚合页 | 部分 | chat/chat.service.ts:437 | 仅解析 #，无聚合页 |
| 14.9 | 名人金色昵称标识 / 舆论治理 | 缺失 | — | 无标识与治理 |
| 14.10 | 语音房（创建/加入/离开/列表） | 部分 | chat/chat.service.ts:601-672；chat.controller.ts:89-131 | 无实时音频与场景联动 |
| 14.10 | 队伍语音 / 语音转写留证 | 缺失 | — | 无音频与转写 |
| 14.11 | 频道等级（发言贡献累积）+ 我的统计 | 已实现 | chat/chat.service.ts:676-704；chat.controller.ts:59 | — |
| 14.11 | 频道称号展示 | 部分 | chat/entities/chat-player-stat.entity.ts:26 | 有等级，无称号联动 |
| 14.11 | 帮派频道自定义口号/欢迎语 | 部分 | social/entities/guild.entity.ts:31 | 有 announcement，聊天未用 |
| 14.11 | 频道公约投票 / 老带新新手频道 | 缺失 | — | 无投票与新手频道 |
| 14.12 | 智能客服关键词触发 + 工单 + GM 人工兜底 | 已实现 | chat/chat.service.ts:532-597；chat.controller.ts:161,175 | — |
| 14.12 | 引导 NPC 常见问题回复 | 部分 | chat/chat.service.ts:559-578 | 仅关键词复读，无 FAQ 库 |
| 14.12 | 客服结果频道公告 | 缺失 | — | 无公告广播 |

本章小结：已实现 8 / 部分 12 / 仅表 0 / 缺失 11

### 第 15 章 · 新手引导与初始数值

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 15.1 | 先社交后成长七日引导链（含领奖） | 已实现 | social/social-guide.service.ts:19-31,71-138；social.controller.ts:442,452 | — |
| 15.1 | 社交成就软强制 / 可跳过（分服开关） | 部分 | constants/enums.ts:564-565；achievement.service.ts:28-70 | 仅枚举，无社交事件解锁与跳过开关 |
| 15.2 | 拜师引导 / 逛街第一课 | 部分 | social/social-guide.service.ts:23,30 | 无新手村 NPC 与逛街引导 |
| 15.2 | 游客登录与绑定 + 新手村配置 | 部分 | auth/auth.controller.ts:50；world/entities/scene.entity.ts:48 | 有游客登录，无绑定转换 |
| 15.3 | D1-D7 路线图任务 | 已实现 | social/social-guide.service.ts:19-31,53-98 | — |
| 15.3 | 每日引导完成推送 | 缺失 | — | 无推送通道 |
| 15.4 | 教程任务链 | 部分 | quest/entities/quest-template.entity.ts:36-52 | 仅通用任务模板，无教程链 |
| 15.4 | 双人教程任务 + 带新奖励 | 部分 | quest.controller.ts:66；quest.service.ts:449-505；community.service.ts:150-200 | 有求助/驰援/大使，无双人教程链 |
| 15.5 | 战败保护「情义相助」引导 | 部分 | combat/rescue.service.ts:73-103；combat.client.controller.ts:121 | 有救援接口，无战败触发引导 |
| 15.5 | 新手保护期（PVP 衰减）+ 红名不可攻击新手 | 已实现 | player/player.service.ts:207-218；combat/face.service.ts:147-157 | — |
| 15.5 | 回流礼包 / 回流带新匹配 | 缺失 | — | 无回归礼包与匹配 |
| 15.6 | 境界差衰减（防碾压） | 缺失 | — | 战斗无等级差衰减 |
| 15.6 | 新手榜（等级段分组） | 缺失 | constants/enums.ts:496-500 | 仅 power/level/wealth 榜 |
| 15.6 | 新手村练功房离线挂机 / 安全区 / 决斗双同意 | 缺失 | — | 无挂机收益、安全区、双同意 |
| 15.7 | 角色基础初值（五属性/忠诚/气血内力/声望/资质） | 已实现 | character-attribute.entity.ts:23-41；character-status.entity.ts:22-35；character-qualification.entity.ts:23 | — |
| 15.7 | 生存资源与世代初值 | 已实现 | character-consumption.entity.ts:23-26；character-resource.entity.ts:22-34；character-darkened.entity.ts:52 | — |
| 15.7 | 世界战斗/社交/运营初值 | 已实现 | character-needs.entity.ts:22-34；skill-template.entity.ts:35-44；monster-template.entity.ts:25-37；buff-template.entity.ts:25；player-currency.entity.ts:29 | — |
| 15.8 | 四象限体检 | 已实现 | analytics/balance-audit.service.ts:19-78；balance-audit.controller.ts:13 | — |
| 15.8 | 上线前校验清单（走查/压测/灰度） | 缺失 | — | 无校验清单与压测门禁 |
| 15.8 | 上线后日出报/异常告警 + 一票否决门禁 | 部分 | analytics.controller.ts:35；balance-audit.controller.ts:13 | 仅按需查询，无日报/告警/否决 |

本章小结：已实现 7 / 部分 7 / 仅表 0 / 缺失 6

### 第 16 章 · 生态联动（游戏 × 业务站点）

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 16.1 | 业务行为回调 → 游戏社交任务 | 已实现 | eco/eco-events.controller.ts:25 | — |
| 16.1 | 身份打通 sso_id 建档映射 | 已实现 | auth/entities/auth-account.entity.ts:35-39 | — |
| 16.1 | 数据通路 ECO_ACTION → 任务监听 | 已实现 | event-bus/game-events.ts:96；quest/quest-event.listener.ts:26 | — |
| 16.2 | SSO login/callback 换码建档签发 token | 已实现 | auth/auth.controller.ts:57-68；auth.service.ts:192-255 | — |
| 16.2 | NORMAL 并存 + 错误码 91605/91606 | 已实现 | auth.service.ts:242-255；constants/error-codes.ts:167 | 91606 未抛出 |
| 16.3 | 接口 + HMAC/时间窗/Redis 防重放 | 已实现 | eco/eco-events.service.ts:60-76,103-118 | — |
| 16.3 | action 白名单 + 未绑定静默 200 | 已实现 | eco/eco-events.service.ts:78-87 | — |
| 16.4 | 生态 10 action → SocialTarget 映射 | 已实现 | quest/quest-event.listener.ts:11-22 | — |
| 16.5 | 阵法/合击/援护/战利品/仲裁 5 项 | 已实现 | quest/quest-event.listener.ts:40-128 | — |
| 16.5 | JOIN_GUILD / INTEL_BUY 补发映射 | 已实现 | quest/quest-event.listener.ts:130-152 | — |
| 16.5 | FORM_FORMATION（建阵成功） | 缺失 | — | 无建阵事件与映射 |
| 16.5 | 经济 6 事件（议价/担保/悬赏×2/赊账/易物） | 部分 | trade/trade.service.ts:373,515,670,754,803,861 | 无 Quest 监听映射 |
| 16.6 | 4 站点钩子（zhao-website/course/point/商品站） | 缺失 | plugins 内无 eco-hook/签名上报 | 站外钩子未落地 |
| 16.7 | 签名防伪造 + 时间窗 + 防重放 | 已实现 | eco/eco-events.service.ts:15-16,67-118 | — |
| 16.7 | 浏览类日上限 10 | 已实现 | quest/quest.service.ts:69-79,354-363 | — |
| 16.7 | 真实行为锚点（业务侧真实记录触发） | 缺失 | — | 依赖 16.6 未实现 |
| 16.8 | 任务种子 12 条 | 已实现 | scripts/seed-social-tasks.sql:31-44 | — |
| 16.9 | 任务推进进度可见 | 已实现 | quest/quest.controller.ts:39 | — |
| 16.10 | 流水归一化 + refId 幂等 + 高水位 | 已实现 | risk/risk-wash.service.ts:94-105,147,174,198,222 | — |
| 16.10 | 三类信号（回环/失衡/价值异动） | 已实现 | risk/risk-detect.ts:120-141 | — |
| 16.10 | 账号评分 0-100 + 评级 + 10 分钟批扫 | 已实现 | risk-wash.service.ts:298-313；scheduler.service.ts:99 | — |
| 16.10 | 实时拦截（拍卖 93202 / 转账送礼 93201） | 部分 | risk/risk-gate.service.ts:12-36；trade.service.ts:157；social.service.ts:1490 | 转账未接闸，仅送礼 |
| 16.10 | 回收闭环（提案/扣款/回滚/封锁） | 已实现 | risk-wash.service.ts:397,421-497,499；risk-admin.controller.ts:78-99 | — |
| 16.10 | 只读回放（since/until + configOverrides） | 已实现 | risk-replay.service.ts:54-94；risk-admin.controller.ts:102 | — |
| 16.10 | 身份聚类（links 表/身份分/图谱接口） | 部分 | risk-identity.service.ts:51,175；risk-admin.controller.ts:43 | buildGraph 无定时触发 |

本章小结：已实现 19 / 部分 3 / 仅表 0 / 缺失 3

### 第 17 章 · 养成长线（境界突破 / 里程碑）

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 17.1 | 修为累加 + 广播 realm.value.gained | 已实现 | realm/realm.service.ts:69-83；event-bus/game-events.ts:123 | — |
| 17.1/17.2 | 属性加成覆盖叠加（delta 新旧差） | 已实现 | realm.service.ts:113-116,174-197 | — |
| 17.2 | realm_templates + characters 三字段 | 已实现 | realm/entities/realm-template.entity.ts:4-30；character/entities/character.entity.ts:44-51 | — |
| 17.3 | 突破流程（校验/消耗/升级/扣减/事件） | 已实现 | realm.service.ts:85-152 | — |
| 17.4 | 里程碑幂等发奖（currency/items/mail） | 已实现 | realm.service.ts:119-131,199-240 | — |
| 17.5 | 客户端 my/cultivate/breakthrough | 已实现 | realm/realm.controller.ts:22-41 | — |
| 17.5 | 后台模板 CRUD | 已实现 | realm/realm-admin.controller.ts:23-49 | — |
| 17.5 | 玩法回调 cultivate 接入 | 已实现 | realm.controller.ts:34 | 无其他调用方，玩法未自动产出修为 |

本章小结：已实现 8 / 部分 0 / 仅表 0 / 缺失 0

### 第 18 章 · 世界探索与奇遇

| 小节 | 机制点 | 状态 | 代码证据 | 缺口 |
|---|---|---|---|---|
| 18.1 | 足迹表 player_explorations（uk: player+scene） | 已实现 | explore/entities/player-exploration.entity.ts:9-26 | — |
| 18.2 | discover 幂等 upsert + 首探里程碑 + uk 并发兜底 | 已实现 | explore/explore.service.ts:112-157 | — |
| 18.3 | 触发（触发率/天气加成/CD 锁/一次性/Redis 会话） | 已实现 | explore.service.ts:182-252 | 取首个模板，非权重随机 |
| 18.3 | 结算（res 锁幂等/选项校验/5 类 effects/事件） | 已实现 | explore.service.ts:255-297,329-381 | — |
| 18.4 | 昼夜（SQL now 分时）+ 天气日种子 | 已实现 | explore.service.ts:85-109 | — |
| 18.5 | 客户端 state/discover/encounter/resolve | 已实现 | explore/explore.client.controller.ts:16-52 | — |
| 18.5 | 后台奇遇模板 CRUD | 已实现 | explore/explore-admin.controller.ts:23-49 | — |
| 18.5 | 远程配置 explore.milestone / explore.weather | 已实现 | explore.service.ts:129-132,197-205 | — |

本章小结：已实现 8 / 部分 0 / 仅表 0 / 缺失 0

## 5. 缺口分级清单

### P0 · 功能失效级（已对外提供入口，但行为不正确/不生效）

| # | 项 | 证据 | 影响 |
|---|---|---|---|
| P0-1 | 成就进度不推进（已修复） | event-listeners.service.ts:116,124 | 成就永久停在 0 |
| P0-2 | 成就领奖不发奖（已修复） | achievement.service.ts:97-105 | 发奖丢失，状态不可回滚 |
| P0-3 | 排行 score 恒 0（已修复） | ranking.service.ts:46-54,74-87 | 榜单与快照数据均无分值 |
| P0-4 | 配置字段不生效（活动条件/人数上限、任务前置/限次/自动发奖、公告时间窗）（已修复） | activity-template.entity.ts:45-49；quest-template.entity.ts:42-55；notice.entity.ts:22-48 | 配置了不生效，运营误判 |
| P0-5 | GM token 无过期（已修复） | admin-auth.service.ts:57-59 | 泄露即永久可用 |
| P0-6 | 无 logout/无会话管理/无改密（已修复） | auth 模块整体 | 无法主动失效凭证、无法踢下线 |
| P0-7 | 交易不校验绑定道具、无手续费/成交税 | trade.service.ts:156-188 | 绑定道具可流通 + 经济无回收泵 |
| P0-8 | GM 后台缺关键面板（封禁处置/举报处置/风控回收/对账/经济看板/活动灰度） | admin/index.html:435-446 vs 60+ admin 路由 | 运营能力只能 curl |

**修复进度（2026-09-21）**：P0-1（成就进度不推进）、P0-2（成就领奖不发奖）、P0-3（排行 score 恒 0）**已修复**。实施计划见 `docs/superpowers/plans/2026-09-20-achievement-ranking-fix.md`，提交 `6c1f6e7b3`/`518eed91a`/`eca559c8c`/`d1e1d3e53`/`573c43771`；回归 77 suites / 915 tests 全绿、`tsc --noEmit` 0 error、本地 `nest build` 通过。**尚未部署到生产**，冒烟未执行。P0-4 ~ P0-8 仍待修复。

**修复进度（2026-09-21，第二批）**：P0-5（GM token 无过期）、P0-6（无 logout/无会话管理/无改密）**已修复**（代码层）。实施计划见 `docs/superpowers/plans/2026-09-21-account-security-fix.md`，提交 `48bc54ffc`/`6422151c1`/`aebcfe8be`/`a6b4de9fd`/`2f15e664f`/`457aedad4`/`4589895ef`/`bfcdb09c5`。落地要点：`AdminUser` 加 `token_version` 列 + 全局 `AdminSessionService`（`AdminGuard` 每请求校验存在/启用/版本一致）；GM token 固定 12h（`JWT_ADMIN_EXPIRES_IN`）；新增 GM 登出/改密、玩家登出/改密、GM 踢玩家下线共 5 条路由，失效统一为「tokenVersion +1」。回归 **80 suites / 939 tests 全绿**、`tsc --noEmit` 0 error。**尚未部署到生产**（Task 7 待办：生产库需先 `ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS token_version int NOT NULL DEFAULT 0;` 再加替换 dist 重启），冒烟脚本 `scripts/smoke-p0b-auth.sh` 未执行。注意：上线后存量 GM token 全部失效，GM 需重新登录一次（预期行为）。剩余 P0-4 / P0-7 / P0-8 待修复。

**修复进度（2026-09-21，第三批）**：P0-4（配置字段不生效）**已修复**（代码层）。实施计划见 `docs/superpowers/plans/2026-09-21-config-fields-effect-fix.md`，提交 `68aa9a99a`（档位常量抽取 `@constants/ranks`）/`b1ea91cca`（任务前置链 + 接取限次 + 等级门槛改查库）/`24caabbee`（主奖励真发 + 手动领奖接口 `POST api/client/v1/quest/claim`）/`c806e0fbd`（活动 conditionJson 等级/前置任务条件 + 新增 60005/60006）/`63dd84d13`（活动人数上限 count 校验）/`cd9b781bb`（好感门槛按 character_id 换算修复）/`4b706724a`（公告时间窗 DTO + 查询过滤）。落地要点：任务 `minLevel` 由服务端查库校验（不再依赖调用方传参）、`prerequisiteIds` 须全部 CLAIMED、`acceptLimit` 按接取次数计数、`rewardJson` 扁平键真发（货币走经济模块 + `exp` 走经验 + 未识别键 warning）；发奖分两段（`autoReward=true` 提交即发，`false` 提交置 COMPLETED 后手动领取，原子占位防重复领）；活动 `conditionJson` 支持 `level`/`questIds`/`favorLevel`/`guildRole`，`maxParticipants` 按报名口径 count 校验；公告 `startAt`/`endAt` 支持为空（立即生效/永久有效）四分支时间窗。回归 **80 suites / 959 tests 全绿**、`tsc --noEmit` 0 error。**尚未部署到生产**，冒烟脚本 `scripts/smoke-p0d-config.sh` 未执行。**上线前需先排查存量任务配置**：`SELECT id,name,repeatable,accept_limit FROM quest_templates WHERE repeatable = true AND accept_limit <= 1;`（新限次会拦截原本可重复接取的任务），且存量 `auto_reward=false` 任务提交后需玩家手动领取。剩余 P0-7 / P0-8 待修复。

### P1 · 玩法骨架级（设计核心玩法，代码成片空白）

| 域 | 缺口概要 | 涉及章 |
|---|---|---|
| 战斗核心数值 | 命中/闪避/暴击/破防/五行克制/机制克制/情报弱点/战斗模式/境界分档/PVP-PVE 分离（10 项） | 6.10、6.11、6.26 |
| 武学养成线 | 内功心法、秘籍传承经济、奇遇机缘分级、演武/练功房、医术毒术丹药（6 项） | 6.14-6.18 |
| 场景社交基建 | 手势动作、分线/附近频道、城镇功能区、坐席、NPC 好感、安全区/红名、家具摆放（12 项） | 5.5-5.16 |
| 社交玩法 | 红包、家园、黑市/物价治理、跑商、请客/婚礼、皇榜/茶楼/庙会、信用分（7 项） | 8.10-8.16、11.4-11.11 |
| 排行与荣誉 | 社交榜、荣誉系统、榜单互动、发奖播报（7 项） | 10.1-10.7 |
| 帮派深化 | 帮战、运镖、驻地/繁荣度、分红/互助基金、帮派 Buff（5 项） | 8.8、8.9、8.19、8.22 |

### P2 · 长尾与运营便利

生态站点钩子（16.6 四个插件的 `eco/events` 上报与签名未落地，连带 16.7 行为锚点不成立）、回流礼包/回流匹配、新手榜、频道智能（动作按钮/红包/公约投票）、语音（实时音频/转写）、公告快报扩散、社区外联、上线前压测门禁与日报告警。

## 6. 盘点局限

1. **判据为静态代码**：未做运行时验证；"有 service 方法"不等价于"线上可用"，接入方（前端/其他模块）是否调用未逐项核对（已知例：`realm.cultivate` 无玩法调用方、`RiskIdentityService.buildGraph` 无定时调用方、`RiskGate.assertTransfer` 仅送礼调用）。
2. **机制点粒度由盘点人（AI）判定**：小节内机制拆分颗粒度存在主观性，总量 414 属量级参考而非精确指标；跨章重复项（如同一机制在 5.7 与 8.9 各记一次）未去重。
3. **行号为快照**：后续提交会使行号漂移，定位请以文件+符号名为准。
4. **未覆盖**：附录 C 部署运维（C.1-C.7）、0 章世界观总纲（无代码落点）、前端 C 端 UI 完备度、性能与容量（2G 服务器约束下）。
5. **与前序文档的关系**：`2026-09-20-game-server-next-steps.md` 规划的阶段 5 批 3（时区 bug 全量排查、VIP 专属拍卖室、admin 补发社交积分）在本次盘点中未被单独核对，该文档结论仍独立有效。

## 7. 结论

服务端**架构骨架与主链路是健康的**：39 模块全部注册、无 TODO 残留、事件总线/队列/风控/对账/远程配置等基础设施已成型，第 13、16、17、18 章落地度最高。

风险集中在两点：

1. **已上线的功能里有 8 处"看起来能用、实际不对"**（P0），其中成就与排行属对玩家可见的功能性缺陷。**进度（2026-09-21）**：其中 6 处已修复并回归通过——P0-1 成就进度不推进 / P0-2 成就领奖不发奖 / P0-3 排行 score 恒 0（第一批），P0-5 GM token 无过期 / P0-6 无 logout·会话管理·改密（第二批），P0-4 配置字段不生效（第三批），均详见本节 P0 清单下方的修复进度说明；剩余 P0-7 / P0-8 待修复。
2. **手册描绘的核心玩法（战斗数值、武学养成、场景社交、社交经济）成片未实现**，第 5/6/8 章合计 178 项的完备度最低——这决定产品能否成立，而非体验优劣。

建议顺序：P0 修复（小而确定，直接恢复既有功能）→ P1 按玩法域分批立项（每批独立可上线，参考阶段 5 批 2 的交付节奏）→ P2 长尾随版本推进。