# 互刷/洗分检测风控 v2 · 完善与细节补充

> 阶段：设计文档（Spec）
> 日期：2026-09-20
> 承接：v1（摄入 completed 成交 + 回环/失衡/价值异动 + 账号评分 + 白名单 + GM 处置 + 10min 定时 + 4 表）

## 一、目标与边界

v1 只归一化 `trade_order.completed` 成交，检测是批量事后型，命中只记 case 不自动处置、评分不接入业务。v2 在 v1 之上补齐三块，形成「**扩源 → 全类检测 → 评分接入 → 半自动处置**」闭环：

1. **扩摄入源**：纳入 gift、拍卖结算、escrow 放款、bounty 奖励，按「直接转移 / 到账」两类归一化。
2. **评分终态接入**：账号风险分实时拦截业务（阻断大额拍卖上架、限制礼物/转账额度）。
3. **处置联动（半自动）**：命中高等级时由 GM 一键回收涉案超额，留痕可回滚。

**不做**（本期明确排除）：真实资金支付、自动不限量回收、改动 v1 已有表结构（除新增列）、引入任何新 npm 依赖、登上 2G 机执行构建。

## 二、核心设计

### 2.1 数据模型增量

| 变更 | 说明 |
|---|---|
| `risk_wash_flows` 新增列 `flow_class` | 枚举 `DIRECT` / `PAYOUT`，区分直接转移与到账 |
| 新增表 `risk_recover_records` | 半自动回收动账留痕：建议差额 / 实际回收额 / 状态 / operator / 可回滚快照 |

### 2.2 摄入源分类

- **`DIRECT`（参与回环/失衡检测）**
  - gift：`sender → receiver`，资产 social_points
  - 现有 completed 成交（v1 已实现）
- **`PAYOUT`（仅喂价值异动 / 数量级观察）**
  - 拍卖结算（买家出价 → 卖家得款）
  - escrow 放款
  - bounty 奖励

> 依据：回环/失衡检测的本质是「A↔B 直接互倒」。单向往账（商城/拍卖/悬赏）不构成对倒，若纳入会放大误报，故只做观察。

### 2.3 评分终态接入（RiskGateService）

`RiskGateService.evaluate(playerId, action, amount) -> allowed/blocked`

- 高危（账号分 ≥ `risk.block_level`，默认 70）：
  - 阻断**拍卖上架**（超过 `risk.auction_value_cap` 起拍价时）
  - **礼物**单笔及日累计超 `risk.gift_daily_cap`
  - **转账**日累计超 `risk.transfer_daily_cap`
- 关注（40~70）：额度按档下调（额度 × 系数，可配）
- 白名单玩家豁免

接入点：`trade.listAuction`、`gift.send`（及相应转账入口），在**写库前**同步校验，命中抛 `GAME_xxx` 错误码（93201-93299 段），前端可读提示。

### 2.4 处置联动（半自动回收）

- `POST /admin/v1/risk/cases/:id/recover-proposal`：统计涉案差额，返回**建议回收额**
- `POST /admin/v1/risk/cases/:id/recover`：GM 确认后真正动账——回收超额至运营账户，双流水 + audit，落 `risk_recover_records`
- `POST /admin/v1/risk/cases/:id/recover/:rid/rollback`：按保存的 balance 快照回滚，防误扣合法资金

### 2.5 接口增量

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/v1/risk/dashboard` | GM 分级看板：高危 TOP / 分数趋势 / 待处置队列 |
| POST | `/api/admin/v1/risk/cases/:id/recover-proposal` | 算建议回收额 |
| POST | `/api/admin/v1/risk/cases/:id/recover` | 确认回收动账 |
| POST | `/api/admin/v1/risk/cases/:id/recover/:rid/rollback` | 回收回滚 |

C 端拦截复用现有错误码段（新增 93201-93299）。

## 三、配置

通过既有 `remote_configs` 的 `risk.*` 键承载（避免硬编码）：

| 键 | 默认 | 含义 |
|---|---|---|
| `risk.block_level` | 70 | 高危阈值 |
| `risk.auction_value_cap` | 待定 | 高危拍卖上架起拍价上限 |
| `risk.gift_daily_cap` | 待定 | 高危礼物日累计上限 |
| `risk.transfer_daily_cap` | 待定 | 高危转账日累计上限 |
| `risk.mid_factor` | 0.5 | 关注档额度系数 |

## 四、风险点与对策

| 风险 | 对策 |
|---|---|
| 误扣合法资金 | 回收为**半自动**：GM 确认后才动账；写前保存 balance 快照，支持 rollback |
| PAYOUT 源放大误报 | PAYOUT 不参与回环/失衡，仅做价值异动观察 |
| 摄入字段名漂移（gift/auction/escrow/bounty 表） | 实现时按仓库真实实体核对列名，与既有 success 模式一致 |
| 拦截误伤正常玩家 | 拦截只在高危档生效，白名单豁免；配置集中可调 |

## 五、交付

- 全部改动经 TDD（jest 单测 + 冒烟脚本扩展），本地构建产物不入库
- 冒烟：`smoke-stage5b.sh` 追加——gift 摄类断言、评分拦截（拍卖/礼物）、看板、回收与回滚
- 手册同步：数据字典（`risk_recover_records` 表 + `risk_wash_flows.flow_class` 列）、接口索引（risk 组 4 接口 + 错误码）、统计头更新
- 2G 机不登构建：仅本地 `npm run build` + 推送，生产部署走既有流水线