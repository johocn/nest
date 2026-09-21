# LayaAir 2D 客户端 S3（实体实例化与交互组件化）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 S1 的「一张 Entity 贴图对象 + 一个 if/else 交互控制器」正式化为**组件装配的实体模型**与**可扩展的交互组件体系**，并把 UI 从 H5 DOM 迁到**引擎内自绘**（双端一致），使 S4/S5/S6 的 NPC 行为、剧情、建造都能以「加一个组件」的方式接入。

**Architecture:** `Entity` 从「构造即贴图」改为**组件容器**（`Entity + Component[]`，组件只管自己的数据与行为，渲染/空间/交互各自独立）；交互统一走 `InteractComponent` 契约（`kind` / `canInteract` / `interact` / `priority`），`InteractController` 退化为「就近选中 + 派发给选中组件」；UI 统一走引擎内 `Hud`（`Laya.Sprite`/`Text` 自绘），DOM 只保留在 `platform/` 的 H5 分支里。

**Tech Stack:** LayaAir 3.4（`laya.core.js` + `laya.ui2.js`）、TypeScript 5.7（复用 `game-server/node_modules` 的 tsc，**零新增依赖**）、NestJS 11 后端（S3 **不改后端**）。

---

## 0. 执行前必读（硬约束）

1. **不准碰 vendure**；任何命令不得进入 vendure / vcash 目录。
2. **零新增依赖**：不装 npm 包（含单测框架，见 §4 待确认项）。
3. **S3 不改后端**：8 类交互组件中后端没有链路的，**不新增接口**（那是 S5/S6 的事）；本批只做能落地的组件 + 其余组件的注册位。
4. **不做碰撞**：地形/建筑阻挡需要地形与美术确定后另批（届时 schemaVersion 升 2）。
5. **不做对象池/阴影/合批**：同屏无压力时池的收益极低，留 S8。
6. **规划阶段可提问，执行阶段不要反复问**；与 §1.2 事实冲突时按事实修正并在 commit message 写明。
7. 单次提交聚焦一个任务，遵守 commitlint。

**依赖前提**：S1（已完成）、**S2（配置管线）与 S2b（GM 场景与实体配置面板）已执行完**——S3 的验收需要能用面板/CLI 造出配置数据。

---

## 1. 设计

### 1.1 缺口盘点（本批要动的东西）

| # | 缺口 | 现状 | S3 处置 |
|---|---|---|---|
| 1 | Entity 是「贴图 + 名字」的哑对象 | [Entity.ts:7-54](file:///e:/code/nest/packages-game/game-client/src/entity/Entity.ts#L7-L54) 构造里直接 `drawRect`/`drawTexture`，能力写死在构造函数 | 改为组件容器：`Entity`（身份 + 组件表 + 生命周期）+ `VisualComponent`/`TransformComponent`/`InteractComponent` |
| 2 | EntityFactory 直接 new Entity 并传颜色/贴图 | [EntityFactory.ts:24-99](file:///e:/code/nest/packages-game/game-client/src/entity/EntityFactory.ts#L24-L99) 5 个 create 方法各自拼参数 | 改为「声明组件清单 → 装配」，新增 `building` kind 占位（S6 用） |
| 3 | 交互是 if/else | [InteractController.ts:60-76](file:///e:/code/nest/packages-game/game-client/src/world/InteractController.ts#L60-L76) 只有 `npc` / `object` 两个分支 | 改为按 `InteractComponent.kind` 派发；新增 `priority` 选中规则 |
| 4 | 无选中态表现 | 只有 `Toast.info('按 F 交互：对象')` | 引擎内自绘：选中目标描边/光圈 + 底部交互提示条 |
| 5 | UI 依赖 DOM | [Platform.ts:40-57](file:///e:/code/nest/packages-game/game-client/src/platform/Platform.ts#L40-L57) 创建 `#s1-toast` 并改 `textContent`；小游戏端直接不显示 | 新增 `Hud`（引擎内自绘），Toast 走 Hud；DOM 分支只留给 H5 |
| 6 | 8 类交互组件只落地 0 类（散在 if/else 里） | — | 落地 5 类（见 §1.3 D3）+ 3 类注册位 |
| 7 | 客户端无任何自动化测试 | S1 靠浏览器点检 | 本批决策是否引入（§4 待确认项 1），默认「零依赖断言脚本」 |

### 1.2 已核实的事实（实现时不要再猜）

**客户端现状**
- `EntityRegistry`：`add/remove/get/all/upsert`；`upsert` 已能按 `entityId` 更新或创建（[EntityRegistry.ts:4-33](file:///e:/code/nest/packages-game/game-client/src/entity/EntityRegistry.ts#L4-L33)）。
- `SceneBuilder`：`create`（地形/触发器区域）→ `addEntity`（幂等挂载）→ `mergeServerSpawns`（按 spawnId 去重，配置包优先，`entity_type='object'` 忽略）→ `resort`（按 y 排序 zOrder）（[SceneBuilder.ts:6-89](file:///e:/code/nest/packages-game/game-client/src/world/SceneBuilder.ts#L6-L89)）。
- `Main.ts`：登录 → 进场景 → 合并 spawns → 建本地玩家 → 订阅 `world.entity_update` → 挂 `InteractController` → 每 10 帧 `resort()`（[Main.ts:29-90](file:///e:/code/nest/packages-game/game-client/src/boot/Main.ts#L29-L90)）。
- 实体坐标约定：**原点在脚底中心**，贴图画在 `(x-16, y-32)`，与后端 `spawn_x/spawn_y` 直接对齐，**不做换算**（[Entity.ts:4-5](file:///e:/code/nest/packages-game/game-client/src/entity/Entity.ts#L4-L5)）。
- Laya 按键事件：`Laya.Event.KEY_DOWN` 不带 `keyCode`，只有归一化小写 `e.key`（S1 实测结论，[InteractController.ts:9](file:///e:/code/nest/packages-game/game-client/src/world/InteractController.ts#L9)）。
- 当前交互半径 `AppConfig.interactRadius = 120`；`Toast.info/error` 是唯一提示出口。

**后端交互链路（S3 只能复用这些，不得新增）**
- 前缀 `api/client/v1/world`，全量 `@UseGuards(JwtAuthGuard)`（[world.client.controller.ts:22-23](file:///e:/code/nest/packages-game/game-server/src/modules/world/world.client.controller.ts#L22-L23)）。
- 现有路由（逐条）：`POST objects/:id/interact`（**入参是 `object_templates.id`，不是 spawn id**）、`POST npcs/:spawnId/talk`（入参是 `scene_entity_spawns.id`）、`POST triggers/:id/activate`（**仅 `PUZZLE/GATE/TRAP` 允许**）、`POST mounts/equip`、`POST mounts/ride`、`POST games/start|bet|finish`、`POST landmarks/:id/message`、`GET landmarks/:id/messages`。
- `InteractType` 全值（[enums.ts:245-256](file:///e:/code/nest/packages-game/game-server/src/constants/enums.ts#L245-L256)）：`collect/hide/camp/sit/lie/carve/read/mount/fish/play`。
- `NpcInteractType`：`talk/shop/quest/transport`；`ObjectType`：`chest/collect/stone/plant/landmark`；`TriggerType`：`transport/story/battle/activity/puzzle/gate/trap`。
- 信封：`GameException` 一律 **HTTP 200 + body `{code,msg,data}`**，客户端必须判 `body.code !== 0`。
- ⚠️ 本地 `scripts/mock-redis.js` 的 `SET NX` **恒返回 OK** → 冷却/一次性校验在本地永远放行；组件里的冷却倒计时显示**不能用它验证**。

**S1 遗留的、S3 必须接住的**
- `Entity.interactType` 字段（string）是 S1 从配置包 `interact.type` 直接塞进 Entity 的 → S3 改由 `InteractComponent.kind` 承载，**字段删除**。
- `InteractController.nearest()` 现在跳过 `kind === 'player'` 并取最近一个 → S3 保持「跳过玩家」，但改为「按 `priority` 再按距离」选。

### 1.3 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **Entity = 身份 + 组件表**：`Entity` 只保留 `entityId/kind/spawnId/templateId/x/y` 与 `components: Map<string, Component>`，渲染/空间/交互全下沉到组件 | 组件化是 S4/S5/S6 的公共底座；Entity 保持薄 |
| D2 | **组件挂载走显式清单**：`EntityFactory` 返回「组件清单」而非拼参数，`Entity.attach()` 逐个挂 | 配置只声明装哪些组件（总纲 §7），不在工厂里写行为 |
| D3 | **本批落地 5 类交互组件**：`Collect`（collect/fish/stone/plant）、`Container`（chest）、`Read`（read）、`Talk`（npc talk）、`Trigger`（puzzle/gate/trap）；**Mount** 复用 `mounts/equip|ride` 做「挂载上马」最小实现；**Quest** 只做注册位（任务系统属 S5）；**其余**（sit/lie/hide/camp/carve）**只注册不实现**（后端无链路，实现在 S5/S6） | 有链路才做，避免为凑「8 类」造无用代码 |
| D4 | **UI 全部引擎内自绘**，`Hud` 提供 `hint()` / `toast()` / `highlight(target)`；`platform/` 只保留 H5 特有能力的适配 | 小游戏无 DOM（总纲 §11.2），S7 不再重写 UI |
| D5 | **`InteractController` 退化为选择器**：只负责「找目标（priority→距离）→ 高亮 → 派发给组件的 `interact()`」，不含任何业务分支 | 新增交互类型 = 加一个组件文件，不改选择器 |
| D6 | **不做碰撞/对象池**（用户已确认） | 无同屏压力前收益低；碰撞需地形数据，另批 |
| D7 | **不改后端**（用户已确认） | S3 是客户端重构批次；缺链路的交互等 S5/S6 |

### 1.4 文件结构（S3 全部新增/修改）

| 路径（相对 `packages-game/game-client/`） | 动作 | 职责 |
|---|---|---|
| `src/entity/components/Component.ts` | 创建 | `Component` 基类：`owner`、`onAttach/onDetach`、（可选）`update(dt)` |
| `src/entity/components/VisualComponent.ts` | 创建 | `resKey`/贴图/缩放/名字标签/zOrder 排序键（承接现 Entity 构造里的绘制逻辑） |
| `src/entity/components/TransformComponent.ts` | 创建 | `x/y/rotation` 与 `distanceTo`/`moveTo` |
| `src/entity/components/interact/InteractComponent.ts` | 创建 | 契约：`kind`（`InteractType`）、`canInteract(ctx)`、`interact(ctx)`、`priority` |
| `src/entity/components/interact/{Collect,Container,Read,Talk,Trigger,Mount,Quest}Component.ts` | 创建 | 5 类实现 + Mount 最小实现 + Quest 注册位 |
| `src/entity/components/interact/registry.ts` | 创建 | `kind → 组件类` 映射（含未实现类型的占位与 `canInteract=false`） |
| `src/entity/Entity.ts` | 修改 | 改组件容器；删除 `interactType`/绘制逻辑；`x/y` 委托 TransformComponent |
| `src/entity/EntityFactory.ts` | 修改 | 5 个 create 方法改为返回组件清单；`EntityKind` 增加 `'building'` |
| `src/entity/EntityRegistry.ts` | 修改 | 补 `byKind(kind)` / `inRadius(x,y,r)` 查询（供选择器与后续 S4 用） |
| `src/ui/Hud.ts` | 创建 | 引擎内自绘：底部提示条、短提示（toast）、选中高亮圈 |
| `src/ui/Toast.ts` | 修改 | 改为委托 `Hud.toast()` |
| `src/platform/Platform.ts` | 修改 | 移除 `toast` 的 DOM 实现（或仅保留 H5 调试分支并默认关闭） |
| `src/world/InteractController.ts` | 重写 | 选择器 + 派发（D5） |
| `src/world/SceneBuilder.ts` | 修改 | 适配新的 Entity/组件装配（`addEntity`/`resort` 逻辑不变） |
| `src/boot/Main.ts` | 修改 | 装配入口适配 + Hud 初始化 |
| `src/config/AppConfig.ts` | 修改 | 新增 HUD/高亮相关常量（提示条位置、高亮半径、颜色） |
| `tools/check-config.mjs` | 不改 | — |
| `scripts/smoke-s3-components.mjs`（或复用 S1 冒烟扩展） | 创建 | S3 验收脚本（见 §1.5） |

### 1.5 验收映射（S3 完成定义 → 任务）

| # | S3 验收项 | 落点 | 判定方式 |
|---|---|---|---|
| A1 | 实体工厂产出组件装配体 | Task 1/2 | 控制台 dump 每个实体的组件清单（player/npc/object 三类各一），组件名与 §1.4 一致 |
| A2 | S1 闭环零回归 | Task 1/7 | 配置包渲染、进场景、NPC 坐标逐像素一致、双窗口互见、采集+对话全部复现 |
| A3 | 引擎内提示可用（无 DOM） | Task 3 | 页面无 `#s1-toast` 元素；提示条出现在 canvas 内；`Platform.isMiniGame()` 分支不依赖 DOM |
| A4 | 就近选中 + 高亮 | Task 4 | 靠近 NPC/物件时高亮圈出现且**只圈住一个**目标；离开半径后消失 |
| A5 | 按 kind 派发（新增组件不改选择器） | Task 4/5 | 采集/开箱/阅读/NPC 对话/触发器 5 条路径各自返回成功；`InteractController` 内**无** kind 的 if/else 业务分支 |
| A6 | 优先级与可达性 | Task 4 | 同屏两个可交互目标重叠时按 `priority` 选中；不可达（`canInteract=false`）目标不选中 |
| A7 | 未实现类型有明确出口 | Task 5 | 配置里出现 `sit/lie/hide/camp/carve` 时给出「暂不支持」提示，且不报错、不崩 |
| A8 | 零新增依赖 | Task 7 | `git diff` 无 `package.json` 依赖变更 |

### 1.6 测试基线

- **后端**：S3 不改后端 → `npm test` 必须保持全绿（基线 80 suites / 998 tests），无新增用例。
- **客户端**：默认**不引入单测框架**；核心纯逻辑（`priority` 选择、`registry` 映射、去重/装配）用 `node scripts/smoke-s3-components.mjs` 的断言覆盖（见 §4 待确认项 1）。
- **冒烟**：S1 冒烟 `scripts/smoke-laya2d-s1.mjs` 必须继续 9/9 PASS（S3 的硬性回归门禁）。

### 1.7 已知限制（S3 明确不覆盖）

1. **不做碰撞**：可穿过物件/NPC（用户已确认）。
2. **不做对象池/合批/阴影**：留 S8。
3. **Quest / sit / lie / hide / camp / carve 组件不实现行为**，仅注册位（后端无链路）。
4. **S5 的对话系统不接入**：`TalkComponent` 仍走 S1 的 `npcs/:spawnId/talk` 单轮文案，不做对话树。
5. **不做建造**：`building` kind 只占位（S6）。
6. **不引入资源图集/动画状态机**：`VisualComponent` 仍用占位素材。

---

## 2. Tasks

> cwd = `e:\code\nest\packages-game\game-client`（除另有说明）。每个 Task 结束都要跑一次「S1 冒烟 + 浏览器点检」再提交。

### Task 1: 组件基座 + Entity 改造

**Files:** 创建 `src/entity/components/{Component,VisualComponent,TransformComponent}.ts`；修改 `src/entity/Entity.ts`、`src/entity/EntityRegistry.ts`

- [x] **Step 1** 写 `Component` 基类：`owner: Entity | null`、`onAttach(owner)`、`onDetach()`、可选 `update(dtMs)`。
- [x] **Step 2** `VisualComponent`：承接现构造里的绘制（`drawRect` 底色 + 可选 `drawTexture` + 名字 `Laya.Text`），尺寸规则 `kind==='player'?36:32`，绘制偏移 `(-size/2, -size)`（**保持不变**，否则坐标全错）；暴露 `zOrderKey`。名字文本改用 `Laya.Text` 而非 DOM。
- [x] **Step 3** `TransformComponent`：`x/y/rotation` + `distanceTo(other)` + `moveTo(x,y)`（`Math.round` 保留）。
- [x] **Step 4** 改 `Entity`：构造参数缩为 `{entityId, kind, spawnId, templateId, displayName, x, y, color, texture}`（**对外签名不变，避免工厂大改**），内部 `attach(new TransformComponent(...))` + `attach(new VisualComponent(...))`；`x/y`/`distanceTo` 委托 TransformComponent；**删除 `interactType`**。
- [x] **Step 5** `EntityRegistry` 补 `byKind(kind)`、`inRadius(x,y,r): Entity[]`。
- [x] **Step 6** 构建 + 点检：`node tools/build-fallback.mjs` → 浏览器 `http://localhost:5173/` → Expected：`[S1] 静态层渲染完成…` 与 NPC 坐标与 S1 完全一致（逐像素）。
- [x] **Step 7** commit `refactor(game-client): Entity 改为组件容器（Transform/Visual 组件）`

### Task 2: EntityFactory 组件化

**Files:** 修改 `src/entity/EntityFactory.ts`、`src/types/laya.d.ts`（如需）

- [x] **Step 1** 5 个 create 方法（`createPlayer`/`createOtherPlayer`/`createFromStatic`/`createFromFixedNpc`/`createFromServerSpawn`）改为「构造 Entity + 显式挂载组件清单」，并给 object 类实体挂上对应的 `InteractComponent`（Task 5 之前先挂 `registry.resolve(kind)` 的占位，Task 5 接真实现）。
- [x] **Step 2** `EntityKind` 增加 `'building'`（仅类型占位，无实现）。
- [x] **Step 3** 控制台加一条装配日志：`[S3] 实体装配 entityId=… 组件=[Transform,Visual,Interact:collect]`。
- [x] **Step 4** 点检：三种 kind 各出现在日志里；S1 五项验收（#3/#4/#5/#6/#7）不复现回归。
- [x] **Step 5** commit `refactor(game-client): EntityFactory 改为组件清单装配`

### Task 3: 引擎内自绘 UI（Hud）

**Files:** 创建 `src/ui/Hud.ts`；修改 `src/ui/Toast.ts`、`src/platform/Platform.ts`、`src/boot/Main.ts`、`src/config/AppConfig.ts`

- [x] **Step 1** `Hud` 用 `Laya.Sprite`+`Laya.Text` 实现：`toast(msg, ms=2000)`（屏幕中上部，自动消失）、`hint(msg|null)`（底部固定提示条）、`highlight(entity|null)`（目标脚底画圆环/描边，随目标移动）。挂到 `Laya.stage` 固定层级（不随相机/世界层滚动）。
- [x] **Step 2** `Toast.info/error` 改为 `Hud.toast(msg)`；`Platform.toast` 的 DOM 实现**删除**（若需保留 H5 调试开关，默认关闭并在计划执行记录里说明）。
- [x] **Step 3** `AppConfig` 加 HUD 常量（提示条 y 偏移、toast 时长、高亮半径/颜色/线宽）。
- [x] **Step 4** 点检：`document.getElementById('s1-toast') === null`；采集/对话提示出现在 canvas 内；提示 2 秒后消失。
- [x] **Step 5** commit `feat(game-client): 引擎内自绘 Hud 替换 DOM 提示`

### Task 4: 选择器 + 高亮（InteractController 重写）

**Files:** 重写 `src/world/InteractController.ts`、新建 `src/entity/components/interact/InteractComponent.ts`、修改 `docs`? 无

- [x] **Step 1** 定义 `InteractComponent` 契约（与总纲 §8 对齐）：
```ts
export interface InteractContext { me: Entity; target: Entity; token: string; }
export abstract class InteractComponent extends Component {
  abstract readonly kind: InteractType;
  priority = 0;
  canInteract(ctx: InteractContext): boolean { return true; }
  abstract interact(ctx: InteractContext): Promise<void>;
}
```
- [x] **Step 2** 重写 `InteractController`：`pickTarget()` = 半径内（`AppConfig.interactRadius`）取 `kind!=='player'` 且 `canInteract()` 为真者 → 先比 `priority` 再比距离；每帧（`frameLoop(6)`）更新 `Hud.highlight(target)` 与 `Hud.hint('按 F 交互：<名字>')`；按 F 时 `component.interact(ctx)`，`busy` 互斥保留。
- [x] **Step 3** 单测式断言（纯逻辑，见 Task 6）：`pickTarget` 的优先级/距离规则用脚本断言（构造假实体）。
- [x] **Step 4** 点检：靠近两个目标时只高亮一个；距离外高亮消失；按 F 命中高亮目标。
- [x] **Step 5** commit `refactor(game-client): 交互改为组件派发 + 就近选中高亮`

### Task 5: 落地 5 类交互组件 + 未实现类型收口

**Files:** 创建 `src/entity/components/interact/{Collect,Container,Read,Talk,Trigger,Mount,Quest}Component.ts`、`registry.ts`；修改 `EntityFactory.ts`

- [x] **Step 1** `CollectComponent`（`collect|fish|stone|plant`）：`POST objects/:id/interact`，body `{interactType: kind}`，**传 `templateId`**；提示「获得 N gold」。
- [x] **Step 2** `ContainerComponent`（`chest`）：同上，提示含 `is_one_time` 语义（一次性箱开启后本地标记不可再交互，**不依赖 mock-redis 的冷却**）。
- [x] **Step 3** `ReadComponent`（`read`）：同上，展示返回文本（`Hud` 多行提示）。
- [x] **Step 4** `TalkComponent`（npc `talk`）：`POST npcs/:spawnId/talk`，`priority` 高于物件（人优先于物）。
- [x] **Step 5** `TriggerComponent`：`POST triggers/:id/activate`；**`transport` 类型不发请求**（后端仅允许 PUZZLE/GATE/TRAP），在 `canInteract` 里返回 false 并给出「该区域不可手动激活」提示（避免 4xx 噪音）。
- [x] **Step 6** `MountComponent`：`mounts/ride`（`equip` 作为可选前置，按后端 DTO 实测参数调整）。
- [x] **Step 7** `QuestComponent` 只做注册位：`canInteract` 返回 false + 提示「任务交互将在后续版本开放」。
- [x] **Step 8** `registry.ts`：`kind → 组件类`；未实现类型（`sit/lie/hide/camp/carve`）返回**占位组件**（`canInteract=false`，`interact()` 抛业务提示不抛异常）。
- [x] **Step 9** 点检：5 条路径各自成功（日志含返回体）；配置里手工塞一个 `interact.type='sit'` 的物件 → 走到跟前不高亮、按 F 提示「暂不支持」，**无报错**。
- [x] **Step 10** commit `feat(game-client): 落地 5 类交互组件与未实现类型收口`

### Task 6: 零依赖断言脚本（客户端核心逻辑）

**Files:** 创建 `scripts/smoke-s3-components.mjs`

- [x] **Step 1** 用 `node`（无框架）断言：`pickTarget` 优先级规则（3 例：人有物、两物不同 priority、超出半径）、`registry` 映射完整（覆盖 `InteractType` 全部 10 值，未实现的 5 个必须解析到占位）、`mergeServerSpawns` 去重规则（配置包优先 + `object` 忽略）。断言失败 `exit 1`。
- [x] **Step 2** 为避免依赖引擎，脚本通过**把纯逻辑抽到无 Laya 依赖的模块**（`src/entity/targeting.ts` 或 `registry.ts` 内的纯部分）来实现；**不得**为了测试引入 jsdom 或引擎 mock 框架。
- [x] **Step 3** 运行 `node scripts/smoke-s3-components.mjs` → Expected：全 PASS，退出码 0。
- [x] **Step 4** commit `test(game-client): S3 核心逻辑零依赖断言脚本`

### Task 7: 全量验收与回归

- [x] **Step 1** S1 冒烟：`cd ../game-server && node scripts/smoke-laya2d-s1.mjs` → Expected：9/9 PASS。
- [x] **Step 2** 后端回归：`npm test` → Expected：80 suites / 998 tests 全绿（S3 不改后端）。
- [x] **Step 3** 依赖自检：`git diff -- packages-game/game-client/package.json` → Expected：无 dependencies 变更。
- [x] **Step 4** 浏览器点检清单（逐条记录证据）：A1–A7 全部走一遍，输出贴进执行记录。
- [x] **Step 5** 双窗口互见复测（S1 #7 路径）→ Expected：仍只渲染一个「我」。
- [x] **Step 6** commit `docs(s3): S3 验收记录`

---

## 3. 风险与回退

| # | 风险 | 触发信号 | 回退动作 |
|---|---|---|---|
| 1 | 组件化让坐标偏移出错（原点/绘制偏移被改） | NPC 与配置包坐标不一致 | 逐像素比对 S1 结论；`VisualComponent` 的 `(-size/2,-size)` 与 `Math.round` **必须逐字保留** |
| 2 | 引擎内自绘 UI 在 `laya.core` 下缺 API（如 `fillText`/`Text` 需要 ui2） | 页面无提示 / 控制台报错 | 只用已验证 API（`Laya.Text`、`graphics.drawCircle`）；缺的 API 用 graphics 基元替代，**不引入 laya.ui 皮肤体系** |
| 3 | Hud 与世界层混在同一 Sprite，随相机滚动 | 提示条跑出屏幕 | Hud 挂 `Laya.stage` 顶层（与场景层平级），设 `zOrder` 最大 |
| 4 | `mounts/ride` 参数与 DTO 不符 | 400/422 | 用 Swagger（`/api/docs`）核对 DTO，按实际改组件；若链路不可用，Mount 降级为注册位并记录 |
| 5 | Trigger 的 transport 类型被误发请求 | 后端 4xx | 严格按 D3：`canInteract` 返回 false |
| 6 | 断言脚本为了测纯逻辑而牵连引擎导入 | `node` 报 `Laya is not defined` | 把纯逻辑模块与引擎代码物理分离（纯模块不 import Laya） |
| 7 | S1 回归失败 | 冒烟非 9/9 | 单任务回滚（每 Task 独立 commit），定位到具体 Task |

---

## 4. 待确认项（动手前请回答）

1. **客户端测试形态**：默认「零依赖 `node` 断言脚本只覆盖纯逻辑」（推荐，不新增依赖）；另一选项是引入 `vitest`/`jest` 做正式单测（总纲 §14 明确把该决策推迟到 S3，但要新增依赖 + 与"引擎不可在 node 跑"的现实冲突）。请确认选哪个。
2. **`Hud` 的实现深度**：只做「提示条 + toast + 高亮圈」（推荐，S3 够用）？还是要顺带做小地图/血条等常驻 HUD（属 S5+）。
3. **S1 的 `AppConfig.interactRadius`（120）**：是否按 S3 调整（例如人 90 / 物 70，避免"隔老远也能交互"）？确认后写进 `AppConfig`。
4. **本批是否需要生产部署**：S3 不改后端、只改客户端，是否要连同 S2 已上线的 `/gamedata` 一起部署 H5 产物到 game.joho.cn？（默认：跟随 S2 的部署节奏，本批只做本地验收。）

---

## 5. 执行方式（沿用 S2 的既定方式）

**Subagent-Driven**（与 S2 一致）：每个 Task 派全新 subagent，Task 之间做两阶段评审（先看 diff 是否符合计划，再看验收输出是否达标）；每个 Task 提交后跑一次 S1 冒烟作为回归门禁。

任务依赖：Task 1 → Task 2 → （Task 3 可与 Task 2 并行）→ Task 4 → Task 5 → Task 6 → Task 7。

---

## 执行记录（S3 验收）

> 执行时间：2026-09-22。环境：本机 PostgreSQL 16（`localhost:5432`，库 `game_server`）+ mock-redis（`:6379`）+ 后端 dev server（`:3000`，scene 1 published = **v1**）+ H5 静态服务 `tools/serve.mjs`（`:5173`，`/gamedata` 反代到 `:3000`）。浏览器自动化：Playwright headless（读控制台 / 递归遍历 Laya 舞台树 / 截图 / 模拟按键）。

### 各 Task 提交（本地主分支）

| Task | commit | message |
|---|---|---|
| Task 1 | `315973277` | refactor(game-client): Entity 改为组件容器（Transform/Visual 组件） |
| Task 2 | `7e4c51939` | refactor(game-client): EntityFactory 改为组件清单装配 |
| Task 3 | `0aca48b93` | feat(game-client): 引擎内自绘 Hud 替换 DOM 提示 |
| Task 4 | `1b75f92b6` | refactor(game-client): 交互改为组件派发 + 就近选中高亮 |
| Task 5 | `8d666fd95` | feat(game-client): 落地 5 类交互组件与未实现类型收口 |
| Task 6 | `becf0c4f4` | test(game-client): S3 核心逻辑零依赖断言脚本 |

### Step 1-3 门禁实测

| 项 | 命令 | 期望 | 实测 |
|---|---|---|---|
| S1 冒烟 | `game-server: node scripts/smoke-laya2d-s1.mjs` | 9/9 PASS | **9/9 PASS**（末行「S1 冒烟全部通过」） |
| 后端回归 | `game-server: npx jest --silent` | 全绿 | **Test Suites: 81 passed / 81；Tests: 1014 passed / 1014** |
| 客户端断言 | `game-client: node tools/build-fallback.mjs && node scripts/smoke-s3-components.mjs` | 16 项全 PASS，退出码 0 | **构建 OK（26 个产物重写导入扩展名）；16/16 PASS，退出码 0** |

> **基线修正**：§1.6 写的后端基线 80/998 已过时（S2 新增 `scene-config.service.spec.ts`），当前实际基线为 **81 suites / 1014 tests**。S3 不改后端，实测保持 81/1014，**未下降**。

### A1–A8 逐条结论与证据

| # | 验收项 | 结论 | 证据 |
|---|---|---|---|
| A1 | 实体工厂产出组件装配体 | **PASS** | 控制台 14 条 `[S3] 实体装配`：`player:1 组件=[TransformComponent,VisualComponent]`、`npc:11/12/13 组件=[TransformComponent,VisualComponent,TalkComponent]`、`object:1/2/5/6/9/10 → CollectComponent`、`object:3/7 → ContainerComponent`、`object:4/8 → ReadComponent`。三类 kind 齐全，组件名与 §1.4 一致 |
| A2 | S1 闭环零回归 | **PASS** | 配置包渲染（`[S1] 静态层渲染完成：地形 1280x960，物件 10，NPC 3，触发器 2`）；进场景 `spawns=13 triggers=2`、去重忽略 13、接受动态 0；**舞台树实测坐标与 `scene-1-v1.json` 逐像素一致**（物10/物6/物5/NPC11/物2/物7/物1/NPC12/NPC13/物3/物4/物8/物9 全中，玩家出生 (640,480)=`scene.entry`）；采集、对话均复现（见 A5） |
| A3 | 引擎内提示可用（无 DOM） | **PASS** | `document.getElementById('s1-toast') === null`；`Laya.stage` 下存在名为 `s3-hud` 的 HUD 根节点（zOrder=9999）；toast/hint 均为 `s3-hud` 下的 `Laya.Text`（实测读到「登录成功：playerId=1」「按 F 交互：…」），即**画在 canvas 内**，H5 与小游戏端同一实现（`Platform` 已无 toast DOM 分支） |
| A4 | 就近选中 + 高亮 | **PASS** | 站到物2 旁：提示条 `按 F 交互：object:2`，全场景**仅 1 个**实体带高亮子节点（`rings=["物2"]`）；移到 (200,200) 后提示消失、高亮数 0 |
| A5 | 按 kind 派发（5 条路径） | **部分 PASS**（4/5 实机成功 + 触发器代码级/注入验证，见下） | ① 采集：`object:2` → toast「采集成功，获得 8 gold」，日志 `采集返回 {"ok":true,"reward":{"currencyType":"gold","amount":8}}`；② 开箱：`object:7` → 「开启成功，获得 20 gold」，日志 `开启返回 {…"amount":20}`；③ 阅读：`object:4` → 提示条「已阅读（该物件暂无文本内容）」，日志 `阅读返回 {"ok":true}`；④ NPC 对话：`npc:11` → toast「spike-村长：村长：远来的客人，先四处看看吧。」，日志 `对话返回 {…"spawnId":"11"…}`。**代码级**：`src/world/InteractController.ts` 无任何 kind 的 if/else 业务分支——`pickAndHighlight()`（L40-47）与 `onKeyDown()`（L57-78）只调用 `pick()`（L49-51，委托纯模块 `entity/targeting.ts` 的 `pickTarget`）→ `Hud.highlight/hint` → `picked.component.interact(ctx)`；全类唯一的 kind 判断是 `radiusOf`（L54-55）`e.kind === 'npc'`，仅用于取半径，非业务派发 |
| A6 | 优先级与可达性 | **PASS** | 同屏重叠点 (620,340)：NPC11（半径 90 内）+ 物6（半径 70 内）同时可达，选中 `npc:11`（`TalkComponent.priority=10` > 物件 `0`），高亮仅 `NPC11`；可达性：一次性箱 `object:7` 开启后 `ContainerComponent.canInteract()` 返回 false → 提示条消失、高亮数 0（不再被选中） |
| A7 | 未实现类型有明确出口 | **PASS** | 见下方「A7 临时实验」：`sit` 可被选中、按 F 提示「暂不支持该交互：sit」，无报错、无崩溃（`pageerror` 为空） |
| A8 | 零新增依赖 | **PASS** | 见下方「依赖自检」 |

**A5 触发器路径说明（未在实机走通「成功」，如实记录）**：当前配置包与场景中**没有触发器实体**——`SceneBuilder.build` 只把 `cfg.triggers` 画成背景矩形（L23-25），不生成 `Entity`，`EntityFactory` 也无触发器装配入口；且已发布 v1 的两个触发器是 `transport`/`story`，后端只允许 `PUZZLE/GATE/TRAP` 手动激活。故：
- 注册表层面由 Task 6 断言脚本覆盖（`puzzle/gate/trap/transport/story/battle/activity → TriggerComponent`，16 项断言含此项）；
- 运行期用**动态注入**一个合成触发器实体（`object:999`，`TriggerComponent('puzzle', 1)`，置于 (1100,200)）验证派发链路：可被选中（提示条 `按 F 交互：object:999`）、按 F 正确派发到 `TriggerComponent.interact()` → 发起 `POST triggers/1/activate` → 后端按类型拒绝返回 `code=90003「该触发器非机关类型」`，前端 `Toast.error` 优雅处理（无 `pageerror`、不崩）。**「触发器成功激活」在本批数据下不可达，属遗留项。**

### A7 临时实验（已全部还原）

按计划口径，`sit` 只能靠「临时改产物 + 临时放宽校验」验证。实际做法（**未改任何客户端/后端源码**）：
1. 备份 `game-server/gamedata/{scene-1-v1.json,manifest.json}` 与构建产物 `game-client/bin/js/config/validate.js`；
2. 把 `scene-1-v1.json` 中 `spawnId=2` 的 `interact.type` 由 `collect` 改为 `sit`，重算并同步 `manifest.json` 的 `hash`（新值 `sha256:5212fbec…`）；直接放宽**构建产物** `bin/js/config/validate.js` 的 `INTERACT_TYPES = ['collect','read','sit']`（改产物而非源码，避免触碰被冻结的 `validate.ts`）；
3. 实测：`[S2] 配置包哈希校验通过` → `object:2 组件=[TransformComponent,VisualComponent,PlaceholderInteractComponent]` → 可被选中 → 按 F 提示「暂不支持该交互：sit」，`pageerror` 为空；
4. **还原**：三个文件全部按备份覆盖回原样。还原证据：
   - `node tools/check-config.mjs` → `scene-1-v1.json: sceneId=1 v1 静态物件=10 NPC=3 触发器=2` + `配置包校验通过`（退出码 0）；
   - `git status --short` 仅剩既有的 4 个 LF/CRLF 噪声 `M` 文件与未跟踪的计划文档，**无任何 S3 相关改动**（`gamedata/`、`bin/` 均被 `.gitignore` 忽略，且已确认内容复原：`object:2` = `collect`、`validate.js` = `['collect','read']`、manifest hash 复原）。

### 依赖自检（A8）

- `packages-game/game-client/package.json`：**该文件本就不存在**（`Test-Path` = False，`git diff 1d9b36a3a -- …/game-client/package.json` 无输出）——客户端工程无独立 npm 包描述，依赖全部复用 `game-server/node_modules`（含 tsc），符合「零新增依赖」。
- `packages-game/game-server/package.json`：`git diff 1d9b36a3a` 仅 **4 行 `scripts` 新增**（`config:list/export/publish/rollback`，属 S2），**无 dependencies/devDependencies 变更**。
- 全量 `git diff 1d9b36a3a --stat`（含 S2+S3）逐路径扫描：**无任何 vendure / vcash 相关路径**被改动。

### 双窗口互见复测（S1 #7）

两个独立浏览器上下文分别登录 `spike01`（playerId=1）与 `spike02`（playerId=3）。A 按住 D 移动 1.2s（(640,480)→(752,480)）后：
- A 窗口舞台树中**只有一个玩家实体** `我(1)`，**无**代表自己的第二份副本（`玩家1` 不出现）；
- B 窗口出现 A 的化身 `玩家1` 于 (752,480)，自身 `我(3)` 保持一份。
**结论：仍只渲染一个「我」，自广播忽略规则未回归。**

### 未验证 / 遗留（如实记录）

1. **触发器成功激活**不可达（无触发器实体 + 现有触发器非机关类型），仅验证到「选中 + 派发 + 后端按类型拒绝被优雅处理」（详见 A5 说明）。
2. **Quest / Mount / 占位类（sit/lie/hide/camp/carve/play）的运行时行为**只在 Task 6 注册表断言层覆盖，未在实机走通（配置包无对应数据）。
3. **冷却（`interact.cd`）**未验证：§1.2 已述本地 mock-redis 的 `SET NX` 恒返回 OK，冷却由服务端裁决，本地无法校验。
4. **Hud 提示条「出现在 canvas 内」**以「`s3-hud` 为 `Laya.stage` 顶层子节点、内容为 `Laya.Text`」+ 截图佐证，**未做逐像素比对**。
5. **微信小游戏端（S1 #8）**本批未复测（S3 不涉及小游戏端；`Platform.isMiniGame()` 分支仅做代码级确认不依赖 DOM）。
6. S3 仅客户端改动，**未做生产部署**（跟随 S2 节奏，本批只做本地验收）。