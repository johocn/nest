# game-client（江湖录 · 2D 客户端）

LayaAir 3.x 工程，零新增 npm 依赖：模板、引擎类型、运行时都从本机 IDE 安装目录与后端已有的依赖里复用。

## 目录约定

- `tools/assemble.mjs` —— 从 LayaAir IDE 安装目录装配工程壳（模板文件、引擎类型声明、vendored socket.io、工程描述文件）。默认 IDE 路径 `D:\Program Files\LayaAirIDE`，可用 `LAYA_IDE_DIR` 覆盖。
- `tools/build-cli.ps1` —— 尝试用 IDE 命令行构建（实证见下）。
- `tools/build-fallback.mjs` —— 不依赖 IDE 的兜底构建：借用 `../game-server/node_modules/typescript` 编译 `src/` 到 `bin/js`，重写产物导入扩展名，生成 `bin/index.html`。
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