# 2026-09-20 GM 经济宏观看板 — Plan 4

> Phase: 风控 v3 第四批 · 给 GM 一个只读「经济仪表盘」，量化通胀 / 产出 / 资产分布 / 冻结量
> Repo: `E:/code/nest` · game-server in `packages-game/game-server`
> 规则：无新 npm 依赖；严格 TDD；逐任务 commit；**先探查流水表再写**

## 设计

风控要看「个体异常」，运营还要看「经济总量健康」。本计划做只读的经济宏观聚合，复用既有经济流水，界面上是一个 GM 看板快照。

**先探查数据源（必须）**：
- EconomyService 金币流水表（`economy` 模块）真实表名/列：金额、in/out 方向、balance 字段、ref_id、reason、created_at。（grep 实体确认）
- `risk_recover_records` 已回收额、UpdateScores 冻结线索数等可作为「风控处置量」并入看板（可选，若 gather 太绕则不并，只做经济口径）。

**只读看板聚合**（`EconomyDashboardService`，只查不改）：
- `currencyStats`：金总量（余额求和）/ 最近 7 日金产出（in）与消耗（out）→ 净通胀/净通缩。
- `assetDistribution`：账号余额 P50 / P90 / max / 活跃账号数（默认去 0 余额，避免冷数据噪音）。
- `frozenAmount`：被 BAN / TRADE_LIMIT 惩罚账号的持仓冻结量（复用既有 Player block 标记，join 余额）。
- `recoveryToDate`：风控已回收总额（`risk_recover_records` 累计 appliedAmount，APPLIED 状态）。
- 全为只读 `createQueryBuilder` 聚合，不落临时表，不写业务数据。

**接口**：`GET /api/admin/v1/economy/dashboard` → `{ currencyStats, assetDistribution, frozenAmount, recoveryToDate }`。

约束：
- 纯只读；不新增告警/不触发动作。
- 统计口径：金以 `gold` 资产键（确认 EconomyService 资产键枚举）为准；金额用 numeric 求和避免 float 误差。
- 时间窗用 SQL 端 `now()`（沿用 3-A 时区修复经验，避免本地/库时区偏移）。

## 任务（TDD，逐任务 commit）

### T1 探查 + 只读聚合服务失败用例
探查 economy 流水表与资产键；build `economy-dashboard.service.spec.ts` 先写聚合用例（mock 各 repo 的 query builder 返回聚合行，断言统计结构），跑 FAIL（服务未建）。提交。
提交 `feat(eco): plan4 T1 看板聚合失败用例`

### T2 实现只读聚合
新建 `src/modules/economy/economy-dashboard.service.ts`（注：放 economy 模块而非 risk），实现四块聚合（SQL now() 时间窗）；`economy.module.ts` 注册 provider/export。tsc + spec PASS 提交。
提交 `feat(eco): plan4 T2 只读看板聚合`

### T3 controller 接口 + 用例
`economy` 模块新增 `EconomyAdminController`（`api/admin/v1/economy/dashboard`，AdminGuard）+ spec 用例。tsc + 全 economy spec PASS 提交。
提交 `feat(eco): plan4 T3 看板接口`

### T4 冒烟 + 手册 + 回归 + 推送
- 冒烟第 16 段：调 dashboard 断言结构非空、currencyStats 有 gold。
- 手册 `api-part.html` economy/admin 组补 `GET /dashboard`（接口数 +1）；开发手册补 13.x 或 16.10 附近一句「GM 经济宏观看板」。
- merge/check 全过；game-server 全量 jest 全绿；push。
提交 `feat(eco): plan4 T4 冒烟+手册+回归+推送`

## 完成验收
1. 只读聚合正确反映通胀/资产分布/冻结量/回收额
2. /economy/dashboard 接口可用、AdminGuard 保护
3. 全量 jest 全绿、文档同步、推送 origin/main