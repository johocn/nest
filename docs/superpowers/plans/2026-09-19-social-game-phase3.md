# 阶段 3 · 社交×系统联动实施计划（社交战斗 / 社交任务 / 社交经济）

- 版本：v1.0
- 日期：2026-09-19
- 项目：game-server（NestJS 11 + TypeORM + PostgreSQL + Redis，game.joho.cn）
- 依据：`docs/superpowers/specs/2026-09-19-social-game-devplan-design.md` §4.2；《游戏服务器开发手册》6.19-6.25 / 7.4-7.9 / 11.3-11.12 / 15.8
- 执行方式：子代理驱动（TDD：先失败测试 → 实现 → 绿），任务间审查
- 设计决策（用户确认 2026-09-19）：**3-1 走「轻量加成层」**——阵法/默契/援护做战斗外状态 + 结算加成参数，不重构单人 PVE；迭代顺序 3-1 → 3-2 → 3-3

## 0. 总览

**验收标准**：三类联动闭环全通；平衡体检 15.8 四象限指标可统计输出。

**既有基础（复用不重写）**：
- combat 模块：`resolvePveCombat(params: PveCombatParams)` 单人 PVE 同步结算 + combat_logs（damageJson/rewardJson）——扩展入参加成即可
- character 模块：CharacterRelationship（favorability/level/status）已实现五阶段好感——**默契档位直接由关系等级推导，不建新表**
- social 模块：情报/送礼/亲缘/帮派全部可用；`getKinships`/`increaseFavorability`/`getRelationshipLevel` 可被战斗/任务引用
- economy 模块：CurrencyType 已含 FAVOR/GUILD_CONTRIB/FACE；addCurrency/deductCurrency 带流水；exchange 已锁死社交币不可兑换
- quest 模块：quest_templates（targetJson/prerequisiteIds/rewardJson）+ player_quests + acceptQuest/submitQuest 骨架
- trade 模块：trade_order（挂单/购买）+ auction（竞价）+ economy exchange 铁律
- event-bus：INTEL_GAINED/FRIEND_ADDED/GUILD_CONTRIB_GAINED/KINSHIP_FORMED/QUEST_ACCEPTED/QUEST_COMPLETED 等已定义；**缺 GIFT_SENT（3-2 需补）**

**新增表（synchronize=true 自动建，只加不删）**：
| 表 | 用途 | 归属 |
|---|---|---|
| formations | 阵法模板（北斗/五行/三才 + 加成 + 克制） | 3-1 |
| formation_bindings | 阵法队伍绑定（队长/成员/站位） | 3-1 |
| rescue_logs | 援护记录（过命交情） | 3-1 |
| combat_loot_logs | 战利品分配记录 | 3-1 |
| combat_arbitrations | 战斗调解/仲裁记录 | 3-1 |
| quest_help_requests | 卡关求助 | 3-2 |
| negotiations | 议价（出价/还价/步数/折扣） | 3-3 |
| escrow_agreements | 担保交易（托管/验货/放款/违约） | 3-3 |
| bounties | 悬赏委托 | 3-3 |
| credit_debts | 赊账（FAVOR 担保） | 3-3 |
| barter_deals | 以物易物 | 3-3 |

**扩展列**：`quest_templates += target_type(varchar32) / prerequisite_social(jsonb) / reward_social(jsonb)`；`combat_logs` 无需加列（damageJson 承载贡献明细）

**枚举扩展（只加值不删值）**：
- `FormationType`：three_talents(3人) / five_elements(5人) / beidou(7人)
- `CombatMode`：points_to_stop / death_match（恩怨战模式声明）
- `LootDistributionMode`：contribution / roll / captain / equal
- `ArbitrationStatus`：pending / success / fail
- `SocialTargetType`：spy / inquire / eavesdrop / send_gift / reciprocate_gift / accept_friend / form_kinship / donate_guild / join_guild / intel_buy
- `NegotiationStatus` / `EscrowStatus` / `BountyStatus` / `CreditStatus` / `BarterStatus`

**错误码新增（error-codes.ts，按域分配）**：
- 战斗域 913xx：FORMATION_NOT_FOUND(91301)/FORMATION_POSITION_TAKEN(91302)/FORMATION_MEMBER_LIMIT(91303)/FORMATION_ACTIVE(91304)/TACIT_NOT_ENOUGH(91306)/RESCUE_DAILY_CAP(91307)/RESCUE_TARGET_INVALID(91308)/LOOT_NOT_FOUND(91309)/ARBITRATION_EXISTS(91311)/ARBITRATION_NOT_READY(91312)/SHAME_TARGET_INVALID(91313)
- 任务域 914xx：QUEST_SOCIAL_PRE_REQ(91401)/QUEST_HELP_EXISTS(91402)/QUEST_HELP_NOT_FOUND(91403)
- 经济域 915xx：NEGOTIATION_NOT_FOUND(91501)/NEGOTIATION_STEP_LIMIT(91502)/ESCROW_NOT_FOUND(91503)/ESCROW_NOT_READY(91504)/GUARANTOR_NOT_QUALIFIED(91505)/BOUNTY_NOT_FOUND(91506)/BOUNTY_FULL(91507)/BOUNTY_DEADLINE(91508)/CREDIT_NOT_FOUND(91509)/CREDIT_OVERDUE(91510)/BARTER_NOT_FOUND(91511)/BARTER_CONFIRM_MISMATCH(91512)

**事件新增（game-events.ts）**：
- `FORMATION_ACTIVATED` / `COMBO_TRIGGERED` / `RESCUE_SUCCESS` / `LOOT_DISTRIBUTED` / `BATTLE_REPORTED` / `ARBITRATION_SETTLED` / `GRUDGE_DECLARED`（3-1）
- `GIFT_SENT: 'social.gift.sent'`（3-2 补发，任务监听用）

**模块装配**：combat 模块 + formations/formation_bindings/rescue_logs/combat_loot_logs/combat_arbitrations forFeature；quest 模块 + quest_help_requests + EventListener；trade 模块 + negotiations/escrow_agreements/bounties/credit_debts/barter_deals forFeature；AppModule 无需改。

---

## 迭代 3-1 · 社交战斗（T1-T6）

### Task 1: 枚举 / 错误码 / 事件扩展 + 新实体
**Files:**
- `src/constants/enums.ts`（FormationType/CombatMode/LootDistributionMode/ArbitrationStatus）
- `src/constants/error-codes.ts`（913xx）
- `src/event-bus/game-events.ts`（7 个战斗事件）
- 新 `src/modules/combat/entities/formation.entity.ts`（表 formations：id/name/type(enum)/maxMembers(int)/baseBonus(jsonb {attack,defense,heal 百分比})/counterType(enum FormationType nullable)/createdAt）
- 新 `src/modules/combat/entities/formation-binding.entity.ts`（表 formation_bindings：id/formationId/leaderId/playerId/position(int)/joinedAt；Unique(formationId,playerId)）
- 新 `src/modules/combat/entities/rescue-log.entity.ts`（表 rescue_logs：id/rescuerId/targetId/combatLogId(nullable)/createdAt）
- 新 `src/modules/combat/entities/combat-loot-log.entity.ts`（表 combat_loot_logs：id/combatLogId/mode(enum)/distributorId/itemsJson(jsonb)/playersJson(jsonb 贡献分账明细)/createdAt）
- 新 `src/modules/combat/entities/combat-arbitration.entity.ts`（表 combat_arbitrations：id/combatLogId/arbitratorId/partiesJson(jsonb)/claimsJson(jsonb)/status(enum)/successRate(numeric)/result(varchar)/createdAt）
- 改 `src/modules/combat/entities/index.ts` + `src/modules/combat/combat.module.ts`（forFeature）

**测试**：实体 smoke（编译 + 表名列名）；无逻辑测试

### Task 2: 阵法服务（战斗外状态 + 加成计算）
**Files:**
- 改 `src/modules/combat/combat.service.ts`（+ 阵法域方法）或新建 `formation.service.ts`（combat 模块内，随 module forFeature）
- 扩展/新建 `combat.service.spec.ts` 对应用例

**方法：**
- `createFormation(leaderId, formationId)`：查 formations 模板（无则 FORMATION_NOT_FOUND）；leader 建 binding position 0；一人不可同时入多阵（FORMATION_ACTIVE）
- `joinFormation(playerId, formationId, position)`：人数 < maxMembers（FORMATION_MEMBER_LIMIT）；position 被占（FORMATION_POSITION_TAKEN）
- `leaveFormation(playerId, formationId)`
- `getFormation(formationId)`：成员列表 + 生效状态
- `activateFormation(leaderId, formationId)`：全员就位（成员数 == maxMembers）→ 生效；发 FORMATION_ACTIVATED
- `getFormationBonus(formationId)`：baseBonus × (1 + 默契加成档位)；克制校验 `checkCounter(attackerId, defenderId)`（北斗克五行/五行克三才/三才克北斗，命中追加 10% 攻击）
- 默契档位（**由关系等级推导，无新表**）：遍历阵内成员与队长 CharacterRelationship.level → 档位 {FRIEND: 10%, CONFIDANT: 15%, SWORN: 20%}（取最高）；亲缘 sworn/couple 额外 +5%

**测试**：创建/加入/人数上限/站位冲突/离开/生效条件/加成数值（注入关系等级 mock）/克制判定

### Task 3: 合击 + 援护服务
**Files:**
- 改 combat.service.ts（或新 `rescue.service.ts`）

**逻辑：**
- `performCombo(attackerId, partnerId, combatLogId?)`：partner 与 attacker 关系等级 ≥ FRIEND（否则 TACIT_NOT_ENOUGH）；档位映射：FRIEND=精妙 +20% / CONFIDANT 及以上=天衣无缝 +40%（结义/侠侣同档）；返回加成系数 + 写 rescue? 不——返回 comboBonus + 记录到 combat_logs.damageJson 占位；发 COMBO_TRIGGERED
- `attemptRescue(rescuerId, targetId)`：target 关系 ≥ CONFIDANT（RESCUE_TARGET_INVALID）；每日上限 5 次 Redis 键 `rescue:daily:{rescuerId}`（get+set EX 86400，超限 RESCUE_DAILY_CAP）；建 RescueLog；双方好感 +5（increaseFavorability，过命交情标记）；发 RESCUE_SUCCESS
- `getRescueCount(playerId)` / `getRescueLogs(playerId)`

**测试**：关系不足拒绝/每日上限拒绝/成功建记录+好感/计数

### Task 4: 颜面系统（6.23）+ 战后仪式（6.22）
**Files:**
- 改 combat.service.ts（或新 `face.service.ts`）

**逻辑：**
- `adjustFace(playerId, delta, reason)`：economyService.addCurrency(FACE, delta, source='social_combat')；发 FACE_CHANGED
- 6.23 规则映射：`applyFaceRule(winnerId, loserId, winnerLevel, loserLevel)`：胜者境界≥败者 +10 / 胜者境界<败者（低阶赢） +15 / 败者输给低阶 -15 / 被迫认输 -10
- `publicShame(shamerId, targetId)`：同场景校验占位（SHAME_TARGET_INVALID 简单校验非同人）；shamer FACE +5；target FACE -30；Redis 标记 `shame:{targetId}`（雪耻资格 24h）；发 GRUDGE_DECLARED
- `declareGrudge(playerId, targetId)`：雪耻宣言（character_relationship status=grudge 已有枚举）+ 全服广播占位（发事件）
- `createBattleReport(combatLogId)`：战报（胜/败/贡献摘要）存 combat_logs 读取；发 BATTLE_REPORTED
- `applyDefeatBuff(playerId)`：战败「重整旗鼓」Buff（Redis 键 `buff:recovery:{playerId}` EX 3600，+10% 修炼效率占位——只标记不接修炼系统）；`getActiveBuffs(playerId)`

**测试**：FACE 增减/羞辱双方数值/雪耻资格标记/战报生成/败者 Buff 标记

### Task 5: 战利品分配（6.24）+ 调解仲裁（6.25）
**Files:**
- 改 combat.service.ts（或新 `loot.service.ts` / `arbitration.service.ts`）

**逻辑：**
- `distributeLoot(distributorId, combatLogId, mode, itemsJson?)`：
  - contribution：按 combat_logs.damageJson 贡献比例分账（DPS/治疗/援护权重 6.24）
  - roll：全队公开随机点数（注入 RNG），最高得
  - captain：distributor 指定得主
  - equal：均分
  - 建 CombatLootLog；发 LOOT_DISTRIBUTED
- `startArbitration(arbitratorId, combatLogId, partiesJson, claimsJson)`：仲裁人资格（帮主或亲缘成员或 FACE≥60，占位查询 social）；同 combatLog 重复仲裁 ARBITRATION_EXISTS；建 pending
- `resolveArbitration(arbitrationId, result)`：successRate = 60 + 声望修正(占位10) + 双方平均好感档位×10 − 愤怒度(占位20)；≥50 → success：双方「不打不相识」好感 +10，status=success；否则 fail（双方获恩怨战资格占位）；发 ARBITRATION_SETTLED
- `getArbitration(arbitrationId)` / `getLootLog(combatLogId)`

**测试**：四种分配模式数值/权限/重复仲裁拒绝/成功率公式边界（RNG 注入）/成功加好感

### Task 6: 战斗控制器 + DTO + 结算扩展
**Files:**
- 改 `src/modules/combat/combat.controller.ts`（+ 全部新接口）
- 新 DTO：formation-create.dto.ts / formation-join.dto.ts / combo.dto.ts / rescue.dto.ts / shame.dto.ts / grudge.dto.ts / loot.dto.ts / arbitration.dto.ts
- 改 `src/modules/combat/dto/pve-combat.dto.ts`（或 params 类型）+ `resolvePveCombat` 增加可选 `formationBonus`（默认 1.0）折算伤害

**接口（全部 `/api/client/v1/combat/...`）：**
- `POST formations` {formationId}（创建）/ `POST formations/:id/join` {playerId, position} / `DELETE formations/:id/leave` / `POST formations/:id/activate` / `GET formations/:id`
- `POST combo` {partnerId, combatLogId?}
- `POST rescue` {targetId} / `GET rescue/logs`
- `POST face/adjust` {playerId, delta, reason}（GM/事件占位）/ `POST shame` {targetId} / `POST grudge/declare` {targetId}
- `POST loot/distribute` {combatLogId, mode, itemsJson?} / `GET loot/:combatLogId`
- `POST arbitration` {combatLogId, partiesJson, claimsJson} / `POST arbitration/:id/resolve` {result} / `GET arbitration/:id`
- `GET battle-report/:combatLogId` / `GET buffs`

**测试**：控制器透传/校验；resolvePveCombat 带 formationBonus 伤害上浮

---

## 迭代 3-2 · 社交任务（T7-T11）

### Task 7: 枚举 / 错误码 / quest_templates 扩展
**Files:**
- `src/constants/enums.ts`（+ SocialTargetType）
- `src/constants/error-codes.ts`（914xx）
- 改 `src/modules/quest/entities/quest-template.entity.ts`（+ targetType varchar32 nullable / prerequisiteSocial jsonb nullable / rewardSocial jsonb nullable）

**prerequisite_social schema**：`{ intelGrade?: 'D'|'C'|'B'|'A', intelCount?: number, favorLevel?: 'stranger'|'acquaintance'|'friend'|'confidant'|'sworn', guildRole?: 'member'|'incense_master'|'hall_master'|'vice_leader'|'leader', friendCount?: number }`
**reward_social schema**：`{ currencyType: 'favor'|'guild_contrib'|'face', amount: number }`

**测试**：实体列扩展编译；枚举值断言

### Task 8: 社交目标事件监听器（社交动作 → 任务进度）
**Files:**
- `src/event-bus/game-events.ts`（+ GIFT_SENT）
- 改 `src/modules/social/social.service.ts`（sendGift/reciprocateGift 补发 GIFT_SENT / 回礼事件）
- 新 `src/modules/quest/quest-event.listener.ts`（@OnEvent 监听 INTEL_GAINED/GIFT_SENT/FRIEND_ADDED/GUILD_CONTRIB_GAINED/KINSHIP_FORMED）
- 改 quest.module.ts（注册 listener）

**逻辑：**
- `handleSocialTarget(event)`：playerId + targetType 映射 → 查该玩家 in_progress 任务中 `target_type = 对应类型` 且未满进度 → progress+1 → 满目标置 COMPLETED（复用 updateProgress 语义，发 QUEST_COMPLETED）
- 映射表：INTEL_GAINED→spy/inquire/eavesdrop（按情报 sourceType 细分）；GIFT_SENT→send_gift/reciprocate_gift（按方向）；FRIEND_ADDED→accept_friend；GUILD_CONTRIB_GAINED→donate_guild；KINSHIP_FORMED→form_kinship

**测试**：各事件推进对应目标任务/无匹配任务不报错/满进度自动 COMPLETED

### Task 9: 社交前提校验 + 奖励倾斜
**Files:**
- 改 `src/modules/quest/quest.service.ts`（acceptQuest + 前提校验；submitQuest + rewardSocial 发放）

**逻辑：**
- `acceptQuest`：等级校验后追加 `checkPrerequisiteSocial(playerId, template)`——intelGrade/intelCount（查 intelligence 表）、favorLevel（characterService.getRelationshipLevel，目标为 0 时查好友最高？——简化：查指定 targetId 或任意好友最高）、guildRole（guildMember.role）、friendCount（friendRepo）；不满足抛 QUEST_SOCIAL_PRE_REQ(91401)
- `submitQuest`：进度达标结算时，若 rewardSocial 存在 → economyService.addCurrency(currencyType, amount, source='quest_reward')；原有 rewardJson 逻辑不变

**测试**：四项前提各自不足拒绝/达标放行/社交货币入账+流水 source

### Task 10: 卡关求助
**Files:**
- 新 `src/modules/quest/entities/quest-help-request.entity.ts`（表 quest_help_requests：id/playerId/questTemplateId/helperId(nullable)/status(enum open|helped|closed)/createdAt/helpedAt）
- 改 quest.service.ts（+ requestHelp/listHelpRequests/respondHelp）
- 改 quest.module.ts forFeature

**逻辑：**
- `requestHelp(playerId, questTemplateId)`：同人同任务未关闭请求去重（QUEST_HELP_EXISTS）；建 open
- `respondHelp(helperId, requestId)`：status=helped，helperId 写入；发起人任务进度 +1（帮一把）；helper 获 GUILD_CONTRIB +10（社交奖励倾斜）；发事件（复用 QUEST 相关）
- `listHelpRequests(playerId)`：我发起的 + 可协助列表

**测试**：重复请求拒绝/协助后进度+1/状态流转

### Task 11: 任务控制器扩展 + DTO
**Files:**
- 改 `src/modules/quest/quest.controller.ts`（+ help 接口 + 任务列表带 targetType/prerequisiteSocial 展示）
- 新 DTO：quest-help.dto.ts

**接口：**
- `POST /api/client/v1/quest/help/request` {questTemplateId}
- `GET /api/client/v1/quest/help/mine`
- `POST /api/client/v1/quest/help/:id/respond`

**测试**：控制器透传/校验

---

## 迭代 3-3 · 社交经济（T12-T17）

### Task 12: 枚举 / 错误码 / 实体（5 张新表）
**Files:**
- `src/constants/enums.ts`（+ NegotiationStatus/EscrowStatus/BountyStatus/CreditStatus/BarterStatus）
- `src/constants/error-codes.ts`（915xx）
- 新 `src/modules/trade/entities/negotiation.entity.ts`（negotiations：id/buyerId/sellerId/tradeOrderId/askPrice(bigint)/replyPrice(bigint)/step(int)/maxSteps(int 默认3)/status(enum)/discountPercent(int 默认0)/message(varchar128)/createdAt）
- 新 `src/modules/trade/entities/escrow-agreement.entity.ts`（escrow_agreements：id/buyerId/sellerId/guarantorId/tradeOrderId/amount(bigint)/feePercent(int)/status(enum)/createdAt/releasedAt(nullable)）
- 新 `src/modules/trade/entities/bounty.entity.ts`（bounties：id/publisherId/type(varchar32)/targetJson(jsonb)/goldReward(bigint)/deadline(timestamp)/maxAcceptors(int)/acceptorId(nullable)/status(enum)/createdAt）
- 新 `src/modules/trade/entities/credit-debt.entity.ts`（credit_debts：id/borrowerId/lenderId/amount(bigint)/dueAt(timestamp)/collateralAmount(bigint 担保 FAVOR)/status(enum)/settledAt(nullable)/createdAt）
- 新 `src/modules/trade/entities/barter-deal.entity.ts`（barter_deals：id/partyAId/partyBId(nullable)/itemsAJson(jsonb)/itemsBJson(jsonb)/goldAmount(bigint)/aConfirm(bool)/bConfirm(bool)/status(enum)/createdAt）
- 改 `src/modules/trade/entities/index.ts` + `trade.module.ts`（forFeature）

**测试**：实体 smoke；无逻辑

### Task 13: 议价服务（11.3）
**Files:**
- 改 `src/modules/trade/trade.service.ts`（+ negotiation 域方法）

**逻辑：**
- `startNegotiation(buyerId, tradeOrderId, askPrice)`：挂单存在；买家非卖家；建 pending，step=1
- `replyNegotiation(sellerId, negotiationId, replyPrice)`：卖家身份校验；step+1；step > maxSteps → 状态锁定（NEGOTIATION_STEP_LIMIT），按原价成交或流单（简化为流单 expired）
- `acceptNegotiation(buyerId, negotiationId)`：折扣 = 好友/同帮 5%（social 查询）+ FACE ≥ 80 面子价 3%（economy 余额）；成交价 = min(ask, reply) × (1 − discount)；走 buyItem 结算；status=completed；围观广播占位发事件
- `rejectNegotiation(buyerId, negotiationId)`：status=expired

**测试**：创建/还价步数上限/折扣计算（FACE/好友条件 mock）/成交价入账/拒绝

### Task 14: 担保交易服务（11.5）
**Files:**
- 改 trade.service.ts（+ escrow 域方法）

**逻辑：**
- `createEscrow(buyerId, sellerId, tradeOrderId, guarantorId)`：担保人资格——帮主或亲缘成员或 FACE≥60（占位查询，不满足 GUARANTOR_NOT_QUALIFIED）；买家 deductCurrency(gold, amount)（托管标记，金额入 escrow 记录）；建 pending
- `inspectGoods(guarantorId, escrowId)`：担保人验货 → `releaseEscrow`：卖家 addCurrency(gold, amount − fee)，担保人 addCurrency(gold, amount×feePercent%)（担保费）；status=released；写流水 source='escrow'
- `penalizeEscrow(escrowId)`：违约 → 担保人赔 amount×2 给买家（占位扣款）、信用分记录占位；status=penalized
- `getEscrow(escrowId)`

**测试**：资格拒绝/托管扣款/放款分账（费率先 2%）/违约赔付

### Task 15: 赊账（11.6 赊账互助）+ 以物易物（11.6 以物易物）
**Files:**
- 改 trade.service.ts（+ credit/barter 域方法）

**逻辑：**
- `createCredit(borrowerId, lenderId, amount, dueDays)`：borrower FAVOR ≥ 100（人情担保，不足 CREDIT_OVERDUE 语义用 GUARANTOR_NOT_QUALIFIED？——新增校验：FAVOR 不足抛 CREDIT_NOT_READY 91510 复用）；lender 是好友/同帮（占位校验好友即可）；borrower addCurrency(gold, amount)；建 active，dueAt = now + dueDays
- `repayCredit(borrowerId, creditId)`：还本金 → settled；借贷双方好感 +5
- `settleOverdueCredits()`：定时/惰性：dueAt < now 未还 → 扣 borrower FAVOR collateralAmount、status=defaulted（CreditStatus.OVERDUE 中间态占位）
- `createBarter(partyAId, itemsAJson, goldAmount)`：挂单 pending，aConfirm=true
- `acceptBarter(partyBId, barterId, itemsBJson)`：bConfirm=true → 双方确认 → 物品交换（inventory 扣/加占位，不实现真实背包交换则记录交换意图 + 事件）；status=completed；发 BARTER 事件（复用 economy 事件占位）
- `getCreditList(playerId)` / `getBarterList(playerId)`

**测试**：人情不足拒绝/借款到账/还款结清/逾期违约扣人情/易物双方确认流程/单方确认未完成

### Task 16: 悬赏服务（11.9）
**Files:**
- 改 trade.service.ts（+ bounty 域方法）

**逻辑：**
- `createBounty(publisherId, type, targetJson, goldReward, deadline, maxAcceptors)`：publisher deductCurrency(gold, goldReward)（托管）；建 active
- `acceptBounty(acceptorId, bountyId)`：未满员（BOUNTY_FULL）；acceptorId 写入；status=accepted
- `completeBounty(acceptorId, bountyId)`：校验 targetJson——type=kill 查 combat_logs / type=intel 查 intelligence / type=collect 占位直接通过；通过 → publisher 已托管金 addCurrency(acceptorId)，status=completed；发事件；超期 BountyStatus 自动 failed（惰性校验 BOUNTY_DEADLINE）
- `cancelBounty(publisherId, bountyId)`：违约扣信用占位、托管金返还（status=cancelled）
- `getBountyBoard(page, limit)`：全服 active/accepted 列表

**测试**：发布扣托管金/满员拒绝/完成校验与发奖/取消返还/榜单

### Task 17: 经济控制器 + DTO + 模块装配收口
**Files:**
- 改 `src/modules/trade/trade.controller.ts`（+ 全部新接口）
- 新 DTO：negotiation.dto.ts / escrow.dto.ts / bounty.dto.ts / credit.dto.ts / barter.dto.ts

**接口（全部 `/api/client/v1/trade/...`）：**
- `POST negotiations` {tradeOrderId, askPrice} / `POST negotiations/:id/reply` {replyPrice} / `POST negotiations/:id/accept` / `POST negotiations/:id/reject`
- `POST escrow` {sellerId, tradeOrderId, guarantorId} / `POST escrow/:id/inspect` / `POST escrow/:id/penalize` / `GET escrow/:id`
- `POST bounties` {type, targetJson, goldReward, deadline, maxAcceptors} / `POST bounties/:id/accept` / `POST bounties/:id/complete` / `POST bounties/:id/cancel` / `GET bounties`
- `POST credit` {lenderId, amount, dueDays} / `POST credit/:id/repay` / `GET credit/mine`
- `POST barter` {itemsAJson, goldAmount} / `POST barter/:id/accept` {itemsBJson} / `GET barter/mine`

**测试**：控制器透传/校验；各服务 spec 全绿

---

## 收尾（T18）

### Task 18: 平衡体检（15.8）+ 全量回归 + 冒烟 + 部署
**Files:**
- 新 `src/modules/analytics/balance-audit.service.ts`（或挂 analytics 模块）+ admin 控制器 `GET /api/admin/v1/balance/audit`

**逻辑：**
- 四象限指标统计（只读，15.8 口径）：
  - 社交：7 日内新玩家关系建立率（friend/kinship ≥1）/ 社交货币流速（FAVOR/GUILD_CONTRIB/FACE 近 7 日交易额）/ 活跃玩家数
  - 战斗：combat_logs PVP 胜率分布（40%-60% 健康带）
  - 经济：金币存量（player_currencies 汇总）/ 月通胀估算（金币增量/存量）
  - 成长：players 等级分布 + 升级耗时估算（created_at → level）
- 返回 `{ social: {...}, combat: {...}, economy: {...}, growth: {...}, health: boolean }`

**Steps:**
1. **全量单测**：`npx jest --no-coverage` 全 PASS（含既有 476 + 阶段 3 新增）
2. **类型编译**：`npx tsc --noEmit -p tsconfig.json` exit 0
3. **冒烟清单**（smoke-stage3.sh，登录后逐项）：
   | 接口 | 入参 | 期望 |
   |---|---|---|
   | POST /combat/formations | {formationId:"beidou"} | 建阵成功 |
   | POST /combat/formations/:id/join | {playerId, position} | 加入成功或 MEMBER_LIMIT |
   | POST /combat/formations/:id/activate | - | 生效 |
   | GET /combat/formations/:id | - | 加成数值 |
   | POST /combat/rescue | {targetId} | 成功或 TARGET_INVALID/DAILY_CAP |
   | POST /combat/shame | {targetId} | 双方 FACE 变化 |
   | POST /combat/loot/distribute | {combatLogId, mode:"equal"} | 分配记录 |
   | POST /combat/arbitration | {combatLogId, ...} | 建仲裁 |
   | POST /quest/help/request | {questTemplateId} | 成功或 EXISTS |
   | POST /trade/negotiations | {tradeOrderId, askPrice} | 建议价 |
   | POST /trade/escrow | {sellerId, tradeOrderId, guarantorId} | 托管成功或资格拒绝 |
   | POST /trade/bounties | {type:"intel", ...} | 发布成功 |
   | POST /trade/credit | {lenderId, amount, dueDays} | 成功或人情不足 |
   | POST /trade/barter | {itemsAJson, goldAmount} | 挂单成功 |
   | GET /admin/v1/balance/audit | - | 四象限数据 |
4. **部署**（阶段 1/2 流程：备份 pg_dump → 本地 build → tar dist → scp → 保留旧 dist → restart → 冒烟；失败回滚 dist_prev_*）

---

## 风险与护栏
| 风险 | 护栏 |
|---|---|
| 阵法加成刷数值 | 加成只读自关系等级/模板，无独立累积量；成员唯一绑定 |
| 援护互刷 | 每日上限 5 次（Redis）+ 关系等级门槛 |
| 颜面刷量 | 羞辱需对方存在 + 24h 雪耻资格单次；FACE 走 economy 流水审计 |
| 任务进度刷量 | 社交动作本身有冷却/上限（刺探冷却、送礼日限），任务只监听真实动作事件 |
| 悬赏托管资金风险 | 发布即扣托管金；违约返还；只读 targetJson 校验（kill/intel 可查证） |
| 赊账坏账 | FAVOR 担保门槛 + 逾期自动违约扣人情 |
| 担保滥用 | 担保人资格门槛 + 违约赔双倍 |
| TypeORM bigint 字符串查询 500 | 所有入参 id 前置 `/^\d+$/` 校验（阶段 1 教训延续） |
| 1G 内存 | 本地构建；服务器仅装 omit=dev；不新增 npm 依赖 |
