# 2026-09-20 交易结算对账审计 — Plan 5

> Phase: 风控 v3 第五批 · 日终对账「成交/拍卖/托管/悬赏」结算与资产流水一致性，防重复放款 / 凭空资产
> Repo: `E:/code/nest` · game-server in `packages-game/game-server`
> 规则：无新 npm 依赖；严格 TDD；逐任务 commit；**先探查结算落点与流水结构**

## 设计

经济系统里「业务结算记录」与「资产流水」分属两张表，若某处少写/重复放款，会导致玩家资产凭空增减。本计划做**日终对账**：对每笔已结算业务核对「应有的一笔资产流水」存在、方向/金额一致、refId 不重复；异常落到审计表并暴露给 GM。

**先探查（必须）**：
- 结算落点：`trade_orders`/`auction_items`(status=sold)/`escrow_agreements(released_at)`/`bounties(acceptor_id)` — 确认状态字段与金额列（v1 摄入已用，可参考）。
- 资产流水：economy 流水表 refId 生成规则（结算写入时用的 refId 前缀），用于「按业务 id 反查预期流水是否存在」。
- 若流水与业务之间**没有稳定 refId 关联**，以「业务侧结算记录是流水的唯一/权威来源」为前提，按业务 id 在流水里找 `ref_id LIKE 'biz%'` 反查；无稳定反查则断言业务结算量与流水供给方一致，如实标注口径。

**新增**：
- 表 `reconcile_results`：`stat_date`、`reconcile_type`（`TRADE`/`AUCTION`/`ESCROW`/`BOUNTY`）、`checked`、`mismatch`、`detail_json`（异常清单，每条含业务 id + 差异类型 `MISSING_FLOW`/`AMOUNT_MISMATCH`/`DUPLICATE_REF`）、`created_at`。`uk (stat_date, reconcile_type)`。
- `ReconcileService.reconcileDaily()`：对四类结算做对账，写 `reconcile_results`（当日已存在则覆盖）。
- 每日 `@Cron`（复用既有 scheduler 频道）+ GM 手动触发。
- 接口：`GET /api/admin/v1/reconcile/results`（列表）+ `POST /api/admin/v1/reconcile/run`（手动跑，AuditAdmin 留 gm-log）。

约束：
- 对账**只标记异常，不自动动账**（回滚/补发属人工决策，防误操作）。
- 金额比较用 numeric；时间窗用 SQL `now()`。
- 错误码复用既有；若新增 `RECONCILE_*` 段则用空闲 945xx — **先检查 945xx 是否空闲再定**。
- 新表/枚举对齐手册累计。

## 任务（TDD，逐任务 commit）

### T1 探查 + 实体 + 失败用例
探查结算落点/流水 refId 规则；建 `ReconcileResult` 实体 + `reconcile_results` 表、`ReconcileType` 枚举；`reconcile.service.spec.ts` 先写用例（mock 各结算 repo 与流水 repo，断言 TRADE 差额被检出类型），FAIL。注册进相应 module。tsc 0 错误提交。
提交 `feat(recon): plan5 T1 表/枚举/失败用例`

### T2 reconcileDaily 各结算对账
实现四类对账（每类一个私有方法，共享 `#assertFlow` 匹配逻辑），写 `reconcile_results`（按日+类型幂等 upsert）。spec 覆盖 MISSING_FLOW / AMOUNT_MISMATCH / DUPLICATE_REF 三类 + 幂等覆盖。tsc + spec PASS 提交。
提交 `feat(recon): plan5 T2 日终对账核心`

### T3 调度 + 手动接口 + 用例
全新 `@Cron` 每日跑（若 scheduler 频道需单独 job 则新建），+ admin 接口 `GET results` / `POST run`，controller spec 用例。tsc + 全 spec PASS 提交。
提交 `feat(recon): plan5 T3 调度与GM接口`

### T4 冒烟 + 手册 + 回归 + 推送
- 冒烟第 17 段：POST run 断言 results 非空；GET results 200。
- 手册：字典补 `reconcile_results` 表（表数 +1）+ `ReconcileType`（枚举数 +1）；api 补 2 接口（接口数 +2）；开发手册补「交易结算对账」一句。
- merge/check 全过；game-server 全量 jest 全绿；push。
提交 `feat(recon): plan5 T4 冒烟+手册+回归+推送`

## 完成验收
1. 四类结算日终对账可跑，三类差异可检出，当日幂等
2. 每日自动 + GM 手动触发
3. 全量 jest 全绿、文档同步、推送 origin/main