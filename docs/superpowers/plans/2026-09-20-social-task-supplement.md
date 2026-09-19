# 补充社交任务 + 生态联动实施计划（E1-E6）

- 版本：v1.0
- 日期：2026-09-20
- 项目：game-server（game.joho.cn）× 业务站点（www.joho.cn / v.joho.cn / www.youshop.cn / zhao-point）
- 依据：`docs/superpowers/specs/2026-09-20-social-task-supplement-design.md`
- 执行方式：子代理驱动（TDD：先失败测试 → 实现 → 绿），任务间审查
- 用户确认（2026-09-20）：SSO 直接登录；业务插件回调上报；P0+P1+P2 全接入；完整交付流程（TDD+回归+部署+冒烟）

## 0. 总览

**验收标准**：SSO 登录建档打通；10 类生态行为回调推进任务；游戏内战斗/经济行为推进任务；join_guild/intel_buy 补齐；种子任务入库；手册第 16 章发布。

**复用不重写**：
- quest 模块：`advanceSocialTarget(playerId, targetType)` 与事件监听器骨架（扩展映射即可）
- 3-1 战斗事件（FORMATION_ACTIVATED/COMBO_TRIGGERED/RESCUE_SUCCESS/LOOT_DISTRIBUTED/ARBITRATION_SETTLED）已发，仅补监听
- auth 模块：tokenVersion/签发逻辑复用；players 自动建档复用 playerService
- zhao-sso：标准 OAuth2（authorize/exchange-token），游戏注册 app_code=game

**新增/变更**：
- 列：`auth_accounts += sso_id / sso_provider`
- 枚举：SocialTargetType +16（游戏内 12 + 生态域 10 中的重叠部分按值新增）；错误码 916xx ×6
- 事件：ECO_ACTION + 补发 GUILD_JOINED/INTEL_BOUGHT/NEGOTIATION_COMPLETED/ESCROW_RELEASED/BOUNTY_PUBLISHED/BOUNTY_COMPLETED/CREDIT_SETTLED/BARTER_COMPLETED
- 无新 npm 依赖

---

## 迭代 E1 · SSO 直接登录（auth 模块）

### Task E1-1: auth_accounts 加列 + 枚举/错误码
**Files:**
- `src/modules/auth/entities/auth-account.entity.ts`（+ ssoId varchar64 unique nullable / ssoProvider varchar32 nullable）
- `src/constants/enums.ts`（+ AccountType.SSO = 'sso'）
- `src/constants/error-codes.ts`（+ SSO_AUTH_FAILED 91605 / SSO_ACCOUNT_EXISTS 91606）

**测试**：实体编译 + 枚举断言

### Task E1-2: SSO 登录服务
**Files:**
- 改 `src/modules/auth/auth.service.ts`（+ ssoLoginUrl / handleSsoCallback）
- 改 `src/modules/auth/auth.controller.ts`（+ GET sso/login、GET sso/callback）

**逻辑：**
- `buildSsoLoginUrl(redirect?)`：拼接 zhao-sso authorize（app_code=game + redirect_uri=game 回调 + response_type=code），SSO 基础地址走 env `SSO_BASE_URL`
- `handleSsoCallback(code)`：调 zhao-sso exchange-token（app_code+code）→ {ssoId, username}；`auth_accounts` 按 ssoId 查 → 存在签发 token；不存在 → 自动建档（username 冲突加后缀 `_g{seq}`，密码随机 bcrypt 不可登录，accountType=SSO，ssoId 写入）→ playerService 建 players → 签发 token
- exchange-token 客户端封装（内置 fetch，短超时）

**测试**：mock exchange-token 成功建档/token 签发/用户名冲突后缀/ssoId 幂等复用/换码失败抛 91605

---

## 迭代 E2 · 生态事件接收（eco 模块）

### Task E2-1: eco-events 服务 + 控制器
**Files:**
- 新 `src/modules/eco/eco-events.service.ts`
- 新 `src/modules/eco/eco-events.controller.ts`
- 新 `src/modules/eco/eco.module.ts`（AppModule 挂载）
- 新 `src/modules/eco/dto/eco-event.dto.ts`

**逻辑：**
- `verifySignature(body, ts, sign)`：HMAC-SHA256(ECO_SHARED_SECRET, body+`|`+ts) 恒定时间比较；|ts-now|>300s 拒绝（ECO_SIGN_INVALID 91601）
- Redis 防重放 `eco:evt:{hash}` SET NX EX 300（ECO_REPLAY 91602）
- action 白名单校验（ECO_UNKNOWN_ACTION 91604）；players 按 ssoId 查（无 → 静默 200 返回，不抛错）
- 通过 → eventBus.emit(ECO_ACTION, {playerId, action, scope, targetId})
- 控制器：POST events（public，签名校验自证）；GET admin stats（admin 鉴权，统计接收/拒绝数）

**测试**：签名正确/篡改 body/过期 ts/重放拒绝/未知 action/未绑定 sso 静默/事件分发 payload

---

## 迭代 E3 · 任务扩展（目标类型 + 监听 + 事件补发）

### Task E3-1: SocialTargetType 扩展
**Files:**
- `src/constants/enums.ts`：+ 游戏内 12 值（form_formation/activate_formation/perform_combo/rescue_success/loot_distributed/arbitration_settled/negotiation_done/escrow_released/bounty_published/bounty_completed/credit_repaid/barter_done）+ 生态 10 值（view_article/view_course/view_product/view_price/view_activity/join_activity/like/comment/purchase/distribute）

**测试**：枚举值断言（含既有值不删）

### Task E3-2: 监听器扩展 + 事件补发
**Files:**
- 改 `src/modules/quest/quest-event.listener.ts`：+ ECO_ACTION 监听（action→targetType 映射表）；+ 战斗事件（FORMATION_ACTIVATED/COMBO_TRIGGERED/RESCUE_SUCCESS/LOOT_DISTRIBUTED/ARBITRATION_SETTLED）→ 目标推进；+ GUILD_JOINED→join_guild、INTEL_BOUGHT→intel_buy
- 改 `src/modules/social/social.service.ts`：joinGuild 成功后发 GUILD_JOINED；intelBuy 成功后发 INTEL_BOUGHT
- 改 `src/modules/trade/trade.service.ts`：议价成交发 NEGOTIATION_COMPLETED；担保放款发 ESCROW_RELEASED；悬赏发布/完成发 BOUNTY_PUBLISHED/BOUNTY_COMPLETED；还款结清发 CREDIT_SETTLED；易物成交发 BARTER_COMPLETED
- `src/event-bus/game-events.ts`：+ 上述 8 事件

**测试**：ECO 各 action 映射推进/战斗事件推进/补发事件推进/无匹配任务不报错

### Task E3-3: 生态浏览类任务日上限
**Files:**
- 改 `src/modules/quest/quest.service.ts`：advanceSocialTarget 对生态类 targetType 增加 Redis 日上限（`eco:daily:{playerId}:{targetType}` EX 86400，默认 10 次/日，超限跳过）

**测试**：第 11 次生态推进被跳过/次日重置

---

## 迭代 E4 · 种子任务数据

### Task E4-1: quest_templates SQL 种子
**Files:**
- 新 `packages-game/game-server/scripts/seed-social-tasks.sql`（幂等 INSERT，name 唯一去重；12 条：生态 8 + 游戏内 4，reward_social/目标数按设计 §6）
- 新 `packages-game/game-server/scripts/seed-social-tasks.sh`（docker exec psql 执行，含存在性检查）

**测试**：脚本幂等（重复执行不重复插入）

---

## 迭代 E5 · 业务插件钩子（Strapi / 商品站）

### Task E5-1: zhao-website 钩子（文章站）
**Files:**
- `e:\code\basic\plugins\zhao-website\server\src\services\*`：visit-log 写入处 + view_article；interaction 写入处 + like/comment；invite-trace 写入处 + distribute
- 新 `e:\code\basic\plugins\zhao-website\server\src\services\eco-hook.ts`：签名 POST 封装（fetch，2s 超时，失败静默；GAME_URL/密钥走 config/env）

### Task E5-2: zhao-course 钩子（课程站）
- course 详情/lesson-progress 写入处 + view_course；course-enrollment 创建处 + purchase

### Task E5-3: zhao-point 钩子（活动）
- activity 详情访问处 + view_activity；activity-signup 创建处 + join_activity；activity-referral-reward 创建处 + distribute

### Task E5-4: 商品站钩子（youshop）
- 确认 www.youshop.cn 实现栈（Vendure 系）→ 对应插件：商品详情/价格查看 + view_product/view_price；订单创建 + purchase；分销结算 + distribute

**测试**：各钩子单测（mock fetch 断言 payload/失败静默/超时）

---

## 迭代 E6 · 收尾

### Task E6-1: 全量回归 + tsc
1. `npx jest --no-coverage` 全 PASS
2. `npx tsc --noEmit -p tsconfig.json` exit 0

### Task E6-2: 冒烟脚本 smoke-eco.sh
覆盖：SSO 登录建档 → 模拟签名回调 10 类行为 → 对应任务进度推进（含日上限命中）→ 游戏内合击/援护/担保放款推进任务 → join_guild/intel_buy 推进 → 种子任务可接取

### Task E6-3: 部署
- game-server：备份 pg_dump → 本地 build → tar dist → scp odoo → 保留旧 dist → restart → journalctl 验证 → 冒烟
- Strapi 业务插件：zhao-website/zhao-course/zhao-point 改后 **必须 `npm run build` 重建 dist 并提交**（铁律），deploy.sh 部署 joho → 验证新接口
- 环境变量：odoo .env.prod + ECO_SHARED_SECRET；joho Strapi 插件 config + GAME_URL

### Task E6-4: 手册发布
- `manual-src/main-part.html` 新增「第 16 章 · 生态联动（游戏 × 业务站点）」+ 第 7 章任务体系补充小节
- `node merge.js` → `node check.js` → deploy-manual.ps1 发布 → 公网验证

---

## 风险与护栏
| 风险 | 护栏 |
|---|---|
| SSO 回调伪造 | 授权码一次性 + 回调白名单 + app_code=game 独立注册 |
| 生态接口刷量 | HMAC + 时间戳 + Redis 防重放 + 浏览类日上限 10 次/日 |
| 业务钩子拖垮主流程 | fire-and-forget + 2s 超时 + 静默失败 |
| Strapi dist 未重建 | E5 完成后 grep dist 含 eco-hook 关键字自检（铁律） |
| 商品站技术栈未定 | E5-4 前置确认，若为 Vendure 按插件模式实现 |
| 1G/2G 内存 | 本地构建；服务器仅装 omit=dev；不新增 npm 依赖 |
