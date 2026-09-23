# LayaAir 2D 客户端 · S9 上线硬化批（真机性能 / 图集 / 生产证书 / 正式提审）实施计划

> **状态：已规划，未执行。** 本文件只做规划，不动代码、不动生产。等待 S7 收尾 + 用户对 §4 待确认项答复后再进入执行。
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
| 3 | **美术未接入** | `assets/resources/` 只有 `placeholder.png`；客户端全部实体由 `graphics` 绘制 | Task 3：素材入库 + 图集 |
| 4 | **无图集能力验证** | 从未导出过图集；`release/web/resources/` 仅 IDE 默认产物 | Task 3：图集导出 + 加载策略 + 数值对比 |
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
| A3 | 美术接入 | 素材全部入库且 `.meta` 完整；图集生效；drawcall/包体有前后数值（允许变差，但必须记录并说明） |
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
- [ ] **Step 1 偏差记录**（后续步骤沿用，勿再踩）：① `inject-env.mjs` 的 `--env` 必填，单独传 `--api-base/--ws-url` 会 exit 1，须写 `--env prod --api-base … --ws-url …`（显式值覆盖预设）；② `publish.mjs h5-site --base /` **必然失败**（`BARE_PATH_RESIDUE` 自校验与 base=`/` 语义冲突，见 `tools/publish.mjs:64`），本机预览只能用 `--base /client/` 并按 `/client/` 路径访问；③ 后端 `CORS_ORIGINS` 只含 `3000/5173/127.0.0.1:3000`，预览点检需复用 `perf-sample.mjs --proxy-port`（页面 origin 保持 `localhost:5173`，服务另监听端口）。
- [ ] **Step 2** 上传 `release/client/` 与 `gamedata/` 到 odoo 站点目录（**服务器零构建**）。
- [ ] **Step 3** 验证：`/client/index.html` 200；页面可进场景；`F3` 面板出现；`?quality=low` 切档生效。
- [ ] **Step 4** 线上冒烟：浏览器双窗口互见移动（插值连续无跳变）+ `curl https://game.joho.cn/health`。
- [ ] **Step 5** 线上指标：跑一次 `perf-sample.mjs`（prod 地址），记录 fps/drawcall/上行 → 写入 S9 报告。
- [ ] **Step 6** commit：`chore(game-client): 发布 S8 性能成果到 H5 生产`

### Task 3: 美术素材入库 + 图集（先量后做）

- [x] **Step 1** 素材交接清单（D8）：分层图 / 摆件 / 图标 的尺寸、透明通道、命名、`@2x` 约定、放置目录 `assets/resources/**`；清单写入 README 或素材文档。→ 已落地 `game-client/docs/art-handover.md`（README 目录约定加 1 行链接）；尺寸逐项附代码出处，3 处待主程确认（建筑贴图尺寸口径 / 玩家朝向与动态 NPC 命名 / 图集页命名与 `@2x` 自动识别），待确认项**不阻塞** Step 2 入库。
- [ ] **Step 2** 素材入库：放入 `assets/resources/**`，由 IDE 生成 `.meta`（**不得手工塞文件**）；`smoke-s9-atlas.mjs` 断言命名与清单一致。
- [ ] **Step 3** **接入原始素材并量基线**：静态层与实体改贴图（无素材时回退 `graphics`），记录 drawcall / heap / 包体。
- [ ] **Step 4** 图集导出（IDE 自带工具）→ `assets/resources/atlas/**`；`atlas-manifest.mjs` 校验清单与产物一致。
- [ ] **Step 5** 对比：图集前后 drawcall / 包体 / 加载耗时（**允许某项变差，但必须记录并给出结论**）。
- [ ] **Step 6** H5 与开发者工具双端点检（表现不回退），跑 S1 冒烟 + S8 断言。
- [ ] **Step 7** commit：`feat(game-client): 美术素材入库与图集接入`

### Task 4: 真机性能验收（低端机型）

- [ ] **Step 1** 定义机型矩阵（§4 待确认 5）与测量项：冷启动耗时、稳态 fps、内存峰值、场景切换回落。
- [ ] **Step 2** 真机跑 H5（手机浏览器）与微信开发者工具/真机调试：记录面板数据 + 截图/录屏。
- [ ] **Step 3** **自动降级验证**：在低端机上确认连续 3s 低于目标 80% → 降 `quality=low`（并记录降级后 fps）。
- [ ] **Step 4** 若 <30fps：先查 `Quality` 开关项（名标签/网格线/触发区描边）与图集是否生效，再考虑降级阈值调参（**禁止无数据调参**）。
- [ ] **Step 5** 达标判定：A4 三项（帧率/内存/启动）。
- [ ] **Step 6** 记录矩阵表 + 结论，commit：`test(game-client): 真机机型矩阵与性能验收记录`

### Task 5: 包体门禁与产物链

- [ ] **Step 1** `tools/check-package.mjs`：检查（a）主包 ≤4MB、（b）总包 ≤20MB、（c）`config/manifest.json` 与场景文件存在且 hash 匹配、（d）入口引擎脚本顺序 `laya.core.js → laya.webgl_2D.js → laya.ui2.js`、（e）`js/player-config.js` 在 init 前加载、（f）产物新鲜度（对比 `src/` 最近提交时间）。
- [ ] **Step 2** 接入 `publish.mjs wxgame`：GUI 导出后补齐 `config/` + 注入 prod env + 自动跑 `check-package.mjs`。
- [ ] **Step 3** 记录 GUI 手工步骤（IDE → 构建/发布 → 微信小游戏 → 产物目录），写入 README。
- [ ] **Step 4** 连续两次发布产物清单与 hash 一致（幂等）。
- [ ] **Step 5** commit：`feat(game-client): 包体检查与 wxgame 产物链`

### Task 6: 微信小游戏正式提审上线

- [ ] **Step 1** 材料清单（技术项自查 + 业务项待提供）：AppID、备案域名白名单（含 `wss`）、类目资质、隐私政策、用户协议、内容合规说明。
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

- [ ] **Step 1** 全量回归：`npm test`（≥1176）、`smoke-laya2d-s1` 9/9、S3/S4/S5/S6/S8/S7 六个客户端冒烟全 PASS。
- [ ] **Step 2** `README.md`：S1 #8 → PASS（附体验版/线上证据）+ 双端发布手册 + 真机矩阵 + 证书续期说明。
- [ ] **Step 3** 把 A1–A10 的实测值填进本文件的执行记录节（沿用 S5–S8 的写法规格）。
- [ ] **Step 4** commit：`docs(game-client): S9 上线硬化验收记录`

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
3. **是否强制图集**？【默认：图集作为可选优化（保留原始素材回退），**不做「必须用图集」的验收**】
4. **提审材料**：隐私政策 / 用户协议 / 类目资质是否已有？【默认：由业务侧提供，我只出清单与技术要求】
5. **真机机型矩阵**：起点定为「1 低端安卓 + 1 中端安卓 + 1 iOS」是否够？【默认：够】
6. **上线验收口径**：S9 的完成定义 = 「审核通过并上线」（而非「提交审核」）？【默认：是】
7. **S10 启动时点**：S9 上线后再开，还是并行起草？【默认：S9 上线后再开】

---

## 5. 执行方式

沿用 **Subagent-Driven**：每 Task 派新 subagent，Task 间两阶段评审（先看 diff 是否符合计划，再看验收数值是否达标），每 Task 后跑门禁（S1 冒烟 + S8 性能断言 + 后端测试）。

**任务依赖（串行主线）**：

Task 1（证书，硬前置）→ Task 2（H5 发布）→ Task 3（素材/图集）→ Task 4（真机）→ Task 5（包体）→ Task 6（提审）→ Task 8（验收）；**Task 7 可与 Task 4/5 并行**。

**前置门禁**：S7 未验收前，不得启动 Task 5 / Task 6（小游戏产物链与 `check-package.mjs` 依赖 S7 收尾）。

---

## 6. 后续批次（S10 范围预告，本文件不展开）

用户已确认**拆两批**：

- **S9（本文件）**：上线硬化 —— 证书 / 发布 / 图集 / 真机 / 包体 / 提审 + 广播门禁。
- **S10（另出计划）**：内容与工具 —— GM 后台**拖拽摆点编辑器**（总纲 §1 已列为第二阶段）、玩法/场景内容扩充、运营数据看板。
- 拆分理由：两者改动面（客户端+运维 vs 后台+内容）、验收口径（可上线 vs 可运营）与前置条件均无交叉，混批会让提审被后台开发拖住。