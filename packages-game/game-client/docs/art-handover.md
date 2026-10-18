# 美术素材交接清单（S9 Task 3 · Step 1）

> **本步只定义契约，不实现。** 素材入库（Step 2）、接入贴图（Step 3）、图集导出（Step 4）为后续步骤。
> 依赖顺序：**本清单未确认 → 不入库**；未入库 → 不接入；未接入 → 不做图集。

## 1. 交付范围

| 项 | 内容 |
|---|---|
| 本步交付物 | 目录契约、命名契约、尺寸清单、`@2x`/透明通道约定、验收方式 |
| 本步不做 | 放入任何 PNG；手工创建/复制任何 `.meta`；改代码；跑构建 |
| 后续步骤 | Step 2 入库（IDE 生成 `.meta`）→ Step 3 接入原始素材并量基线 → Step 4 图集导出与清单校验 |
| 依赖顺序 | 本表未确认即不得开始 Step 2 |

## 2. 目录与文件命名契约

**落盘目录** `assets/resources/**`；`assets/resources/atlas/**` 预留给 Step 4 图集产物（本步不创建）。

**硬规则**：所有 `*.png.meta` 必须与 LayaAir IDE 导入产物**同格式**（`{"uuid":"<v4>","importer":{"textureType":2,"sRGB":true,"generateMipmap":true}}`，无 BOM、无尾随换行），**禁止出现缺失 `.meta` 的 PNG** —— 手工塞文件会导致 `.meta` 缺失、发布产物丢资源（计划 §3 风险 5）。
既有旁证：`assets/resources/placeholder.png.meta`（140B，格式如 `{"uuid":"c95ef96a-…","importer":{"textureType":2,"sRGB":true,"generateMipmap":true}}`）。
**实际落地方式（2026-09-24 变更，用户已批准）**：Step 2 素材入库**不走 IDE 逐个导入**，改由 `tools/gen-art.ps1` 程序化生成 PNG **并同时写出同格式 `.meta`**（零新依赖：仅用 Windows 自带 `System.Drawing`）。IDE 导入路径保留给后续美术真稿替换，替换时同样必须带 `.meta`。

**命名规则**：**按 `resKey` 落盘**，即 `resources/<resKey>.png`（`resKey` 原文即相对路径，可含斜杠子目录）；全小写、仅 `[a-z0-9_/]`、不含中文/空格/大写/版本后缀。

**待回填**：图集页文件名与配套文件后缀（`.atlas` / `.json` / `.png` 等实际产物形态）**待 Step 4 实测 IDE 导出结果后回填**，本节不猜。

```
assets/
  Scene.ls(.meta)                   # 既有 IDE 场景文件
  resources/
    placeholder.png(.meta)          # 既有 S1 占位贴图（缺图回退用，非业务素材）
    bg_scene1.png(.meta)            # 静态分层背景（§3.1，`bg_scene<sceneId>`）
    player_default.png(.meta)       # 实体：玩家（§3.2；玩家无 resKey 来源，暂定）
    npc/elder_01.png(.meta)         # 实体：NPC（§3.2，按 resKey 原文落盘）
    npc_smith_01.png(.meta)         #   注意：种子里的 resKey 原文即 `npc_smith_01`（无斜杠），照抄
    npc/peddler_01.png(.meta)
    obj/plant_01.png(.meta)         # 实体：物件（§3.2）
    obj/stone_01.png(.meta)
    obj/chest_01.png(.meta)
    obj/landmark_01.png(.meta)
    building/wooden_house.png(.meta)   # 实体：建筑（§3.2，蓝图 resKey）
    building/stone_wall.png(.meta)
    building/town_hall.png(.meta)
    ui/icon_talk.png(.meta)         # UI 图标（§3.3，待确认）
    atlas/                          # ← Step 4 图集产物目录，本步不创建
      （命名待 Step 4 回填）
```

## 3. 交付清单

### 3.1 静态分层背景

场景清单以 `game-server/gamedata/manifest.json` 的 `scenes[]` 为准：当前仅登记 **1 个场景**（`sceneId=1`，`file=scene-1-v1.json`）。
> 备注：`gamedata/` 下另有 `scene-1-v2/v3/v4.json` 三个文件**未被 manifest 引用**，本期不作为交付依据；manifest 增补后按同样规则补行。

| 用途 | 建议文件名 | 逻辑尺寸（代码出处） | @1x | @2x | 透明通道 | 备注 |
|---|---|---|---|---|---|---|
| 场景 1 地块底图（sceneId=1，`mapWidth×mapHeight` = 1280×960） | `bg_scene1.png`（落盘 `resources/bg_scene1.png`，按 `bg_scene<sceneId>`） | 1280×960 —— `src/world/SceneBuilder.ts:95-96`（命中 `drawTexture(0, 0, mapWidth, mapHeight)` / 未命中 `drawRect(0, 0, …)`）；尺寸来源 `gamedata/scene-1-v1.json` 的 `scene.mapWidth/mapHeight` | 1280×960 | 2560×1920 | **不透明 RGB** | 与逻辑坐标 **1:1**，左上角对齐世界原点 (0,0)，无偏移、无居中；覆盖整张地图，故无 alpha 需求；`resKey` 由 `SceneBuilder.bgResKey`（:80）生成 |
| 网格线 | 不交付 | 间隔 100px / 线宽 1px —— `src/config/AppConfig.ts:261-262`（`gridInterval`/`gridLineWidth`） | — | — | — | 引擎 `drawLine` 绘制，且属质量档开关（`shouldDrawGrid`），贴图化会改变切档语义 |
| 触发区描边 | 不交付 | 线宽 2px —— `src/config/AppConfig.ts:264-265`（`triggerOutlineColor`/`triggerOutlineWidth`） | — | — | — | 引擎 `drawRect` 无填充描边，属质量档开关（`shouldDrawTriggerOutline`） |

背景层整体在 `src/world/SceneBuilder.ts:43` 以 `cacheAs='bitmap'` 合图缓存；替换贴图后该缓存刷新路径不变（Step 3 已完成接入：命中铺贴图、未命中回退底色）。

### 3.2 实体（玩家 · NPC · 物件）

统一规则（`src/entity/components/VisualComponent.ts:111-120`）：`size = kind === 'player' ? 36 : 32`，底色矩形与贴图都画在 `(-size/2, -size, size, size)` —— 即**原点在贴图底部中心（脚底中心）**，与后端 `spawn_x/spawn_y` 直接对齐（`src/entity/Entity.ts:39`、`src/entity/components/TransformComponent.ts:4`）。
**建筑例外**：`kind === 'building'` 时尺寸 = 占地格 `footprint × 64`（`VisualComponent.ts:112-114`），底色矩形与贴图同尺寸。

| 用途 | 建议文件名 | 逻辑尺寸（代码出处） | @1x | @2x | 透明通道 | 备注 |
|---|---|---|---|---|---|---|
| 玩家（本地/远端） | `player_default.png`（玩家无 resKey 来源，已按 `EntityFactory.PLAYER_RES_KEY` 常量接入，本地/远端同一张） | **36×36** —— `VisualComponent.ts:111`（`kind==='player'`） | 36×36 | 72×72 | PNG-32（RGBA） | 朝向：`TransformComponent` 支持 `rotation`（:29-31）但 `VisualComponent` 不写旋转，当前**无朝向贴图**；是否需要 4/8 向（`player_default_up.png` 等）**待主程确认** |
| NPC（固定 NPC） | `npc/elder_01.png`、`npc_smith_01.png`、`npc/peddler_01.png` | **32×32** —— `VisualComponent.ts:111` | 32×32 | 64×64 | PNG-32（RGBA） | 按 `resKey` 原文落盘（`npc_smith_01` 原文无斜杠，照抄）：标识取自 `gamedata/scene-1-v1.json` `fixedNpcs[].resKey`：`npc/elder_01`（spawnId 11）、`npc_smith_01`（12）、`npc/peddler_01`（13） |
| NPC（动态/怪物） | 命名待确认 | **32×32** 同上 | 32×32 | 64×64 | PNG-32（RGBA） | 怪物走 `kind` 映射为 `npc`（`src/entity/EntityFactory.ts:130`），故与 NPC 同尺寸；配置包 `resKey` 未在本仓库提供 → 命名与套数**待主程确认** |
| 静态物件 | `obj/plant_01.png`、`obj/stone_01.png`、`obj/chest_01.png`、`obj/landmark_01.png` | **32×32** 同上 | 32×32 | 64×64 | PNG-32（RGBA） | 按 `resKey` 原文落盘：标识取自 `scene-1-v1.json` `staticEntities[].resKey`：`obj/plant_01`、`obj/stone_01`、`obj/chest_01`、`obj/landmark_01`（各模板在场景内复用多次） |
| 建筑（木屋/石墙/议事厅） | `building/wooden_house.png`、`building/stone_wall.png`、`building/town_hall.png` | 贴图尺寸 = **占地格 × 64**：木屋 2×2=128、石墙 1×1=64、议事厅 3×3=192（`src/world/build-logic.ts:22` `DEFAULT_GRID_SIZE=64`；`src/entity/components/VisualComponent.ts:112-114`；`game-server/seeds/building.seed.ts:29/41/53` 的蓝图 `resKey`） | 待确认 | 待确认 | PNG-32（RGBA） | **已确认（主程拍板）**：建筑按占地 `footprint × 64` 绘制，底色矩形/贴图同尺寸，进度条与耐久锚点随新高度上移；玩家 36 / NPC·物件 32 不变。**resKey 已接入**：由蓝图 `BuildingTemplate.resKey` 经 `build-logic.toBuildingSpawn` → `EntityFactory.createFromBuilding` 透传（不改 WS 契约，用的是既有 HTTP 蓝图接口字段） |
| 进度条 / 耐久文本 / 名字标签 / 任务标记 / 高亮光圈 | 不交付 | 进度条 48×6、y 随建筑高度上移（`AppConfig.ts:143-145` 基准 `-42`，画在世界空间 `src/entity/components/BuildComponent.ts:135-141`）；耐久 fontSize 11（`BuildComponent.ts:152`）；名字标签 fontSize 12（`VisualComponent.ts:123`）；任务标记 fontSize 18 / y=-50（`src/entity/Entity.ts:16,126`）；高亮光圈 r=22 / 线宽 2（`AppConfig.ts:72,74`） | — | — | — | 全部为引擎内 `graphics`/`Text` 绘制，本期不贴图化 |

### 3.3 UI 与图标

现状：UI 全部引擎内自绘（`Laya.Sprite` + `graphics` + `Text`），**当前无任何图标素材**，且面板尺寸由文本测量推导。

| 用途 | 建议文件名 | 逻辑尺寸（代码出处） | @1x | @2x | 透明通道 | 备注 |
|---|---|---|---|---|---|---|
| HUD toast / hint 底框 | 不交付 | 无固定尺寸：宽高 = 文本测量 + 内边距（`src/ui/Hud.ts:67-81`：`textWidth/textHeight` + `toastPadX/toastPadY`）；hint 宽 = `min(640, stageWidth-48)`、高按行数（`Hud.ts:104-120`） | — | — | — | 尺寸随文案变化 → **以代码为准待主程确认**是否九宫格贴图化 |
| 对话框面板 | 不交付 | 宽 `min(panelMaxWidth 448, stageWidth-80)`，高按内容行数推导 —— `src/ui/DialogueView.ts:165-181`、`AppConfig.ts:92`（448 由触控层几何定：面板左缘 256 贴齐摇杆激活区右界 x=256，右缘 704 让开交互按钮 x848..936） | — | — | — | 同上，无固定像素尺寸 |
| 建造面板底框 | 不交付 | 宽 320、高按行数推导（`AppConfig.ts:118`；`src/world/BuildPanel.ts:474-481`） | — | — | — | 同上 |
| 登录页面板 | 不交付 | 宽 `min(420, …)`、高按字段布局推导（`AppConfig.ts:163`；`src/ui/login-logic.ts` 的 `loginLayout`） | — | — | — | 同上 |
| 交互图标（对话/采集等） | `ui/icon_talk.png`（暂定，无 `resKey` 来源） | **当前无实现**：交互仅键盘 `F` + 脚底光圈提示，无图标节点 | 待确认 | 待确认 | PNG-32（RGBA） | 无现有代码依据 → 图标清单与尺寸**待主程确认** |

## 4. `@2x` 与透明通道约定

| 项 | 约定 |
|---|---|
| 交付倍率 | 一律交付 **@2x**（= §3 中 @1x 逻辑尺寸 ×2） |
| 落地方式 | 运行时按目标逻辑尺寸**显式缩放**（`Sprite.scaleX/scaleY`），**不依赖引擎自动识别 `@2x` 后缀**：现有贴图路径由 `VisualComponent.ts:84` `drawTexture(texture, -size/2, -size, size, size)` 显式指定绘制宽高，代码中无 `@2x` 后缀解析逻辑 |
| 回填条款 | 若 Step 2 入库实测 IDE/引擎**确有**自动 `@2x` 机制，以实测为准，并回填本表 |
| @1x 是否随包 | 默认**仅交付 @2x**；@1x 由美术另存备用，不入库 |
| 背景透明通道 | 分层背景用**不透明 PNG（RGB）**，减包体 |
| 实体/图标透明通道 | 一律 **PNG-32（RGBA）**；四周不得留白色描边或半透明脏边（预乘 alpha 污染会出白边）；必须独立透明背景，**不得与背景合图** |

## 5. 验收与校验方式（契约，本步不实现）

| 环节 | 校验手段 | 判定 |
|---|---|---|
| 命名/清单一致性 | Step 2 新增 `scripts/smoke-s9-atlas.mjs`（纯逻辑断言，零依赖） | 按本表逐行比对文件名与目录 |
| 图集产物一致性 | Step 4 新增 `tools/atlas-manifest.mjs` | 清单与 `assets/resources/atlas/**` 实际产物一致 |
| 发布产物资源存在性 | Task 5 新增 `tools/check-package.mjs` | 发布目录内贴图存在（对应 §3 风险 5） |

**本表即断言依据**：后续脚本按 §3 逐行校验文件名/目录；脚本当前均不存在，属 Step 2/4 与 Task 5 的实现范围。

## 6. 交付形式与验收动作

| 项 | 内容 |
|---|---|
| 美术交付形式 | 目录压缩包，目录层级与本表 §2 的树一致（`resources/` 下的相对路径即最终落盘路径） |
| 接收方验收入口 | Step 2：IDE 逐个导入 → `git status` 中应出现对应 `*.png.meta` |
| 验收判定 | **缺失 `.meta` = 未验收**（不得手工补 `.meta`） |

## 7. 明确不覆盖

1. 不做动效（序列帧 / 逐帧动画）；`anim: "idle"` 等字段本期无贴图实现。
2. 不做字体（全部 `Laya.Text` 用系统默认字体）。
3. 不做音效。
4. 不做合并图集前的压缩 / 格式转换（WebP 等需另议，会引入转换工具，违反「不新增依赖」）。

## 8. 交付记录（2026-09-24）

**生成方式**：`tools/gen-art.ps1`（一条命令产全部素材，零新依赖）——仅用 Windows 自带 .NET `System.Drawing`（GDI+），**程序化矢量绘制**：精确像素尺寸、真 alpha（32bppArgb）、统一治愈系国风低饱和调色板、确定性伪随机（LCG 种子 20260924，同参数可复现）。脚本按 §2 命名规则**原文落盘**，并在同一路径写出**同格式 `.meta`**（140B、UTF-8 无 BOM、无尾随换行；`[guid]::NewGuid()` 生成 v4 uuid），视同 IDE 导入产物。

**AI 通道不可用的替代决策**：原计划背景 `bg_scene1` 走 AI 文生图（`text_to_image` 接口），**实测该通道被鉴权拦截**（无鉴权返回 `default.jpeg` 占位图「The image is generating...」；另一 hash 为带水印测试图）。故背景一并改为程序化生成（`Draw-Bg`，底草 + 色斑 + 边缘压暗 + 村中广场 + 双条土路 + 左下池塘 + 零散花草），保证 12 张素材风格统一、尺寸精确、无外部依赖。

**实测产物**（`assets/resources/**`，均为 PNG）：

| 文件 | 尺寸 | 字节 | 备注 |
|---|---|---|---|
| `bg_scene1.png` | 2560×1920 | 491,786 | 不透明 RGB；`Draw-Bg` + `ScaleTransform(2,2)` |
| `player_default.png` | 72×72 | 3,018 | 玩家 @2x（逻辑 36） |
| `npc/elder_01.png` | 64×64 | 2,908 | NPC @2x（逻辑 32） |
| `npc_smith_01.png` | 64×64 | 2,986 | 照抄 resKey 原文（无斜杠） |
| `npc/peddler_01.png` | 64×64 | 2,428 | |
| `obj/plant_01.png` | 64×64 | 2,181 | |
| `obj/stone_01.png` | 64×64 | 1,546 | |
| `obj/chest_01.png` | 64×64 | 924 | |
| `obj/landmark_01.png` | 64×64 | 1,052 | |
| `building/stone_wall.png` | 64×64 | 501 | 占地 1×1 |
| `building/wooden_house.png` | 128×128 | 2,849 | 占地 2×2 |
| `building/town_hall.png` | 192×192 | 3,828 | 占地 3×3 |

实体 11 张合计约 21 KB；背景 480.3 KB。全部尺寸与 §3 的 @2x 列**逐行一致**。

**接入状态**：§3 全部 resKey 已离线（玩家走 `EntityFactory.PLAYER_RES_KEY`、建筑走蓝图 `BuildingTemplate.resKey` 透传，背景走 `SceneBuilder.bgResKey`）；缺图仍静默回退 `placeholder.png`，不阻塞启动。

**验证**：`tsc --noEmit` 通过；六个冒烟（s3/s4/s5/s6/s8/platform-s7）全绿；`publish.mjs h5-site` 装配产物含 12 PNG + 12 `.meta`；生产站 `https://game.joho.cn/assets/resources/**` 线上 HEAD 全 200。

**仍未安装**：`ui/icon_talk.png`（§3.3 当前无实现，无 `resKey` 来源）、图集产物（§4 Step 4，本批未做）。