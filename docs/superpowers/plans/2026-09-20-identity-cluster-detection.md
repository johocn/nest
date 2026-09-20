# 2026-09-20 同人多账号识别（设备 / IP / SSO 关联）— Plan 3

> Phase: 风控 v3 第三批 · 识别一人多号（打金 / 互刷 / 逃封用的多账号集群）并并入风控分
> Repo: `E:/code/nest` · game-server in `packages-game/game-server`
> 规则：无新 npm 依赖；严格 TDD；逐任务 commit；**先探查数据源再写**

## 设计

现有风控按「账号维度」评分，但打金/互刷常一人持多号，需要按「身份维度」聚类识别。方案：从登录/账号数据构造账号邻接图，用强信号（同设备 / 同 IP×窗口 / SSO 同源）赋予「同人多号」概率分，作为一类**身份信号**并入 `risk_account_scores`（同人多号 = 高风险特征，命中即加分，可进高危实时拦截）。

**先探查数据源（必须）**：
- `account_login_logs`（登录日志）列集：是否含 device 指纹 / IP / region / player_id。（grep 实体确认）
- `auth_accounts`：sso_id 是否有 `player_id`（sso 与玩家一对一）。
- 若无设备指纹列，退化为「同 IP × 窗口 + SSO 同源」聚类，如实标注口径降级。

1. **新表** `risk_identity_links`：`player_id_a`、`player_id_b`、`link_type`（`SAME_IP`/`SAME_DEVICE`/`SSO`）、`confidence`（0-1）、`evidence_json`、`created_at`。`uk (player_id_a, player_id_b, link_type)`。
2. **`RiskIdentityService.buildGraph()`**：定时（复用 10min 频道或独立新 job）聚合登录日志（窗口内同 IP、同 device，或 SSO 同源）写邻接（幂等 upsert，活学活用于既有的 uk 幂等模式）。无设备列则只跑 SAME_IP + SSO。
3. **评分并入**：查网格中「活跃账号数 ≥2 的连通分量」（如某 IP/device 下 ≥2 账号），对分量内账号累加身份分（`identity_penalty`，随分量人数封顶），叠加进 `risk_account_scores`。提供 `resolveIdentityScore(playerId)` 供 `updateScores()` 并入。
4. **GM 只读**：`GET /api/admin/v1/risk/identity/player/:playerId` → `{ playerId, links:[{peerId, linkType, confidence}], clusterSize }`。

约束：
- 不改登录日志表的写入侧；只读聚合。
- 邻接无向、去重（a<b 字典序），幂等。
- 身份分并入但不越 `score_cap`(100)；只加分不减分。
- `link_type` 用新增枚举 `RiskLinkType`（enums.ts）。错误码复用既有，不新增。
- 新表/枚举要对齐新增规则：dict/enums 计数累加。

## 任务（TDD，逐任务 commit）

### T1 探查 + 实体/枚举
探查确认 login_logs/auth_accounts 列；加 `RiskLinkType` 枚举（SAME_IP/SAME_DEVICE/SSO）；建 `RiskIdentityLink` 实体（`risk_identity_links`）注册进 risk.module forFeature。`risk-identity.service.spec.ts` 先写空用例跑骨架 FAIL（服务未建）。tsc 0 错误提交。
提交 `feat(risk): plan3 T1 枚举+表+骨架`

### T2 buildGraph（首步失败用例→实现）
spec：mock 登录日志 repo，断言同 IP/同 device 会写邻接、SSO 同源、幂等去重（重复跑不增行）。FAIL 后实现 `buildGraph()`。tsc + spec PASS 提交。
提交 `feat(risk): plan3 T2 身份邻接图构建`

### T3 identity 评分并入
`resolveIdentityScore(playerId)`：查含 playerId 的连通分量，≤2 账号给基础分、≥3 给更高并封顶分量惩罚；`updateScores()` 并入（不越 score_cap）。spec 断言并入与封顶。tsc + spec PASS 提交。
提交 `feat(risk): plan3 T3 身份分并入评分`

### T4 GM 只读接口
`GET identity/player/:playerId`（AdminGuard）返回关联图谱；controller spec 补用例。tsc + 全 risk spec PASS 提交。
提交 `feat(risk): plan3 T4 身份图谱只读接口`

### T5 冒烟 + 手册 + 回归 + 推送
- 冒烟第 15 段：两个测试号同 IP 登录后查 identity graph 命中互为 peer。
- 手册：字典补 `risk_identity_links` 表（表数 +1）；枚举补 `RiskLinkType`（枚举数 +1）；api risk 组补 `GET identity/player/:playerId`（接口数 +1）；16.10 补「身份聚类信号」一句。
- merge/check 全过；game-server 全量 jest 全绿；push。
提交 `feat(risk): plan3 T5 冒烟+手册+回归+推送`

## 完成验收
1. 身份邻接图幂等可建，同人多号能识别
2. 身份分并入评分且不越 cap
3. GM 只读图谱接口可用；全量 jest 全绿、文档已同步、推送 origin/main