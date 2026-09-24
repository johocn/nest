# LayaAir 2D 客户端 · S9 上线硬化批（真机性能 / 图集 / 生产证书 / 正式提审）实施计划

> **状态：执行中，范围收敛为 H5-only（2026-09-24）。** 微信小游戏侧**缺 AppID**，Task 6（正式提审）**阻塞**，Task 5 的产物链**代码已交付**，真实 `release/wxgame` 导出的复核随小游戏上线解阻后再补。本文件只做规划与记录，不动代码、不动生产。
> **H5 侧进度快照（2026-09-24）**：Task 1（证书）/ Task 2（S8 上线）/ Task 5（包体门禁）/ Task 7（广播门禁）**已完成**；Task 3 Step 2–3（素材入库 + 贴图接线）**已完成并上线**（落地方式偏离 D8，见 Task 3 Step 2 记录），Step 4–5（图集）**已决策不做**（2026-09-24 确认，见 Task 3 Step 4/5 记录），Step 6（线上点检）**服务器侧已完成、手机端待人工**（见 §7.4.1）；Task 4（真机验收，唯一需设备的硬缺口）**清单与模板已就绪、实测未做**；Task 8（验收与文档结清）Step 1–4 **已完成**（见 §7，提交 `76c2e8e7f`）。
> **点检轮快照（2026-09-24 晚，「接上文，真机点检」）**：① **P0 已修** —— 线上证书 13:30 被「整目录还原」类操作回退成自建 CA（A1 回归），18:14 用面板 cert-stage 的 LE 全链重铺 + reload 修好（`0 (ok)`），回退陷阱已写进 `game-client/README.md`；② **服务器侧点检完成**（SSH → odoo）：线上产物 md5 与本机一致、S8 五模块/素材/manifest/health 全 200、assets 13 PNG + 13 `.meta`、`wss` 101；③ **本地基线完成**：`s9-art-after` 60fps / drawcall 峰 39 / heap 峰 23.2MB / up 9.5 / high（Task 3 Step 3 + §7.4.2）；④ **真机清单与记录模板已产出**（Task 4 Step 1–6 + §7.4.3），实测待人工持真机执行 —— 本机 Windows 且**出网被拦**，无真机通道；⑤ **低端代理预评估完成**（§7.4.4，`perf-sample.mjs` 新增 `--cpu-throttle`）：×6 仍 60fps（**H5 无 CPU 瓶颈**）、×50 **首次实证自动降级链路可用**（降级后 39.7fps ≥30）—— 代理值**不参与 A4 判定**。
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
- [x] **Step 3** **接入原始素材并量基线**：静态层与实体改贴图（无素材时回退 `graphics`），记录 drawcall / heap / 包体。→ **接线已完成并已上线；基线数值已于 2026-09-24 晚补齐（同口径采样）**。接线范围：`SceneBuilder` 背景走 `bgResKey(cfg)` 命中贴图 / 未命中回退底色；实体走 `TextureRegistry`（`resKey` → `resources/<resKey>.png`，404 归一 null → 回退 `placeholder.png`）；建筑绘制尺寸改为 `footprint × 64`（进度条/耐久锚点随高度上移）；**玩家**原 `resKey: ''` 永不生效，改走新常量 `EntityFactory.PLAYER_RES_KEY`；**建筑** resKey 由蓝图 `BuildingTemplate.resKey` 经 `build-logic.toBuildingSpawn` 透传（**未改 WS 契约**）。

  **进图前 / 进图后（表现，dev 端点 + `tools/serve.mjs`，route 6s 移动 + 6s 静止，`--map-localhost-ipv4`）**：

  | 项 | 进图前 `s9-preview`（2026-09-23） | 进图后 `s9-art-after`（2026-09-24） | 目标 |
  |---|---|---|---|
  | 移动段 fps 均值 / 最低 | 60 / 59.9 | **60 / 59.9** | 60 |
  | drawcall 峰值 | 38 | **39** | ≤60 |
  | heap 峰值 | 18.7 MB | **23.2 MB** | ≤300MB |
  | 移动段 up/s 均值 | 9.7 | **9.5** | ≤10 |
  | 静止段 up/s 合计 | 0 | **0** | ≈0 |
  | 结束档位 | high | **high** | — |

  **进图前 / 进图后（包体，线上站点目录实测 `du -sb`）**：

  | 项 | 进图前（`client.bak_art_20260924_110638`） | 进图后（`client`，线上现状） |
  |---|---|---|
  | 文件数 / 站点字节 | 71 / 2,411,180 | **96 / 2,953,242** |
  | `assets/` 文件 / 字节 | 4 / 20,356 | **28 / 550,331**（13 PNG + 13 `.meta`，另含 `config/`） |
  | 最大单文件 | `placeholder.png` 7,731 | **`bg_scene1.png` 491,786** |

  **结论（允许变差但必须记录，§9 风险 #4）**：表现不回退（fps 不变、drawcall +1）；包体 +0.52 MiB（+22%），其中背景整图占 480 KiB、12 张实体素材合计仅 ~21 KiB，属素材本身，且总包 2.8 MiB **远低于主包 4MiB / 总包 20MiB 门禁**；heap +4.5 MB 未隔离单变量（样本间波动），绝对值 23.2 MB 远低于 300MB 上限。
- [ ] **Step 4** 图集导出（IDE 自带工具）→ `assets/resources/atlas/**`；`atlas-manifest.mjs` 校验清单与产物一致。→ **【本期不做】**（用户 2026-09-24 决策，与 §4 待确认 3 默认口径一致）：`assets/resources/atlas/` 与 `tools/atlas-manifest.mjs` 均不存在，未落地。理由见 Step 5。
- [ ] **Step 5** 对比：图集前后 drawcall / 包体 / 加载耗时（**允许某项变差，但必须记录并给出结论**）。→ **【本期不做，随 Step 4 一并放弃】** 决策依据：① 收益侧——H5 线上实测 **60fps、drawcall 峰值 34**（S8 / Task 2 口径），**无性能压力**，自动降级在 H5 从未触发；② 包体侧——12 张实体素材合计仅约 21KB，包体主体是背景 **480.3KB 单张整图**（打不进图集），合图仅省几十 KB 文件头，**收益近零**；③ 成本侧——需把 `TextureRegistry` 由「按 URL 逐张加载」改为「加载 `.atlas` + `@img0.png` 按帧名取纹理」，属真实代码改动 + 6 冒烟回归 + 重新构建部署，且计划风险 #4 记有像素错位/模糊风险。**能力澄清**：Step 4 原假设「IDE 工具导出、不可自动化」**不成立**——`library/` 下现成产物表明 `.atlas` 是**纯 JSON 帧表 + PNG**，程序化生成本可行（同 `gen-art.ps1` 的零依赖套路），故本次属**主动取舍而非能力受限**。**后续触发条件**：Task 4 真机（低端安卓）若 <30fps，图集为首选优化项（风险 #6 处置顺序：降级开关项 → 图集 → `degradeRatio` 调参）。
- [ ] **Step 6** H5 与开发者工具双端点检（表现不回退），跑 S1 冒烟 + S8 断言。→ **未做完整点检**：`tsc --noEmit` 通过、6 个冒烟（S3/S4/S5/S6/S8/S7）全绿、`publish.mjs h5-site` 装配 96 文件（assets 28 文件）已跑；**线上真机/浏览器点检未做**（本机沙箱 DNS 不通，无法解析 `game.joho.cn`），已用「拼版预览图 + 看图自评」替代，并据此修掉 3 个绘制缺陷（缺参 / 两点多边形 / PowerShell 变量名大小写覆盖导致背景只铺局部）。线上校验改用服务器侧 `curl -sI`：`/client/index.html`、`/assets/resources/**` 共 15 个 URL 全 200。→ **补充（2026-09-24 晚）**：① 服务器侧点检升级为「SSH 到 odoo + `Host` 头全量核对」——线上 `index.html` **md5 `8d9d559a232ef842ae2adf4e5c7f05ee` 与本机 `release/client/index.html` 逐字节一致**；`/client/index.html`、S8 五模块（`EntityPool`/`PerfPanel`/`Quality`/`Viewport`/`RemoteInterp`）、`/gamedata/manifest.json`、`/health`、6 个素材 URL 全 200；线上 assets 实测 **13 PNG + 13 `.meta`**（与入库数一致，无丢资源）；`wss` 握手 `101`（注意 curl 需 `--http1.1`，否则走 h2 会得 400）。② 本机浏览器点检改用 **`tools/serve.mjs` + `perf-sample`**（口径与 S8 基线一致，见 Step 3 表），表现不回退。**仍缺**：线上手机浏览器端到端点检（本机出网被拦，见 §7.4）。
- [x] **Step 7** commit：`feat(game-client): 美术素材入库与图集接入` → 实际提交 `b5d8c19f0`（`feat(game-client): 美术素材入库与贴图接线（S9 Task 3）`，33 files / +844 −44）；另附 `73924cc6a`（`chore(git): .meta 文件禁用换行转换（-text）`）。**部署**：本地 `tar.gz` → `scp` → 服务器先 `cp -a` 备份（`client.bak_art_<时间戳>`）再解压到 `.../game.joho.cn/client/`，**服务器零构建**。**注**：本次提交不含图集（Step 4/5 未做），Step 6 亦未完整达成。

### Task 4: 真机性能验收（低端机型）

> **本期范围（用户 2026-09-24 决策）：仅 H5 手机浏览器**。不含微信开发者工具、不含小游戏真机（Task 6 阻塞于缺 AppID）；原 Step 2 的小游戏分支据此移出本期。
> **执行状态：清单与模板已就绪（本轮产出），实测待人工持真机执行**——本机为 Windows、出网被拦，无真机通道（见 §7.4「为何本机做不了」）。

- [ ] **Step 1** 定义机型矩阵（§4 待确认 5）与测量项：冷启动耗时、稳态 fps、内存峰值、场景切换回落。→ **口径已定义（本轮）**：
  - **机型矩阵**（§4 待确认 5 的默认口径，三档）：① **低端安卓** —— 门槛档，A4 判定以它为准（如骁龙 4xx/6xx 系、4GB RAM、Android 10±）；② **中端安卓** —— 参考档（如骁龙 7xx 系、8GB RAM）；③ **iOS Safari** —— 参考档。**三档各一台**即可，机型/系统版本如实填进 Step 6 表。
  - **打开地址与账号**：手机浏览器直接打开 `https://game.joho.cn/client/`（**非** `http://`、**非** PC 地址），用 `spike01` / `spike123456` 登录；需看「互见」时在 PC 另开一窗用 `spike02` 同场景对照（Task 2 Step 4 的线上双窗口径）。
  - **打点方式（关键约束：手机无键盘，`F3` 不可用；移动/交互见 §7.4.5 触控通道）**：
    - **安卓**：USB 连 PC → PC Chrome 打开 `chrome://inspect` → inspect 手机页面 → Console 执行 `__PERF__.panel(true)`（显形面板，`__PERF__.panel()` 不传参是**切换**，连调两次取第二次返回值才是「读」）或 `__PERF__.snapshot()` 逐秒读数。**面板读数项**：`fps` / `drawcall` / `heapMB` / `upPerSec` / `quality` / `entityTotal`。
    - **iOS**：无 Mac 则走不了 Safari Web Inspector → **仅目视 + 录屏**，`heapMB` 记 **n/a**（iOS 无 `performance.memory`，`snapshot().heapMB` 本就返回 null），fps 以目视是否卡顿 + 录屏帧计数估算，并在结论里标注「非仪器读数」。
  - **测量项与判定阈值**（A4 三项 + 降级）：

    | 代号 | 测量项 | 打点方式 | 阈值 |
    |---|---|---|---|
    | T1 | 打开 URL → 登录表单可输入 | 秒表（或录屏逐帧） | — |
    | T2 | 点登录 → 场景首帧出现 | 秒表（或录屏逐帧） | — |
    | T3 | 冷启动总耗时 = T1 + T2 | T1 + T2 | **≤5s** |
    | F | 稳态 fps（移动 + 静止，含降级生效后） | `__PERF__.snapshot().fps` 逐秒 | **低端安卓 ≥30** |
    | M | 内存峰值 / 切场景后 | `snapshot().heapMB` | 峰值 **≤300MB**，切场景后**回落**（安卓）；iOS 记 n/a |
    | D | 自动降级可复现性 | 控制台日志 + `snapshot().quality` | 出现 `[S8] 连续 3000ms fps 低于目标 80% → 自动降级 quality=low` 或 `quality==='low'`，且**降级后 fps ≥30** |

  - **桌面端已知基线（仅供对照，非真机结论）**：H5 线上 PC 非 headless **60fps** / drawcall 峰 34 / heap 峰 17MB（Task 2 Step 5）；本机 dev `s9-art-after` 60fps / drawcall 峰 39 / heap 峰 23.2MB（Task 3 Step 3）；**CPU 限速代理**（非真机替代）见 §7.4.4：×6 仍 60fps、×50 触发降级后 39.7fps。真机数值**一律实测填入，不预填**。
- [ ] **Step 2** 真机跑 H5（手机浏览器）：记录面板数据 + 截图/录屏。→ **本期仅 H5 手机浏览器**（小游戏真机随 Task 6 解阻再补）。操作即 Step 1 的「打开地址 + 打点方式」；每档机型产出一份 Step 6 表行 + 至少 1 张面板截图或 1 段录屏。
- [ ] **Step 3** **自动降级验证**：在低端机上确认连续 3s 低于目标 80% → 降 `quality=low`（并记录降级后 fps）。→ 判据见 Step 1 表 D 行。**若低端安卓本就 ≥30fps 不触发降级**，改由「临时构造」验证：`https://game.joho.cn/client/?quality=low` 强制低档，确认面板 `quality==='low'` 且表现正常（**证明开关链路可用**），并在结论里注明「未触发自动降级，仅验证手动切档」。**代理侧已先证**：§7.4.4 的 ×50 CPU 限速下该链路**真实触发**（日志 + `finalQuality=low`，降级后 39.7fps ≥30）—— 真机只需复现「是否触发」，不必再验证代码通不通。
- [ ] **Step 4** 若 <30fps：先查 `Quality` 开关项（名标签/网格线/触发区描边）与图集是否生效，再考虑降级阈值调参（**禁止无数据调参**）。→ 处置顺序（§3 风险 #6）：① 降级开关项（`?quality=low` 或触发自动降级）；② 图集（Task 3 Step 4/5 已决策不做，**真机 <30fps 是它的首选触发条件**）；③ 最后才动 `degradeRatio` 调参。**先验线索**：§7.4.4 表明 H5 无 CPU 瓶颈（×6 仍 60fps），故真机掉帧优先怀疑 **GPU / 内存**——第 ② 步（图集，本质是减少纹理与 drawcall）的优先级因此高于第 ③ 步调参。
- [ ] **Step 5** 达标判定：A4 三项（帧率/内存/启动）。→ 判定表（**逐档机型单独判**，低端安卓为门槛档）：T3 ≤5s、F ≥30（若触发降级，用**降级后**的 F 判定）、M ≤300MB 且切场景后回落（iOS 该项记 n/a 并在结论标注）。三项全过 = 该档 PASS；低端安卓 FAIL 即 A4 FAIL。**§7.4.4 的 CPU 限速值只作参考、不参与判定**（不模拟移动 GPU / 内存 / 触屏，且为桌面浏览器口径）。
- [ ] **Step 6** 记录矩阵表 + 结论，commit：`test(game-client): 真机机型矩阵与性能验收记录`。→ **模板已就绪（本轮）**，见 §7.4「真机点检记录模板」；实测数据由执行者填入后随本 Step 一起提交（README「真机性能矩阵」节的占位表同步回填）。

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
- [x] **Step 5** `scripts/loadtest-s9-report.md`：上线前/后指标对照 + 门禁结论。→ **已闭环**：报告 §3 上线前（S8 本机 50 bot）+ **§4 上线后对照（2026-09-24 生产冒烟，5 bot/10s：P95 33.08ms、上行 9.2/s/人、掉线 0、进场景 5/5）**；§4.1 记录生产冒烟暴露的两处脚本缺陷。**注**：上线后为 5 bot 冒烟口径（2G 生产机未跑 50 bot），非 50 bot 对照。
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
| A1 | 证书链合法 | `openssl s_client -showcerts -connect game.joho.cn:443` | 链完整、issuer 公共 CA、无 `unable to verify` | **通过**：`Verify return code: 0 (ok)`，issuer `C=US, O=Let's Encrypt, CN=YE2`（链 4 张）；本机 `curl`（系统 CA、不带 `-k`）→ 200 / `ssl_verify_result=0`；Node `https.get` → `authorized=true`（Task 1 Step 4）。**⚠️ 2026-09-24 曾回归过一次**：站点 `ssl/` 被「整目录还原」覆盖回自建 CA（`19 self signed certificate`），当日 18:14 已修复并复验 `0 (ok)`；防再发条款见 `game-client/README.md` 与 §7.4.1 |
| A2 | S8 成果上线 | 线上 `/client/` 含 S8 模块、`PerfPanel` 可开、线上 `perf-sample` | 线上产物为 S8 版 | **通过**：线上 `/client/index.html` 200 且 md5 `533b098c…` 与本机一致；S8 十模块 URL 全 200；F3 面板真实按键可开；线上非 headless **60fps**/最低 59.9、drawcall 峰 34、heap 峰 17MB、上行 9.4/s、静止 0；`?quality=low` 生效（drawcall 峰 15）（Task 2 Step 3–5）。**2026-09-24 晚服务器侧复验**：S8 五模块 URL 仍全 200，`index.html` md5 更新为 `8d9d559a…`（Task 3 素材上线后的重建产物，本机逐字节一致）（§7.4.1） |
| A3 | 美术接入 | 素材入库 + `.meta` 完整；drawcall/包体前后数值 | 素材入库 + 数值记录（图集不列入，§4-3 已确认不做） | **达成**：12 张 PNG 入库（程序化生成 + 同格式 `.meta`，**偏离 D8 已获批准**）并贴图接线、已上线（`b5d8c19f0`）；图集本期已决策不做（不计入缺口）；**进图前后基线已补齐**（2026-09-24 晚，Task 3 Step 3）：表现不回退（60/59.9、drawcall 38→39、heap 18.7→23.2MB、high），包体 71→96 文件 / 2.41→2.95 MB（+0.52 MiB，远低于门禁） |
| A4 | 真机性能 | 低端安卓机型矩阵实测（面板打点） | ≥30fps / ≤300MB / 冷启动 ≤5s | **未做 / PENDING（清单已就绪 + 代理预评估已做）**：本机 Windows + 出网被拦，无真机通道；**点检清单 + 记录模板本轮已产出**（Task 4 Step 1–6、§7.4.3，H5 手机浏览器口径），**CPU 限速代理预评估见 §7.4.4**（×6 仍 60fps、×50 真实触发自动降级且降级后 39.7fps ≥30 —— 但**不参与 A4 判定**）。**无任何真机 fps/内存/启动数据** |
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
| Task 3 基线数值（drawcall/heap/包体） | **已补齐**（2026-09-24 晚） | 同口径采样写入 Task 3 Step 3：表现「60/59.9、drawcall 39、heap 23.2MB、up 9.5、high」不回退；包体 96 文件 / 2,953,242 B（+0.52 MiB，远低于门禁）。单变量未隔离：heap +4.5MB 含样本波动，不作为结论 |
| Task 3 Step 6 线上点检 | **服务器侧完成 / 手机端待人工** | 服务器侧（SSH 到 odoo）全量核对通过：线上 `index.html` md5 与本机逐字节一致、S8 五模块 + manifest + health + 6 素材 URL 全 200、assets 13 PNG + 13 `.meta`、`wss` 101；**线上手机浏览器端到端点检归入 Task 4，由人工持真机执行**（模板见 §7.4） |
| **生产证书被回退成自建 CA（P0，2026-09-24 发现）** | **已修复**（2026-09-24 18:14） | 站点 `ssl/` 目录 13:30 被「整目录还原」类操作覆盖回自建 CA（A1 回归，手机/微信端报不受信）。已用面板 cert-stage 的 LE 全链 + 私钥重铺 + `chmod 600` + reload，验证 `Verify return code: 0 (ok)`（链 4 张）；同源事故的**回退陷阱已写进 `game-client/README.md`**（只还原产物目录、绝不还原 `ssl/`）。详见 §7.4 |
| Task 4（A4 真机性能） | **PENDING（清单已就绪 + 代理预评估已做）** | 需真实设备（低端/中端安卓 + iOS）；**点检清单与记录模板本轮已产出**（Task 4 Step 1–6 + §7.4 模板），**CPU 限速代理预评估见 §7.4.4**（含自动降级首次实证触发），本机无真机通道（出网被拦、无 USB/Safari Inspector），真机实测待人工执行 |
| Task 5 真实 `release/wxgame` 复核 | **PENDING** | 缺 AppID 不导出，产物链仅以 fixture 自检 |
| Task 6（A6 正式提审） | **BLOCKED** | 缺微信小游戏 AppID，S9 记为 H5-only 交付 |
| Task 8 Step 4（commit） | **已执行** | `76c2e8e7f`（`docs(game-client): S9 上线硬化验收记录`，README.md + 本文件） |

### 7.4 点检记录（服务器侧 / 本机基线 / 真机模板）

> 本节为 2026-09-24「接上文，真机点检」一轮的产出：服务器侧线上点检、本机性能基线、真机点检清单与模板。**真机实测数据待人工填入**。

#### 7.4.1 服务器侧线上点检（已完成，SSH → odoo）

方式：本机沙箱**出网全被拦**（`curl` 连公网均 000、DNS 不通、ICMP 不通），唯一可用通道是 **SSH 到 odoo（39.106.99.9）**，故所有线上核对在服务器侧执行（Windows 下复杂命令经 base64 编码后 `ssh odoo "echo <b64> | base64 -d | bash"`）。

| 项 | 期望 | 实测 |
|---|---|---|
| 线上入口产物一致性 | 与本机 `release/client` 逐字节一致 | `/client/index.html` md5 **`8d9d559a232ef842ae2adf4e5c7f05ee`** = 本机同值；200（2082 B） |
| S8 模块上线 | 五模块 URL 200 | `js/entity/EntityPool.js`、`js/perf/PerfPanel.js`、`js/perf/Quality.js`、`js/world/Viewport.js`、`js/entity/components/RemoteInterp.js` **全 200** |
| 素材入库 | 13 PNG + 13 `.meta` | 线上 `assets/` 实测 **13 PNG + 13 `.meta`**（与入库数一致，无丢资源）；抽查 6 个素材 URL 全 200 |
| 配置包与健康 | 200 | `/gamedata/manifest.json` 200（`generatedAt 2026-09-21T16:07:17.494Z`，scene 1 `sha256:2a2e0f80…`）、`/health` 200 |
| 站点规模 | 与 Task 3 记录一致 | `/client` **96 文件** |
| 后端进程 | active | `systemctl is-active game-server` = **active** |
| TLS 证书链（A1） | `Verify return code: 0 (ok)`、公共 CA | **`0 (ok)`**，issuer `C=US, O=Let's Encrypt, CN=YE2`，链 4 张（leaf ← YE2 ← Root YE ← ISRG Root X2 ← ISRG Root X1），`notAfter 2026-12-22 15:38:49 GMT` |
| 公网可达（服务器侧自测） | 全 200 且校验通过 | `pub_health=200 ssl_verify=0`、`pub_client=200 ssl_verify=0`、`pub_jianghu=200 ssl_verify=0` |
| `wss` 握手 | 101 | **101**（**curl 须加 `--http1.1`**，走 h2 会得 400） |

**P0 事故与修复（证书回退）**：

- **现象**：线上 443 服务的是**自建 CA 证书**（`Verify return code: 19 (self signed certificate in certificate chain)`）——A1 回归，手机/微信端直接报不受信。
- **证据链**：站点 conf `game.joho.cn-ssl.conf` 指向 `ssl/game.joho.cn.fullchain.crt`/`.key`，该文件 md5 `c306bcb0822c330241dad60af5b38200` 与**换证前 22:41 备份 `/opt/1panel/game-site-backup/20260923_224154/ssl/` 内的自建 CA 文件逐字节相同**；LE 证书（md5 `906577d2…`）仅存于 `*.le_1790227810` 与 `/opt/1panel/cert-stage/game.joho.cn/`，公钥 md5 配对一致（`6cdf925a3874c2e67c2e5695924ce7d8`）。时间线：`ssl/` 目录 mtime **2026-09-24 13:30:10**（内容回到换证前），openresty worker 13:30:31 重启。**面板记录自身正确**（`auto_renew=1`、`push_dir=1`、`exec_shell=1` 且 shell = cp + chmod + reload），故非续期机制问题，而是「有人把站点/`ssl/` 整目录还原」。
- **修复（用户授权后执行，18:14 完成）**：备份现场 `ssl/` → `/opt/1panel/game-site-backup/fixcert-20260924_181432`（10 文件）→ `cp -f cert-stage/game.joho.cn/fullchain.pem → ssl/game.joho.cn.fullchain.crt`、`cp -f privkey.pem → ssl/game.joho.cn.key`、`chmod 600` → `docker exec 1Panel-openresty-cFrx openresty -t`（OK）→ `-s reload` → 验证 **`0 (ok)`** + 上述公网三项 + `wss 101`。
- **防再发**：`game-client/README.md` 已写入「**⚠️ 证书回退陷阱（2026-09-24 实际踩到）**」+ 两条硬约束（回退只还原 `client/` 等产物目录、绝不还原 `ssl/`；改动后必跑三条验证命令，`19` = 自建链又回来了）。

#### 7.4.2 本机性能基线（已完成，`s9-art-after`）

口径与 S8 基线一致：dev 端点 + `tools/serve.mjs`（:5173），`node scripts/perf-sample.mjs --label s9-art-after --move-ms 6000 --idle-ms 6000 --map-localhost-ipv4`，结果已 append 到 `docs/perf-sample.md`。

| 项 | 实测 | 目标 |
|---|---|---|
| 移动段 fps 均值 / 最低 | **60 / 59.9** | 60（H5） |
| 静止段 fps 均值 | **59.8** | — |
| drawcall 峰值 | **39** | ≤60 |
| heap 峰值 | **23.2 MB** | ≤300MB |
| 移动段 上行/s 均值 | **9.5** | ≤10 |
| 静止段 上行合计 | **0** | ≈0 |
| 结束档位 | **high** | 不降级 |

> 说明：本机 5173 被 jianghu-client vite 占用在 `::1`，`localhost` 优先解析 IPv6 → **必须加 `--map-localhost-ipv4`**（否则页面打到 vite，`#s1-submit` 超时）。此环境细节已记入 `perf-sample.mjs` 的参数注释。

#### 7.4.3 真机点检执行清单（人工，H5 手机浏览器）

**为何本机做不了**：本机是 Windows 且**出网被拦**（DNS/HTTPS 全不通），既没有真机、也没有 `chrome://inspect` 的 USB 通道与 Mac 的 Safari Inspector；服务器侧 SSH 只能验「产物/证书/接口」，验不了「手机上的 fps 与内存」。故本轮**只产出清单与模板**，实测由人工执行后回填。

**执行顺序（安卓门槛档为例，中端/iOS 同法各跑一遍）**：

1. 手机浏览器打开 `https://game.joho.cn/client/`（确认地址栏无证书告警 —— 有告警说明 §7.4.1 的 P0 复发，先修证书再点检）；秒表起 T1（URL → 登录表单可输入）。
2. USB 连 PC → PC Chrome `chrome://inspect` → inspect 该页 → Console 备用。
3. 输入 `spike01` / `spike123456` 登录，秒表计 T2（点登录 → 场景首帧）；T3 = T1 + T2。
4. Console 执行 `__PERF__.panel(true)` 显形面板（或 `__PERF__.snapshot()` 逐秒读数）；用**左下角虚拟摇杆**（§7.4.5）按住走一段 + 静止一段，各读数 **F**（fps）与 **M**（heapMB）。
5. 观察控制台是否出现 `[S8] 连续 3000ms fps 低于目标 80% → 自动降级 quality=low` 或 `snapshot().quality === 'low'`（**D**）；若触发，记录降级后 fps。
6. 切换场景（或走出/回到场景）后再读一次 heap，判定**是否回落**（**M** 后半句）。
7. 截图/录屏留证，按下方模板填行，回填 README「真机性能矩阵」节。

**真机点检记录模板**（Step 6 用；**数据待填，不预填占位数值**）：

| 机型 | 系统/浏览器 | T1(s) | T2(s) | T3(s) | fps 均值/最低 | drawcall 峰 | heap 峰(MB) | 切场景后 heap(MB) | 触发降级 | 降级后 fps | 结论 | 证据文件 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 待填（低端安卓 · 门槛档） | 待填 | 待填 | 待填 | 待填（≤5s） | 待填（≥30） | 待填 | 待填（≤300） | 待填（应回落） | 待填 | 待填 | 待填 PASS/FAIL | 截图/录屏文件名 |
| 待填（中端安卓 · 参考档） | 待填 | 待填 | 待填 | 待填（≤5s） | 待填（≥30） | 待填 | 待填（≤300） | 待填（应回落） | 待填 | 待填 | 待填 | 截图/录屏文件名 |
| 待填（iOS Safari · 参考档） | 待填 | 待填 | 待填 | 待填（≤5s） | 待填（≥30，目视估算） | n/a（无 Inspector） | **n/a**（iOS 无 `performance.memory`） | n/a | 待填 | 待填 | 待填 | 录屏文件名 |

**填写注意**：① `drawcall` 仅安卓可读（`snapshot().drawcall`），iOS 无 Inspector 时记 n/a；② 触发降级时，**F 用降级后的值判**（Step 1 表 F 行）；③ iOS 的 fps/heap 属目视估算，结论须标注「非仪器读数」；④ 三档中**低端安卓为 A4 门槛档**，其 FAIL 即 A4 FAIL。

#### 7.4.4 低端代理预评估（CPU 限速 · **非 A4 替代**）

真机不可得时的降险手段：用 CDP `Emulation.setCPUThrottlingRate` 在桌面浏览器上降 CPU 速度近似低端安卓。为此给 `scripts/perf-sample.mjs` 新增 `--cpu-throttle <n>`（记录字段新增 `cpuThrottle` / `degradeLine`）。**局限（必读）**：只降 CPU，不模拟移动 GPU、显存/内存带宽与触屏输入 —— 结论只能回答「H5 是否 CPU 瓶颈」，**不能替代 A4 真机验收**。

| 限速 | 移动段 fps 均值 / 最低 | 静止段 fps 均值 | drawcall 峰 | heap 峰 | 自动降级 | 结束档位 |
|---|---|---|---|---|---|---|
| 不限速（`s9-art-after` 对照） | 60 / 59.9 | 59.8 | 39 | 23.2 MB | 未触发 | high |
| ×6 | 59.2 / 55.2 | 60 | 39 | 21.8 MB | 未触发 | high |
| ×20 | 50.3 / 20.8 | 58.2 | 38 | 22.5 MB | 未触发 | high |
| ×50 | **39.7 / 32.8** | 46.8 | **28** | 22.8 MB | **已触发** | **low** |

**结论**：

1. **H5 不是 CPU 瓶颈**：×6（已属低端安卓量级的 CPU 降速）仍稳 60fps；直到 ×20 才见回落（最低 20.8，但未持续 3s，故未降级），×50 才崩到 39.7。
2. **自动降级链路首次被实证可用**（此前 H5 从未触发过）：×50 出现 `[S8] 连续 3000ms fps 低于目标 80% → 自动降级 quality=low`，`finalQuality=low`，drawcall 峰 38→28；**降级后 fps 均值 39.7 / 最低 32.8，均 ≥30** —— 与 Task 4 Step 3 的「降级后 fps ≥30」判据一致。
3. **对真机的指向**：真机若 <30fps，更可能来自**移动 GPU / 内存带宽 / 触屏输入**而非 CPU，处置仍按 §3 风险 #6 顺序（开关项 → 图集 → 阈值调参）；图集是否启动仍待真机数据决定。

样本：`docs/perf-sample.md` 的 `s9-lowend-proxy-6x` / `s9-lowend-proxy-20x` / `s9-lowend-proxy-50x`。

#### 7.4.5 手机触控通道（本轮补入 —— **A4 真机验收的硬前置**）

**发现的硬阻断（本轮）**：手机浏览器上**完全无法操作**。全客户端只有键盘输入 —— `PlayerControl` 只绑 `KEY_DOWN/KEY_UP`，`InteractController` 只在 `'f'` 键上派发交互，触屏一个字都不认。所以 §7.4.3 里「按 `ArrowRight/Down/Left/Up` 走一段」在真机上根本做不到，A4 的 F/M 两项（稳态 fps / 内存峰值）**必然测不出**（人只能站在原地）。

**补法（最小改动：只补输入通道，零逻辑分支）**：

| 文件 | 改动 |
|---|---|
| `src/config/AppConfig.ts` | 新增 `touch` 常量块（zOrder 9998、摇杆激活区 256×400 / 半径 88 / 摇杆头 36 / 死区 0.28、交互按钮 88px、半透明配色）—— 初版为 3×3 网格 8 向方向键，2026-09-24 改为浮动摇杆（见 §7.4.7 第 3 条） |
| `src/world/PlayerControl.ts` | 新增 `press(key)` / `release(key)`：把**与键盘同名**的 `'w'/'a'/'s'/'d'` 注入既有 `pressed` 集合，之后完全复用 `onFrame` 的位移与 10Hz 上报（原 `releaseAll()` 已删，见 §7.4.7 第 3 条「差量注入」） |
| `src/world/InteractController.ts` | `F` 键分支抽成 `public async triggerInteract()`，键盘路径改为委托它（行为逐字不变） |
| `src/ui/TouchControls.ts`（新增） | 引擎内自绘（同 `Hud` 范式，不引 DOM/`laya.ui`）：左下**浮动虚拟摇杆**（激活区内按下 → 底座落在按下点）+ 右下「交互」按钮；**仅触摸设备显示**；抬手由 激活区 `MOUSE_DRAG_END` + `MOUSE_DRAG` + **舞台级** `MOUSE_UP` 三路收口、按 `touchId` 过滤（见 §7.4.7 第 3 条） |
| `src/boot/Main.ts` | 进场景装配 ⑧a 处接线 `TouchControls.attach(playerControl, interactControl)` |

**范围（用户 2026-09-24 决策）**：只做**走动 + 交互**；建造（`B` 键与面板内 `Q/E/Enter/G/Del`）本期不做。

**e2e 取证（Playwright 移动端模拟 + CDP `Input.dispatchTouchEvent`，本机 5173/3000/6379 + 本机 PostgreSQL 16，**已跑通 15/15 PASS**）**：

- 触摸设备识别 → `[S9] 触控层就绪：浮动摇杆（激活区 256×400，半径 88）+ 交互按钮`；PC（无触摸）→ `非触摸设备：不启用触控层`（触控层不渲染）。
- **真实位移**（取 WS 上行报文，比截图硬）：摇杆按住「右」1s，`world.move` 帧 `x: 648 → 908`（≈240px/s 与 `moveSpeedPxPerMs=0.24` 一致；2026-09-24 摇杆版为 8.7–9.4 次/秒）；抬手后 `upPerSec` 回到 **0** 且不再有新位置帧。
- **交互与键盘同源**：走回 `plant_01`（`(560,480)`，物件半径 70）→ 点「交互」→ 命中 `POST /api/client/v1/world/objects/1/interact`（`before=3 → after=4`）。
- 回归：S3/S4/S5/S6/S7/S8 六个零依赖冒烟全绿（16/18/27/50/102/146 项）。

**仍未做**：真机（含 iOS Safari）上的触控手感验收。**⚠️ 2026-09-24 更正**：本行原写「Laya 默认 `multiTouchEnabled=false`，同屏只能按一个按钮」是**错的** —— 引擎 `laya.core.js:25963` 显式 `InputManager.multiTouchEnabled = true`，多点触控默认开启，故「摇杆按住 + 同屏点交互」本身可行；摇杆另按 `touchId` 过滤（只认按下摇杆的那根手指），避免交互按钮抬手时把摇杆一起停掉。

**发布记录（2026-09-24 已完成）**：摇杆版触控**已发布**到线上 `game.joho.cn/client/`（原「发布前置」已解除）——真机验收直接开 `https://game.joho.cn/client/` 即可，无需 LAN 通道（§7.4.6 保留作离线验收备用）。

- **装配**（cwd `packages-game/game-client`，服务器零构建）：`node tools/build-fallback.mjs`（42 个产物重写导入扩展名）→ `node tools/inject-env.mjs --env prod`（`apiBase=https://game.joho.cn` / `wsUrl=wss://game.joho.cn/game`）→ `node tools/publish.mjs h5-site` → **97 文件**（js 60 / libs 5 / vendor 1 / assets 28 / gamedata 2 / index.html）；index.html 前缀改写与 env-config 顺序自校验通过、gamedata sha256 校验通过。
- **上传**：本机 `tar.gz` 1,138,086B，sha256 `7709176d…` 经 `scp` 后服务器比对一致 → 解包到 `client.new` 后**换目录**（非覆盖解包，杜绝残留旧文件）→ `chmod -R u=rwX,go=rX`。
- **备份（回退用）**：`client.bak_touch_20260924_230714`（发布前 **96 文件 / 2,953,242B**，即 Task 3 美术版现状）；回退 = `mv client client.failed && mv client.bak_touch_20260924_230714 client`。
- **验证**：站点目录 **97 文件 / 2,967,970B**；`index.html` 线上 md5 **`5a20bce8020ec25cf8e0464c018f1a79`** 与本机逐字节一致；服务器侧 `Host: game.joho.cn` 下 `/client/index.html`、`/client/js/ui/TouchControls.js`、`/client/js/boot/Main.js`、`/client/js/env-config.js`、`/client/assets/resources/bg_scene1.png`、`/gamedata/manifest.json`、`/health` **全 200**；线上 `TouchControls.js` 含 `s9-stick-zone` 且 `AppConfig.js` 为 `stickZoneWidth: 256`（收窄版）；本机 `curl --resolve game.joho.cn:443:39.106.99.9 https://game.joho.cn/client/index.html` → **200 且 `ssl_verify_result=0`**（公共 CA 链合法，与 Task 1 结论一致）。
- **口径提示**：本次发布用的是**工作区当前 `src/`**（含 `Entity.ts` / `spawn-merge.ts` 等**未提交**改动），与已提交 HEAD（`9d2097fd4`）存在差异 —— 若要「线上产物 = 某次 commit 可字节级重现」，需先处置这几个未提交文件再重发。

**S9 第二轮修复（2026-09-24，真机实测「建造面板仍点不动」）**

- **上一轮结论被真机推翻**：§7.4.7 第 3 条的 BuildPanel 修复（删根节点遮罩）只验证了「空白处按下 → 选格」，**从未测「点面板里的行」，也从未真机验证** → 真机上依旧点不动。根因与遮罩无关，是两条叠加：
  1. **绑的是 `CLICK`**：引擎 `InputManager.clickTestThreshold = 10`（**舞台像素**），而实测手机 390 CSS px 宽时 `SCALE_SHOWALL` 缩放比仅 **0.406** → 10 舞台像素 ≈ **4 CSS px**；真机手指按下时轻滚超过 4 CSS px 即被 `TouchInfo.move()` 置 `clickCancelled=true`，`clickTest()` 返回 null，**CLICK 根本不派发**。反证：同口径早已改成 `MOUSE_DOWN` 的摇杆 / 交互按钮一直正常。
  2. **命中的行带太矮**：建造面板蓝图行高 **20** 舞台像素（≈8.1 CSS px）、对话选项行 `optionHeight=22`（≈8.9 CSS px），远小于手指落点误差 → 常按到相邻的**信息行**（那些行有意不可点），表现就是「点了没反应」。
- **改法（视觉零变化：只放大看不见的命中区 + 换事件口径）**：

| 文件 | 改动 |
|---|---|
| `src/config/AppConfig.ts` | `touch` 段新增 `minHitHeight: 44`（**舞台像素**，≈18 CSS px，与 88 的交互按钮同量级）：所有「点一下就有反应」的行把**命中区**撑到至少 44，**视觉一律不动** |
| `src/world/BuildPanel.ts` | ① `Laya.stage` 的 `CLICK` → **`MOUSE_DOWN`**（`onStageClick` → `onStageDown`），并加 `fromTouchLayer(e)` 守卫（沿 `e.target` 的父链找 `s9-touch`：摇杆 / 交互按钮上的按下不移动建造光标）；② `rebuild()` 改为「行带预排（`RowHit`）→ 绘制（视觉节点一律 `mouseEnabled=false`）→ `addRowHit()`」；③ 新增 `addRowHit()`：以行带为中心向上下扩到 44，**边界夹在面板内框与相邻可点行的分界**（相邻两行都可点 → 只能各吃半个行距） |
| `src/ui/DialogueView.ts` | 同源隐患一并修（用户 2026-09-24 选定范围 = BuildPanel + DialogueView，不含 LoginView）：选项行 `CLICK` → `MOUSE_DOWN`，命中区扩到 `max(行带, 44)`、上下界夹在相邻选项行分界中点；底色与文字仍画在行带上（用 `row.y - top` 补偿）→ **视觉零变化** |

- **取证（CDP `Input.dispatchTouchEvent`，移动模拟 390×844，实测 scale=0.406）**：蓝图行「手指不动」→ `mouseDown=1 / click=1`；蓝图行「按下后位移 10 CSS px」→ **`mouseDown=1 / click=0`**（旧 `CLICK` 会漏掉的那一下，正是真机的手感）；信息行按下**不响应且不移动光标**；地图空白处按下 → 选址光标移动；摇杆区按下 → 光标不动且摇杆底座出现。命中区实测：`s6-build-hit` 高度 **20 → 32/35**（可加高的行）；**相邻两行都可点时保持 20**（投料行 26 与相邻蓝图行 20，物理上无法各自到 44）。对话选项行命中区 **24/26/26/24**（≈9.7–10.6 CSS px），「按下后位移 10 CSS px」→ fire 且 `click=0`。
- **回归**：`node tools/build-fallback.mjs` 通过（42 个产物）；S3/S4/S5/S6/S7/S8 六个零依赖冒烟全绿（16/18/27/50/102/146）。
- **提交**：`ee6b1fea8`「fix(game-client): 建造面板与对话选项改 MOUSE_DOWN + 命中区加高，修真机点不动（S9）」，**仅 3 文件**（`src/config/AppConfig.ts`、`src/world/BuildPanel.ts`、`src/ui/DialogueView.ts`），3 files changed / 139 insertions(+) / 28 deletions(-)。
- **发布记录（第二轮，2026-09-24）**：同链路 `build-fallback` → `inject-env --env prod` → `publish h5-site` → **97 文件 / 2,880,884B**；`tar.gz` 1,141,393B，sha256 **`e9d411e9677ce4425e536204116140867db0f15cd4859201c9e5ef9232a9a1fd`**（服务器 `sha256sum` 比对一致）；解到 `client.new` 后**换目录**（`before: 97 / new: 97 / after: 97`），`chmod -R u=rwX,go=rX`。**备份（回退用）**：`client.bak_touch2_20260924_234148`（发布前的上一版 = 97 文件 / 2,967,970B），回退 = `mv client client.failed && mv client.bak_touch2_20260924_234148 client`。
- **验证（第二轮）**：本机 ⇄ 服务器 md5 双向一致 —— `index.html` **`acc04c8ed250a6d12d5c5a0d35c84a20`**、`js/world/BuildPanel.js` **`6ec7788aca4171d1ac10f34cbc74233e`**（含 marker `s6-build-hit`）、`js/ui/DialogueView.js` **`a941f5f00241da807d6b1fe37830c433`**（含 3 处 `MOUSE_DOWN`）；`env-config.js` 为 prod；公网 `https://game.joho.cn/client/index.html` 与 `.../js/world/BuildPanel.js` 均 **200** 且含 marker。
- **本次口径已收敛**：提交与发布同源（发布用的 `src/` 即 `ee6b1fea8` 的内容），上一轮「线上产物 ≠ HEAD」的差异已消除。
- **仍未做**：**真机复验**（需用户手测）；`LoginView` 的 `CLICK`（提交按钮 @273 / 输入框 @303）为同类隐患但本次按用户决策未修。

#### 7.4.6 真机验收的 LAN 通道（2026-09-24 用户选择「先不发布」；**当晚已发布，本节降为备用通道**）

不发布也能真机验收，前提是让手机直连开发机：

| 环节 | 做法 |
|---|---|
| 入口页 | `game-client/bin/lan.html`（**gitignored 构建目录**，非源码；`serve.mjs` 直接可服）——在引擎脚本后注入 `window.__ENV__ = { apiBase: 'http://192.168.1.2:3000', wsUrl: '…/game' }`（机制见 `Platform.ts` `envValue`）。`bin/index.html` 不注入，故本机 localhost 流程与 `perf-sample.mjs` 不受影响 |
| 后端 | 本机起 `mock-redis`(6379) + `node dist/src/main.js`(3000)，并把 LAN 源加入白名单：`CORS_ORIGINS=…,http://192.168.1.2:5173,http://192.168.1.2:3000`（否则前端登录/接口全被 CORS 拦） |
| 静态 | `node tools/serve.mjs`(5173，绑 `::` 双栈，LAN 可达) |
| 手机 URL | `http://192.168.1.2:5173/lan.html`（同一 WiFi；开发机 LAN IP 用 `Get-NetIPAddress` 查） |
| ⚠️ 防火墙 | 本机三个 Profile 均 `Enabled=True / DefaultInboundAction=NotConfigured`，且**没有 `node.exe` 入站允许规则** → 手机大概率连不上。需**管理员** PowerShell 放行：`New-NetFirewallRule -DisplayName "lan-game" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000,5173 -Profile Any` |

**LAN 源预检（本机以 `http://192.168.1.2:5173/lan.html` 为源跑同一套触控 e2e）：10/10 PASS**

- `__ENV__` 注入生效 → 跨源登录 + 进场景成功（CORS 放行 LAN 源）→ 触控层启用；**全程无控制台错误、无失败请求**（CORS / ws / 静态资源都干净）。
- 触控位移与上报同 localhost：按住「右」`world.move` 帧 `x: 644 → 952`，`upPerSec` 0 → 6 → 9，抬手回 0。
- 触控几何：根节点 9 个子节点 = 8 向 + 交互，交互按钮 `88×88 @ (848,512)`。**⚠️ 2026-09-24 更正**：这是**方向键版（8 向 pad）**的几何，摇杆重写后已作废 —— 摇杆版根节点只有 **3 个子节点**（`s9-stick-zone` 激活区 + `s9-stick-base` 底座 + 交互按钮），交互按钮 `88×88 @ (848,512)` 不变；现行几何见 §7.4.5。
- 触控点按「交互」→ 命中 `POST /api/client/v1/world/npcs/13/talk` 并弹出对话。

**两条与验收有关的实测结论（不是 bug，记录以免误判）**

1. **交互目标由「就近 + priority」裁决，NPC 会抢走物件**：站在 `chest_01 (420,600)` 旁边时选中的是同样在附近的 `npc:13`（货郎），于是发的是 `talk` 而非 `collect`。真机验收要测「采集」得挑没有 NPC 抢的物件。**⚠️ 2026-09-24 更正**：这里原先举的 `plant_01 (560,480)` **也不安全**（货郎会巡逻过来抢，§7.4.7 实测）；目前已知的稳妥点是 **`stone_01 (720,400)`**（最近 NPC smith 距 122px）。
2. **「该 NPC 暂不可对话」是契约内的正常出口**：`InteractComponent` 规定「未实现类型 / 不可手动激活的触发器 / Quest 注册位」`canInteract()=true` 但 `interact()` **只 toast、不发请求**。所以「点交互没看到请求」不等于触控坏了——**同位置键盘 F 也是同样 toast**（本轮已用此差分证明触控与键盘行为一致）。

**手机端读数（A4 的 F/M）怎么办**：手机无键盘，`F3` 调不出面板。安卓可 USB + PC Chrome `chrome://inspect` → Console 执行 `__PERF__.panel(true)`；iOS 无此路。若不便接线，则 F/M 采用 §7.4.4 的 CPU 限速代理样本（已在 `docs/perf-sample.md`），真机只做**功能与手感**验收。

#### 7.4.7 移动端模拟验收（**非真机**，2026-09-24 用户决策「先不发布，跑完可自动化的部分」；**当晚已发布**，见 §7.4.5 发布记录）

**口径声明（必读）**：本节数据来自 Chromium 移动端模拟（移动 UA + DPR 1.75 + `isMobile/hasTouch` + 视口 915×412 横屏 + CDP 真实触摸事件），**不是真机**：不反映移动 GPU / 内存带宽 / 机型差异，也**不参与 A4 判定**（§1.2 / §7.4.3 的真机表仍为「待填」）。它的用途是：① 补上「触控通路」的端到端取证；② 把 §7.4.3 里**可自动化**的部分（T1/T2/T3、F/M、D、切档）先跑出基线，真机只需换设备复测；③ 沉淀可复跑的脚本。

**工具**：`scripts/accept-mobile.mjs`（零依赖，仅可选 playwright；同 `perf-sample.mjs` 一样从 `e:\code\node_modules` 解析）

```bash
node scripts/accept-mobile.mjs --label mobile-sim --map-localhost-ipv4                       # 标准轮
node scripts/accept-mobile.mjs --label mobile-sim-throttle50 --cpu-throttle 50 --map-localhost-ipv4  # 自动降级
node scripts/accept-mobile.mjs --label mobile-sim-quality-low --quality low --map-localhost-ipv4     # 手动切档
```

产物：`docs/perf-shots/<label>.png`（移动视口截图）+ `docs/perf-shots/<label>.json`（逐秒样本与全部取证字段）。

**实测（场景 1，固定路线 → ↓ ← ↑ →，移动 10s + 静止 10s）**：

| 轮次 | 限速 / 档位 | T1(s) | T2(s) | T3(s) | fps 均值 / 最低 | drawcall 峰 | heap 峰 | 静止后 heap | 触发降级 | 结束档位 | 交互取证 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `mobile-sim` | 不限速 / 平台默认 | 0.40 | 0.33 | **0.73** | **59.8 / 58.0** | 38 | 16.8 MB | **15.2 MB（回落）** | 未触发 | high | `201 POST …/world/objects/2/interact` |
| `mobile-sim-throttle50` | **×50** / 平台默认 | 2.07 | 2.26 | 4.33 | 56.2 / **39.4** | **29** | 16.1 MB | 15.3 MB（回落） | **已触发** | **low** | `201 POST …/world/npcs/12/talk` |
| `mobile-sim-quality-low` | 不限速 / **`?quality=low`** | 0.41 | 0.33 | 0.74 | 60.0 / 60.0 | **29** | 16.0 MB | 16.0 MB（5s/5s 短采样，不作回落结论） | 未触发（强制低档） | **low** | `201 POST …/world/objects/2/interact` |

**触控通路取证（每轮均成立）**：

| 项 | 实测 |
|---|---|
| 触控层启用 | `[S9] 触控层就绪`；摇杆激活区 `256×400`（舞台 `(0,240)`）+ 底座/摇杆头（按下才显示）+ 交互按钮 `88×88`（舞台 `(848,512)`）—— 2026-09-24 摇杆版 |
| 触摸送达 | `touchDelivered=1`（CDP 触摸 → 舞台 `MOUSE_DOWN` 计数 +1，**证明点按真的到达**，非「以为点了」） |
| 按住能走 | 移动段上行 **9.0–9.4 次/秒**（键盘基线 9.5，`world.move` 帧 `x: 644 → 676 → …`） |
| 松手能停 | 静止段上行合计 **0**（抬手即停，舞台级 `MOUSE_UP` 兜底有效） |
| 交互命中 | HUD 选中 `object:2`（stone_01）→ 点「交互」→ HUD `采集成功，获得 8 gold` + `201 POST …/objects/2/interact` |
| 无副作用 | `pageerror=0`、失败请求 `=0`、CORS 干净（全程无控制台报错） |

**自动降级（D 项）实证**：×50 下出现 `[S8] 连续 3000ms fps 低于目标 80% → 自动降级 quality=low`，`finalQuality=low`，drawcall 峰 38 → **29**，**降级后最低 fps 39.4 ≥ 30** —— 与 §7.4.4 桌面口径一致，且本轮是**在移动端模拟 + 真实触摸输入**下复现的。

**本轮发现（第 1 条已修复并验证）**：

1. **对话打开后触控失效 → 已修复**：交互成功（如 `talk`）会打开 `DialogueView`（zOrder 10000），其根节点被显式 `mouseEnabled = true` 且 `size(960,640)` 铺满舞台；而 Laya 命中检测（`getSpriteUnderPoint` → `hitTest`）会把「有 bounds + 显式启用鼠标」的最上层节点直接判为命中目标 → 下层 `TouchControls`（zOrder 9998）收不到任何事件（实测：若把交互取证排在移动段之前，移动段 `upPerSec` 恒 0）。而 `InteractController.triggerInteract` 的注释明确写着「对话打开时屏蔽交互……**移动是 W/A/S/D，不受影响**」→ 结果变成「**对话打开时键盘能走、触控走不了**」，与设计意图相悖。
    - **修复**：删掉根节点的 `size(...)` 与三处 `mouseEnabled` 赋值（`src/ui/DialogueView.ts` 的 `init/open/close`）——根节点自身永不命中、触摸穿透到触控层，选项按钮（子节点，显式 `mouseEnabled=true`）照常吃点击。
    - **修复后实测**（移动端模拟 + 真实 CDP 触摸；站点 `(660,470)` → 铁匠 smith）：对话打开后按住方向键 → **26 帧上行 / 652px 位移**（修复前 0）；松手静置 1s → **0 帧**；点选项 → `POST …/world/dialogue/choose` **200**；`pageerror = 0`。
    - **连带修掉的布局冲突**：选项命中区原为 `x176..784`，把方向键右列（`↗/→/↘`，`x156..220`）整列压在下面——不只是「按不动」，**点它会误选对话选项**。故 `dialogue.panelMaxWidth` 640 → **448**（居中面板 x 256..704，让开左下方向键 x≤220 与右下交互按钮 x≥848；居中面板宽度上限 ≤496 属几何约束）。收窄后复测：两组几何不相交、按住 `→` → **23 帧 / 588px**、静置 0 帧、选项点击 200、文本无溢出（最大右边缘 524 < 面板右 704）。
2. **NPC 抢目标 + 巡逻**（复述 §7.4.6 结论并对脚本取点产生实际影响）：NPC 半径 90 > 物件 70，且 NPC 会巡逻移动 → 站点必须选「NPC 距离 > 90 且不易被巡逻覆盖」的点。本轮由 `plant_01 (560,480)`（被货郎抢走）改为 **`stone_01 (720,400)`**（最近 NPC smith 距 122px）后稳定命中物件。`npcs:3:1` / `npc:12` 这类选中是**契约内占位出口**（只 toast 不发请求），不是触控故障。另：村长 `npc:11` 无对话数据（`talk` 返回空 `options` + `dialogueId=null`，只走 greeting 兜底、不开视图），验对话请用铁匠 `npc:12`。

3. **8 向方向键 → 浮动虚拟摇杆；并修掉两处「面板根节点吃指针」（2026-09-24 用户决策，已修复并验证）**：
    - **动机**：第 1 条只修了 `DialogueView`，`BuildPanel` 是同一写法的第二处（`init/open/close` 里 `mouseEnabled` + `open()` 里 `size(960,640)`）→ 建造面板一打开，摇杆同样按不动；且 8 向 3×3 方向键在手机上按键面积小、手感差（用户要求改摇杆）。
    - **摇杆实现**（`src/ui/TouchControls.ts`）：左下角锚定一块**不可见但可命中**的激活区（`256×400`，`mouseEnabled=true`）接住按下 —— 这是必须的，因为引擎 `MOUSE_DRAG`/`MOUSE_DRAG_END` **只向「按下时命中的节点链」**（`TouchInfo.downTargets`）派发，空处按下连 `MOUSE_DOWN` 都收不到；按下后浮动底座落在按下点，拖动按方向钳制在半径 88 内并按 8 向离散注入 `'w'/'a'/'s'/'d'`（纯函数 `stickKeys`，阈值 sin22.5°=0.3827，死区 88×0.28≈24.6）；抬手由 激活区 `MOUSE_DRAG_END` + `MOUSE_DRAG` + 舞台 `MOUSE_UP` 三路收口，并按 `touchId` 过滤（只认按下摇杆的那根手指）。**差量注入**（只 press 新增 / release 失效）→ `PlayerControl.releaseAll()` 成为死代码已删除，且触控与键盘可并存。
    - **BuildPanel 修复**：删掉 `init()` 的 `mouseEnabled=false`、`open()` 的 `mouseEnabled=true` + `size(960,640)`、`close()` 的 `mouseEnabled=false` → 根节点自身永不命中（`hitTest` 是**纯几何**：只看自身 `width>0 && height>0`），行按钮作为子节点照常可点；点空白处仍**冒泡到 stage**，`onStageClick`（移动建造光标）不受影响（实测光标 `格(10,7) → 格(7,4)`、预览 bounds `(640,448)→(448,256)`）。
    - **连带修掉一个既有 bug**（与触控无关，本次一并修）：`B` 键打不开建造面板 —— `InteractController.onKeyDown` 与 `BuildPanel.onKeyDown` **都**监听 stage 的 `KEY_DOWN` 并各自 `toggle()`，一次按键「开+关」互相抵消。已删除 `InteractController` 里的 `KEY_BUILD` 分支（含随之无用的 `BuildPanel` import 与常量），建造键监听收敛到 `BuildPanel` 一处。实测：按 `b` → `s6-build-panel` 子节点 **0 → 18**，再按 `b` → **0**。
    - **激活区宽度 480 → 256（零重叠）**：初版激活区 `x 0..480` 与对话面板（`x 256..704`）重叠 224px，压在选项行上的按下会**误选对话选项**。取 `256` 后激活区右界与面板左缘**恰好贴齐**（`dialogue.panelMaxWidth=448` 的推导也正是这条：左缘 ≥ 256 → `w ≤ 448`；右缘 704 < 848 让开交互按钮）。实测：无面板/对话打开两种状态下，激活区 5 点 `(40,440)/(128,440)/(250,440)/(128,300)/(128,600)` 按下**全部起摇杆**、底座坐标逐点等于按下点、无一误选；底座圆覆盖舞台 `x 40..216`，与面板左缘 256 有 40px 间隙。
    - **摇杆版实测**（移动端模拟 + CDP `touchStart→touchMove→保持→touchEnd`，`accept-mobile.mjs` 已同步改为摇杆口径并刷新 `docs/perf-shots/mobile-sim.json`）：5 段路线 + 闭环走位共 8 次长按，每次 `base` 均为按下点 `(128,440)`、`knob` 偏移逐次为 `(±88,0)`/`(0,±88)`；移动段 **8.7 次/秒**、静止段 **0**；`59.88–60.01 fps` / drawcall 峰 **39** / heap 峰 16.7MB（静止回落 15.4）；`对 stone_01 交互 → 201`、`pageerror=0`。**建造面板打开时摇杆仍可用**（面板 18 子节点下按住 → `upPerSec=9`）、**对话打开时摇杆仍可用**（`upPerSec=9`）且选项点击 `200`。

4. **可点行「绑 CLICK + 行带太矮」导致真机点不动（2026-09-24 第二轮修复，已提交 `ee6b1fea8` 并发布）**：第 3 条只修了「根节点遮罩」，且当轮验证只覆盖「空白处按下选格」，**既没测面板内的行、也没真机验证** → 真机上手测「建造面板仍点不动」。与遮罩无关的两条根因、改法（`touch.minHitHeight=44` + `s6-build-hit` 命中区 + `CLICK`→`MOUSE_DOWN` + `fromTouchLayer` 守卫，BuildPanel/DialogueView 同批，**视觉零变化**）、CDP 取证与第二轮发布记录见 §7.4.5 末节。**教训**：① 触控验证必须**打在真实可点元素上**（空白处选格通过 ≠ 行按钮可用）；② 手机端可点元素一律 `MOUSE_DOWN`，不用 `CLICK`（`clickTestThreshold=10` 舞台像素 ≈ 手机 4 CSS px）。仍待**真机复验**。

**仍未做（需真机 / 人工）**：真机三档（低端安卓门槛档、中端安卓、iOS Safari）与手感验收、iOS 无法用 `chrome://inspect` 的目视口径。**⚠️ 更正（2026-09-24）**：原写「多点触控（Laya `multiTouchEnabled=false`，同屏只能按一个按钮）」不成立 —— 引擎 `laya.core.js:25963` 显式 `InputManager.multiTouchEnabled = true`，多点触控默认开启，「摇杆按住 + 同屏点交互」可行（摇杆另按 `touchId` 过滤，见第 3 条）。