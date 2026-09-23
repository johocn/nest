# S9 Task 7：后端广播硬指标门禁报告

> 范围：只做「指标固化 + 可回归门禁」。**不改 `game-server/src/**`、不改 WS 契约、不改广播行为**（计划 §0/§1.4 D5）。
> 数据产出仍由 `scripts/loadtest-s8.mjs` 负责，本报告使用的判定脚本是 `scripts/loadtest-gate.mjs`（零新增依赖，只用 `node:` 内置模块）。

---

## 1. 门禁口径

`scripts/loadtest-gate.mjs` 断言的 5 个指标，取自计划 §1.2「硬指标表」中归属 A7 的行：

| 指标 | 阈值 | 度量方式 | 数据来源字段 |
|---|---|---|---|
| P95 延迟 | ≤ 200 ms | 同机近似单向延迟（发送方记录 emit 时刻，任一 bot 收到该广播时算差值，含事件循环排队） | `latencyP95` |
| 下行投递 | ≤ 25,000 条/秒 | **按秒折算**全场景投递总量 | `downMsgs / durationSec` |
| 上行 | ≤ 10 次/秒/人 | bot 实际发出的 `world.move` 频率 | `upPerSecPerBot` |
| 服务端内存增量 | ≤ 50 MB | 测量窗口前后 RSS 差（Windows `WorkingSet64` 折算） | `serverRssDeltaMb` |
| 掉线 | ≤ 0 | 未自愈的 WS 断开次数总和 | `disconnects` |

补充判定（同属门禁，不单列阈值）：

- `latencyP95` 为 `null`（无延迟样本）→ 判 **FAIL**（无法度量不得算通过）。
- `serverRssDeltaMb` 为 `null`（未采到服务端 PID）→ 判 **FAIL**，结论里标注「无法度量」。
- `connectErrors > 0` → 判 **FAIL**，并在结论里说明。

阈值全部可用 CLI 覆盖（默认值为上表）：`--p95` / `--down-per-sec` / `--up-per-sec-per-bot` / `--rss-delta` / `--disconnects`。

---

## 2. 用法

cwd = `packages-game/game-server`。

```powershell
# A. 判定已有结果数据（默认读 scripts/loadtest-s8-result.json）
node scripts/loadtest-gate.mjs --in scripts/loadtest-s8-result.json --bots 50

# B. 现场压测 + 判定（透传参数给 loadtest-s8.mjs，子进程非 0 → gate 也 exit 1）
node scripts/loadtest-gate.mjs --run --bots 50 --seconds 25 --hz 10
```

选 run 规则：`--label <label>` 或 `--bots <n>` 二选一（同时给 → exit 2）；都不给 → 取 `bots` 最大的 run，并列取最后一条。

常用可选项：`--out <path>`（仅 `--run` 时透传给压测脚本）、`--write-json <path>`（把门禁结论写成 JSON）、`--quiet`（省略识别信息与表格，只输出超限项与结论行）、`--allow-remote`（原样透传，本脚本不额外放开远端保护）。

退出码语义：

| 退出码 | 含义 |
|---|---|
| 0 | 5 项全部达标，且 `connectErrors = 0` |
| 1 | 任一指标超限 / 无法度量 / `connectErrors > 0` / `--run` 子进程失败 |
| 2 | 用法或输入错误（`--label` 与 `--bots` 同时给、结果文件不存在、JSON 解析失败、选不到 run、阈值参数非法） |

---

## 3. 上线前对照（S8 实测，本机 50 bot）

数据源：`scripts/loadtest-s8-result.json` 的 `50bots` run（`generatedAt=2026-09-23T09:17:28.607Z`，`durationSec=25`）。

| 指标 | 硬指标 | 实测 | 判定 | 余量 |
|---|---|---|---|---|
| P95 延迟 | ≤ 200 ms | 97.04 ms | PASS | 2.06× |
| 下行投递 | ≤ 25,000 条/秒 | 23,332 条/秒 | PASS | 1.07× |
| 上行 | ≤ 10 次/秒/人 | 9.32 次/秒/人 | PASS | 1.07× |
| 服务端 RSS 增量 | ≤ 50 MB | 10.71 MB | PASS | 4.67× |
| 掉线 | 0 | 0 | PASS | 达标（实测 0） |

**结论：PASS（exit 0）。** 上行与下行余量最薄（均 1.07×），是本批之后最需要盯的两项。

---

## 4. 上线后对照（PENDING / 挂账）

| 指标 | 硬指标 | 生产实测 | 判定 | 余量 |
|---|---|---|---|---|
| P95 延迟 | ≤ 200 ms | PENDING | PENDING | — |
| 下行投递 | ≤ 25,000 条/秒 | PENDING | PENDING | — |
| 上行 | ≤ 10 次/秒/人 | PENDING | PENDING | — |
| 服务端 RSS 增量 | ≤ 50 MB | PENDING | PENDING | — |
| 掉线 | 0 | PENDING | PENDING | — |

**挂账原因：Task 2（H5 发布上线）未执行**，当前线上跑的还是 S7 时期产物，生产指标无意义。

上线后补测要求（计划 §1.7 风险 #9：2G 服务器，**只允许 ≤5 bot / ≤10s 冒烟，禁止高压测**）：

```powershell
# 生产冒烟：5 bot / 10s，允许远端（--allow-remote 显式开启，压测脚本会打警告）
node scripts/loadtest-gate.mjs --run --bots 5 --seconds 10 --hz 10 --base https://game.joho.cn --allow-remote --label prod-5bot --write-json scripts/loadtest-prod-smoke.json
```

注意：生产冒烟是**连通性与稳定性**验证，不是并发容量验证（5 bot 的下行量远达不到 25k/s 门限）；容量结论仍以本机 50 bot 为准。

---

## 5. 门禁自检记录

全部命令 cwd = `packages-game/game-server`。

### 5.1 达标路径（exit 0）

```powershell
node scripts/loadtest-gate.mjs --in scripts/loadtest-s8-result.json --bots 50
```

```
[loadtest-gate] 数据文件：E:\code\nest\packages-game\game-server\scripts\loadtest-s8-result.json
[loadtest-gate] 判定 run：label=50bots bots=50 durationSec=25 scene=「新手村（Spike）」 generatedAt=2026-09-23T09:17:28.607Z
  指标            | 实测          | 阈值        | 判定
  P95 延迟        | 97.04 ms      | 200 ms      | PASS
  下行投递        | 23332 条/秒   | 25000 条/秒 | PASS
  上行            | 9.32 次/秒/人 | 10 次/秒/人 | PASS
  服务端 RSS 增量 | 10.71 MB      | 50 MB       | PASS
  掉线            | 0 次          | 0 次        | PASS
[loadtest-gate] 连接错误 connectErrors=0
门禁结论：PASS
EXITCODE=0
```

### 5.2 失败路径：整体（exit 1）

```powershell
node scripts/loadtest-gate.mjs --in scripts/loadtest-s8-result.json --p95 1 --down-per-sec 1 --up-per-sec-per-bot 1 --rss-delta 0.1 --disconnects -1
```

```
  指标            | 实测          | 阈值       | 判定
  P95 延迟        | 97.04 ms      | 1 ms       | FAIL
  下行投递        | 23332 条/秒   | 1 条/秒    | FAIL
  上行            | 9.32 次/秒/人 | 1 次/秒/人 | FAIL
  服务端 RSS 增量 | 10.71 MB      | 0.1 MB     | FAIL
  掉线            | 0 次          | -1 次      | FAIL
[loadtest-gate] 超限项：
  - P95 延迟：97.04 ms vs 阈值 1 ms → 超出 96.04ms（97.04×）
  - 下行投递：23332 条/秒 vs 阈值 1 条/秒 → 超出 23331条/秒（23332.00×）
  - 上行：9.32 次/秒/人 vs 阈值 1 次/秒/人 → 超出 8.32次/秒/人（9.32×）
  - 服务端 RSS 增量：10.71 MB vs 阈值 0.1 MB → 超出 10.61MB（107.10×）
  - 掉线：0 次 vs 阈值 -1 次 → 超出 1次
门禁结论：FAIL
EXITCODE=1
```

### 5.3 逐条独立性（每次只让 1 个阈值不可满足，其余默认）

| # | 命令（附加参数） | 唯一 FAIL 项 | exit code |
|---|---|---|---|
| 1 | `--p95 1` | P95 延迟 | 1 |
| 2 | `--down-per-sec 1` | 下行投递 | 1 |
| 3 | `--up-per-sec-per-bot 1` | 上行 | 1 |
| 4 | `--rss-delta 0.1` | 服务端 RSS 增量 | 1 |
| 5 | `--disconnects -1` | 掉线 | 1 |

5 条命令统一为：

```powershell
node scripts/loadtest-gate.mjs --in scripts/loadtest-s8-result.json --bots 50 <见上表附加参数> --quiet
```

输出（`--quiet` 只打印超限项与结论，因此可直接看出每次只有 1 项失败）：

```
- P95 延迟：97.04 ms vs 阈值 1 ms → 超出 96.04ms（97.04×）
门禁结论：FAIL

- 下行投递：23332 条/秒 vs 阈值 1 条/秒 → 超出 23331条/秒（23332.00×）
门禁结论：FAIL

- 上行：9.32 次/秒/人 vs 阈值 1 次/秒/人 → 超出 8.32次/秒/人（9.32×）
门禁结论：FAIL

- 服务端 RSS 增量：10.71 MB vs 阈值 0.1 MB → 超出 10.61MB（107.10×）
门禁结论：FAIL

- 掉线：0 次 vs 阈值 -1 次 → 超出 1次
门禁结论：FAIL
```

结论：5 个断言彼此独立，任一项超限都能单独把门禁判成 FAIL。

### 5.4 `--run` 布线验证（真实压测，1 bot / 8s，输出隔离到临时文件）

```powershell
node scripts/loadtest-gate.mjs --run --bots 1 --seconds 8 --out scripts/.gate-wiring-tmp.json
```

- **第 1 次（13:02:59）**：布线本身正常，但该次 `Get-NetTCPConnection` 取服务端 PID 偶发失败 → `serverRssDeltaMb = null` → 按既定口径判「无法度量」→ **FAIL / exit 1**（这是预期内的严格行为，不是漏判；无 PID 时 `loadtest-s8.mjs` 会打印 `RSS = nullMB`）。
- **第 2 次（13:04:59）**：PID 正常采到，**PASS / exit 0**：

```
[loadtest-s8] 服务端 PID=11616 CPU=236.484375s RSS=102.03MB
[loadtest-s8] 结果：
  上行 world.move = 74（9.25/s/bot）
  下行 entity_update = 82（10.25/s/bot；player 74 / 其它 8）
  延迟样本 = 74  P50 = 0.96ms  P95 = 2.34ms
  掉线 = 0  连接错误 = 0
  服务端 CPU = 0.59%  RSS = 102.78MB（Δ 0.75MB）
[loadtest-gate] 判定 run：label=1bots bots=1 durationSec=8 scene=「新手村（Spike）」 generatedAt=2026-09-23T13:04:59.354Z
  指标            | 实测          | 阈值        | 判定
  P95 延迟        | 2.34 ms       | 200 ms      | PASS
  下行投递        | 10.25 条/秒   | 25000 条/秒 | PASS
  上行            | 9.25 次/秒/人 | 10 次/秒/人 | PASS
  服务端 RSS 增量 | 0.75 MB       | 50 MB       | PASS
  掉线            | 0 次          | 0 次        | PASS
[loadtest-gate] 连接错误 connectErrors=0
门禁结论：PASS
EXITCODE=0
```

**数据隔离自证**：`scripts/loadtest-s8-result.json` 在验证前后完全一致（`size=4998`、`mtime=2026-09-23T09:17:28.6091483Z`、`SHA256=EDFFEDFF6B6EC374A749791A2709C3BCA3107999FB15EA5CD3DA86D1674CF2A3`）——压测写入全部由 `--out` 指向 `scripts/.gate-wiring-tmp.json`，该临时文件已在验证后删除。

### 5.5 用法错误（exit 2）

```powershell
node scripts/loadtest-gate.mjs --in scripts/loadtest-s8-result.json --bots 50 --label 50bots
# [loadtest-gate] 用法错误：--label 与 --bots 不能同时给出（二选一）
# EXITCODE=2

node scripts/loadtest-gate.mjs --in scripts/no-such-result.json
# [loadtest-gate] 用法错误：结果文件不存在：E:\code\nest\packages-game\game-server\scripts\no-such-result.json
# EXITCODE=2
```

另已验证：`--label 50bots`（按 label 选中）与不带选择参数（按最大 bots 选中 50bots）均判定 PASS / exit 0；`--write-json scripts/.gate-rep-tmp.json` 可正常落盘结论 JSON。

---

## 6. 监控固化（不引入任何监控组件）

### 6.1 生产（odoo 39.106.99.9，应用 `/opt/game-server`，systemd 服务名 `game-server`）

```bash
systemctl status game-server
systemctl show game-server -p MemoryCurrent          # 单位字节（含其它 cgroup 进程，仅作趋势参考）
ps -o rss=,pcpu= -p $(systemctl show -p MainPID --value game-server)
journalctl -u game-server --since "-5 min" -p warning
```

同机其它受 pm2 管理的服务的等价写法：

```bash
pm2 jlist                      # 全量 JSON，过滤名字后看 pm2_env.status / monit.memory / monit.cpu
pm2 describe <name>            # 单进程：restarts / uptime / memory / cpu
```

### 6.2 本机 dev（Windows）

不新增采样组件：`loadtest-s8.mjs` 已内置服务端进程采样，直接看它打印的 `服务端 PID=… CPU=… RSS=…`，以及结果里的 `serverCpu` / `serverRss` / `serverRssDeltaMb`。

Windows 侧等价命令（`<pid>` 由压测输出给出，或 `Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object -First 1 -ExpandProperty OwningProcess`）：

```powershell
Get-Process -Id <pid> | Select-Object CPU,WorkingSet64
```

### 6.3 超标看什么（**按此顺序排查，不要跳步**）

1. **先排除测量噪声**：bot 与服务端同机、同 CPU 竞争，读数偏保守；换一台机器跑 bot 复测再谈结论。
2. **看下行是否随人数平方增长**：每个 bot 每 tick 收 N 条 → 总量 ≈ N² × Hz（50 人 25,000/s 上限，实测 23,332/s）。这是**结构性上限**，不是参数调优问题。
3. **看 RSS 是否单调增长且不回落**：持续爬升不回落才是泄漏嫌疑；配合 Node 堆快照与 `--max-old-space-size` 观察。
4. **看单核 CPU 是否打满**：50 bot 已到 ≈67%（单核），打满才决定是否上 cluster/worker。
5. **最后才谈后端视口裁剪 / 分线**：这**属广播行为变更**，须单独确认（见 §7）。

---

## 7. 触发条件（何时重议广播）

满足任一条件即**重新评估后端视口裁剪 / 分房间分线 / 远端广播降频**，且**必须用户单独确认**后再动手：

- **目标并发 > 50 人**；
- 门禁在**同一参数、同一环境下连续 2 次失败**（单次偶发失败先按 §6.3 顺序排查，不直接改架构）。

外推（按下行 ≈ N² × Hz 的平方关系）：

| 并发 | 下行投递（约） | 对 25,000 条/秒门限 |
|---|---|---|
| 50 人 | 23,332 条/秒（实测） | 1.07× 余量 |
| 100 人 | ≈ 100,000 条/秒 | 4× 超出 |
| 200 人 | ≈ 400,000 条/秒 | 16× 超出 |

**本批不改广播的依据**：S8 实测 50 人 P95 97.04ms < 200ms、掉线 0，达标（计划 §1.4 D5）；且改广播会变更 `world.entity_update` 的可见性语义、影响互见验收口径（计划 §1.4 D5 引 S8 D10）。当前维持 50 人目标并发（计划 §1.8 已知限制 1）。

---

## 8. 不覆盖 / 挂账

1. **生产环境压测未做**：odoo 为 2G 服务器，本批只允许 **≤5 bot / ≤10s 冒烟**，真实容量验证留待 Task 2（H5 发布上线）之后按 §4 命令补测；高压测一律本机。
2. **iOS / 真机性能不属本任务**：归 Task 4（真机机型矩阵 + 面板打点）。
3. **本批不改后端广播行为**：视口裁剪 / 分线 / 降频仅在 §7 触发条件下单独立项。
4. **已知环境噪声**：Windows 下 `loadtest-s8.mjs` 采服务端 PID 依赖 `Get-NetTCPConnection`，偶发取不到（→ RSS 记为 `null` → 门禁判 FAIL）。这是既定严格口径，复跑即可；未改动 `loadtest-s8.mjs`。