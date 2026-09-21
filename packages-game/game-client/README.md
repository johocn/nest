# game-client（江湖录 · 2D 客户端）

LayaAir 3.x 工程，零新增 npm 依赖：模板、引擎类型、运行时都从本机 IDE 安装目录与后端已有的依赖里复用。

## 目录约定

- `tools/assemble.mjs` —— 从 LayaAir IDE 安装目录装配工程壳（模板文件、引擎类型声明、vendored socket.io、工程描述文件）。默认 IDE 路径 `D:\Program Files\LayaAirIDE`，可用 `LAYA_IDE_DIR` 覆盖。
- `tools/build-cli.ps1` —— 尝试用 IDE 命令行构建（实证见下）。
- `tools/build-fallback.mjs` —— 不依赖 IDE 的兜底构建：借用 `../game-server/node_modules/typescript` 编译 `src/` 到 `bin/js`，重写产物导入扩展名，生成 `bin/js/player-config.js` 与 `bin/index.html`。
- `tools/serve.mjs` —— 零依赖静态服务器（默认 5173），把 `/config`、`/assets`、`/vendor`、`/libs`、`/js`、`/` 映射到统一 URL 空间。
- `tools/check-config.mjs` —— 校验 `assets/config` 配置包与 manifest 的 hash 一致性。

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