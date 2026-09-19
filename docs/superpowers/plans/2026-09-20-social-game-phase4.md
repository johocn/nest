# 阶段 4 · 运营与治理实施计划（活动工作台 / 社区运营 / 社交数据分析 / 聊天深化）

- 版本：v1.0
- 日期：2026-09-20
- 项目：game-server（NestJS 11 + TypeORM + PostgreSQL + Redis，game.joho.cn）
- 依据：`docs/superpowers/specs/2026-09-19-social-game-devplan-design.md` §4.3；《游戏服务器开发手册》13.6-13.8 / 14.8-14.12 / 15.8
- 执行方式：直接实现（枚举/实体/错误码风格统一，迭代内 TDD 自测），迭代顺序 4-1 → 4-2 → 4-3 → 4-4

## 0. 总览

**验收标准**：运营看板当天可见；新玩家 7 日关系建立率 ≥ 60%（可统计输出）。

**既有基础（复用不重写）**：
- activity 模块：activity_templates（status 编排 DRAFT/ACTIVE/ENDED）+ player_activities + sign_in_records + Admin CRUD——4-1 扩展灰度流水线
- config 模块：remote_configs（version + Redis 缓存 + CONFIG_UPDATED 事件）——4-1 扩展版本历史回滚
- admin 模块：gm_operate_logs + logOperation（一切运营操作留痕）——4-1 发布/回滚审计
- analytics 模块：player_behavior_logs + retention_stats + 运营面板（DAU/行为统计）——4-1 活动看板数据源；4-3 社交分析宿主
- notice 模块：notices CRUD——4-2 扩展互动
- chat 模块：chat_messages + world/private/guild 发送服务 + 敏感词过滤；gateway 已有 heartbeat/enter-scene/move——4-4 补 chat.send 实时入口
- social 模块：friends/kinships/guild_members + 送礼（GIFT_SENT 事件）——4-3 数据源（表直查聚合，不依赖埋点）
- character 模块：title_templates + character_titles（称号系统）——4-2 大使称号发放

**新增表（synchronize=true 自动建，只加不删）**：
| 表 | 用途 | 归属 |
|---|---|---|
| config_versions | 远程配置版本历史（回滚依据） | 4-1 |
| notice_reactions | 公告互动（like/ack，唯一 notice+player+type） | 4-2 |
| feedback_suggestions | 建议箱（建议/Bug 闭环公开） | 4-2 |
| player_ambassadors | 玩家大使（任命/撤销/称号） | 4-2 |
| chat_player_stats | 频道发言统计 + 频道等级（Unique player+channel） | 4-4 |
| chat_sign_ins | 频道签到（每日首条世界发言，Unique player+date） | 4-4 |
| support_tickets | 客服工单（关键词自动回复 / GM 人工介入） | 4-4 |
| voice_rooms | 语音房（房间成员状态骨架，音频走客户端 P2P） | 4-4 |

**扩展列**：
- `activity_templates += gray_whitelist_json(jsonb 默认'{}' 玩家ID数组或百分比字符串) / published_at(timestamp nullable) / published_version(int 默认0)`
- `notices += like_count(int 默认0) / ack_count(int 默认0)`（冗余计数）

**枚举扩展（只加值不删值）**：
- `ActivityStatus += GRAY('gray')`（灰度中）
- `ActivityType += CHANNEL('channel')`（频道活动——彩蛋口令类，4-4 消费）
- `NoticeReactionType`：like / ack
- `FeedbackCategory`：suggestion / bug
- `FeedbackStatus`：pending / accepted / rejected / done
- `AmbassadorStatus`：active / revoked
- `SupportTicketStatus`：auto_replied / needs_gm / resolved
- `VoiceRoomType`：tea_house / guild / private（茶馆公共房 / 帮派房 / 私密房）

**错误码新增（error-codes.ts，按域分配，916xx 已被生态占用）**：
- 活动运营 917xx：ACTIVITY_GRAY_ONLY(91701，灰度中非白名单)/ACTIVITY_WHITELIST_REJECTED(91702)/ACTIVITY_ROLLBACK_FAILED(91703)/ACTIVITY_NOT_PUBLISHED(91704，无发布记录)
- 配置回滚 918xx：CONFIG_VERSION_NOT_FOUND(91801)/CONFIG_ROLLBACK_FAILED(91802)
- 社区运营 919xx：NOTICE_REACTION_EXISTS(91901)/FEEDBACK_NOT_FOUND(91902)/AMBASSADOR_EXISTS(91903)/AMBASSADOR_NOT_FOUND(91904)
- 聊天深化 921xx：CHAT_SIGN_IN_DONE(92101)/SUPPORT_TICKET_NOT_FOUND(92102)/VOICE_ROOM_NOT_FOUND(92103)/VOICE_ROOM_FULL(92104)/CHAT_TOPIC_EMPTY(92105)/LUCKY_STAR_NO_CANDIDATE(92106)

**事件新增（game-events.ts）**：
- `NOTICE_REACTED: 'notice.reacted'`
- `FEEDBACK_SUBMITTED: 'community.feedback.submitted'`
- `AMBASSADOR_APPOINTED: 'community.ambassador.appointed'`
- `CHAT_SIGN_IN: 'chat.sign_in'`
- `LUCKY_STAR_DRAWN: 'chat.lucky_star.drawn'`
- `SUPPORT_TICKET_CREATED: 'support.ticket.created'`
- `VOICE_ROOM_JOINED / VOICE_ROOM_LEFT: 'voice.room.joined' / 'voice.room.left'`

**模块装配**：
- config 模块 forFeature += ConfigVersion
- notice 模块 forFeature += NoticeReaction
- 新建 community 模块（feedback_suggestions / player_ambassadors forFeature；依赖 analytics 社交枢纽接口占位）
- analytics 模块 forFeature += Friend/Kinship/GuildMember/ChatMessage/Player（社交分析表直查）
- chat 模块 forFeature += ChatPlayerStat/ChatSignIn/SupportTicket/VoiceRoom；gateway 注入 ChatService

---

## 迭代 4-1 · 活动工作台（13.6 预配置→灰度→回滚 + 数据看板）

### Task 1: 枚举 / 错误码 / 事件 + activity_templates 扩展列
**Files:**
- `src/constants/enums.ts`（ActivityStatus += GRAY；ActivityType += CHANNEL）
- `src/constants/error-codes.ts`（917xx / 918xx）
- `src/event-bus/game-events.ts`（无新事件；复用 CONFIG_UPDATED）
- 改 `src/modules/activity/entities/activity-template.entity.ts`（+ grayWhitelistJson/publishedAt/publishedVersion）

**测试**：实体列映射 smoke

### Task 2: 活动发布 / 灰度验证 / 回滚服务
**Files:**
- 改 `src/modules/activity/activity.service.ts`

**方法：**
- `publishActivity(adminId, id, grayWhitelist?)`：DRAFT 才可发布；grayWhitelist 非空 → status=GRAY + 写 whitelist，否则 → ACTIVE；published_version+1、published_at=now；GM 审计（change_before 记录发布前快照 conditionJson/rewardJson/startAt/endAt/status → 回滚依据）；发布状态不校验时间窗（定时编排由前端 startAt 控制）
- `grayVerifyActivity(adminId, id, passed)`：GRAY 才可验证；passed=true → ACTIVE；false → 回滚（同 rollback 逻辑，GM 审计留痕）
- `rollbackActivity(adminId, id)`：ACTIVE/GRAY → 从最近发布审计快照恢复 conditionJson/rewardJson/startAt/endAt → status=DRAFT、whitelist 清空；无发布记录 → ACTIVITY_NOT_PUBLISHED；GM 审计
- `isWhitelisted(template, playerId)`：百分比字符串（如 "10%"）→ playerId hash 取模；玩家ID数组 → 包含判断
- `getActiveActivities(playerId)`：ACTIVE 全量 + GRAY 中 whitelist 命中者（客户端视角）
- `joinActivity/signIn/claimReward`：GRAY 且非白名单 → ACTIVITY_GRAY_ONLY 拦截

**测试**：发布→灰度→白名单可见→灰度通过→ACTIVE；灰度失败→回滚；回滚恢复快照；无发布记录拒绝；白名单百分比命中

### Task 3: 远程配置版本历史 + 回滚
**Files:**
- 新 `src/modules/config/entities/config-version.entity.ts`（表 config_versions：id/configKey/version/value/createdBy(nullable)/createdAt；Index configKey+version）
- 改 `src/modules/config/entities/index.ts` + `config.module.ts`（forFeature）
- 改 `src/modules/config/config.service.ts`

**方法：**
- `setConfig` 内追加：写 config_versions 历史快照（每次变更一行）
- `listConfigVersions(key)`：版本倒序列表
- `rollbackConfig(adminId, key, version)`：查该版本历史（无 → CONFIG_VERSION_NOT_FOUND）；校验版本 < 当前版本；恢复 value → version+1 + 写新历史 + 清 Redis 缓存 + CONFIG_UPDATED + GM 审计

**测试**：set 写历史；回滚恢复旧值且版本递增；回滚到不存在版本拒绝；缓存失效

### Task 4: 活动数据看板
**Files:**
- 改 `src/modules/activity/activity.service.ts`（+ getActivityDashboard）

**方法：**
- `getActivityDashboard(id, days=7)`：参与数（player_activities count）、签到数（sign_in_records count + 今日签到）、奖励领取数、参与玩家等级分布（join player level 聚合，join player 表）、活动期留存（join 玩家 join 后次日有 LOGIN 行为比例，查 player_behavior_logs）、最近 N 天每日参与趋势
- 数据看板接口挂 AdminGuard（运营看板当天可见）

**测试**：看板字段齐全；趋势按日聚合；空数据不崩

### Task 5: 控制器接口 + 冒烟
**Files:**
- 改 `src/modules/activity/activity.controller.ts`（admin: publish/gray-verify/rollback/dashboard）
- 改 `src/modules/config/config.controller.ts`（admin: versions/rollback）

**接口：**
- `POST api/admin/v1/activity/:id/publish`（body: grayWhitelist?）
- `POST api/admin/v1/activity/:id/gray-verify`（body: passed）
- `POST api/admin/v1/activity/:id/rollback`
- `GET api/admin/v1/activity/:id/dashboard?days=7`
- `GET api/admin/v1/config/:key/versions`
- `POST api/admin/v1/config/:key/rollback`（body: version）
- 客户端 `GET api/client/v1/activity/list` 支持灰度过滤（自动）

**冒烟**：创建→发布（白名单）→灰度玩家可见/非白名单 60002→灰度通过→回滚→版本回滚→看板

## 迭代 4-2 · 社区运营（13.7 公告互动/建议箱/玩家大使）

### Task 1: 枚举 / 错误码 / 事件 + 新实体 + community 模块骨架
**Files:**
- `src/constants/enums.ts`（NoticeReactionType/FeedbackCategory/FeedbackStatus/AmbassadorStatus）
- `src/constants/error-codes.ts`（919xx）
- `src/event-bus/game-events.ts`（NOTICE_REACTED/FEEDBACK_SUBMITTED/AMBASSADOR_APPOINTED）
- 新 `src/modules/notice/entities/notice-reaction.entity.ts`（表 notice_reactions：id/noticeId/playerId/reactionType/createdAt；Unique noticeId+playerId+reactionType）
- 新 `src/modules/community/` 模块：`entities/feedback-suggestion.entity.ts`（表 feedback_suggestions：id/playerId/category(enum)/content/text/status(enum)/reply(nullable)/adminId(nullable)/handledAt(nullable)/createdAt）、`entities/player-ambassador.entity.ts`（表 player_ambassadors：id/playerId/status(enum)/remark/createdBy/appointedAt/revokedAt(nullable)）、`community.module.ts`/`community.service.ts`/`community.controller.ts`
- 改 `src/modules/notice/entities/notice.entity.ts`（+ likeCount/ackCount）+ `notice.module.ts`（forFeature reaction）+ `entities/index.ts`

**测试**：实体 smoke

### Task 2: 公告互动
**Files:**
- 改 `src/modules/notice/notice.service.ts`（+ react/reactionCounts）+ `notice.controller.ts`

**方法：**
- `react(noticeId, playerId, type)`：查公告存在；唯一约束重复 → NOTICE_REACTION_EXISTS；likeCount/ackCount +1；发 NOTICE_REACTED
- `getReactions(noticeId)`：{likes, acks}
- `getActiveNotices` 返回带计数

**测试**：点赞/回执计数；重复拒绝；公告不存在拒绝

### Task 3: 建议箱
**Files:**
- `src/modules/community/community.service.ts` + `community.controller.ts`

**方法：**
- `submitFeedback(playerId, category, content)`：status=pending；发 FEEDBACK_SUBMITTED
- `getMyFeedback(playerId)`：我的反馈（含状态/回复）
- `listFeedback(status?, page, limit)`：管理端
- `handleFeedback(adminId, id, status, reply)`：pending 才可处理；写 reply/adminId/handledAt；玩家端可见闭环
- Bug 反馈留档 GM 工单：category=bug 时同步 logOperation 占位（GM 审计）

**测试**：提交→列表→处理（已采纳）→玩家端可见；非法状态拒绝

### Task 4: 玩家大使
**Files:**
- `src/modules/community/community.service.ts`（+ ambassador 方法）+ controller

**方法：**
- `appointAmbassador(adminId, playerId, remark?)`：重复在任 → AMBASSADOR_EXISTS；status=active；发 AMBASSADOR_APPOINTED；称号发放：查 title_templates 是否存在「江湖大使」（name='江湖大使'）→ 有则发放到 character_titles（无则跳过，不阻断）；GM 审计
- `revokeAmbassador(adminId, id)`：status=revoked + revokedAt；GM 审计
- `listAmbassadors(status?)`：管理端
- `getActiveAmbassadors()`：客户端（在任大使列表）
- `recommendAmbassadors(limit)`：调 analytics 社交枢纽接口（4-3 完成前返回占位空数组）

**测试**：任命/重复拒绝/撤销/客户端列表/称号发放容错

### Task 5: 控制器 + 冒烟
**接口：**
- `POST api/client/v1/notice/:id/react`（body: type）
- `GET api/client/v1/notice/:id/reactions`
- `POST api/client/v1/community/feedback`（category/content）
- `GET api/client/v1/community/feedback/my`
- `GET api/admin/v1/community/feedback/list?status=`
- `POST api/admin/v1/community/feedback/:id/handle`
- `POST api/admin/v1/community/ambassadors` / `POST .../ambassadors/:id/revoke` / `GET api/admin/v1/community/ambassadors`
- `GET api/client/v1/community/ambassadors`

**冒烟**：公告互动闭环；建议提交→处理→玩家可见；大使任命/撤销/列表

## 迭代 4-3 · 社交数据分析（13.8 关系图谱/流失预警/社交漏斗）

### Task 1: analytics 模块实体注入 + 错误码
**Files:**
- 改 `src/modules/analytics/analytics.module.ts`（forFeature += Friend/Kinship/GuildMember/ChatMessage/Player）
- `src/constants/error-codes.ts`（922xx 分析域可选）

**测试**：模块装配编译通过

### Task 2: 关系图谱 + 社交枢纽
**Files:**
- 改 `src/modules/analytics/analytics.service.ts`（+ 社交分析方法）+ `analytics.controller.ts`

**方法：**
- `getSocialGraph(limit=50)`：节点=近30天有行为玩家（behavior log 聚合，带昵称），边=好友 accepted + 亲缘 active 成员；按度数 TOP limit 裁剪防爆量；输出 {nodes:[{id,nickname,degree}], edges:[{source,target,type}]}
- `getSocialHubs(limit=10)`：度数 = 好友数 + 亲缘成员数（去重）；返回 {playerId, nickname, degree, friendCount, kinshipCount} 降序——大使候选（13.8②）+ 流失挽回锚点

**测试**：图谱节点边正确；枢纽排序；空数据不崩

### Task 3: 流失预警
**Files:**
- 改 `src/modules/analytics/analytics.service.ts`

**方法：**
- `getChurnRisks(days=7)`：对比近 7d vs 前 7d 社交动作数（好友新增 + 送礼流水 FAVOR 收发 + world/guild 聊天数）；近 7d 有登录（LOGIN 行为）且社交动作降幅 ≥ 50% 且前 7d 动作数 ≥ 3 → 风险名单；返回 {playerId, nickname, prevCount, recentCount, dropRate, riskLevel:'high'|'medium'}；并返回命中玩家可推送社交召集（占位字段 pushSuggested）

**测试**：构造数据验证降幅判定；边界（无历史/无登录不预警）

### Task 4: 社交漏斗（7日社交建立率）——验收核心指标
**Files:**
- 改 `src/modules/analytics/analytics.service.ts`

**方法：**
- `getSocialFunnel(days=7)`：新玩家 = 近 days 天注册 player；建立关系 = accepted 好友（任一方）OR 入帮（guild_members）OR 亲缘成员（kinships.members 含）；输出 {newPlayerCount, relatedCount, relationRate(百分比1位小数), threshold: 60, healthy, detail: {withFriend, withGuild, withKinship}}
- 与 balance-audit 的 auditSocial 同口径（15.8 四象限一致）

**测试**：构造新玩家数据验证分子分母；阈值 60 判定

### Task 5: 控制器 + 冒烟
**接口：**
- `GET api/admin/v1/analytics/social/graph?limit=50`
- `GET api/admin/v1/analytics/social/hubs?limit=10`
- `GET api/admin/v1/analytics/social/churn-risk?days=7`
- `GET api/admin/v1/analytics/social/funnel?days=7`

**冒烟**：四接口全绿；funnel healthy 可判定；hubs 供 4-2 大使候选联动（回填 recommendAmbassadors）

## 迭代 4-4 · 聊天频道深化（14.8-14.12）

### Task 1: 枚举 / 错误码 / 事件 + 新实体
**Files:**
- `src/constants/enums.ts`（SupportTicketStatus/VoiceRoomType；ActivityType.CHANNEL 已在 4-1）
- `src/constants/error-codes.ts`（921xx）
- `src/event-bus/game-events.ts`（CHAT_SIGN_IN/LUCKY_STAR_DRAWN/SUPPORT_TICKET_CREATED/VOICE_ROOM_JOINED/VOICE_ROOM_LEFT）
- 新 `src/modules/chat/entities/chat-player-stat.entity.ts`（表 chat_player_stats：id/playerId/channel/msgCount/int/level/int/updatedAt；Unique playerId+channel）
- 新 `src/modules/chat/entities/chat-sign-in.entity.ts`（表 chat_sign_ins：id/playerId/signInDate/date/rewardJson/jsonb/createdAt；Unique playerId+signInDate）
- 新 `src/modules/chat/entities/support-ticket.entity.ts`（表 support_tickets：id/playerId/channel/keyword/content/status(enum)/autoReply(nullable)/gmReply(nullable)/adminId(nullable)/handledAt(nullable)/createdAt）
- 新 `src/modules/chat/entities/voice-room.entity.ts`（表 voice_rooms：id/roomName/ownerId/roomType(enum)/members(jsonb 数组)/maxMembers(int 默认 8)/createdAt）
- 改 `chat.module.ts`（forFeature += 4 实体）+ `entities/index.ts`

**测试**：实体 smoke

### Task 2: gateway chat.send（实时入口 + 权限 + 限频 + 统计）
**Files:**
- 改 `src/modules/gateway/game.gateway.ts`（+ chat.send 处理器，注入 ChatService + FriendRepo/GuildMemberRepo 校验）
- 改 `src/modules/chat/chat.service.ts`（+ sendChannelMessage 统一入口：权限校验/限频/统计/签到触发/客服检测）

**逻辑：**
- `chat.send` 消息：{data:{channel, content, recipientId?, guildId?}}
  - world：等级≥3 解锁（远程配置 `chat.world_level_req` 默认 3）；限频 Redis `chat:rate:{playerId}` 5s/条（world 最严）
  - guild：校验 guild_members 在帮
  - private：校验 friends accepted（双向任一）
  - 敏感词过滤（已有）；入库 chat_messages；事件广播：world→server.emit 全服 / guild→`guild:{guildId}` room / private→双方 socket
  - 统计：chat_player_stats msgCount+1 + level 分段重算
  - 世界频道当日首条 → 频道签到（Task 3）
  - 命中客服关键词 → 自动建工单（Task 6）

**测试**：三频道权限拒绝/限频/统计递增/广播目标

### Task 3: 频道签到 + 频道等级
**Files:**
- 改 `src/modules/chat/chat.service.ts` + `chat.controller.ts`

**方法：**
- `channelSignIn(playerId)`：今日已有 → CHAT_SIGN_IN_DONE；新建 chat_sign_ins（rewardJson 读 remote_config `chat.sign_in_reward` 默认 {favor:1}，发放调用 economy 占位——未接 economy 则仅记录）；发 CHAT_SIGN_IN
- `getSignInStatus(playerId)`：今日是否已签
- `getMyChatStats(playerId)`：chat_player_stats 全频道 + level 分段（remote_config `chat.level_thresholds` JSON 默认 {0:0,1:10,2:50,3:200}）
- 客户端接口：`POST api/client/v1/chat/sign-in` / `GET api/client/v1/chat/sign-in/status` / `GET api/client/v1/chat/my-stats`

**测试**：首发言签到/重复拒绝/等级分段

### Task 4: 江湖热搜 + 话题标签
**Files:**
- 改 `src/modules/chat/chat.service.ts` + `chat.controller.ts`

**方法：**
- `getHotTopics(days=1, limit=10)`：查近 days 天 world 频道消息；正则解析 `#[\u4e00-\u9fa5\w]+`（话题标签）与 `@[\u4e00-\u9fa5\w]{2,32}`（玩家昵称提及）；聚合 TOP limit；Redis 缓存 `chat:hot:{days}` 60s；空 → CHAT_TOPIC_EMPTY
- 客户端接口：`GET api/client/v1/chat/hot-topics?days=1`

**测试**：话题聚合计数排序；缓存命中；空数据

### Task 5: 频道幸运星
**Files:**
- 改 `src/modules/chat/chat.service.ts` + `chat.controller.ts`

**方法：**
- `drawLuckyStar(adminId, count=3, days=1)`：候选=近 days 天有效发言玩家（content 长度 ≥ 8 去水，按 chat_messages 聚合）；不足 → LUCKY_STAR_NO_CANDIDATE；随机抽 count；奖励读 remote_config `chat.lucky_star_reward` 默认 {favor:5}（发放占位，仅记录名单）；GM 审计 + 发 LUCKY_STAR_DRAWN
- 管理接口：`POST api/admin/v1/chat/lucky-star/draw?count=3&days=1`

**测试**：去水过滤/随机抽取/不足拒绝

### Task 6: 客服引导
**Files:**
- 改 `src/modules/chat/chat.service.ts` + `chat.controller.ts`

**方法：**
- `checkSupportTrigger(playerId, channel, content)`：关键词命中（remote_config `support.keywords` JSON 默认 ["投诉","举报","申诉","退款","GM","客服"]；分类 `support.gm_keywords` 默认 ["GM","客服","充值问题","退款"]）→ 建 support_tickets（status=auto_replied 带自动回复文案 / needs_gm）；发 SUPPORT_TICKET_CREATED；自动回复返回给发送者
- `getMyTickets(playerId)` / `listTickets(status?, page, limit)` / `replyTicket(adminId, id, reply)`：reply → status=resolved + 可选发公告（Notice 创建，14.12④ 处理结果公开）
- 接口：`GET api/client/v1/chat/support/my` / `GET api/admin/v1/chat/support/list` / `POST api/admin/v1/chat/support/:id/reply`

**测试**：关键词触发建单；GM 回复闭环；公告可选

### Task 7: 语音房（骨架）
**Files:**
- 改 `src/modules/chat/chat.service.ts` + `chat.controller.ts`

**方法：**
- `createVoiceRoom(playerId, roomName, roomType, maxMembers?)` / `joinVoiceRoom(playerId, roomId)`（满 → VOICE_ROOM_FULL）/ `leaveVoiceRoom(playerId, roomId)`（空房自动删除）/ `getVoiceRooms(roomType?)`；成员变更广播（gateway room 占位，发 VOICE_ROOM_JOINED/LEFT）
- 接口：`POST api/client/v1/chat/voice-room` / `POST .../voice-room/:id/join` / `POST .../voice-room/:id/leave` / `GET api/client/v1/chat/voice-rooms`

**测试**：创建/加入/满员/离开/空房清理

### Task 8: 全链路冒烟（chat 深化）
**冒烟**：连接 ws → 世界发言（统计+签到）→ 热搜出现话题 → 客服关键词触发工单 → GM 回复 → 幸运星抽取 → 语音房进出

## 收尾（阶段4整体）

1. 全量回归：`npm test` 既有 + 新增 spec 全绿
2. `tsc --noEmit` 零错误
3. 本地构建 dist + smoke 脚本（scp 到服务器执行，覆盖 4-1 至 4-4 新接口）
4. 部署：pg_dump 备份 → scp dist → 保留旧 dist → systemd 重启 → 冒烟 → 失败回滚
5. 手册更新：main-part.html 数据字典补 8 张新表字段、接口索引补新接口、check.js 校验通过 → 发布 deploy-manual.ps1
6. 验收核对：运营看板接口当天可见；funnel 7 日关系建立率输出
