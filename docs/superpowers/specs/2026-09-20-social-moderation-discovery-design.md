# 社交治理与发现设计（阶段 5 · 批 1）

- 版本：v1.0
- 日期：2026-09-20
- 项目：game-server（NestJS 11 + TypeORM + PostgreSQL + Redis，game.joho.cn）
- 依据：《游戏服务器开发手册》第 8 章（社交系统）/ 第 13 章（运营与数据）；阶段 4 计划（2026-09-20-social-game-phase4.md）；探索盘点（social/auth/chat/admin/analytics 模块现状）
- 决策记录（用户确认 2026-09-20）：**举报走 admin 手工处理**（复用阶段 4 社区运营台账模式）；**拉黑为完整社交隔离**（私聊/好友申请/亲缘互动，双向）；**推荐用图谱协同**（复用 analytics 关系图谱，附推荐理由）；**方案 1 扩展 social 模块**（举报/拉黑/推荐全放 social，chat 补禁言校验，admin 复用 auth-admin 惩罚接口）

## 1. 背景与目标

阶段 1~4 已交付基础/成长/生态/运营治理四阶段，社交系统（好友/公会/情报/礼物/亲缘/七日引导）与运营治理（公告/建议箱/大使/分析/聊天深化）均已上线。经功能缺口盘点确认三类盲区：

1. **无社区治理闭环**：玩家无举报入口、无拉黑/屏蔽能力；现有 `face` 的 report 是战报非举报；admin 侧无举报台账。
2. **无社交发现能力**：阶段 4 已实现关系图谱（分析侧），但缺"你可能认识"推荐侧，新玩家社交建立依赖主动搜索。
3. **禁言未生效**：`auth` 已具备分级处置（`PenaltyLevel` 含 MUTE，`auth-account.mutedUntil` 字段 + `applyPenalty` 已实现），但 chat 发言链路未校验 `mutedUntil`，禁言实际不生效。

**目标**：补全社区治理（举报→admin 处理→惩罚生效）与社交发现（图谱协同推荐）两环，形成"发现→建立→治理"完整社交闭环。

## 2. 总体架构

```
C 端玩家                          admin
  │  POST report/block              │  GET community/reports（台账）
  │  GET recommend/friends          │  POST community/reports/:id/handle
  ▼                                 ▼
social 模块（新增）            community 模块（复用台账模式）
  │  player_reports / player_blocks │   └→ authService.applyPenalty（复用分级处置）
  │                                 │        └→ auth-account.mutedUntil / BANNED
  ├─ 推荐：调 analytics 关系图谱（复用）
  │
chat 模块（补校验）            social 链路（补校验）
  sendChannelMessage              friend/apply、kinship/form
  → mutedUntil + 互拉黑             → 拉黑关系拦截
```

## 3. 决策记录

| 决策点 | 结论 | 理由 |
|---|---|---|
| 举报处理 | admin 手工处理（台账） | 阶段 4 社区运营已有台账模式，不新增自动惩罚逻辑（最简、可控） |
| 拉黑范围 | 完整社交隔离（双向） | 私聊不可达 + 好友申请自动拒绝 + 亲缘互动禁止；被拉黑方同样看不到拉黑者私聊 |
| 推荐逻辑 | 图谱协同推荐 | 复用阶段 4 analytics 关系图谱（共同好友/同帮派/亲缘网络打分），附推荐理由 |
| 实现组织 | 方案 1：扩展 social 模块 | 举报/拉黑本质是社交关系；改动集中在 social/chat/auth-admin 三处；不新增模块 |
| 惩罚能力 | 复用 authService.applyPenalty | `PenaltyLevel`/`mutedUntil`/`account-penalty` 均已存在，仅补 chat 链路校验缺口 |
| 新增依赖 | 不新增 npm 依赖 | 全部使用既有框架能力 |
| 处理动作 | IGNORE / WARN / MUTE / BAN | 对齐 PenaltyLevel 枚举（WARNING/MUTE/GUILD_REMOVE/TRADE_LIMIT/BAN），台账只暴露前四类 |

## 4. A 部分 · 社区治理（举报 + 拉黑 + 禁言生效）

### 4.1 数据模型（新增 2 表）

`player_reports` 举报表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | |
| reporter_id | bigint | 举报人 |
| target_type | varchar(32) | 枚举：PLAYER / CHAT_MESSAGE / GUILD |
| target_id | varchar(64) | 玩家ID / 消息ID / 帮派ID |
| reason | varchar(32) | 枚举：ABUSE / AD / FRAUD / CHEAT / OTHER |
| content | varchar(500) | 补充描述，可空 |
| status | varchar(16) | 枚举：PENDING / PROCESSED / IGNORED，默认 PENDING |
| handler_admin_id | bigint | 处理人，可空 |
| handle_action | varchar(32) | 最终处置：IGNORE / WARN / MUTE / BAN，可空 |
| handle_remark | varchar(255) | 处理备注，可空 |
| handled_at | timestamp | 可空 |
| created_at | timestamp | |

索引：`(target_type, target_id)`、`(status)`、`(reporter_id)`。

`player_blocks` 拉黑表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | |
| player_id | bigint | 拉黑者 |
| blocked_id | bigint | 被拉黑者 |
| created_at | timestamp | |

唯一索引 `(player_id, blocked_id)`；索引 `(blocked_id)`（双向查询）。

### 4.2 接口

客户端（social 模块，均 `@UseGuards(JwtAuthGuard)`）：

- `POST /api/client/v1/social/report` `{ targetType, targetId, reason, content? }`
  - 校验：reason/targetType 枚举合法、targetId 存在；同一 `reporter_id + target_id` 24h 内去重（防刷举报，错误码 `REPORT_COOLDOWN`）；不能举报自己
  - 成功：创建 PENDING 记录，emit `GameEvents.REPORT_SUBMITTED`
- `POST /api/client/v1/social/block` `{ playerId }`
  - 校验：不能拉黑自己（`BLOCK_SELF`）；已拉黑幂等成功（重复拉黑直接返回成功，不报错）；每玩家上限 200 人（超限错误码 `BLOCK_LIMIT`）
  - 成功：写入 player_blocks，emit `GameEvents.PLAYER_BLOCKED`
- `DELETE /api/client/v1/social/block/:playerId` 取消拉黑
- `GET /api/client/v1/social/block/list` 我的拉黑列表（分页）
- `GET /api/client/v1/social/block/check?playerId=` 查询是否被对方拉黑（前端展示用，可选）

admin（community 模块，复用阶段 4 台账模式）：

- `GET /api/admin/v1/community/reports?status=&page=&pageSize=` 举报台账（分页，可按 status 筛选）
- `POST /api/admin/v1/community/reports/:id/handle` `{ action: IGNORE|WARN|MUTE|BAN, durationSeconds?, remark }`
  - action=IGNORE：标记 IGNORED + 备注
  - action∈{WARN,MUTE,BAN}：调用 `authService.applyPenalty(admin.username, playerId, accountId, level, reason, durationSeconds)`（复用分级处置），举报标记 PROCESSED + handle_action
  - 动作映射：WARN→`PenaltyLevel.WARNING`、MUTE→`PenaltyLevel.MUTE`、BAN→`PenaltyLevel.BAN`（IGNORE 不落惩罚）
  - 记录 GM 操作日志（复用 adminService.logOperation）
  - 幂等：已处理举报拒绝重复处理

### 4.3 禁言生效（补 chat 链路缺口）

- `chat.service.sendChannelMessage` 入口新增校验：
  1. 经 `player.account_id` 取账号，调 `authService.getAccountRestrictions(accountId)` 读取 `mutedUntil`，未过期则拒绝发言（复用预留错误码 `ACCOUNT_MUTED`，返回剩余时长）
  2. 私聊（channel=PRIVATE）经 `SocialService.isBlocked` 校验 `(senderId, recipientId)` 双向拉黑，命中则拒绝（错误码 `TARGET_BLOCKED_YOU`）
- gateway `chat.send` 已统一走 `sendChannelMessage`，天然生效，无需重复校验

### 4.4 拉黑隔离生效点

| 入口 | 逻辑 |
|---|---|
| chat 私聊 | 发送前双向拉黑校验（见 4.3） |
| friend/apply | 目标已拉黑申请人 → 自动拒绝（`TARGET_BLOCKED_YOU`） |
| kinship/form | 互拉黑 → 拒绝（`TARGET_BLOCKED_YOU`） |
| gift/send | 不禁（不在隔离范围内，保持社交活跃） |
| 帮派互动 | 不禁（组织关系，且帮派为共同场景） |

拉黑关系查询统一收敛到 social 模块门面方法 `isBlocked(a, b)`（双向），chat/social 内部引用，避免散落直查。

## 5. B 部分 · 社交发现（图谱协同推荐）

### 5.1 推荐算法

输入：当前玩家 P、候选数 N（默认 10，上限 20）。

数据源：复用 analytics `getSocialGraph` 已有图谱能力（好友/帮派/亲缘边），新增轻量打分：

1. **排除集**：已是好友、自己、互拉黑、已申请待接受
2. **打分**（按权重求和）：
   - 共同好友数 × 3（最强信号，"你可能认识"）
   - 同帮派 × 2
   - 亲缘网络（与 P 的亲缘对象的共同好友）× 1.5
   - 近 7 日活跃 × 1（冷启动补充）
   - 等级相近（|Δ|≤5）保底分 0.5
3. **理由字段**：取最高分来源生成 `reason`（`共同好友 N 人` / `同帮派` / `亲缘网络` / `活跃玩家`），可并列拼接

### 5.2 接口

- `GET /api/client/v1/social/recommend/friends?limit=10` → `[{ playerId, name, level, score, reason }]`
  - 排序：score 降序；无候选返回空数组
  - 每次返回随机扰动（同分随机），避免推荐固化

### 5.3 性能与缓存

- 候选规模为全服玩家，图谱边量级可控（社交游戏单服规模），实时计算可接受
- 若后续玩家数增长：缓存推荐结果 5 分钟（Redis），或在玩家社交动作（新好友/入帮/结亲缘）时失效；本期不做，仅留扩展点

## 6. 错误处理

新增错误码（constants/error-codes.ts，数值按既有分区编排）：

| 错误码 | 场景 |
|---|---|
| `BLOCK_SELF` | 不能拉黑自己 |
| `BLOCK_LIMIT` | 拉黑数超上限（200） |
| `TARGET_BLOCKED_YOU` | 被对方拉黑（私聊/好友申请/亲缘被拒） |
| `ACCOUNT_MUTED`（复用 50006 预留码） | 禁言中（返回剩余时长） |
| `REPORT_COOLDOWN` | 24h 内重复举报同一目标 |
| `REPORT_INVALID_TARGET` | 举报目标不存在或类型非法 |

## 7. 测试策略

- **单元**：
  - social.service：举报创建/去重/自举报拒绝、拉黑增删查/上限/自拉黑、推荐打分/排除集/理由生成
  - chat.service：mutedUntil 未过期拒绝（`ACCOUNT_MUTED`）、过期放行、私聊双向拉黑拦截
  - social 链路：friend/apply 被拉黑自动拒绝、kinship/form 互拉黑拒绝
  - community 台账：handle 幂等、IGNORE/WARN/MUTE/BAN 分发、GM 日志记录
- **冒烟**：新增 `scripts/smoke-stage5.sh`（复用 smoke-stage4.sh 结构），覆盖：举报提交→台账→处理闭环（含 MUTE 后发言被拒）、拉黑→私聊/好友申请/亲缘全链路拦截、推荐接口返回结构与理由字段
- **回归**：阶段 1~4 既有 111 项冒烟不回归（本批不触碰既有接口行为，仅 chat 发言新增校验）

## 8. 风险与护栏

| 风险 | 缓解 |
|---|---|
| chat 新增校验影响既有聊天（误伤） | 校验仅新增拦截分支，不改变既有放行逻辑；冒烟覆盖正常发言回归 |
| 举报被滥用（刷举报） | 24h 去重 + 台账状态透明 + admin 可 IGNORE |
| 推荐接口性能 | 单服规模实时可算；留缓存扩展点，不做预实现 |
| 拉黑滥用（全服拉黑） | 上限 200 人/玩家 |

## 9. 验收标准

1. 玩家可提交举报，24h 内去重；admin 台账可见并可处置（IGNORE/WARN/MUTE/BAN）
2. 处置 MUTE 后，被处置玩家发言被拒（返回剩余时长）；BAN 后登录被拒（既有能力验证）
3. 拉黑后：私聊不可达、好友申请自动拒绝、亲缘互动禁止；取消拉黑恢复
4. 推荐接口返回 ≤limit 条候选，附 reason，不含好友/自己/互拉黑
5. 阶段 1~4 冒烟全量回归通过，新增 smoke-stage5.sh 全绿
