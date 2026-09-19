# 补充社交任务 + 生态联动设计（阶段 3 延伸）

- 版本：v1.0
- 日期：2026-09-20
- 项目：game-server（NestJS 11 + TypeORM + PostgreSQL + Redis，game.joho.cn）× 业务站点（www.joho.cn 文章 / v.joho.cn 课程 / www.youshop.cn 商品 / zhao-point 活动）
- 依据：《游戏服务器开发手册》6.19-6.25 / 7.4-7.9 / 11.3-11.12；阶段 3 计划（2026-09-19-social-game-phase3.md）
- 决策记录（用户确认 2026-09-20）：**SSO 直接登录游戏**（非绑定方案）；**业务插件回调上报**（非前端直报/轮询）；**P0 浏览查看报名 + P1 互动成交 + P2 分销全接入**

## 1. 背景与目标

阶段 3 已实现游戏内社交任务骨架（5 类社交动作事件推进 + 前提校验 + 卡关求助），存在三类缺口：

1. **游戏内事件遗漏**：`join_guild` / `intel_buy` 两个目标类型无事件推进入口；3-1 社交战斗、3-3 社交经济行为无对应任务目标——「社交×系统联动」闭环不完整。
2. **生态行为缺失**：游戏外业务站点（文章/课程/商品/活动）的浏览、查看价格、报名、成交、分销、点赞、评论等真实用户行为未被纳入社交任务体系，游戏任务与业务生态完全隔离。
3. **任务数据空白**：`quest_templates` 缺少社交/生态任务种子数据。

**目标**：补全游戏内战斗/经济行为 → 任务闭环；打通业务站点行为 → 游戏任务联动，形成「游戏内社交 × 业务生态」双环互哺。

## 2. 总体架构

```
C 端用户（SSO 会话）
   │
   ├─[SSO 直接登录]→ game-server /auth/sso/login → zhao-sso authorize
   │                    └→ /auth/sso/callback → 换码 → 建/查 auth_accounts+players
   │
   ├─[行为发生地] zhao-website / zhao-course / zhao-point / 商品站(Vendure)
   │        │  插件内钩子（fire-and-forget POST，HMAC 签名）
   │        ▼
   │   game-server POST /api/client/v1/eco/events
   │        │  签名校验 + 时间戳防重放 + sso_id → playerId
   │        ▼
   │   EventBus ECO_ACTION → QuestEventListener → advanceSocialTarget
   │
   └─[游戏内行为] combat/trade/social 模块 → 既有事件 → 任务推进
```

## 3. 决策记录

| 决策点 | 结论 | 理由 |
|---|---|---|
| 身份打通 | SSO 直接登录游戏 | 无绑定成本、体验最顺；zhao-sso 已提供标准 OAuth2（authorize/exchange-token） |
| 行为上报 | 业务插件回调上报 | 行为在业务系统本地发生最可信；签名+防重放可验 |
| 生态范围 | P0+P1+P2 全接入 | 数据源已确认：visit-log/interaction/invite-trace/course-enrollment/lesson-progress/activity-signup/activity-referral-reward |
| 新增依赖 | 不新增 npm 依赖 | 游戏侧 crypto/http 内置；Strapi 侧 fetch 内置 |
| 兼容 | 既有 NORMAL 账号登录保留 | SSO 账号与 NORMAL 账号并存，互不迁移 |

## 4. A 部分 · 游戏内补充（战斗 + 经济行为 → 任务）

### 4.1 SocialTargetType 扩展（游戏内，只加值不删值）

```
FORM_FORMATION     组建阵法
ACTIVATE_FORMATION 激活阵法
PERFORM_COMBO      完成合击
RESCUE_SUCCESS     成功援护
LOOT_DISTRIBUTED   参与战利品分配
ARBITRATION_SETTLED 调解仲裁成功
NEGOTIATION_DONE   议价成交
ESCROW_RELEASED    担保交易放款
BOUNTY_PUBLISHED   发布悬赏
BOUNTY_COMPLETED   完成悬赏
CREDIT_REPAID      还清赊账
BARTER_DONE        以物易物成交
```

### 4.2 事件补齐

| 事件 | 补发位置 | 对应目标 |
|---|---|---|
| `GUILD_JOINED` | social.service（joinGuild 成功后） | join_guild |
| `INTEL_BOUGHT` | social.service（intelBuy 成功后） | intel_buy |
| `FORMATION_ACTIVATED` / `COMBO_TRIGGERED` / `RESCUE_SUCCESS` / `LOOT_DISTRIBUTED` / `ARBITRATION_SETTLED` | 3-1 已发，仅补监听映射 | 战斗四类目标 |
| `NEGOTIATION_COMPLETED` / `ESCROW_RELEASED` / `BOUNTY_PUBLISHED` / `BOUNTY_COMPLETED` / `CREDIT_SETTLED` / `BARTER_COMPLETED` | trade.service 补发（3-3 当时未发） | 经济六类目标 |

### 4.3 监听器扩展

quest-event.listener.ts 新增映射：战斗事件 → 战斗目标；经济事件 → 经济目标。复用 `advanceSocialTarget(playerId, targetType)` 与既有去重/进度语义，不新增逻辑。

## 5. B 部分 · 生态联动（业务站点行为 → 任务）

### 5.1 SSO 直接登录（auth 模块改造）

**表变更**（synchronize=true，只加列）：
- `auth_accounts += sso_id varchar(64) unique nullable / sso_provider varchar(32)`

**流程**：
1. `GET /api/client/v1/auth/sso/login?redirect=...` → 302 跳 zhao-sso `authorize?app_code=game&redirect_uri={game 回调}&response_type=code`
2. 用户 SSO 授权 → 302 回 `GET /api/client/v1/auth/sso/callback?code=xxx`
3. game-server 用 code 调 zhao-sso `exchange-token`（app_code + code，回调一致性由 zhao-sso 校验）→ 获得 `{ ssoId, username }`
4. `auth_accounts` 按 sso_id 查 → 有则签发游戏 token（tokenVersion 逻辑复用）；无则自动建档（username 取 SSO 用户名，密码随机不可密码登录，accountType=SSO）→ 建 players 行（accountId 关联）→ 签发 token

**错误码**：`SSO_AUTH_FAILED(91605)` 换码失败 / `SSO_ACCOUNT_EXISTS(91606)` 用户名冲突（SSO 用户名与既有 NORMAL 同名时追加后缀）。

### 5.2 行为回调接口

`POST /api/client/v1/eco/events`（业务插件回调，非玩家直调）

**请求头**：`X-Eco-Sign: hmac_sha256(sharedSecret, body + "|" + timestamp)`、`X-Eco-Ts: unix 秒`、`Content-Type: application/json`

**请求体**：
```json
{ "action": "view_article", "scope": "joho", "ssoId": "12", "targetId": "1024", "extra": {} }
```

**action 枚举（生态域）**：
```
view_article / view_course / view_product / view_price / view_activity
join_activity / like / comment / purchase / distribute
```

**校验管线**（eco-events 服务）：
1. 时间戳窗口 ±300s（防重放前提）
2. HMAC-SHA256 签名比对（sharedSecret 环境变量 `ECO_SHARED_SECRET`，与业务侧共享）
3. Redis 防重放：key `eco:evt:{sha256(body+ts)}` SET NX EX 300，已存在抛 `ECO_REPLAY(91602)`
4. action 在白名单（`ECO_UNKNOWN_ACTION(91604)`）
5. sso_id → players 映射（players 无此 sso_id → `ECO_SSO_NOT_BOUND(91603)` 静默忽略，不报错——业务侧无需感知）
6. 通过 → EventBus 发 `ECO_ACTION`（payload: playerId/action/scope/targetId）→ QuestEventListener 按 action 映射 `SocialTargetType`（生态域）推进任务

**生态域 SocialTargetType 扩展**：
```
VIEW_ARTICLE / VIEW_COURSE / VIEW_PRODUCT / VIEW_PRICE / VIEW_ACTIVITY
JOIN_ACTIVITY / LIKE / COMMENT / PURCHASE / DISTRIBUTE
```

### 5.3 业务插件钩子（Strapi / 商品站）

钩子统一模式：行为写入点后 fire-and-forget `POST {GAME_URL}/api/client/v1/eco/events`，2s 超时、失败静默（console.warn），密钥/地址走插件 config 或环境变量。

| 站点 | 插件 | 行为 | 触发点 |
|---|---|---|---|
| www.joho.cn 文章 | zhao-website | view_article | visit-log 写入处 |
| | | like / comment | interaction 写入处 |
| | | distribute | invite-trace 写入处 |
| v.joho.cn 课程 | zhao-course | view_course | course 详情访问/lesson-progress 写入处 |
| | | purchase | course-enrollment 创建处 |
| zhao-point 活动 | zhao-point | view_activity | activity 详情访问处 |
| | | join_activity | activity-signup 创建处 |
| | | distribute | activity-referral-reward 创建处 |
| www.youshop.cn 商品 | 商品站插件 | view_product / view_price | 商品详情/价格查看处 |
| | | purchase | 订单创建处 |
| | | distribute | 分销关系/佣金结算处 |

### 5.4 防刷护栏

- 生态浏览类任务进度**每日计入上限**：任务级每日最多 +N 次（Redis key `eco:daily:{playerId}:{targetType}`，默认 10 次/日），防止批量脚本刷浏览任务
- 签名防伪造（HMAC + 时间戳 + 防重放）
- 成交/报名/分销类以业务侧真实记录为准（enrollment/signup/订单创建处触发），不可凭空刷

## 6. 任务种子数据（quest_templates 补充）

按既有 schema（target_type/prerequisite_social/reward_social）插入，示例：

| name | target_type | target 数量 | reward_social | 说明 |
|---|---|---|---|---|
| 初窥门径·浏览文章 | view_article | 3 | favor +10 | 生态 P0 |
| 江湖见闻·查看课程 | view_course | 2 | favor +10 | 生态 P0 |
| 货比三家·查看商品 | view_product | 3 | face +5 | 生态 P0 |
| 一探究竟·查看价格 | view_price | 2 | face +5 | 生态 P0 |
| 闻讯而动·报名活动 | join_activity | 1 | face +10 | 生态 P0 |
| 英雄所见·点赞文章 | like | 3 | favor +15 | 生态 P1 |
| 仗义执言·发表评论 | comment | 1 | favor +15 | 生态 P1 |
| 千金一诺·完成成交 | purchase | 1 | face +20 | 生态 P1 |
| 结阵而战·激活阵法 | activate_formation | 1 | guild_contrib +20 | 游戏内补充 |
| 同生共死·成功援护 | rescue_success | 1 | favor +15 | 游戏内补充 |
| 一诺千金·担保放款 | escrow_released | 1 | guild_contrib +20 | 游戏内补充 |
| 广而告之·发布悬赏 | bounty_published | 1 | face +10 | 游戏内补充 |

种子以 SQL 迁移脚本提供（幂等 INSERT，name 唯一去重），执行时附于部署步骤。

## 7. 错误码新增（error-codes.ts，生态域 916xx）

```
ECO_SIGN_INVALID(91601)     签名校验失败
ECO_REPLAY(91602)           重复上报（防重放命中）
ECO_SSO_NOT_BOUND(91603)    sso_id 无对应玩家（静默忽略用，接口不返回）
ECO_UNKNOWN_ACTION(91604)   未知行为类型
SSO_AUTH_FAILED(91605)      SSO 换码/登录失败
SSO_ACCOUNT_EXISTS(91606)   SSO 用户名与既有账号冲突
```

## 8. 接口清单

| 接口 | 方法 | 说明 |
|---|---|---|
| /api/client/v1/auth/sso/login | GET | 302 到 SSO 授权页 |
| /api/client/v1/auth/sso/callback | GET | 换码建档发 token |
| /api/client/v1/eco/events | POST | 业务插件行为回调（HMAC 签名） |
| /api/admin/v1/eco/events/stats | GET | 生态事件接收统计（GM 排障） |

## 9. 实施计划（迭代划分）

- **E1 · SSO 登录**：auth_accounts 加列 + sso login/callback 控制器 + 自动建档 + 单测（mock zhao-sso exchange-token）
- **E2 · 生态事件接收**：eco-events 服务（签名/防重放/映射）+ 控制器 + 单测
- **E3 · 任务扩展**：SocialTargetType 生态域+游戏内补充 + 监听器映射 + social/combat/trade 事件补发 + 单测
- **E4 · 种子数据**：quest_templates SQL 种子脚本（幂等）
- **E5 · 业务钩子**：zhao-website / zhao-course / zhao-point 钩子 + 商品站钩子（Strapi dist 重建）
- **E6 · 收尾**：全量回归 + tsc + 冒烟（模拟签名回调全链路）+ 部署 + 手册发布（第 16 章）

## 10. 风险与护栏

| 风险 | 护栏 |
|---|---|
| SSO 回调被伪造 | 授权码一次性 + 回调白名单（zhao-sso 侧）+ app_code=game 独立注册 |
| 生态接口被刷 | HMAC 签名 + 时间戳窗口 + Redis 防重放 + 浏览类日上限 |
| 业务插件故障拖垮主流程 | fire-and-forget + 2s 超时 + 静默失败 |
| sso_id 与账号错配 | auth_accounts.sso_id 唯一约束；换码结果以 zhao-sso 为准 |
| Strapi 侧新增依赖风险 | 钩子用内置 fetch/axios，不加新依赖；zhao-* 插件需重建 dist 部署（铁律） |
| 商品站技术栈未最终确认 | 执行 E5 前确认 www.youshop.cn 实现（Vendure 系），钩子按对应框架插件模式实现 |

## 11. 验收标准

1. SSO 授权登录游戏成功建档（auth_accounts.sso_id 落库 + players 自动创建 + token 签发）
2. 模拟签名回调 10 类生态行为 → 对应 SocialTargetType 任务进度推进（含日上限）
3. 游戏内战斗（合击/援护/阵法激活）、经济（议价/担保/悬赏/赊账/易物）行为 → 任务推进
4. join_guild / intel_buy 事件补齐后可推进任务
5. 全量单测通过 + tsc 0 错误 + 冒烟通过 + 生产部署 + 手册第 16 章发布
