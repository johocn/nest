# LayaAir 2D 客户端 · S9 上线硬化批（真机性能 / 图集 / 生产证书 / 正式提审）实施计划

> **状态：执行中，范围收敛为 H5-only（2026-09-24）。** 微信小游戏侧**缺 AppID**，Task 6（正式提审）**阻塞**，Task 5 的产物链**代码已交付**，真实 `release/wxgame` 导出的复核随小游戏上线解阻后再补。本文件只做规划与记录，不动代码、不动生产。
> **H5 侧进度快照（2026-09-24）**：Task 1（证书）/ Task 2（S8 上线）/ Task 5（包体门禁）/ Task 7（广播门禁）**已完成**；Task 3 Step 2–3（素材入库 + 贴图接线）**已完成并上线**（落地方式偏离 D8，见 Task 3 Step 2 记录），Step 4–5（图集）**已决策不做**（2026-09-24 确认，见 Task 3 Step 4/5 记录），Step 6（线上点检）**未做**；Task 4（真机验收，唯一需设备的硬缺口）**未做**；Task 8（验收与文档结清）Step 1–4 **已完成**（见 §7，提交 `76c2e8e7f`）。
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（沿用 S2–S8 的既定方式：每 Task 派新 subagent，Task 间两阶段评审）。

**Goal:** 把「能在开发者工具与本机跑通」的客户端变成**可正式上线**的游戏端：修掉生产证书链、把 S8 性能成果发布上线、接入已定稿美术并做图集、在**真机低端机型**上验收帧率与内存、建立包体与后端广播的**硬指标门禁**，最终通过**微信小游戏正式提审**并上线 H5。

**Architecture:** 三条线——**上线线**（证书 → H5 发布 → 小游戏提审）、**表现线**（美术入库 → 图集 → 真机验收）、**门禁线**（包体检查 + 广播压测阈值断言）。S9 **不改后端广播行为、不改 WS 契约**：50 人并发已实测达标（S8 §3），后端只做「指标固化 + 可回归门禁」。

---

## 0. 执行前必读（硬约束）

1. **不准碰 vendure**；2G 服务器（odoo, 39.106.99.9）**禁止构建**：一律本地构建 → 上传产物 → 服务器零构建重载。
2. **不新增依赖**（含客户端与小游戏端）：图集使用 LayaAir IDE 自带工具，不引入打包器/图片库。
3. **不改 WS 契约、不改后端广播**：`world.move` / `world.entity_update` 字段零改动；`server.to('scene:<id>').emit` 保持（S8 已判定无收益不动，触发条件见 §1.4 D5）。
4. **H5 与开发者工具的表现不得回退**：每个 Task 后跑 S1 冒烟 + S8 性能断言（门禁）。
5. **证书与站点改动必须可回滚**：改 odoo 的 OpenResty 证书/conf 前先备份，失败即刻还原。
6. **提审相关内容合规由业务侧提供**（隐私政策、用户协议、类目资质），执行方只出「材料清单 + 技术项」。
7. 全部提交遵守 commitlint，单次提交聚焦一个任务。
8. **先修证书、再提审**：微信对 `wss`/`request` 域名证书严格，链不合法直接拦截。

---

## 1. 设计

### 1.1 缺口盘点（已核实）

| # | 缺口 | 现状（已核实，2026-09-23） | S9 处置 |
|---|---|---|---|
| 1 | **生产证书不被信任（提审硬阻塞）** | `https://game.joho.cn` 当前为**自建 CA** 签发：subject `CN=game.joho.cn, O=JOHO Enterprise`，issuer `CN=JOHO Enterprise Root CA`，链深 2；Node/浏览器报 `SELF_SIGNED_CERT_IN_CHAIN`；有效期至 2036-09-18 | Task 1：换**公共 CA** 证书（S7 原计划「补中间证书」的前提不成立 —— 根就不是公共 CA） |
| 2 | **S8 成果未上线** | H5 站点 `/client/index.html` 已可访问（200）但内容是 S7 时期的产物；S8 的 `perf/`、`EntityPool`、`Viewport`、`RemoteInterp` 未发布（S8 报告 §8 挂账） | Task 2：发布 S8 产物 + 线上冒烟 |
| 3 | **美术未接入** | `assets/resources/` 只有 `placeholder.png`；客户端全部实体由 `graphics` 绘制 | Task 3：素材入库 + 图集（**2026-09-24 已入库并接入上线**；图集本期已决策不做，见 Task 3 Step 4/5） |
| 4 | **无图集能力验证** | 从未导出过图集；`release/web/resources/` 仅 IDE 默认产物 | Task 3：图集导出 + 加载策略 + 数值对比（**已决策不做**：图集按可选优化处理，§4-3） |
| 5 | **真机数据为零** | S8 只证明「30fps 等价性」（纯函数），无真机 fps/内存/启动耗时 | Task 4：真机矩阵实测 + 自动降级验证 |
| 6 | **包体检查脚本缺失** | `tools/check-package.mjs` **不存在**（S7 Task 6 未落地）；`release/wxgame/` **不存在** | Task 5：落地包体门禁 |
| 7 | **小游戏产物链未闭环** | GUI 导出（不可自动化）+ `config/` 补齐 + env 注入 + 包体检查 未串成一条命令 | Task 5/6：产物链 + 提审 |
| 8 | **后端广播无门禁** | `loadtest-s8.mjs` 只输出 JSON 报告，**无阈值断言**；无监控面板 | Task 7：阈值门禁 + 指标固化 |
| 9 | **下行量随人数平方增长** | 50 人 ≈ 23,332 投递/秒（S8 §3.3）；当前无监控手段 | Task 7：记录 + 监控（不改广播） |

### 1.2 硬指标（本批的判定口径）

沿用总纲 §12，并在此**固化为可断言的门禁值**：

| 指标 | 硬指标 | 度量方式 | 归属 |
|---|---|---|---|
| 证书链 | 公共 CA 签发、`openssl s_client` 无 `unable to verify` | `openssl` / 浏览器 / 微信开发者工具域名校验 | A1 |
| H5 帧率 | ≥55fps（目标 60） | S8 面板 / `perf-sample.mjs` | A2 |
| **真机帧率（低端安卓）** | ≥30fps 稳定（含自动降级生效后） | 真机面板（S8 `PerfPanel`） | A4 |
| 真机内存 | ≤300MB，场景切换后回落 | 真机面板 / 微信开发者工具内存面板 | A4 |
| 启动耗时 | 冷启动 ≤5s（体验版实测，取值待 Task 4 基线后校准） | 真机秒表 + 面板打点 | A4 |
| 主包 / 总包 | 主包 ≤4MB、总包 ≤20MB | `tools/check-package.mjs` | A5 |
| 上行 | ≤10 次/秒/人，静止不发 | `loadtest` bot 计数 | A7 |
| **50 人 P95 延迟** | ≤200ms（S8 实测 97.04ms，留 2× 余量） | `loadtest` 阈值断言 | A7 |
| **50 人下行投递** | ≤25,000 条/秒（S8 实测 23,332） | `loadtest` 阈值断言 | A7 |
| 服务端内存增量 | 25s 压测内 RSS Δ ≤50MB（S8 实测 +10.71MB） | `loadtest` | A7 |
| 掉线 | 0 | `loadtest` | A7 |

### 1.3 已知事实（实现时不要再猜）

**生产环境（实测 2026-09-23）**
- `/health` → 200、`/client/index.html` → 200（2082B）、`/client/gamedata/manifest.json` → 200（240B）、`/` → 302。
- TLS：`game.joho.cn` ← `JOHO Enterprise Root CA`（自建 CA，非公共信任链）。
- 部署形态：odoo（39.106.99.9）、应用 `/opt/game-server`、systemd `game-server`、OpenResty 站点目录 `/opt/1panel/apps/openresty/openresty/www/sites/game.joho.cn/`、DB 容器 `1Panel-postgresql-4LsS`。

**客户端构建/发布（已核实）**
- `tools/publish.mjs` 三个子命令：`h5`（gamedata → `release/web`）、`wxgame-config`、`h5-site`（整站装配 → `release/client`，默认 `--base /client/`），**只做本地文件操作**（源码断言不含 ssh/scp/curl/npm run build）。
- `tools/inject-env.mjs --env prod` 生成 env 覆盖；`tools/build-fallback.mjs` 借用后端 tsc 编译 `src/` → `bin/js/`。
- `release/` 现有 `web/`（IDE 构建）与 `client/`（h5-site 装配）；**无 `wxgame/`**。
- GUI 导出不可自动化（S1 实证：CLI 需交互式账号登录）。

**性能现状（S8 结论）**
- 本机：H5 移动段 60fps、drawcall 峰值 38、heap 峰值 22.5MB、上行 9.4/s。
- 150 实体探针：合图 `cacheAs='bitmap'` 使 fps 38.5→53.8；`marginPx=0` 使 drawcall 338→176.3、fps 39→46.2。
- 自动降级：`degradeRatio=0.8` / `sustainMs=3000`，H5 未触发（小游戏端未验证）。
- 后端：50 bot P95 97.04ms、0 掉线、RSS +10.71MB、单核 ≈67%。

**测试基线（S8 收尾实测）**
- 后端 `npm test`：91 suites / 1176 tests 全绿。
- 客户端冒烟：S1 9/9、S3 16/16、S4 18/18、S5 27/27、S6 50/50、S8 146/146、S7 平台层 102/102。

### 1.4 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **证书必须换成公共 CA**（而非继续补自建链） | 自建 CA 只在「本机装了根证书」的客户端被信任；微信端与真实用户都不信任。S7 的前置判断（「缺中间证书」）已被实测推翻 |
| D2 | **提审排在最后**（Task 6），前面四件都是它的前置 | 提审用体验版走真实域名与真实包体；证书/包体/真机性能任一不达标都会被驳回或线上崩 |
| D3 | **图集「先量后做」**：先接入原始素材（分层/摆件），量出 drawcall 与包体基线，再做图集合并 | 没有素材基线就无法判断图集收益（沿用 S8 D1 的度量优先原则） |
| D4 | **真机验收用「机型矩阵 + 面板打点」**，不引入第三方监控 SDK | 不新增依赖；面板已在 S8 落地，直接复用 |
| D5 | **后端广播本批不改**：只在目标并发 >50 人时重新评估 | S8 实测 P95 97ms < 200ms；改广播会变更语义、影响互见验收口径（S8 D10）。触发条件写进 §1.2 门禁，超限即重议 |
| D6 | **广播门禁脚本独立于报告脚本**：`loadtest-s8.mjs`（产数据）→ `loadtest-gate.mjs`（断阈值 + exit 1） | 保留 S8 的可复现数据产出；门禁需要「能失败」的退出码 |
| D7 | **包体检查落地在 S9**（S7 未做完），且**只做检查不自动上传** | 微信上传仍需 GUI/CLI 账号，脚本越界会带来「以为自动化了」的错觉 |
| D8 | **素材入库遵守既有目录契约**：`assets/resources/**` + `.meta` 由 IDE 生成 | 绕过 IDE 手工塞文件会导致 `.meta` 缺失 → 发布产物丢资源（S7 已遇到 `.meta` 缺失问题） |
| D9 | **S10 不做**：GM 拖拽摆点编辑器与玩法运营另开一批 | 与上线硬化无依赖交叉，混批会拖慢提审 |

### 1.5 文件结构

**修改/新增（客户端 `packages-game/game-client/`）**

| 路径 | 动作 |
|---|---|
| `assets/resources/**` | **素材入库**（分层图/摆件/图标，含 IDE 生成的 `.meta`） |
| `assets/resources/atlas/**` | **新增**：图集产物目录（IDE 图集导出） |
| `src/world/SceneBuilder.ts` | 静态层改用素材/图集贴图（保留 `graphics` 兜底：无素材时行为与 S8 一致） |
| `src/entity/Entity.ts` | 实体贴图来源改为图集/素材；`reset()` 同步扩展 |
| `tools/check-package.mjs` | **新增**：包体 + 关键文件 + 引擎脚本顺序检查（S7 Task 6 未落地项） |
| `tools/atlas-manifest.mjs` | **新增**：图集清单与素材命名校验（零依赖） |
| `scripts/smoke-s9-atlas.mjs` | **新增**：图集/素材加载纯逻辑断言 |
| `README.md` | 更新 S1 #8 → PASS、双端发布手册、真机机型矩阵记录 |

**新增（后端 `packages-game/game-server/scripts/`，不改 `src/`）**

| 路径 | 动作 |
|---|---|
| `scripts/loadtest-gate.mjs` | **新增**：调用压测并断言 §1.2 硬指标，超限 exit 1 |
| `scripts/loadtest-s9-report.md` | **新增**：上线前与上线后的指标对照 + 门禁结论 |

### 1.6 验收映射

| # | 验收项 | 判定方式 |
|---|---|---|
| A1 | 证书链合法 | `openssl s_client -showcerts -connect game.joho.cn:443` 链完整、issuer 为公共 CA；浏览器无告警；微信开发者工具域名校验通过 |
| A2 | S8 成果上线 | 线上 `/client/` 产物含 S8 模块；线上 `PerfPanel` 可开（F3）；线上跑一次 `perf-sample.mjs` 达标 |
| A3 | 美术接入 | 素材全部入库且 `.meta` 完整；drawcall/包体有前后数值（允许变差，但必须记录并说明）。**图集不列入验收**（§4 待确认 3 已确认本期不做） |
| A4 | 真机性能 | 低端安卓 ≥30fps 稳定 / 内存 ≤300MB / 冷启动 ≤5s；自动降级在低端机触发可复现 |
| A5 | 包体门禁 | `check-package.mjs` 通过：主包 ≤4MB、总包 ≤20MB、`config/manifest.json` hash 匹配、引擎三脚本顺序正确 |
| A6 | 正式提审 | 体验版内部验收通过 → 提交审核 → 审核通过上线（含类目/隐私/协议材料齐全） |
| A7 | 广播硬指标 | `loadtest-gate.mjs` exit 0（P95 ≤200ms、投递 ≤25k/s、0 掉线、RSS Δ ≤50MB） |
| A8 | 零契约变更 + 回归 | `world.move`/`world.entity_update` 字段零改动；后端 `npm test` ≥1176 全绿；6 个客户端冒烟脚本全 PASS |
| A9 | 服务器零构建 | 部署全程服务器无 `npm run build`（发布脚本源码断言 + 人工核对） |
| A10 | 文档结清 | `README.md` 的 S1 #8 由 BLOCKED 改 PASS；双端发布步骤、真机矩阵、包体上限写入文档 |

### 1.7 测试基线

- **门禁（每 Task 后必跑）**：`smoke-laya2d-s1.mjs` 9/9 + `smoke-s8-perf.mjs` 146/146 + `npm test` 全绿。
- **新增断言**：`smoke-s9-atlas.mjs`（素材命名/清单/回退路径的纯逻辑断言，零依赖）。
- **真机**：人工（机型矩阵 + 面板截图/录屏），无自动化框架（不引入依赖）。
- **压测**：本机 1/10/50 bot；**生产只做 ≤5 bot / ≤10s 冒烟**（2G 服务器）。
- **提审**：体验版二维码 + 审核记录归档。

### 1.8 已知限制（S9 明确不覆盖）

1. **不做后端视口裁剪/分线**（目标并发维持 50 人）。
2. 不做 GM 拖拽摆点编辑器、不做玩法内容扩充（→ S10）。
3. 不做 `wx.login` 静默登录（沿用 S7 D4）。
4. 不做微信支付/分享/排行榜（运营批次）。
5. 不做 iOS 全机型覆盖（矩阵为「1 低端安卓 + 1 中端安卓 + 1 iOS」起步）。
6. 不做法务文案撰写（只用业务侧提供的隐私政策/协议）。

---

## 2. Tasks

> 客户端 cwd = `e:\code\nest\packages-game\game-client`；后端 cwd = `e:\code\nest\packages-game\game-server`。

### Task 1: 生产证书链修复（公共 CA）—— 硬前置

- [x] **Step 1** 现状留证：`openssl s_client -showcerts -connect game.joho.cn:443 -servername game.joho.cn`，记录当前自建链（`JOHO Enterprise Root CA`）。→ 已核实（2026-09-23 只读侦察，未动生产）：链 subject `C=CN, O=JOHO Enterprise, OU=IT, CN=game.joho.cn` / issuer `…, CN=JOHO Enterprise Root CA`（自建，链深 2）；`notBefore=2026-09-21 00:30:04Z`、`notAfter=2036-09-18 00:30:04Z`；证书目录内另有自建 CA 的 `joho-ca.crt/.key/.srl`（2026-09-21 08:30）。
- [x] **Step 2** 备份：odoo 上备份 OpenResty 该站点 conf 与现有证书文件（`.crt/.key`）到带时间戳目录。→ `/opt/1panel/game-site-backup/20260923_224154/`（conf + `ssl/` 8 个文件含自建 `joho-ca.*`）；换证后又补一份 `post-cert-20260924_041833/`（**原因见下「conf 漂移」**）。
- [x] **Step 3** 申请/上传**公共 CA** 证书（阿里云免费证书或 Let's Encrypt，按 §4 待确认 1 选定），替换证书文件 + nginx 证书指令（**不改反代规则**）。→ 1Panel 面板（ACME 账号 `admin@joho.cn`，LE 生产）签发 `game.joho.cn`，HTTP-01 验证通过，证书 `id=1`；落地方式=面板「推送目录 `/opt/1panel/cert-stage/game.joho.cn/` + 申请后执行脚本」，`cp` 成站点原有文件名 `game.joho.cn.fullchain.crt`/`.key` + `chmod 600` + `docker exec 1Panel-openresty-cFrx openresty -s reload`。**站点 conf 证书相关行零改动**。
- [x] **Step 4** 重载 OpenResty → 验证：`openssl s_client` 无 `unable to verify`；浏览器无告警；`https://game.joho.cn/health` 200。→ `openssl s_client -verify_return_error` → **`Verify return code: 0 (ok)`**，issuer `C=US, O=Let's Encrypt, CN=YE2`（链 4 张：leaf ← YE2 ← Root YE ← ISRG Root X2 ← ISRG Root X1）；证书/私钥公钥 MD5 一致；`https /health` 200、`https /client/index.html` 200、`http /health` 200；本机（系统 CA、不带 `-k`）`curl` → 200 且 `ssl_verify_result=0`，Node `https.get` → `authorized=true`、`issuer=Let's Encrypt`。HSTS 已开（`max-age=31536000; includeSubDomains`）。
- [x] **Step 5** `wss` 验证：H5 生产页用 `wss://game.joho.cn/game` 跑通「进场景 + 互见」。→ 握手层已验证：`GET /socket.io/?EIO=4&transport=websocket` 经反代 over TLS 返回 **`101 Switching Protocols`**（应用侧直连同样 101）。**「进场景 + 互见」的完整闭环仍留待 Task 2 Step 4 线上冒烟**（当前 `/client/` 仍是 S7 期产物，S8 构建未上线）。
- [x] **Step 6** 记录证书到期日与续期方式（写进 README 运维节，避免再次「不知何时过期」）。→ `game-client/README.md` 新增「生产运维（game.joho.cn）」节：**到期 2026-12-22**、面板自动续期 + 续期脚本内容、路径陷阱、备份位置、三条验证命令。
- [x] **Step 7** commit（文档/脚本）：`docs(game-ops): 生产证书链改用公共 CA`

> **Task 1 执行预案（Step 1 已核实；凭据到位后一次执行，全部路径已用只读命令验证）**
>
> - **部署形态（关键）**：OpenResty 跑在 Docker 容器 `1Panel-openresty-cFrx`（`1panel/openresty:1.21.4.3-3-3-focal`）；**容器的 `/www` ← 宿主 `/opt/1panel/apps/openresty/openresty/www`**（已用 ssl 目录内 6 个文件的 size/mtime 逐一对齐证实），站点 conf 在宿主 `/opt/1panel/apps/openresty/openresty/conf/conf.d/`。
> - **⚠️ 陷阱**：宿主另有 `/www/sites/game.joho.cn/`（只有 `log/`、`tour/`，**没有 `ssl/`**）——这是更早原生 nginx 时期的遗留目录，**容器不读它**。改这个路径 = 静默无效（改了内容也不生效，且不会报错）。
> - **现网证书文件**（宿主，容器内为 `/www/sites/game.joho.cn/ssl/`）：`game.joho.cn.fullchain.crt` / `.crt` / `.key` / `.csr` / `.ext` + `joho-ca.*`；conf 第 4/5 行 `ssl_certificate(_key)` 即指向这两个文件。
> - **ACME 可行性**：80 端口站点 conf 已含 `location ^~ /.well-known/acme-challenge { root /usr/share/nginx/html; }`，该目录在容器内存在（2026-03-24）→ **HTTP-01 验证路径可行，不需要域名 DNS API 权限**（风险 #2 降级）。
> - **备份**：`ts=$(date +%s); bk=/opt/1panel/apps/openresty/openresty/backup-cert-$ts; mkdir -p $bk; cp /opt/1panel/apps/openresty/openresty/conf/conf.d/game.joho.cn-ssl.conf $bk/; cp -a /opt/1panel/apps/openresty/openresty/www/sites/game.joho.cn/ssl $bk/ssl`
> - **申请**：~~1Panel 面板（v1.10.34-lts）→ 证书 → Let's Encrypt（HTTP-01）→ 应用到 `game.joho.cn`；面板会自行重写该站点 conf 的 `ssl_certificate` 指令并落新证书文件~~ → **实测修正**：`game.joho.cn` **不是面板管理的站点**（`website_domains` 无此域名），**没有「应用到站点」可点**，面板**不会**改写 conf；实际走「申请证书 + 推送目录 + 申请后执行脚本」自己落地（见 Step 3 记录）。
> - **重载 / 回滚**：重载 `docker exec 1Panel-openresty-cFrx openresty -s reload`；回滚 = 还原备份的 conf + `ssl/` 目录后重新 reload（备份里 `joho-ca.*` 一并保留，可整目录还原）。
> - **验证**：`openssl s_client -showcerts -connect game.joho.cn:443 -servername game.joho.cn </dev/null` 无 `unable to verify` 且 issuer 非 `JOHO Enterprise`；`curl -I https://game.joho.cn/health` → 200；H5 页 `wss://game.joho.cn/game` 进场景 + 双窗互见。
> - **续期**：面板 ACME 自动续期（保持开启），到期日与续期入口写进 `game-client/README.md` 运维节（Step 6）。
>
> **⚠️ conf 漂移（执行中发现，影响回滚）**：本次执行窗口内，`game.joho.cn-ssl.conf` 被**与本任务无关的改动**改过 —— 新增 `/jianghu/`（武侠文字冒险 Vue SPA 子目录部署）location 块、并调整 `/manual/` 位置（旁证：同目录 `game.joho.cn.conf.bak_jianghu`，mtime 00:04；conf 1494B → 1716B）。**结论：Step 2 的 22:41 备份是 `/jianghu/` 之前的版本，直接回滚会连带撤销 `/jianghu/` 部署**；故已补备份 `post-cert-20260924_041833/`（含当前 conf）。**今后回滚一律用 `post-cert-*` 那份**，或先重新备份再回滚。证书相关两行（`ssl_certificate` / `ssl_certificate_key`）全程未被改动。

### Task 2: S8 成果发布上线（含线上冒烟）

- [x] **Step 1** 本地构建：`node tools/build-fallback.mjs` → `node tools/inject-env.mjs --env prod` → `node tools/publish.mjs h5-site`（**计划缺陷修正**：原文写成 `publish.mjs h5-site --env prod`，但 `publish.mjs` 只认 `--target/--source/--base`，`--env` 会 exit 1）。→ 已跑通：`release/client` 71 文件 / 2.23MB，index.html 前缀改写与 env-config 顺序自校验通过，gamedata sha256 校验通过；S8 十个模块在 `release/client/js` 全在（新增「预演」口径：本机另装 `release/client-preview`（dev 端点、`--base /client/`）实跑点检，high 档移动段 fps 60/最低 59.9、drawcall 峰 38、heap 峰 18.7MB、上行 9.7/s、静止 0；`?quality=low` 生效，drawcall 峰 20；样本追加进 `docs/perf-sample.md` 的 `s9-preview` / `s9-preview-low`）。
- [x] **Step 1 偏差记录**（后续步骤沿用，勿再踩）：① `inject-env.mjs` 的 `--env` 必填，单独传 `--api-base/--ws-url` 会 exit 1，须写 `--env prod --api-base … --ws-url …`（显式值覆盖预设）；② `publish.mjs h5-site --base /` **必然失败**（`BARE_PATH_RESIDUE` 自校验与 base=`/` 语义冲突，见 `tools/publish.mjs:64`），本机预览只能用 `--base /client/` 并按 `/client/` 路径访问；③ 后端 `CORS_ORIGINS` 只含 `3000/5173/127.0.0.1:3000`，预览点检需复用 `perf-sample.mjs --proxy-port`（页面 origin 保持 `localhost:5173`，服务另监听端口）。
- [x] **Step 2** 上传 `release/client/` 与 `gamedata/` 到 odoo 站点目录（**服务器零构建**）。→ 已上传并替换 `.../openresty/www/sites/game.joho.cn/client/`（该目录由容器 `location ^~ /client/` alias 提供服务）：本机 `tar.gz` 604KB → `scp` → 服务器 `sha256` 一致 → 解包 **71 文件**（旧产物 61 文件）→ `chmod 644/755`。上传前备份 `client.bak_s7_20260924_042423`（61 文件 / 2349432B，与旧产物逐文件一致，回滚用）。`/gamedata` 语义已确认：客户端 `configBase='/gamedata'`（同源绝对路径），站点 conf 无该 location → 落 `location /` 反代 `:3000`，由**后端实时提供**（`release/client/gamedata/` 快照只服务小游戏端读包内 `config/`，H5 不消费）。
- [x] **Step 3** 验证：`/client/index.html` 200；页面可进场景；`F3` 面板出现；`?quality=low` 切档生效。→ `/client/index.html` 200 且 md5 `533b098c0b116ff136ae6d04836aeb95` 与本机一致；关键 URL（`/client/js/entity/EntityPool.js`、`/client/js/perf/{PerfPanel,Quality}.js`、`/client/js/world/Viewport.js`、`/client/js/entity/components/RemoteInterp.js`、`/gamedata/manifest.json`、`/health`）全 200；线上进场景 `[S1] 进场景应答 … 服务端 spawns=13 triggers=2`；F3 **真实按键** 关→开→关（`__PERF__.panel()` 连调两次取第二次返回值才是「读」，不传参是切换）；`?quality=low` → `finalQuality=low`、drawcall 峰 34→15。
- [x] **Step 4** 线上冒烟：浏览器双窗口互见移动（插值连续无跳变）+ `curl https://game.joho.cn/health`。→ 双窗（spike01 / spike02）线上同场景：B 端稳定看到 A 位移 556px、`miss=0`、远端实体挂 `RemoteInterp`；**插值连续**逐帧位移 maxΔ=**6px**（中位 4px），关插值基线对照 maxΔ=**28px**（证明插值确在起作用，非 no-op）；`/health` 200（本机 `curl.exe` 受沙箱线程限制无法 DNS，用 `--resolve game.joho.cn:443:39.106.99.9` 后 `ssl_verify_result=0`）。临时冒烟脚本落在 `%TEMP%`，**不入库**。
- [x] **Step 5** 线上指标：跑一次 `perf-sample.mjs`（prod 地址），记录 fps/drawcall/上行 → 写入 S9 报告。→ 线上跑三次写入 `docs/perf-sample.md`：`prod-s9`（headless，54.2fps —— 软件渲染口径，仅留证）、`prod-s9-gpu`（非 headless，**60fps**/最低 59.9、drawcall 峰 34、heap 峰 17MB、上行 9.4/s、静止 0，与本地 preview 口径一致）、`prod-s9-low`（60fps、drawcall 峰 15）。后端生产冒烟（5 bot/10s）写入 `loadtest-s9-report.md` §4：P95 33.08ms、上行 9.2/s/人、掉线 0、进场景 5/5，门禁 exit 1 仅因远端 RSS 无法度量（已记录两处脚本缺陷）。
- [x] **复现复核（补测，2026-09-24）**：按 Step 1 的三步命令（`build-fallback` → `inject-env --env prod` → `publish.mjs h5-site`）全部重跑一遍并逐文件比对 → 重建后仍是 71 文件；与重建前快照比对 **70/71 文件 sha256 完全一致**，唯一差异是 `index.html` 的缓存戳 `?v=`（重建 `mueu1br1` vs 线上 `mue6f1cn`），来源为 `tools/build-fallback.mjs:34` 的 `const BUILD_ID = Date.now().toString(36)` —— **按设计每次构建必变**，被引用的 7 个资源内容逐字节相同，故属预期行为而非缺陷。**结论：H5 发布链语义可复现**，线上 `release/client` 可用 README 记录的流程重现（字节级差异仅缓存戳）。
- [x] **Step 6** commit：`chore(game-client): 发布 S8 性能成果到 H5 生产`（`e4454c907`）

### Task 3: 美术素材入库 + 图集（先量后做）

- [x] **Step 1** 素材交接清单（D8）：分层图 / 摆件 / 图标 的尺寸、透明通道、命名、`@2x` 约定、放置目录 `assets/resources/**`；清单写入 README 或素材文档。→ 已落地 `game-client/docs/art-handover.md`（README 目录约定加 1 行链接）；尺寸逐项附代码出处，3 处待主程确认（建筑贴图尺寸口径 / 玩家朝向与动态 NPC 命名 / 图集页命名与 `@2x` 自动识别），待确认项**不阻塞** Step 2 入库。
- [x] **Step 2** 素材入库：放入 `assets/resources/**`，由 IDE 生成 `.meta`（**不得手工塞文件**）；`smoke-s9-atlas.mjs` 断言命名与清单一致。→ **已完成，但落地方式偏离 D8（用户 2026-09-24 已批准）**：没有美术真稿来源，改由 **`tools/gen-art.ps1` 程序化生成** 12 张 PNG（11 实体 + 1 背景）并**同时写出同格式 `.meta`**（140B / UTF-8 无 BOM / 无尾随换行 / v4 uuid），视同 IDE 导入产物。零新依赖（仅 Windows 自带 `System.Drawing`）。**AI 文生图通道实测不可用**（`text_to_image` 无鉴权返回 `default.jpeg` 占位图），故背景也一并程序化。原计划的「分层图」未做——背景是**单张整图** `bg_scene1.png`，非分层。交付明细见 `game-client/docs/art-handover.md` §8。**挂账**：`scripts/smoke-s9-atlas.mjs` **未落地**（命名/清单断言缺失）。
- [ ] **Step 3** **接入原始素材并量基线**：静态层与实体改贴图（无素材时回退 `graphics`），记录 drawcall / heap / 包体。→ **接线已完成并已上线，基线数值未量（未达本 Step 验收）**。接线范围：`SceneBuilder` 背景走 `bgResKey(cfg)` 命中贴图 / 未命中回退底色；实体走 `TextureRegistry`（`resKey` → `resources/<resKey>.png`，404 归一 null → 回退 `placeholder.png`）；建筑绘制尺寸改为 `footprint × 64`（进度条/耐久锚点随高度上移）；**玩家**原 `resKey: ''` 永不生效，改走新常量 `EntityFactory.PLAYER_RES_KEY`；**建筑** resKey 由蓝图 `BuildingTemplate.resKey` 经 `build-logic.toBuildingSpawn` 透传（**未改 WS 契约**）。**缺基线**：进图前后的 drawcall / heap / 包体三项数值未记录。
- [ ] **Step 4** 图集导出（IDE 自带工具）→ `assets/resources/atlas/**`；`atlas-manifest.mjs` 校验清单与产物一致。→ **【本期不做】**（用户 2026-09-24 决策，与 §4 待确认 3 默认口径一致）：`assets/resources/atlas/` 与 `tools/atlas-manifest.mjs` 均不存在，未落地。理由见 Step 5。
- [ ] **Step 5** 对比：图集前后 drawcall / 包体 / 加载耗时（**允许某项变差，但必须记录并给出结论**）。→ **【本期不做，随 Step 4 一并放弃】** 决策依据：① 收益侧——H5 线上实测 **60fps、drawcall 峰值 34**（S8 / Task 2 口径），**无性能压力**，自动降级在 H5 从未触发；② 包体侧——12 张实体素材合计仅约 21KB，包体主体是背景 **480.3KB 单张整图**（打不进图集），合图仅省几十 KB 文件头，**收益近零**；③ 成本侧——需把 `TextureRegistry` 由「按 URL 逐张加载」改为「加载 `.atlas` + `@img0.png` 按帧名取纹理」，属真实代码改动 + 6 冒烟回归 + 重新构建部署，且计划风险 #4 记有像素错位/模糊风险。**能力澄清**：Step 4 原假设「IDE 工具导出、不可自动化」**不成立**——`library/` 下现成产物表明 `.atlas` 是**纯 JSON 帧表 + PNG**，程序化生成本可行（同 `gen-art.ps1` 的零依赖套路），故本次属**主动取舍而非能力受限**。**后续触发条件**：Task 4 真机（低端安卓）若 <30fps，图集为首选优化项（风险 #6 处置顺序：降级开关项 → 图集 → `degradeRatio` 调参）。
- [ ] **Step 6** H5 与开发者工具双端点检（表现不回退），跑 S1 冒烟 + S8 断言。→ **未做完整点检**：`tsc --noEmit` 通过、6 个冒烟（S3/S4/S5/S6/S8/S7）全绿、`publish.mjs h5-site` 装配 96 文件（assets 28 文件）已跑；**线上真机/浏览器点检未做**（本机沙箱 DNS 不通，无法解析 `game.joho.cn`），已用「拼版预览图 + 看图自评」替代，并据此修掉 3 个绘制缺陷（缺参 / 两点多边形 / PowerShell 变量名大小写覆盖导致背景只铺局部）。线上校验改用服务器侧 `curl -sI`：`/client/index.html`、`/assets/resources/**` 共 15 个 URL 全 200。
- [x] **Step 7** commit：`feat(game-client): 美术素材入库与图集接入` → 实际提交 `b5d8c19f0`（`feat(game-client): 美术素材入库与贴图接线（S9 Task 3）`，33 files / +844 −44）；另附 `73924cc6a`（`chore(git): .meta 文件禁用换行转换（-text）`）。**部署**：本地 `tar.gz` → `scp` → 服务器先 `cp -a` 备份（`client.bak_art_<时间戳>`）再解压到 `.../game.joho.cn/client/`，**服务器零构建**。**注**：本次提交不含图集（Step 4/5 未做），Step 6 亦未完整达成。

### Task 4: 真机性能验收（低端机型）

- [ ] **Step 1** 定义机型矩阵（§4 待确认 5）与测量项：冷启动耗时、稳态 fps、内存峰值、场景切换回落。
- [ ] **Step 2** 真机跑 H5（手机浏览器）与微信开发者工具/真机调试：记录面板数据 + 截图/录屏。
- [ ] **Step 3** **自动降级验证**：在低端机上确认连续 3s 低于目标 80% → 降 `quality=low`（并记录降级后 fps）。
- [ ] **Step 4** 若 <30fps：先查 `Quality` 开关项（名标签/网格线/触发区描边）与图集是否生效，再考虑降级阈值调参（**禁止无数据调参**）。
- [ ] **Step 5** 达标判定：A4 三项（帧率/内存/启动）。
- [ ] **Step 6** 记录矩阵表 + 结论，commit：`test(game-client): 真机机型矩阵与性能验收记录`

### Task 5: 包体门禁与产物链

- [x] **Step 1** `tools/check-package.mjs`：检查（a）主包 ≤4MB、（b）总包 ≤20MB、（c）`config/manifest.json` 与场景文件存在且 hash 匹配、（d）入口引擎脚本顺序 `laya.core.js → laya.webgl_2D.js → laya.ui2.js`、（e）`js/player-config.js` 在 init 前加载、（f）产物新鲜度（对比 `src/` 最近提交时间）。→ 已落地（零依赖，只用 `node:` 内置模块；退出码 0/1/2；`--target/--entry/--src/--main-max-mb/--total-max-mb/--no-freshness`）。自检用 `release/client` 装配的 TEMP fixture（72 文件 / 2.23MB）：通过路径 **6/6 PASS, exit 0**；6 条失败路径各自独立命中——主包超限、总包超限、场景文件 hash 篡改、缺 `config/manifest.json`、交换 `laya.core.js`/`laya.ui2.js` 使顺序倒挂、把 `player-config` 的 `<script>` 移到 `Main.js` 之后（后两者 `FAIL` 单点 + exit 1）；`--entry nope.js` / `--target nope` / `--main-max-mb abc` → exit 2。**注**：入口候选表（`index.html`/`game.js`…、`js/boot/Main.js`…）为布局假设，Step 2 拿到 IDE 真实 `release/wxgame` 导出后需复核；主包口径 = 总包 − `game.json` 的 `subpackages[].root`。**Step 2 已修正两处口径**：(e) 由「`js/player-config.js` 在业务入口前」泛化为「配置注入时机」——H5 仍按独立文件位置判，小游戏改判入口 `require` 的脚本内 `Laya.PlayerConfig` 是否早于 `Laya.init`（IDE 的 `common/index.js` 把两者内联在同一文件，真实产物无 `js/player-config.js`）；(f) 新鲜度只统计**每次导出都会重写的构建产物**，排除 `config/ assets/ libs/ vendor/` —— Windows 的 `CopyFileW` 保留源 mtime，把它们计入会让 (f) 恒 FAIL（实测踩到）。修正后 H5 布局（`release/client` 71 文件）与小游戏布局（fixture）双双 6/6 PASS。**另修正 (d) 误判**：核对 IDE 的 `resources/app.asar` 构建代码后确认——`_insertEnginePluginRequire` 与 `addHashToFileName` 表明 IDE「版本管理」开关（`enableVersion`，默认 `false`）会把 hash 插在扩展名前（`laya.core.js` → `laya.core-a1b2c.js`），原 `text.indexOf('laya.core.js')` 会未命中而误 FAIL；改用 `findScript()`（主干 + 可选 `-<hash>` + 扩展名）后实测：无 hash 顺序正常 PASS、带 hash 顺序正常 PASS（修正前误 FAIL）、带 hash 顺序倒挂 FAIL、缺 `laya.ui2.js` FAIL（报「入口未引用」），exit 码均正确。**(e) 复核结论（修正上一版误判）**：`addHashToFileName` 是**重命名磁盘文件**，开版本管理后 `game.js` 引用什么磁盘就叫什么，故 (e) 小游戏分支的**字面量路径解析本来就命中**——上一版据「引用带 hash 而磁盘不带」的合成 fixture 判定 (e) 有同类缺陷**不成立**，已撤掉多余的 `resolveMaybeHashed` 兜底。真正需要 hash 容忍的只有**纯文本子串匹配**的两处：(d) 与小游戏布局判定用的 `text.indexOf(PLAYER_CONFIG)`；后者即 (e) 的 H5 分支，已同步改走 `findScript`（开版本管理时引用名带 `-<hash>`，纯 indexOf 会落空后误判为小游戏布局 → 再找不到 `require` → FAIL）。实测 H5 hash-on（引用与磁盘同步改名）PASS、hash-on 下 PlayerConfig 倒挂仍 FAIL 单点。(e) 小游戏分支实测：无 hash 基线 PASS、真实 hash-on（磁盘同步改名）PASS、hash-on 下倒挂 FAIL 单点。注：本仓 H5 走 `bin/` 的 `?v=` query 版本化，H5 这处属预防性对齐，当前并不触发。
- [x] **Step 2** 接入 `publish.mjs wxgame`：GUI 导出后补齐 `config/` + 注入 prod env + 自动跑 `check-package.mjs`。→ 已落地子命令 `wxgame`（三件事串行，任一失败 exit 1）：复用 `publishConfigBundle` 补 `config/`；`spawnSync` 调 `inject-env.mjs --env prod --out <target>` 生成 `env-config.js` 并在 `game.js` 的 `require("weapp-adapter.js")` 之后插入 `require("env-config.js")`（幂等，重跑不重复插入）；`spawnSync` 调 `check-package.mjs`（`stdio: inherit`）。产物结构依据 IDE 安装目录模板 `resources/template/release/wxgame/game.js` + `release/common/index.js`（已直读源码核实）。**自检**（仿真实结构 fixture，10 文件 / 1.24MB）：全通过 6/6 exit 0；幂等两跑清单 + 逐文件 sha256 完全一致；`--target` 无 `game.js` → exit 1 并给出 IDE 导出提示；`PlayerConfig` 移到 `Laya.init` 之后 → 单点 `FAIL 配置注入时机` exit 1。**复核状态**：入口固定 `game.js`、引擎脚本落在 `libs/`、`common/index.js` 内联 PlayerConfig 三项均取自 IDE 安装目录模板 + `resources/app.asar` 源码直读（**非真实产物**）；**无微信 AppID 暂不导出** `release/wxgame`，真实产物复核随小游戏上线（Task 6 解阻）再补。
- [x] **Step 3** 记录 GUI 手工步骤（IDE → 构建/发布 → 微信小游戏 → 产物目录），写入 README。→ README 新增「发布（双端，本地装配 → 上传由部署环节做）」节（H5 / 小游戏两行命令表 + GUI 三步 + 收尾命令的三件事说明）。
- [x] **Step 4** 连续两次发布产物清单与 hash 一致（幂等）。→ 见 Step 2 自检：两次 `publish.mjs wxgame` 后 10 个文件的相对路径 / 字节数 / sha256 逐项一致；`game.js` 内 `require("env-config.js")` 只出现 1 次。
- [x] **Step 5** commit：`feat(game-client): 包体检查与 wxgame 产物链`（含 `tools/check-package.mjs`、`tools/publish.mjs`、`README.md`、本文件）

### Task 6: 微信小游戏正式提审上线

> **⚠️ 阻塞（2026-09-24）：无微信小游戏 AppID，无法上传/提审。** Step 1 的业务项材料（AppID、类目资质、隐私政策、用户协议、内容合规说明）由业务侧提供；AppID 到位前本 Task 全部 Step 不启动，S9 记为 **H5-only** 交付。

- [ ] **Step 1** 材料清单（技术项自查 + 业务项待提供）：AppID、备案域名白名单（含 `wss`）、类目资质、隐私政策、用户协议、内容合规说明。→ **技术项自查可先做**（域名白名单 = `game.joho.cn`，证书链已由 Task 1 修复）；AppID 与合规材料**待业务侧提供**。
- [ ] **Step 2** 产物上传体验版：`check-package` 通过 → 上传 → 生成体验版二维码。
- [ ] **Step 3** 体验版内部验收：登录 → 进场景 → 移动互见 → 交互/对话 → 建造（覆盖 S3–S6 主链路）+ A4 真机项。
- [ ] **Step 4** 提交审核 → 跟踪审核意见 → 修复重提（记录每次驳回原因）。
- [ ] **Step 5** 审核通过 → 上线 → 上线后冒烟（H5 + 小游戏各一次）。
- [ ] **Step 6** commit：`docs(game-client): 微信小游戏提审与上线记录`

### Task 7: 后端广播硬指标门禁（不改广播）

- [x] **Step 1** `scripts/loadtest-gate.mjs`：复用 `loadtest-s8.mjs` 运行 50 bot，断言 §1.2 的 5 个阈值（P95 ≤200ms、投递 ≤25k/s、上行 ≤10/s/人、RSS Δ ≤50MB、掉线 0），任一超限 exit 1。→ 已落地（零依赖，`--in` 判历史数据 / `--run` 现场压测；退出码 0/1/2）。
- [x] **Step 2** 用 S8 的历史数据（`loadtest-s8-result.json`）验证门禁脚本能正确判定（含一次「故意把阈值调到不可能满足」的失败路径验证）。→ 50bot 历史数据 PASS/exit 0；5 条阈值各自单独调到不可能满足均 exit 1（断言彼此独立）；`--run` 布线用 1 bot/8s 实测 PASS（输出隔离到临时文件，S8 数据文件 SHA256 未变）。
- [x] **Step 3** 监控固化：记录 pm2/systemd 的 RSS/CPU 观测命令与「超标看什么」的排查顺序（不引入监控组件）。→ 报告 §6。
- [x] **Step 4** 明确触发条件：**目标并发 >50 人** 或门禁连续失败 → 重新评估后端视口裁剪/分线（需单独确认，属广播行为变更）。→ 报告 §7（含 N² 外推表：100 人 ≈100k/s、200 人 ≈400k/s）。
- [x] **Step 5** `scripts/loadtest-s9-report.md`：上线前/后指标对照 + 门禁结论。→ 上线后一列 **PENDING**（Task 2 未执行，挂账）。
- [x] **Step 6** commit：`test(game-perf): 广播硬指标门禁与上线报告`

### Task 8: S9 验收与文档结清

- [x] **Step 1** 全量回归：`npm test`（≥1176）、`smoke-laya2d-s1` 9/9、S3/S4/S5/S6/S8/S7 六个客户端冒烟全 PASS。→ 实测（2026-09-24）：`npm test` **91 suites / 1176 tests 全绿**（exit 0，150.1s）；`smoke-laya2d-s1` **9/9 PASS**（末行「S1 冒烟全部通过」，exit 0）；客户端冒烟 S3 **16/16**、S4 **18/18**、S5 **27/27**、S6 **50/50**、S8 **146/146**、S7 平台层 **102/102**，全部 exit 0；`build-fallback` **41 产物重写** exit 0。
- [x] **Step 2** `README.md`：S1 #8 → PASS（**H5-only**：附线上 `/client/` 证据；小游戏体验版证据随 Task 6 解阻再补）+ 双端发布手册 + 真机矩阵 + 证书续期说明。→ 已完成（**偏离**：S1 #8 **未**整体改 PASS —— 按事实拆为「**H5 PASS**（线上 `/client/index.html` 200、`/assets/resources/**` 15 URL 全 200）/ **小游戏 BLOCKED**（缺 AppID）」；双端发布手册与证书续期说明核对**已在位、无需补**；新增「真机性能矩阵（S9 Task 4）」占位节，**不预填任何 fps/内存/启动数值**）。
- [x] **Step 3** 把 A1–A10 的实测值填进本文件的执行记录节（沿用 S5–S8 的写法规格）。→ 见本文件 **§7 执行记录（S9）**：§7.1 门禁实测 + §7.2 A1–A10 实测 + §7.3 挂账。
- [x] **Step 4** commit：`docs(game-client): S9 上线硬化验收记录` → 实际提交 `76c2e8e7f`（README.md + 本文件，2 files / +69 −8）。

---

## 3. 风险与回退

| # | 风险 | 触发信号 | 回退动作 |
|---|---|---|---|
| 1 | 换证书改坏线上站点 | 其他站点/接口 502 或证书告警 | 改动前备份 conf 与证书；只动本站点证书指令；失败立即还原并 reload |
| 2 | 公共 CA 申请需域名验证（可能涉及 DNS 解析权） | 验证卡住 | 改用 DNS 验证方式；仍不通则回退「保留自建链 + 明确记录提审阻塞」（不硬推） |
| 3 | 提审被驳回（类目/隐私/内容） | 审核意见 | 按意见整改重提；每次驳回原因归档进 Task 6 记录 |
| 4 | 图集接入后表现变差（模糊/错位） | 点检异常 | 图集只作为**可选优化**，保留原始素材回退路径（`atlas` 开关）；`high` 档表现不得劣于 S8 |
| 5 | 素材 `.meta` 缺失导致发布丢资源 | 产物里找不到贴图 | 一律经 IDE 导入；发布后跑 `check-package.mjs`（含资源存在性检查） |
| 6 | 真机不达标（低端安卓 <30fps） | A4 失败 | 先启用降级开关项（名标签/网格线/描边）→ 再查图集是否生效 → 最后才调 `degradeRatio`；**不得无数据调参** |
| 7 | 包体超限（主包 >4MB） | `check-package.mjs` FAIL | 查是否把 IDE 引擎文件/未压缩素材混进主包；必要时启用分包（需 IDE 支持确认） |
| 8 | 误在 odoo 上构建 | 服务器负载飙升 | 发布脚本保持「只上传/只重载」；评审时检查脚本源码无 `npm run build` |
| 9 | 线上压测打挂 2G 服务器 | 线上响应变慢/SSH 卡 | 生产只允许 ≤5 bot / ≤10s；高压测一律本机 |
| 10 | S7 未收尾就启动 S9 | `release/wxgame/` 缺失、`check-package.mjs` 缺失 | S9 Task 5/6 依赖 S7 产物链；**S7 未验收前不得开始 Task 5/6** |

---

## 4. 待确认项（动手前请回答；无异议则按【默认】执行）

1. **证书方案**：用哪种公共 CA？【默认：阿里云/腾讯云免费 DV 证书（域名 `game.joho.cn`，1 年）】——是否允许我操作 **odoo** 的 OpenResty 证书文件与指令（改动前备份、只动本站点）？
2. **美术素材交接**：素材由谁、以什么形式提供（目录/压缩包/网盘）？是否已包含 `@2x` 与命名规范？【默认：用户提供分层图与摆件 PNG，我按 §1.5 目录约定入库并生成 `.meta`】
3. **是否强制图集**？【默认：图集作为可选优化（保留原始素材回退），**不做「必须用图集」的验收**】→ **已确认（2026-09-24）：按默认执行，本期不做图集**（Task 3 Step 4/5 记为「不做」并保留理由与后续触发条件）
4. **提审材料**：隐私政策 / 用户协议 / 类目资质是否已有？【默认：由业务侧提供，我只出清单与技术要求】
5. **真机机型矩阵**：起点定为「1 低端安卓 + 1 中端安卓 + 1 iOS」是否够？【默认：够】
6. **上线验收口径**：S9 的完成定义 = 「审核通过并上线」（而非「提交审核」）？【默认：是】
7. **S10 启动时点**：S9 上线后再开，还是并行起草？【默认：S9 上线后再开】

---

## 5. 执行方式

沿用 **Subagent-Driven**：每 Task 派新 subagent，Task 间两阶段评审（先看 diff 是否符合计划，再看验收数值是否达标），每 Task 后跑门禁（S1 冒烟 + S8 性能断言 + 后端测试）。

**任务依赖（串行主线）**：

Task 1（证书，硬前置）→ Task 2（H5 发布）→ Task 3（素材/图集）→ Task 4（真机）→ Task 5（包体）→ Task 6（提审）→ Task 8（验收）；**Task 7 可与 Task 4/5 并行**。

**范围收敛（2026-09-24）**：微信小游戏侧缺 AppID，**Task 6 阻塞**，S9 按 **H5-only** 交付；Task 5 产出照常落地（产物链代码已交付，真实 `release/wxgame` 复核随小游戏上线再补），Task 8 验收不含小游戏证据。

**前置门禁**：S7 未验收前，不得启动 Task 5 / Task 6（小游戏产物链与 `check-package.mjs` 依赖 S7 收尾）。

---

## 6. 后续批次（S10 范围预告，本文件不展开）

用户已确认**拆两批**：

- **S9（本文件）**：上线硬化 —— 证书 / 发布 / 图集 / 真机 / 包体 / 提审 + 广播门禁。
- **S10（另出计划）**：内容与工具 —— GM 后台**拖拽摆点编辑器**（总纲 §1 已列为第二阶段）、玩法/场景内容扩充、运营数据看板。
- 拆分理由：两者改动面（客户端+运维 vs 后台+内容）、验收口径（可上线 vs 可运营）与前置条件均无交叉，混批会让提审被后台开发拖住。

---

## 7. 执行记录（S9）

> 执行时间：2026-09-24（**H5-only** 范围）。本地环境：PostgreSQL 16（`localhost:5432/game_server`）+ mock-redis（`:6379`）+ 后端 `npm start`（`:3000`）。
> 生产环境：`odoo`（39.106.99.9）、`https://game.joho.cn`。
> 「期望」列取自 §1.2 硬指标 / §1.6 验收映射；「实测」一律为本次回归（§7.1）与各 Task Step 的记录值。

### 7.1 门禁实测（Task 8 Step 1 全量回归）

| 项 | 命令 | 期望 | 实测 |
|---|---|---|---|
| 后端回归 | `game-server: npm test` | 全绿，tests ≥1176 | **91 suites / 1176 tests 全绿**，exit 0（150.1s） |
| S1 冒烟回归 | `game-server: node scripts/smoke-laya2d-s1.mjs` | 9/9 PASS | **9/9 PASS**，末行「S1 冒烟全部通过」，exit 0 |
| 客户端构建 | `game-client: node tools/build-fallback.mjs` | 构建 OK | **41 个产物重写导入扩展名**，exit 0 |
| S3 组件断言 | `node scripts/smoke-s3-components.mjs` | 全 PASS | **16/16 PASS**，exit 0 |
| S4 NPC 断言 | `node scripts/smoke-s4-npc.mjs` | 全 PASS | **18/18 PASS**，exit 0 |
| S5 对话断言 | `node scripts/smoke-s5-dialogue.mjs` | 全 PASS | **27/27 PASS**，exit 0 |
| S6 建造断言 | `node scripts/smoke-s6-build.mjs` | 全 PASS | **50/50 PASS**，exit 0 |
| S8 性能断言 | `node scripts/smoke-s8-perf.mjs` | 全 PASS | **146/146 PASS**，exit 0 |
| S7 平台层断言 | `node scripts/smoke-platform-s7.mjs` | 全 PASS | **102/102 PASS**，exit 0 |

### 7.2 验收映射实测（A1–A10）

| # | 验收项 | 判定方式（命令） | 期望 | 实测 |
|---|---|---|---|---|
| A1 | 证书链合法 | `openssl s_client -showcerts -connect game.joho.cn:443` | 链完整、issuer 公共 CA、无 `unable to verify` | **通过**：`Verify return code: 0 (ok)`，issuer `C=US, O=Let's Encrypt, CN=YE2`（链 4 张）；本机 `curl`（系统 CA、不带 `-k`）→ 200 / `ssl_verify_result=0`；Node `https.get` → `authorized=true`（Task 1 Step 4） |
| A2 | S8 成果上线 | 线上 `/client/` 含 S8 模块、`PerfPanel` 可开、线上 `perf-sample` | 线上产物为 S8 版 | **通过**：线上 `/client/index.html` 200 且 md5 `533b098c…` 与本机一致；S8 十模块 URL 全 200；F3 面板真实按键可开；线上非 headless **60fps**/最低 59.9、drawcall 峰 34、heap 峰 17MB、上行 9.4/s、静止 0；`?quality=low` 生效（drawcall 峰 15）（Task 2 Step 3–5） |
| A3 | 美术接入 | 素材入库 + `.meta` 完整；drawcall/包体前后数值 | 素材入库 + 数值记录（图集不列入，§4-3 已确认不做） | **部分达成**：12 张 PNG 入库（程序化生成 + 同格式 `.meta`，**偏离 D8 已获批准**）并贴图接线、已上线（`b5d8c19f0`）；图集本期已决策不做（不计入缺口）；**进图前后 drawcall/heap/包体基线未记录**（Task 3 Step 3） |
| A4 | 真机性能 | 低端安卓机型矩阵实测（面板打点） | ≥30fps / ≤300MB / 冷启动 ≤5s | **未做 / PENDING**：需真实设备，无任何 fps/内存/启动数据（Task 4 未启动） |
| A5 | 包体门禁 | `tools/check-package.mjs`（体积/hash/引擎脚本顺序） | exit 0 | **脚本通过**：H5 布局（`release/client` 71 文件 / 2.23MB）与 wxgame 布局 fixture 均 **6/6 PASS, exit 0**；6 条失败路径各自独立命中（exit 1/2 正确）。**真实 `release/wxgame` 复核 PENDING**（缺 AppID 不导出）（Task 5 Step 1/2） |
| A6 | 正式提审 | 体验版验收 → 提交审核 → 上线 | 审核通过上线 | **未做 / PENDING**：**阻塞于缺微信小游戏 AppID**（Task 6 全部 Step 未启动） |
| A7 | 广播硬指标 | `scripts/loadtest-gate.mjs` | exit 0（P95 ≤200ms、投递 ≤25k/s、0 掉线、RSS Δ ≤50MB） | **门禁判定正确**：S8 历史 50bot 数据 PASS/exit 0；5 条阈值各自单独调到不可能满足均 exit 1（独立）；生产冒烟（5 bot/10s）**P95 33.08ms**、上行 9.2/s/人、**掉线 0**、进场景 5/5，门禁 exit 1 **仅因远端 RSS 无法度量**（脚本缺陷已记录）（Task 7 Step 2 + Task 2 Step 5） |
| A8 | 零契约变更 + 回归 | `git diff`（WS 契约）+ `npm test` + 6 冒烟 | 字段零改动、全绿 | **通过**：`world.move`/`world.entity_update` 字段零改动（Task 3 resKey 走蓝图 `BuildingTemplate` 透传，未动 WS 契约）；`npm test` **91/1176 全绿**；6 个客户端冒烟全 PASS（§7.1） |
| A9 | 服务器零构建 | `publish.mjs` 源码断言 + 人工核对 | 全程无 `npm run build` | **通过**：`publish.mjs` 源码不含 `ssh/scp/curl/npm run build`（S7 冒烟 I-4 PASS）；Task 2/3 部署均「本机构建 → scp → 服务器解包」，服务器零构建 |
| A10 | 文档结清 | `README.md` 核对（S1 #8 / 双端发布 / 真机矩阵 / 包体上限） | 文档更新 | **完成（H5-only 口径）**：S1 #8 按事实拆分「H5 PASS（线上证据）/ 小游戏 BLOCKED（缺 AppID）」；双端发布手册与证书续期说明已在位；真机矩阵新增占位节（不预填数值） |

### 7.3 挂账 / 未达成

| 项 | 状态 | 原因与后续 |
|---|---|---|
| Task 3 Step 4/5（图集导出 + 前后对比） | **已决策不做** | 用户 2026-09-24 确认按 §4 待确认 3 默认口径执行：线上 60fps / drawcall 峰 34 无性能压力、包体收益近零（实体素材仅 ~21KB）、需改加载路径并回归；后续触发条件见 Task 3 Step 5 |
| Task 3 基线数值（drawcall/heap/包体） | **未记录** | 贴图接线已上线但未量前后数值（Step 3 未达验收） |
| Task 3 Step 6 线上浏览器点检 | **部分** | 服务器侧 `curl -sI` 复核 15 个 URL 全 200；浏览器真机点检未做（本机沙箱 DNS 不通） |
| Task 4（A4 真机性能） | **PENDING** | 需真实设备（低端/中端安卓 + iOS），唯一需设备的硬缺口 |
| Task 5 真实 `release/wxgame` 复核 | **PENDING** | 缺 AppID 不导出，产物链仅以 fixture 自检 |
| Task 6（A6 正式提审） | **BLOCKED** | 缺微信小游戏 AppID，S9 记为 H5-only 交付 |
| Task 8 Step 4（commit） | **已执行** | `76c2e8e7f`（`docs(game-client): S9 上线硬化验收记录`，README.md + 本文件） |