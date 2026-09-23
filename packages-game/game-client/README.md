# game-client（江湖录 · 2D 客户端）

LayaAir 3.x 工程，零新增 npm 依赖：模板、引擎类型、运行时都从本机 IDE 安装目录与后端已有的依赖里复用。

## 目录约定

- `tools/assemble.mjs` —— 从 LayaAir IDE 安装目录装配工程壳（模板文件、引擎类型声明、vendored socket.io、工程描述文件）。默认 IDE 路径 `D:\Program Files\LayaAirIDE`，可用 `LAYA_IDE_DIR` 覆盖。
- `tools/build-cli.ps1` —— 尝试用 IDE 命令行构建（实证见下）。
- `tools/build-fallback.mjs` —— 不依赖 IDE 的兜底构建：借用 `../game-server/node_modules/typescript` 编译 `src/` 到 `bin/js`，重写产物导入扩展名，生成 `bin/js/player-config.js` 与 `bin/index.html`。
- `tools/serve.mjs` —— 零依赖静态服务器（默认 5173），把 `/assets`、`/vendor`、`/libs`、`/js`、`/` 映射到统一 URL 空间，并把 `/gamedata` 反向代理到后端（同源，规避静态响应无 CORS 头）。
- `tools/check-config.mjs` —— 校验服务端导出目录 `../game-server/gamedata` 的配置包与 manifest 的 hash 一致性。
- `docs/art-handover.md` —— 美术素材交接清单（目录/命名/尺寸/`@2x`/透明通道契约，S9 Task 3 Step 1）。

## S1 工具链实证

环境：LayaAir IDE **3.4.1**（`D:\Program Files\LayaAirIDE`），工程 `e:\code\nest\packages-game\game-client`。

### 1. IDE「打开项目」需要工程描述文件

IDE 靠工程根目录的 `<工程名>.laya`（内容仅 `{"version":"3.4.1"}`）识别工程根。该文件不在 IDE 模板里（是 IDE 新建项目时才生成的），因此 `tools/assemble.mjs` 已补上生成步骤，产物为 `game-client.laya`。

缺少它时，IDE 不把该目录当工程，只能走「新建项目」，而新建的默认落点取自 IDE 上次的 `newProjectPath`（当时即本工程目录），会在工程内生成一个多余的示例工程。

### 2. Web 发布产物落点是 `release/web/`，不是 `bin/`

GUI「文件 → 构建/发布」执行 Web 目标后：

- 发布产物：`release/web/`（`index.html`、`libs/`、`js/bundle.js`、`js/index.js`、`resources/`、`internal/UI/`、`Scene.ls`、`fileconfig.json`）
- 编译中间产物：`bin/js/bundles/bundle.js(.map)`
- **没有** `bin/index.html`；`bin/` 不产出可运行的入口页

### 3. IDE 命令行构建入口：实测失败

命令：

```
powershell -ExecutionPolicy Bypass -File tools\build-cli.ps1
```

即 `LayaAirIDE.exe --project=<工程目录> --script=Build.buildWeb`。

原始报错：

```
login failed Error: Interactive account login is unavailable in CLI mode.
unknown script 'Build.buildWeb'
exit=
```

结论：未产出任何文件（`release/web/index.html` 与 `bin/js/bundles/*` 时间戳均未变化）。

补充事实（扫描 `resources/app.asar` 得到，用于判断这是"版本不支持"还是"未配置"）：

- 机制**存在**：`window.rendererInfo.cliScriptFiles` 驱动 `codeBuilder.buildCliBundle()`，按列表逐个 `readFileSync` 并解析脚本；`IEditorEnv.BuildTask`（导出名 `BuildTask`）与 `StartBuildTask` IPC 均在。
- `unknown script '<name>'` 来自 `EditorEnv.extensionManager.findFunction(name)` 返回空，即脚本未被注册进该列表。
- 本机 `cliScriptFiles` 未配置：`%APPDATA%\LayaAirIDE\Preferences.json`、`appconfig.json` 与工程 `local/workspace.json` 中均无此项。IDE 设置里的对应配置项本次未定位到。

即：失败原因是脚本未注册到 IDE 的 `cliScriptFiles`，而**非**该版本不支持；注册后能否成功**未验证**。按 S1 计划的 30 分钟投入上限，此处停止投入，改用兜底构建。

### 4. 兜底构建（实际采用）

```
node tools/build-fallback.mjs
```

借用后端已有的 typescript 编译 `src/` 到 `bin/js/`，并把 `bin/index.html` 作为 H5 入口页。这是 S1 的构建与验收路径，不依赖 IDE。

### 5. 兜底构建必须自行补齐「发布期契约」

IDE 发布出的 `release/web/` 是可直接运行的参照，它比 `bin/` 多做了两件由发布器完成的事，缺任一项都会让 `Laya.init` 失败：

**(1) 引擎脚本集**

2D 客户端只需三个脚本，顺序固定：

```
laya.core.js → laya.webgl_2D.js → laya.ui2.js
```

- `createEngine` 定义在 `laya.webgl_2D.js`（由 `addBeforeInitCallback` 注册 `LayaGL.renderDeviceFactory`），缺它即 `TypeError: Cannot read properties of undefined (reading 'createEngine')`。
- `laya.d3.js` 会让 core 的 init 多跑一步 `Laya3D.__init__()`，2D 不需要，故不加载。
- 自检信号：`Laya.Laya._beforeInitCallbacks.length === 3`（三库各自注册的回调数）。

**(2) 发布期 PlayerConfig**

IDE 的 `release/web/js/index.js` 会 `Object.assign(Laya.PlayerConfig, config)`（config 由工程设置生成）。兜底构建因此需要在 init 前自行注入等价内容（`bin/js/player-config.js`），否则：

- 缺 `PlayerConfig.UI.alwaysIncludeDefaultSkin` → ui2 的 `UIPackage._init` 直接 `TypeError: Cannot read properties of undefined (reading 'alwaysIncludeDefaultSkin')`。
- 若把皮肤路径（`popupMenu`/`tooltipsWidget`/`horizontalScrollBar`/`verticalScrollBar`）写进 `UIConfig2`，`_init` 会去 `URL.basePath`（本工程为 `/assets/`）加载这些 `.lh`；本工程不提供它们，404 后加载 promise 永不 resolve，表现为 `Laya.init` **静默挂起**（页面无报错、stage 保持默认 `bgColor=gray`/`scaleMode=noscale`）。ui2 自身默认即 `null`，故不放皮肤路径。

另：`tools/serve.mjs` 的 `/libs/` 直接指向 IDE 安装目录的 `resources/engine/libs`（未压缩版，与发布版行为一致）；引擎脚本 URL 带 `?v=<构建时间戳>` 以击穿浏览器缓存。

## S1 验收结论（2026-09-21）

环境：后端 `:3000`（依赖 `scripts/mock-redis.js` 的 `:6379`）、H5 静态服务 `:5173`、LayaAir IDE 3.4.1、Chrome。

| # | 验收项 | 判定 | 证据 |
|---|---|---|---|
| 1 | 命令行产出 H5 产物并在浏览器打开 | PASS | `node tools/build-fallback.mjs` 生成 `bin/index.html`；`http://localhost:5173/` 渲染成功（canvas 出图） |
| 2 | 登录拿到 token | PASS | 页面控制台 `[S1] 登录成功 playerId=1 token=eyJhbGciOiJIUzI1…`（登录走 `POST /api/client/v1/auth/login`） |
| 3 | 配置包加载并渲染地形 + 静态物件 | PASS | `[S1] 配置包哈希校验通过 scene-1-v1.json`、`[S1] 静态层渲染完成：地形 1280x960，物件 10，NPC 3，触发器 2，出生点 (640,480)` |
| 4 | 进场景拿到 `{scene, spawns, triggers}` 并生成实体 | PASS | `[S1] 进场景应答 cmd=world.enter_scene_sync scene=新手村（Spike） 服务端 spawns=13 triggers=2`、`[S1] 服务端 spawns=13，去重忽略=13…接受动态=0`、`[S1] 本地玩家 player:1 出生于 (640,480)` |
| 5 | NPC 位置与配置一致 | PASS | 实体层 dump 出 13 个实体（10 物件 + 3 NPC），与配置包逐一比对**不一致 0 个**：`NPC11=(600,380)`、`NPC12=(700,520)`、`NPC13=(500,560)`，物件 `物1=(560,480)` … `物9=(760,820)` |
| 6 | 1 次采集 + 1 次 NPC 对话 | PASS | `[S1] 对话返回 {"spawnId":"12","name":"spike-铁匠","talkType":"talk","text":"铁匠：要打铁，先得有矿。","options":[]}`；`[S1] 采集返回 {"ok":true,"reward":{"currencyType":"gold","amount":3}}` |
| 7 | 双窗口互见移动 | PASS | 浏览器实体层出现 `玩家3` 且坐标随广播变化（584→633→591），且仅一个 `我(1)`（自身广播被正确忽略）；反向 Node 第二客户端记录 `P2 SAW player:1 pos=(796,480)` |
| 8 | 小游戏端（**降级口径**） | BLOCKED | 见下「#8 未完成项」：IDE 命令行导出不可行，需人工 GUI 导出 |
| 9 | 后端回归全绿、旧契约零改动 | PASS | `npm test` → `Test Suites: 80 passed`、`Tests: 998 passed`；`git diff bbe550903 -- …/world.client.controller.ts` 仅**新增** `npcs/:spawnId/talk`；`…/gateway/game.gateway.ts` 1 处 diff 为计划已记录的「实测偏离③」（先落身份再 `await validateToken` 的握手时序修复），无既有消息契约变更 |

### 冒烟脚本

```
cd packages-game/game-server && node scripts/smoke-laya2d-s1.mjs
```

实测输出（9/9 PASS）：

```
PASS 后端 /health 可达
PASS 配置包含静态物件与 NPC :: 物件=10 NPC=3 触发器=2
PASS HTTP 登录拿到 token/playerId :: A=1 B=3
PASS world.enter-scene 应答 world.enter_scene_sync :: cmd=world.enter_scene_sync code=0
PASS 进场景返回 scene/spawns/triggers :: spawns=13 triggers=2
PASS 触发器按场景过滤未串场（总数等于配置包 triggers） :: 服务端=2 配置包=2
PASS B 端收到 A 的 world.entity_update 广播 :: entityId=player:1 pos={"x":700,"y":500}
PASS 物件采集接口返回 code=0 :: templateId=1 type=collect → {"code":0,…"amount":3}
PASS NPC 对话接口返回非空文案 :: spawnId=11 → text=村长：远来的客人，先四处看看吧。
S1 冒烟全部通过
```

### #8 未完成项（小游戏端，待人工 GUI）

已落地的小游戏端适配：`Platform.readLocalText()`（`wx.getFileSystemManager().readFileSync`）+ `ConfigLoader.readText()` 小游戏分支（读包内 `config/*.json` 而非 `fetch`），H5 路径回归通过。

阻塞点：**IDE 命令行无法导出 wxgame**。原始输出（`LayaAirIDE.exe --project=… --script=Build.buildWxgame`）：

```
login failed Error: Interactive account login is unavailable in CLI mode.
unknown script 'Build.buildWxgame'
```

`release/` 下仅有 GUI 手动构建出来的 `web/`，无 `wxgame/`；`local/buildLogs/` 也只有 `web-*.log`。CLI 模式要求交互式账号登录，故 `--script` 机制在本机不可用（与「工具链实证 3」同因）。

待人工执行（完成后即可按降级口径把 #8 判为 PASS）：

1. IDE 打开工程 `packages-game/game-client` → 「构建/发布」选「微信小游戏」执行，记录实际产物目录（预期 `release/wxgame`）；
2. `Copy-Item -Recurse -Force ..\game-server\gamedata (Join-Path (Resolve-Path .\release\wxgame).Path 'config')`；
3. 微信开发者工具导入产物根目录（AppID 用测试号），本地设置勾选「不校验合法域名…」；
4. Console 执行 `wx.request({ url: 'http://localhost:3000/health', success: (r) => console.log('health', r.statusCode, r.data) })`，预期 `health 200`。

小游戏端**不覆盖**多人/WS/完整闭环（WS 适配属 S7）。

### 执行中发现的两处计划缺陷（已在代码中修正）

1. Laya 的 `Laya.Event.KEY_DOWN/KEY_UP` 事件对象**不带 `keyCode`**，只通过 `get key()` 代理原生 `key` 字符串 → `PlayerControl`/`InteractController` 改用归一化小写 `e.key`（`'w'/'a'/'s'/'d'/'f'/'arrowleft'…`）判定按键，否则按键恒无效。
2. 冒烟脚本原稿的 WS 收发方式与真实契约不符：服务端用 `@SubscribeMessage(cmd)` 订阅，**事件名即 cmd**，handler 直接 `return` 的值走 **socket.io ack 回调**（不是 `message` 事件）→ 已按 `src/net/ws.ts` 的 `send()` 改为 `emit(cmd, payload, ack)`。

> 另注：本机浏览器窗口不可合成（`requestAnimationFrame` 近乎停摆，`Laya.timer.currFrame` 恒 0），键盘真实按键（WASD/F）未在真实 rAF 下验证，是改用页面内 `Laya.timer._update(...)` 强制走帧验证的（对应验收 #7 与交互逻辑）；此项属环境限制，非功能缺陷。