# 阶段 2 · 社交核心实施计划（情报生态 / 关系养成 / 帮派全生命周期）

- 版本：v1.0
- 日期：2026-09-19
- 项目：game-server（NestJS 11 + TypeORM + PostgreSQL + Redis，game.joho.cn）
- 依据：`docs/superpowers/specs/2026-09-19-social-game-devplan-design.md` §4.1；《游戏服务器开发手册》8.6 / 8.7 / 8.18-8.22 / 15.3
- 执行方式：子代理驱动（TDD：先失败测试 → 实现 → 绿），任务间审查

## 0. 总览

**验收标准**：七日社交引导（15.3）可走通；「社交→产出→成长」闭环 MVP。

**既有基础（复用不重写）**：
- social 模块：Friend / Guild / GuildMember / GuildDonate 实体 + 好友申请/接受/列表 + 建帮/入帮/捐献（donateToGuild 给 contribution 点数）
- character 模块：CharacterRelationship（favorability/level/status/history）实体 + addRelationship/getRelationships；CharacterEspionage 实体（espionage_level/can_spy/can_infiltrate）——**尚无服务逻辑**
- economy 模块：CurrencyType 已含 FAVOR/GUILD_CONTRIB/FACE；EconomyService.addCurrency/deductCurrency（带 Redis 锁）
- event-bus：GameEvents 已含 FAVOR_GAINED / GUILD_CONTRIB_GAINED / FACE_CHANGED / GUILD_JOINED / GUILD_DONATED / FRIEND_ADDED

**新增表（synchronize=true 自动建，只加不删）**：
| 表 | 用途 | 归属迭代 |
|---|---|---|
| intelligences | 情报（grade E~A / 来源 / 保鲜期 / 挂单 / 卖家留痕） | 2-1 |
| gift_templates | 礼物模板（item_id → gift_weight / daily_cap） | 2-2 |
| kinships | 亲缘（结义/师徒/侠侣 成员组） | 2-2 |
| guild_impeachments | 弹劾（发起/联署/移交） | 2-3 |
| guild_buildings | 驻地建筑（类型/等级 1-5） | 2-3 |
| guild_fund_logs | 帮派资金流水 | 2-3 |
| guild_activities | 帮派活动日历 | 2-3 |
| guild_diplomacies | 帮派外交（友好/中立/敌对 + 信誉） | 2-3 |

**扩展列**：`character_espionages += intelligence_value / counter_spy_level`；`guilds += fund(bigint)`；`guild_members += position?`（职位复用 role 枚举扩展即可，不加列）

**枚举扩展（只加值不删值）**：
- `RelationshipLevel += FRIEND('friend') / CONFIDANT('confidant') / SWORN('sworn')`（五阶段阈值：stranger 0 / acquaintance 50 / friend 150 / confidant 300 / sworn 500）
- `GuildRole += VICE_LEADER('vice_leader') / HALL_MASTER('hall_master') / INCENSE_MASTER('incense_master')`

**错误码新增（error-codes.ts，从 90003 后按域分配）**：
- 情报域：INTEL_NOT_FOUND / INTEL_EXPIRED / INTEL_COOLDOWN / INTEL_ALREADY_LISTED / INTEL_LEVEL_NOT_ENOUGH / INTEL_SPY_FAILED
- 关系域：RELATIONSHIP_NOT_ENOUGH（好感不足）/ GIFT_DAILY_CAP / GIFT_NOT_FOUND / KINSHIP_EXISTS / KINSHIP_SIZE_INVALID / KINSHIP_LEVEL_GAP / KINSHIP_NOT_OWNER
- 帮派域：GUILD_ROLE_FORBIDDEN / GUILD_IMPEACHMENT_NOT_READY / GUILD_IMPEACHMENT_EXISTS / GUILD_FUND_NOT_ENOUGH / GUILD_BUILDING_EXISTS / GUILD_BUILDING_LEVEL_CAP / GUILD_DIPLOMACY_EXISTS

**事件新增（game-events.ts）**：
- `INTEL_GAINED: 'social.intel.gained'` / `INTEL_SOLD: 'social.intel.sold'`
- `RELATIONSHIP_LEVEL_UP: 'social.relationship.level_up'`
- `KINSHIP_FORMED: 'social.kinship.formed'` / `KINSHIP_BROKEN: 'social.kinship.broken'`
- `GUILD_ROLE_CHANGED: 'social.guild.role_changed'` / `GUILD_FUND_CHANGED: 'social.guild.fund_changed'` / `GUILD_DIPLOMACY_CHANGED: 'social.guild.diplomacy_changed'` / `GUILD_IMPEACHMENT: 'social.guild.impeachment'`

**模块装配**：`SocialModule` 扩展 imports（CharacterModule、EconomyModule）+ 新实体 forFeature；`CharacterModule` 关系服务扩展（好感度/送礼）；`AppModule` 无需改（social 已注册）。

---

## 迭代 2-1 · 情报生态（T1-T5）

### Task 1: 枚举 / 错误码 / 事件扩展
**Files:**
- `src/constants/enums.ts`（RelationshipLevel/GuildRole 追加值）
- `src/constants/error-codes.ts`（新错误码）
- `src/event-bus/game-events.ts`（新事件）

**Steps:**
1. RelationshipLevel 追加 `FRIEND='friend' / CONFIDANT='confidant' / SWORN='sworn'`（保留原值）
2. GuildRole 追加 `VICE_LEADER='vice_leader' / HALL_MASTER='hall_master' / INCENSE_MASTER='incense_master'`
3. 错误码按上表追加
4. 事件按上表追加
5. 新增 `IntelligenceGrade` 枚举（E/D/C/B/A，带 order 排序值）与 `IntelType`（rumor/secret）、`KinshipType`（sworn/master/couple）、`GuildDiplomacyRelation`（friendly/neutral/hostile）、`GuildBuildingType`（meeting_hall/training_room/scripture_library/blacksmith/herb_garden）、`GuildActivityType`（banquet/quiz/instance/expedition）

**测试**：`npm run build` 编译通过；无逻辑测试（纯常量）

### Task 2: 情报与礼物实体
**Files:**
- 新 `src/modules/social/entities/intelligence.entity.ts`（表 `intelligences`）
- 新 `src/modules/social/entities/gift-template.entity.ts`（表 `gift_templates`）
- 新 `src/modules/social/entities/kinship.entity.ts`（表 `kinships`）
- 改 `src/modules/social/entities/index.ts`
- 改 `src/modules/character/entities/character-espionage.entity.ts`（+intelligenceValue/counterSpyLevel 列）
- 改 `src/modules/social/social.module.ts`（forFeature 注册新实体）

**字段设计：**
- `Intelligence`：id(bigint) / ownerId(varchar64 或 bigint，按 player) / grade(enum) / intelType(enum rumor|secret) / title(varchar128) / content(text) / sourceType(spy|inquire|eavesdrop|market) / sourceId(varchar64 目标) / freshnessExpireAt(timestamp) / isListed(bool) / price(bigint) / sellerTrace(jsonb：卖家 id/时间) / status(active|listed|sold|expired|consumed) / createdAt
- `GiftTemplate`：id / itemId(varchar64 unique) / giftWeight(int) / dailyCap(int 默认5)
- `Kinship`：id / type(enum) / name(varchar64) / leaderId(varchar64) / members(jsonb 数组) / status(active|disbanded) / createdAt / disbandedAt
- `CharacterEspionage` += intelligenceValue(int 默认0) / counterSpyLevel(int 默认0)

**测试**：entity 定义 smoke（类型编译 + 表名/列名断言可选，TDD 弱化因实体无逻辑）

### Task 3: 情报动作服务（spy/inquire/eavesdrop + 保鲜期）
**Files:**
- 改 `src/modules/social/social.service.ts`（+ 情报域方法）
- 新 `src/modules/social/social.service.spec.ts` 扩展或新 `intelligence.service.spec.ts`（按现有 spec 风格）

**方法：**
- `spyIntelligence(playerId, targetId)`：Redis 冷却键 `intel:spy:{playerId}` 10min；成功率 = 60% + espionageLevel×3% − target.counterSpyLevel×3%；随机成功/失败（注入 RNG 便于测试）；成功产出 1 条情报（60% D、40% C），intelligenceValue += 10；失败抛 INTEL_SPY_FAILED（业务码）并记录冷却；升级检查 `espionage_level`（阈值：1-5 级每级 100，6-10 级每级 300，封顶 10）
- `inquireIntelligence(playerId, topic)`：扣金币 100（economyService.deductCurrency gold）→ 产出 D 级情报；intelligenceValue += 5
- `eavesdropIntelligence(playerId, targetId)`：要求 espionageLevel ≥ 5（否则 INTEL_LEVEL_NOT_ENOUGH）且 canInfiltrate；产出 B 级，intelligenceValue += 20
- `getIntelligences(playerId)`：我的情报列表（懒校验保鲜期：B 48h / A 24h 过期置 expired）
- 冷却实现：用 cacheService.get/set（set EX ttl）而非 acquireLock（幂等性不同，按 5.2 教训用 get+set）

**测试**（jest，mock repo + RNG）：
1. spy 成功（注入 RNG 返回 0）→ 建 1 条 C/D 情报 + intelligenceValue+10
2. spy 冷却内二次调用 → INTEL_COOLDOWN
3. spy 失败（RNG 返回 1）→ INTEL_SPY_FAILED 且无情报产出
4. inquire 扣金币后产出 D 级
5. eavesdrop 等级不足 → INTEL_LEVEL_NOT_ENOUGH
6. 保鲜期过期情报读取时置 expired
7. espionage_level 升级阈值（intelligenceValue 100 → level 2）

### Task 4: 情报市场（挂单/列表/购买 + 留痕）
**Files:**
- 改 `src/modules/social/social.service.ts`（+ 市场方法）

**方法：**
- `listIntelligence(playerId, intelId, price)`：校验持有 + status=active → isListed=true/price/status=listed；防重复挂单 INTEL_ALREADY_LISTED
- `getIntelMarket(page, limit)`：listed 情报分页（含卖家昵称脱敏）
- `buyIntelligence(buyerId, intelId)`：买方 deductCurrency(gold, price)；卖方 addCurrency(gold, price, source='intel_sale')；情报 ownerId 转移给买方（status=active）、sellerTrace 记录原卖家+时间；事件 INTEL_SOLD
- `consumeIntelligence(playerId, intelId)`：消耗情报（status=consumed，阶段 3 战斗弱点消费预留入口）

**测试**：挂单→市场可见→购买→金币双方向正确→情报易主→sellerTrace 留痕→重复购买拒绝

### Task 5: 情报控制器 + 模块装配
**Files:**
- 新 `src/modules/social/intelligence.controller.ts`（或扩展 social.controller.ts，按现有结构扩展 social.controller.ts 更省）
- 新 DTO：`intel-spy.dto.ts`（targetId）/ `intel-inquire.dto.ts`（topic）/ `intel-list.dto.ts`（intelId/price）/ `intel-buy.dto.ts`（intelId）

**接口：**
- `POST /api/client/v1/social/intel/spy` {targetId}
- `POST /api/client/v1/social/intel/inquire` {topic}
- `POST /api/client/v1/social/intel/eavesdrop` {targetId}
- `GET /api/client/v1/social/intel/mine`
- `POST /api/client/v1/social/intel/list` {intelId, price}
- `GET /api/client/v1/social/intel/market?page&limit`
- `POST /api/client/v1/social/intel/buy` {intelId}

**测试**：控制器单元测试（mock service，断言参数透传与守卫）

---

## 迭代 2-2 · 关系养成（T6-T8）

### Task 6: 好感度五阶段 + 送礼回礼（character 模块）
**Files:**
- 改 `src/modules/character/character.service.ts`（+ increaseFavorability / sendGift / reciprocateGift / getRelationshipLevel）
- 改 `src/modules/character/character.service.spec.ts`

**逻辑：**
- 阶段阈值表：`{STRANGER:0, ACQUAINTANCE:50, FRIEND:150, CONFIDANT:300, SWORN:500}`；`increaseFavorability(characterId, targetId, delta)`：累加 → 计算新 level → 跨级发 RELATIONSHIP_LEVEL_UP 事件 + history 追加记录
- `sendGift(playerId, targetId, itemId)`：校验 target 是好友（FriendStatus.ACCEPTED）或已有关系记录；gift_templates 查 giftWeight（无模板抛 GIFT_NOT_FOUND）；每日上限 Redis 键 `gift:send:{playerId}` 计数（get+set，超过抛 GIFT_DAILY_CAP）；消耗背包物品（inventory 模块 deduct——注入 ItemService 或复用 inventory 服务，若 inventory 无对外服务则先读后删 player_item 简化）；对 target 的 rel.favorability += giftWeight；触发对方 24h 可回礼窗口（Redis `gift:reciprocate:{targetId}:{playerId}`）
- `reciprocateGift(playerId, targetId, itemId)`：校验回礼窗口存在，双向好感

**测试**：
1. 好感累加跨阶段升级（150→160 变 FRIEND，事件触发）
2. 陌生阶段送礼拒绝（无关系记录时自动建 rel？——设计：无 rel 先建 STRANGER rel，送礼要求 ≥ACQUAINTANCE？不，送礼本身是加好感的入口，允许对任何 target 送礼，但需是好友——按 8.7 相识解锁送礼。→ 校验 friend 关系存在，否则 NOT_FRIEND）
3. 每日上限 5 次后拒绝
4. 无 gift 模板拒绝
5. 回礼窗口内可回礼、过期拒绝
6. 物品不足拒绝（若走 inventory）

### Task 7: 亲缘（结义/师徒/侠侣）服务
**Files:**
- 改 `src/modules/social/social.service.ts`（+ kinship 域方法）
- 新 `src/modules/social/kinship.service.spec.ts`（或并入 social spec）

**逻辑：**
- `formKinship(playerId, type, memberIds, name)`：
  - sworn：人数 3-8；全部互为 CONFIDANT(≥300) 及以上（两两校验 rel.level）；leaderId=发起人；members=[发起人,...memberIds]；事件 KINSHIP_FORMED + 全服广播字段（占位）
  - master：仅 2 人；师等级 ≥ 徒等级+10（player.level，经 PlayerService 查询）；成员 [master, apprentice]
  - couple：仅 2 人；互为 CONFIDANT
- `breakKinship(playerId, kinshipId)`：发起人/成员可解除（couple 强解扣忠诚占位）；status=disbanded；事件 KINSHIP_BROKEN
- `getKinships(playerId)`：我参与的亲缘列表
- `graduateApprentice(playerId, kinshipId)`：师徒出师（apprentice 等级达标校验）；关系保留为 history 记录

**测试**：结义人数边界（2 拒绝/3 成功/9 拒绝）/ 好感不足拒绝 / 师徒等级差不足拒绝 / 解除状态流转 / 重复结义拒绝

### Task 8: 关系控制器
**Files:**
- 改 `src/modules/character/character.controller.ts`（+ gift 接口）或 social.controller（按归属：送礼是关系动作归 social 更贴 8.7——**决策：社交动作接口统一进 social.controller**，character 保留档案接口）
- 新 DTO：`gift.dto.ts`（targetId/itemId）

**接口：**
- `POST /api/client/v1/social/gift/send` {targetId, itemId}
- `POST /api/client/v1/social/gift/reciprocate` {targetId, itemId}
- `POST /api/client/v1/social/kinship/form` {type, memberIds[], name?}
- `POST /api/client/v1/social/kinship/break` {kinshipId}
- `GET /api/client/v1/social/kinships`
- `GET /api/client/v1/social/relationships`（汇总好友+亲缘+关系等级）

**测试**：控制器参数校验与透传

---

## 迭代 2-3 · 帮派全生命周期（T9-T13）

### Task 9: 帮派治理（职位 / 弹劾）
**Files:**
- 新 `src/modules/social/entities/guild-impeachment.entity.ts`（表 `guild_impeachments`）
- 改 `src/modules/social/social.service.ts`（+ 治理方法）
- 改 social.module.ts（forFeature + 实体 index）

**逻辑：**
- `setGuildRole(operatorId, guildId, playerId, role)`：帮主可任命任意职位；副帮主可任堂主/香主以下；目标必须在帮；事件 GUILD_ROLE_CHANGED
- `initiateImpeachment(operatorId, guildId)`：operator 须副帮主以上；leader 须 7 日未上线（auth_accounts.lastLoginAt 或 player.lastActivityAt 早于 now-7d，注入 Clock 便于测试）；同帮无进行中弹劾（GUILD_IMPEACHMENT_EXISTS）；创建 impeachment（status=pending，endorsements=[]）
- `endorseImpeachment(playerId, impeachmentId)`：联署人须香主以上（HALL_MASTER/INCENSE_MASTER/VICE_LEADER）；联署人数 ≥ 半数香主以上（含副帮主）；达标 → 自动移交 leaderId= 副帮主中贡献最高者（或发起人），status=done，事件 GUILD_IMPEACHMENT
- `getImpeachment(guildId)` / `getGuildLog(guildId)`（帮派日志：任命/逐出/弹劾记录，存 guilds 新列 log?——简化：存 JSONB 列 `guilds += action_log(jsonb)`，成员可见）

**测试**：权限拒绝（成员任命→GUILD_ROLE_FORBIDDEN）/ leader 在线不可弹劾 / 联署过半移交 / 重复弹劾拒绝 / 日志追加

### Task 10: 驻地建设 + 帮派资金
**Files:**
- 新 `src/modules/social/entities/guild-building.entity.ts`（表 `guild_buildings`）
- 新 `src/modules/social/entities/guild-fund-log.entity.ts`（表 `guild_fund_logs`）
- 改 `guild.entity.ts`（+ fund bigint 默认 0 / actionLog jsonb）
- 改 social.service.ts

**逻辑：**
- `buildBuilding(operatorId, guildId, buildingType)`：帮主/副帮主；同类型已存在 → 升级（level+1，上限 5 GUILD_BUILDING_LEVEL_CAP）；升级费 = level×10000 帮派资金（GuildBuildingType 映射：meeting_hall 1 级 50000，其余 10000 起——简化统一 10000×level）；扣 fund + 写 guild_fund_logs(expense)
- `getGuildBuildings(guildId)`
- `adjustGuildFund(operatorId, guildId, amount, reason)`：帮主/副帮主；amount>0 入账（income），<0 校验充足（GUILD_FUND_NOT_ENOUGH）；写流水 + 事件 GUILD_FUND_CHANGED
- `getGuildFundLogs(guildId, page, limit)`
- 捐献联动：donateToGuild 增加 amount 入 fund（gold 类 100% 入账）+ contributionGained 同步发放 GUILD_CONTRIB 货币（economyService.addCurrency，source='guild_donate'，事件 GUILD_CONTRIB_GAINED）

**测试**：建设升级与费用/等级上限/权限/资金不足拒绝/流水留痕/捐献入资金+发 GUILD_CONTRIB

### Task 11: 帮派活动日历 + 外交
**Files:**
- 新 `src/modules/social/entities/guild-activity.entity.ts`（表 `guild_activities`）
- 新 `src/modules/social/entities/guild-diplomacy.entity.ts`（表 `guild_diplomacies`）
- 改 social.service.ts

**逻辑：**
- `createGuildActivity(operatorId, guildId, activityType, scheduleAt)`：帮主/副帮主；状态 scheduled→active→ended（占位流转）；`getGuildActivities(guildId)`
- `setDiplomacy(operatorId, guildId, targetGuildId, relation)`：帮主/副帮主；双方帮派存在；重复建友好/敌对记录（GUILD_DIPLOMACY_EXISTS 则更新）；事件 GUILD_DIPLOMACY_CHANGED
- `getGuildDiplomacies(guildId)`

**测试**：权限/重复外交/活动创建与列表

### Task 12: 帮贡经济（商店兑换 / 工资）
**Files:**
- 改 social.service.ts

**逻辑：**
- `exchangeGuildShop(contributorId, guildId, rewardType)`：rewardType 枚举（skill_point 技能点占位 / resource_pack / title）；消耗 GUILD_CONTRIB 货币（deductCurrency，source='guild_shop'）；产出占位（阶段 3 接帮派技能树，MVP 返回消耗结果 + 写流水）
- `paySalaries(operatorId, guildId)`：帮主/副帮主触发周薪结算；按职位周薪（LEADER 5000 / VICE_LEADER 3000 / HALL_MASTER 2000 / INCENSE_MASTER 1000 / MEMBER 500，GOLD 支付）；活跃校验（player.lastActivityAt 近 7 天，注入 Clock）；在职才发；写 guild_fund_logs(expense)；事件 GUILD_FUND_CHANGED；每人扣帮派资金
- `getGuildContributionRank(guildId)`：贡献排行（member.contribution desc）

**测试**：兑换扣 GUILD_CONTRIB / 周薪按职位与活跃发放 / 资金不足时部分发放或拒绝 / 排行

### Task 13: 帮派接口扩展 + 模块装配收口
**Files:**
- 改 `src/modules/social/social.controller.ts`（+ 全部新接口）
- 新 DTO：guild-role.dto.ts / guild-impeach.dto.ts / guild-build.dto.ts / guild-fund.dto.ts / guild-activity.dto.ts / guild-diplomacy.dto.ts / guild-shop.dto.ts

**接口（全部 `/api/client/v1/social/guild/...`）：**
- `POST role` {guildId, playerId, role}
- `POST impeach` {guildId} / `POST impeach/endorse` {impeachmentId} / `GET :guildId/impeachment`
- `POST build` {guildId, buildingType} / `GET :guildId/buildings`
- `POST fund` {guildId, amount, reason} / `GET :guildId/fund-logs`
- `POST activities` {guildId, activityType, scheduleAt} / `GET :guildId/activities`
- `POST diplomacy` {guildId, targetGuildId, relation} / `GET :guildId/diplomacies`
- `POST shop/exchange` {guildId, rewardType}
- `POST salary` {guildId}
- `GET :guildId/contribution-rank`

**测试**：控制器透传/校验

---

## 收尾（T14）

### Task 14: 七日社交引导 + 全量回归 + 冒烟 + 部署
**Files:**
- 改 `src/modules/social/social.service.ts`（+ getDailyGuide）
- 新 `src/modules/social/dto/guide.dto.ts`（无需）
- 控制器 + `GET /api/client/v1/social/guide/daily`

**逻辑：**
- `getDailyGuide(playerId)`：按 player.created_at 算注册第 N 天 → 返回当日引导项（D1-D7 映射：D1 拜师+组队 / D2 加好友+互赠 / D3 茶楼+首条情报 / D4 入帮 / D5 运镖/悬赏 / D6 送礼回礼 / D7 结义或师徒）+ 各动作完成状态（好友数/亲缘数/情报数/帮派成员），Day≥8 返回「日常循环」占位

**Steps:**
1. **全量单测**：`npx jest --no-coverage` 全 PASS
2. **类型编译**：`npx tsc --noEmit -p tsconfig.json` exit 0
3. **冒烟清单**（本地/线上，登录后逐项）：
   | 接口 | 入参 | 期望 |
   |---|---|---|
   | POST /social/intel/spy | {"targetId":"2"} | 成功情报或 INTEL_COOLDOWN/INTEL_SPY_FAILED 业务码 |
   | POST /social/intel/inquire | {"topic":"test"} | D 级情报 |
   | POST /social/intel/list | {intelId, price} | listed |
   | GET /social/intel/market | - | 分页列表 |
   | POST /social/intel/buy | {intelId} | 金币转移+易主 |
   | POST /social/gift/send | {targetId, itemId} | 好感+ |
   | POST /social/kinship/form | {type:"master", memberIds:[]} | 等级差校验业务码 |
   | POST /social/guild/role | {guildId, playerId, role} | 权限校验 |
   | POST /social/guild/build | {guildId, buildingType:"meeting_hall"} | 建设成功或资金不足 |
   | POST /social/guild/fund | {guildId, amount, reason} | fund 变化 |
   | POST /social/guild/diplomacy | {guildId, targetGuildId, relation} | 外交建立 |
   | GET /social/guide/daily | - | D1-D7 引导项 |
4. **部署**（按阶段 1 流程：备份 pg_dump → 本地 build → tar dist → scp → 保留旧 dist → restart → 冒烟；失败回滚 dist_prev_*）

---

## 风险与护栏
| 风险 | 护栏 |
|---|---|
| 枚举扩展破坏既有行 | 只加值不删值；新值默认不应用于旧数据 |
| 情报刷产出 | 冷却（Redis）+ 成功率随机 + 每日可配置 |
| 好感/帮贡刷量 | 每日送礼上限 + 周薪活跃校验 + 贡献透明排行 |
| 弹劾误操作 | 7 日未上线硬校验 + 联署过半 + 全程日志 |
| TypeORM bigint 字符串查询 500 | 所有入参 id 前置 `/^\d+$/` 校验（阶段 1 教训） |
| 1G 内存 | 本地构建，服务器仅装 omit=dev |
