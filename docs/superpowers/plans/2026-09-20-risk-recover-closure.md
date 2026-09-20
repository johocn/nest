# 2026-09-20 风控回收闭环（真实扣款 + 封禁联动）— Plan 1

> Phase: 风控 v3 第一批 · 承接风控 v2 的「只落台账不扣款」遗留负债
> Repo: `E:/code/nest` · game-server in `packages-game/game-server`
> 规则：无新 npm 依赖；严格 TDD；逐任务 commit；全部完成后 reviewer 两阶段审查

## 设计

风控 v2 的 `recover` 只生成 `risk_recover_records` 台账并把线索 open→frozen，**不真正扣除玩家涉案超额**（当时为安全而留白）。本计划把它补成经济闭环，并联动既有封禁能力：

1. **真实扣款**：`recover(caseId, operator, note)` 改为接 `EconomyService`，对收款方（`toId`）按净差额 `net>0` 真实扣除 GOLD，转入运营账户。扣款 + 台账 + 审计在**同一数据库事务**内（`dataSource.transaction`）。台账记录 EconomyService 返回的流水号，回滚可据此精确反推。
2. **可回滚**：`rollback(recoverId, operator)` 按台账里的流水快照真实退回 `toId`，记审计与回滚台账状态。
3. **封禁封锁联动**：新增 `lock(caseId, operator, level)`，把高危线索一键落地为对涉事账号的既有惩罚（复用 admin 惩罚能力，`PenaltyLevel`），并保持线索可追踪。封锁动作同样留 audit。

约束要点：
- **只允许在 `net>0` 时扣款**；`net<=0` 抛 `RISK_INVALID_ACTION`(92902)。
- 扣款金额方向：对倒/失衡的集中收款方 = `toId`（`risk_cases.detailJson` 的 a2b/b2a 净差由 `computeNetGap(fromId,toId)` 得，绝对值即应收超额）。单笔净差绝对值即回收额。
- 真实扣款必须**先确认 EconomyService 接口签名**再接入（grep `EconomyService`，找金币增减方法如 `changeBalance`/`adjustGold`，含事务与流水返回结构）。
- `risk_recover_records` 增 `economy_ref_id`（可选列，记录扣款流水号）以便回滚精确反查；`snapshot` 保留操作前 from/to 余额。
- 封锁复用既有 `Player` block 能力（见 `admin`/`social` 既有惩罚），**不要新造封禁表**；level 取既有枚举。

## 数据/模型增量
- `risk_recover_records` 加一列 `economy_ref_id varchar`（记录扣款流水号）；枚举/错误码复用既有（93203/93204、92901/92902），不新增错误码。
- 新增接口 1 个：`POST /api/admin/v1/risk/cases/:id/lock`。
- `recover` / `rollback` 接口语义改造（仍是 v2 那两个路由）。

## 任务（TDD，逐任务 commit）

### T1 先写失败用例
在 `risk-wash.service.spec.ts` 追加 3 用例并跑 FAIL：
- `recover` net>0 时调用 EconomyService 扣款并落台账（断言 economy 被调、流水 ref 写入 economy_ref_id）
- `rollback` 按 economy_ref_id 真实退回 + 状态 ROLLED_BACK
- `lock` 调用封禁能力并留 audit

跑 `npx jest src/modules/risk/risk-wash.service.spec.ts --no-cache` 确认 FAIL。
提交 `feat(risk): plan1 T1 回收/回滚/封禁 FAIL 用例`

### T2 依赖注入
`RiskWashService` constructor 注入 `EconomyService` 与 `PlayerService`（或封禁所属的服务，**先 grep 确认封禁落点**）；`risk.module.ts` import 所需模块。tsc 0 错误后提交。
提交 `feat(risk): plan1 T2 注入 Economy/封禁依赖`

### T3 真实扣款 recover
重写 `recover()`：校验 net>0 → 事务内 EconomyService 扣款（toId 扣 net → 运营账户）→ 写入 `risk_recover_records`（APPLIED + economy_ref_id + snapshot）→ 线索 open→frozen + handledBy/At → `updateScores()`。返回 `{ recoverId, net, economyRef }`。tsc + spec 全 PASS 后提交。
提交 `feat(risk): plan1 T3 recover 真实扣款`

### T4 可回滚 rollback
重写 `rollback()`：按台账 economy_ref_id 反查扣款流水，事务内退回 toId（运营账户转回），状态置 ROLLED_BACK，留审计。重复回滚抛 93204；找不到抛 93203。tsc + spec 全 PASS 提交。
提交 `feat(risk): plan1 T4 rollback 真实退回`

### T5 封禁封锁联动 lock
`lock(caseId, operator, level, reason?)`：调既有封禁能力对 fromId/toId 落惩罚（level 映射既有 PenaltyLevel），写 audit，线索置 FROZEN 但保留 recover 关联；返回 `{ playerId, level, appliedAt }`。`risk-admin.controller.ts` 新增 `POST cases/:id/lock` + spec 用例。tsc + 全 risk spec 全 PASS 提交。
提交 `feat(risk): plan1 T5 封禁封锁联动`

### T6 冒烟 + 手册 + 回归 + 推送
- `smoke-stage5b.sh` 追加第 13 段：真实回收（构造一个 net>0 的 case 数据，调用 recover 断言 economyRef 非空）、回滚、lock。
- 手册 `main-part.html` 16.10 回收描述改为「真实扣款 + 可回滚 + 封禁联动」；`dict-part.html` 的 risk_recover_records 补 economy_ref_id 列（表字段数 +1）；`api-part.html` risk 组补 lock 接口（接口数 +1）。
- `manual-src` 下 `node merge.js`（期望 MERGED_OK）+ `node check.js`（全过）。
- game-server 全量 `npx jest --no-cache` 全绿（基线 66/836 + 本版新增）。
- git add 相关文件 → commit → `git push origin main`。

提交 `feat(risk): plan1 T6 冒烟+手册+回归+推送`

## 完成验收
1. recover 真实扣款在事务内、economy_ref_id 留痕、可精确回滚
2. lock 复用既有封禁能力、audit 留痕
3. 全量 jest 全绿、merge/check 全过、已推送 origin/main