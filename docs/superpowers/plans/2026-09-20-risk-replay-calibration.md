# 2026-09-20 风控阈值回放校准 — Plan 2

> Phase: 风控 v3 第二批 · 用真实历史流水量化阈值命中，帮运营把 `risk.*` 配到低误报
> Repo: `E:/code/nest` · game-server in `packages-game/game-server`
> 规则：无新 npm 依赖；严格 TDD；逐任务 commit

## 设计

线上三个拦截阈值是我们按经济规模拍的，缺少「按当前阈值会命中哪些账号」的量化依据。本计划把 v1 检测核心抽成**可注入阈值的纯函数**，新增一个**只读回放引擎**，用 `risk_wash_flows` 历史数据重放三类检测，输出命中曲线与疑似账号清单，供运营定档。**不回写任何业务表**。

1. **检测核心参数化**：把 `risk-wash.service.ts` 里的回环/失衡/价值异动检测抽为纯函数（输入：窗口内 flows + 阈值对象 → 输出信号/分数），现有定时批扫改为「从 remote_configs 读阈值」调用之；回放引擎传「override 阈值」调用之。保证同一逻辑两条路径复用，杜绝两套实现漂移。
2. **只读回放引擎** `RiskReplayService`：从 `risk_wash_flows` 取 `[since, until]` 时段数据，按给定阈值 object（`configOverrides` 逐键覆盖默认）跑检测与评分，返回 `{ iterated, hitAccounts:[{playerId, score, level, signals[]}], hitCount, scoreBuckets }`。`scoreBuckets` 为各分数档位命中量 → 运营可见「阈值放在 70 会命多少人」。
3. **GM 只读接口**：`POST /api/admin/v1/risk/replay`（body: since/until/configOverrides）→ 只读计算结果，**不落库、不触发处置**。
4. 数据安全：回放限于已摄入的 `risk_wash_flows`（不回溯原始交易，防碰撞/越权）。

约束：
- `configOverrides` 只接受 `risk.*` 键 + 数值合法校验（非法即 92901）。
- 复用的检测纯函数须保持与线上批扫**完全一致**的行为（阈值来源不同、判定口径相同）。
- 接口走 `RiskAdminController`，AdminGuard + audit 只读操作留 gm-log。

## 任务（TDD，逐任务 commit）

### T1 抽取检测纯函数并保持线上一致
将回环/失衡/异动判定抽到 `src/modules/risk/risk-detect.ts`（导出 `detectWindow(flows, thresholds) → { signals, agg }`、`scoreAccount(signals, thresholds)`），`risk-wash.service.ts` 改为调用它（阈值读 remote_configs）。先补 `risk-detect.spec.ts` 构造三样本断言信号与分数，跑 FAIL→PASS；再跑既有 risk-wash spec 全 PASS（证明线上行为未变）。
提交 `feat(risk): plan2 T1 检测纯函数抽取且线上行为一致`

### T2 回放引擎 + 失败用例
新增 `src/modules/risk/risk-replay.service.ts` 与 `risk-replay.service.spec.ts`。先写用例：构造历史 flows，传 override 阈值断言命中账号/scoreBuckets/只读（无 repo save 调用）。FAIL 后实现；`risk-replay.service` 依赖 `washRepo`（只读 find）+ `RiskDetectService`。tsc + spec PASS 提交。
提交 `feat(risk): plan2 T2 只读回放引擎`

### T3 controller 接口 + 用例
`dto/risk-admin.dto.ts` 补 `RiskReplayDto`（since/until 必填 Date，configOverrides 可选 Record<string,number>，校验仅 risk.* 键）；`risk-admin.controller.ts` 加 `POST replay`；`risk-admin.controller.spec.ts` 补用例（合法 override、非法键 92901、AuditAdmin 留 gm-log）。tsc + 全 risk spec 全 PASS 提交。
提交 `feat(risk): plan2 T3 /replay 只读接口`

### T4 冒烟 + 手册 + 回归 + 推送
- `smoke-stage5b.sh` 追加第 14 段：replay 空窗口返回 hitAccounts=[]、非法 override 92901。
- 手册 `api-part.html` risk 组补 `POST /replay`（接口数 +1）；`main-part.html` 16.10 补一句「支持只读回放校准阈值」。
- merge.js MERGED_OK + check.js 全过；game-server 全量 jest 全绿。
- commit + push。
提交 `feat(risk): plan2 T4 冒烟+手册+回归+推送`

## 完成验收
1. 检测为单一纯函数，线上/回放同口径
2. /replay 只读返回命中清单 + 分数分布，非法键拦截
3. 全量 jest 全绿、merge/check 全过、已推送