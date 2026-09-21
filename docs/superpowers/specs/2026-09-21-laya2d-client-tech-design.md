# LayaAir 2D 客户端 · 技术总纲（方案 C 双通路）

> 状态：待评审　|　日期：2026-09-21　|　后续：各子系统按本总纲拆分为独立 spec → plan → 实现

## 0. 本文件是什么

这是**技术总纲**，不是玩法设计文档。它只回答四件事：

1. 客户端工程长什么样、怎么构建与发布；
2. 数据库配置如何变成客户端能渲染的世界（单一源头 + 版本化配置包）；
3. 静态世界与动态实体分别由谁负责、边界在哪；
4. 后续子系统的拆分顺序与各自的验收基线。

**不在本文件内**：具体场景美术、玩法数值、剧情文案、各子系统的详细接口清单（各自另开 spec）。

---

## 1. 已锁定的决策（用户确认，不再讨论）

| # | 决策项 | 结论 |
|---|---|---|
| 1 | 交付形态 | **纯 H5 网页为主 + 微信小游戏适配**（双端出包） |
| 2 | 实时性定位 | **单人为王 + 弱实时多人**（沿用现有 `world.move` → `world.entity_update` 广播，无帧同步/预测回滚） |
| 3 | 后端边界 | **允许新增表和接口**（沿用 NestJS + TypeORM + GM 后台面板规范） |
| 4 | 配置生产 | **GM 后台表单 + 坐标/半径/数量输入**（第一阶段；拖拽摆点编辑器列为第二阶段） |
| 5 | 地图规模 | **小场景制 + 传送切换**：单场景 ≤ 2000×2000 像素，同屏实体 ≤ 150，同场景玩家 ≤ 50 |
| 6 | 工程形态 | **代码优先**：LayaAir 3.x + TypeScript + 命令行构建；先做最小可运行 spike 验证引擎与后端联调 |
| 7 | 工程落位 | **与后端同仓**：`e:\code\nest\packages-game\game-client` |
| 8 | 世界架构 | **方案 C 双通路**：静态世界走版本化配置包，动态实体与建造走服务端权威 |
| 9 | 美术资源 | 暂无美术，先用占位素材；总纲只定「资源替换契约」（命名/切图/锚点/九宫格），不设计美术风格 |

---

## 2. 现状盘点（实现前的事实基线）

### 2.1 后端已有能力（复用，不改契约）

| 能力 | 载体 | 关键事实 |
|---|---|---|
| 场景配置 | `scenes` 表 | `map_res_key`、`map_width/height`（默认 1000×1000）、`layer_config jsonb`、`refresh_rule jsonb`、`trigger_group_ids int[]`、`min_level`、`max_players`（默认 100）、`status`（[scene.entity.ts](file:///e:/code/nest/packages-game/game-server/src/modules/world/entities/scene.entity.ts)） |
| 实体落位 | `scene_entity_spawns` | `entity_type`（`npc/monster/object`）、`template_id`、`spawn_x/spawn_y/spawn_rotation`、`spawn_count`、`spawn_radius`、`is_active` |
| 物件交互 | `object_templates` | `type`（`ObjectType`）、`interact_cd`、`reward jsonb`、`anim_open`、`is_one_time` |
| NPC 模板 | `npc_templates` | `res_key`、`scale`、`default_anim`、`interact_type`（`NpcInteractType`）、`dialogue_id int`、`move_range`、`is_auto_wander`、`attr jsonb` |
| 机关/传送 | `scene_triggers` | `trigger_type`、`area_x/y/w/h`、`target_scene_id`、`story_id`、`condition jsonb`、`once_only` |
| 交互链路 | [world.service.ts:165-233](file:///e:/code/nest/packages-game/game-server/src/modules/world/world.service.ts#L165-L233) | 读模板 → 校验 `interactCd` → 校验 `isOneTime` → 发 `reward` |
| 多人在场 | [game.gateway.ts:159-244](file:///e:/code/nest/packages-game/game-server/src/modules/gateway/game.gateway.ts#L159-L244) | WS 进场景加入房间 `scene:<id>`，返回 `{scene, spawns, triggers}`；`world.move` 广播 `world.entity_update` |
| 奇遇 | `explore` 模块 | `POST /api/client/v1/explore/scene/:sceneId/discover`、`/encounter`、`/encounter/:id/resolve` |
| 任务 | `quest_templates`（31 行）、`player_quest` | 任务模板与进度已可用 |

**WS 帧结构（必须严格对齐，勿自创）**：
- 请求：`{ cmd: 'world.enter-scene' | 'world.move' | 'player.heartbeat' | 'chat.send', seq, data }`
- 应答：`{ cmd, seq, code, msg, data }`（`cmd` 应答名为 snake：`world.enter_scene_sync`）
- 广播：`{ cmd: 'world.entity_update', seq: 0, code: 0, msg: 'success', data: { entityId: 'player:<playerId>', entityType: 'player', playerId, pos: {x, y}, rotation, state: 'move' } }`
- 心跳：`player.heartbeat`；断线时服务端自动 `leaveScene` + `playerDisconnect`

### 2.2 后端缺口（本批要新增）

| 缺口 | 影响 |
|---|---|
| 无建造相关表 | 「单独建造 / 共同建造 / 不允许建造」无处落库；只有帮派级 `guild_building` |
| NPC 无出现规则表、无巡逻路径表、无 AI 状态机 | 「随机出现 / 固定出现 / 定时巡逻」只能硬编码在客户端（不可信） |
| 无对话/剧情文本表 | `npc_templates.dialogue_id` 是悬空整数，无对应表 |
| 交互链路单一 | 服务端只有「物件交互 + 触发器激活」两条通用链路，NPC 对话类交互需新增接口 |

### 2.3 内容基线（生产库实测）

`scenes / scene_entity_spawns / scene_triggers / npc_templates / monster_templates / object_templates` **全部 0 行**；已有内容仅 `quest_templates 31`、`item_templates 39`、`characters 55`。

→ **世界内容从 0 起步**：总纲必须包含播种策略，否则客户端无内容可验收（见 §11.3）。

### 2.4 客户端基线

仓库内**无任何游戏客户端工程**（`sandbox/` 是财富沙盘 3D 实验，与本游戏无关）。LayaAir 工程为全新建设。

---

## 3. 总体架构（方案 C）

```
       [ DB 配置表：单一源头 ]
                 │  ① GM 后台「发布」（表单编辑 + 校验 + 版本号）
                 ▼
   [ 配置包 scene-<id>-v<n>.json + manifest.json（哈希/版本） ]
                 │  ② 走现有静态托管（与 /admin 同级），客户端本地缓存
                 ▼
 ┌─────────────────────────── 客户端（LayaAir 3.x） ───────────────────────────┐
 │  静态层：地形背景、建筑/树木/矿产/山川湖泊固定位、固定 NPC 初始位、碰撞、传送点   │
 │  动态层：其他玩家、随机/巡逻 NPC、掉落物、建造中/已建成建筑、交互状态            │
 └───────────────────────────────────┬────────────────────────────────────────┘
                                     │  ③ 动态层权威：WS（进场景/移动/广播）+ HTTP（交互/建造/任务）
                                     ▼
                        [ game-server：唯一权威（校验 CD/一次性/奖励/扣料/所有权） ]
```

**职责边界表**（实现时按此表判定，不可越界）：

| 数据 | 权威方 | 客户端可做什么 | 传输通路 |
|---|---|---|---|
| 地形/背景/碰撞 | 配置包 | 直接渲染与碰撞 | 静态（②） |
| 建筑/树木/矿产/山川湖泊固定位 | 配置包 | 直接渲染 | 静态（②） |
| 固定 NPC 初始位 | 配置包（初始）+ 服务端（当前） | 渲染，位置以服务端为准 | 静态 + ③ |
| 随机/巡逻 NPC 的当前存在与位置 | **服务端** | 仅表现（插值） | ③ WS |
| 其他玩家位置/状态 | **服务端** | 本地预测 + 插值表现 | ③ WS |
| 交互结果（掉料/CD/一次性） | **服务端** | 请求 + 播放表现 | ③ HTTP |
| 建造（扣料、落成、共建分配、所有权） | **服务端** | 请求 + 预览态表现 | ③ HTTP |
| 任务进度/背包/货币 | **服务端** | 展示 | ③ HTTP |

**为什么这样切**：静态数据走图纸（配置包）→ 首帧不依赖网络、移动时不重复传输静止物；动态数据走权威 → 可防改包、可热更、多端一致。

---

## 4. 工程结构（`packages-game/game-client`）

```
packages-game/
├── game-server/                 # 现有后端（NestJS）
├── config-schema/               # 【新增】配置契约单一来源（JSON Schema + 枚举常量）
│   ├── scene-config.schema.json
│   ├── npc-behavior.schema.json
│   └── building.schema.json
└── game-client/                 # 【新增】LayaAir 3.x 客户端
    ├── src/
    │   ├── boot/                # 启动、登录、资源与配置包加载、WS 连接
    │   ├── config/              # 配置包模型 + 校验 + 缓存（读 config-schema）
    │   ├── world/               # 场景装配、相机、分块与排序、碰撞、传送
    │   ├── entity/              # 人/事/物实体基类与实例工厂、对象池
    │   │   ├── components/      # 表现/物理/状态/交互/AI 组件（见 §7）
    │   │   └── factory/         # 由 spawn 记录 + 模板生成实体
    │   ├── net/                 # HTTP 客户端、WS 客户端（严格对齐 §2.1 帧结构）
    │   ├── ui/                  # 通用 UI（背包/任务/聊天/商城/建造面板）
    │   └── platform/            # 平台适配层（H5 / 微信小游戏）
    ├── assets/                  # 占位素材（后续按「资源替换契约」替换）
    └── tools/                   # 构建与发布脚本（命令行）
```

**关键约束**
1. 客户端**不含任何硬编码世界数据**（场景、实体坐标、NPC 行为全部来自配置包或服务端）。
2. 配置契约以 `config-schema/` 为单一来源：后端导出脚本与客户端校验读同一份 schema，避免双写漂移。
3. 不新增后端运行时依赖；客户端依赖保持最小（引擎 + 平台适配）。
4. 构建产物路径与后端静态托管约定对齐（生成独立静态目录，由部署脚本同步，不塞进后端 dist）。

---

## 5. 配置契约

### 5.1 配置包结构（`scene-<sceneId>-v<n>.json`）

```jsonc
{
  "schemaVersion": 1,
  "sceneId": 1,
  "version": 3,                  // 每次发布自增
  "hash": "sha256:...",          // 内容哈希，客户端缓存校验
  "scene": { "name": "...", "mapResKey": "...", "mapWidth": 2000, "mapHeight": 2000,
             "minLevel": 1, "maxPlayers": 50, "sceneType": "town" },
  "layers": {},                  // 原样透传 scenes.layer_config（键名与结构由 S2 的 schema 定义，本总纲不预设）
  "staticEntities": [            // 固定位置，客户端直接实例化
    { "kind": "object", "spawnId": 12, "templateId": 3, "resKey": "...", "x": 800, "y": 640,
      "rotation": 0, "interact": { "type": "collect", "cd": 43200, "oneTime": false } }
  ],
  "fixedNpcs": [ { "spawnId": 21, "npcTemplateId": 5, "resKey": "...", "x": 300, "y": 420, "anim": "idle" } ],
  "triggers": [ { "id": 7, "type": "portal", "area": { "x": 0, "y": 0, "w": 120, "h": 200 }, "targetSceneId": 2, "onceOnly": false } ]
}
```
配套 `manifest.json`：`{ "scenes": [{ "sceneId": 1, "version": 3, "hash": "...", "file": "scene-1-v3.json" }] }`。

**发布语义**：配置包按版本号**只增不改**，客户端缓存命中即用；哈希不符则重新拉取；发布失败不影响线上旧版本（回滚 = 重新指回旧文件）。

### 5.2 复用现有表（不新增列，只加数据）

`scenes` / `scene_entity_spawns` / `object_templates` / `npc_templates` / `scene_triggers` 直接作为配置来源。`object_templates.type` 与 `InteractType`、`ObjectType` 枚举对齐（见 [enums.ts:212-257](file:///e:/code/nest/packages-game/game-server/src/constants/enums.ts#L212-L257)）。

### 5.3 新增表（后端 schema 变更）

**NPC 行为**

| 表 | 关键字段 | 说明 |
|---|---|---|
| `npc_spawn_rules` | `scene_id`、`npc_template_id`、`rule_type`（`fixed`/`random`/`patrol`）、`spawn_x/y`、`spawn_radius`、`spawn_count`、`max_alive`、`respawn_interval_sec`、`time_window jsonb`、`condition jsonb`、`is_active` | 一条规则 = 一种出现方式；`condition` 承载「按任务需要出现」（任务 id、等级、天气、游戏内时段） |
| `npc_patrol_routes` | `scene_id`、`npc_template_id`、`name`、`loop_mode`（`loop`/`pingpong`/`once`）、`speed`、`points jsonb`（`[{x,y,pauseSec}]`）、`schedule jsonb`（定时巡逻的时段表）、`is_active` | 路径点用 `jsonb` 数组而非独立点表：GM 后台整树编辑更简单，无需 join |

**建造**

| 表 | 关键字段 | 说明 |
|---|---|---|
| `scene_build_rules` | `scene_id`(唯一)、`mode`（`solo`/`coop`/`forbidden`）、`land_grid_size`、`max_buildings_per_player`、`allow_demolish`、`coop_min_contributors`、`coop_expire_hours`、`reserved_zones jsonb` | 场景级规则，直接对应「单独建造 / 共同建造 / 不允许建造」 |
| `building_templates` | `name`、`res_key`、`category`、`footprint_w/h`、`build_cost jsonb`、`build_seconds`、`durability`、`effect jsonb`（产出/仓储/增益）、`unlock_condition jsonb`、`is_active` | 建筑蓝图（配置数据） |
| `scene_land_plots` | `scene_id`、`gx`、`gy`、`w`、`h`、`state`（`empty`/`occupied`/`locked`） | 地块占位（世界状态） |
| `building_instances` | `scene_id`、`plot_id`、`template_id`、`owner_type`（`player`/`guild`）、`owner_id`、`state`（`building`/`built`/`demolishing`）、`finish_at`、`durability`、`payload jsonb` | 建造中/已建成用同一表：`state` + `finish_at`，由 1 分钟定时任务结算（复用 P0-7 的定时任务先例），不额外建队列表 |
| `building_coop_contributions` | `building_instance_id`、`player_id`、`item_id`、`amount`、`created_at` | 共建贡献流水；分配与「共建者权利」由本表推导 |

**对话/剧情**

| 表 | 关键字段 | 说明 |
|---|---|---|
| `dialogues` | `code`(唯一)、`title`、`nodes jsonb`（节点树：`{key, speaker, text, condition, options:[{text,next,action}]}`）、`version`、`is_active` | 对话树整体存 `jsonb`，一张表搞定；`npc_templates.dialogue_id` 指向本表 `id`，不做多表 JOIN |
| （复用）`scene_triggers.story_id` | — | 剧情触发继续走现有触发器，不新造机制 |

**所有新增表遵循现有规范**：`bigint` 主键、`created_at/updated_at/deleted_at` 软删、枚举用 PostgreSQL enum、schema 变更走生产同步脚本（禁止服务器构建）。

---

## 6. 双通路数据流（进场景时序）

1. **登录**：HTTP 认证拿到玩家 token（复用现有客户端登录接口）。
2. **配置包**：读本地缓存的 `manifest.json` → 按 `hash` 判定是否需要拉取 `scene-<id>-v<n>.json` → 校验 schema → 建静态层。
3. **WS 连接**：认证握手 → `player.heartbeat` 起心跳。
4. **进场景**：发 `world.enter-scene { data: { sceneId } }` → 收 `world.enter_scene_sync` 的 `{scene, spawns, triggers}`。
5. **合并实体表**：`spawns`（服务端下发的动态实体）∪ 配置包静态实体。**去重规则（必须实现）**：以 `spawnId` 求交集，**配置包优先**——服务端下发的静态物件（`entity_type=object` 且坐标与配置包一致）一律忽略，只接受动态实体（随机/巡逻 NPC、掉落、其他玩家）。理由：静态物件已在配置包里，避免同屏双份实例与坐标漂移。
6. **移动**：本地即时表现 + 约 10Hz 上报 `world.move`；收到 `world.entity_update` 时对他人做插值。
7. **交互**：HTTP 请求 → 服务端校验（CD/一次性/奖励/扣料）→ 客户端播放表现并刷新数据；失败按业务码给出中文提示。
8. **切场景**：踩到 `trigger(type=portal)` 区域 → 重复步骤 2、4、5（旧场景实体全部回收进对象池）。

**坐标系统（全项目统一）**：像素整数坐标，原点左上，`x` 向右、`y` 向下；角色与物件的渲染层级按 `y` 升序（伪 3D 遮挡）；与后端 `spawn_x/spawn_y`、`world.move` 的 `pos` 完全一致，不做任何坐标换算。

---

## 7. 实体模型：人 / 事 / 物 实例化拆分

**核心原则**：实体（Entity）是唯一可寻址的逻辑单元，能力全部由组件装配；配置只声明「装哪些组件」，不写行为代码。

| 构成 | 内容 |
|---|---|
| Entity 身份 | `entityId`：`player:<playerId>` / `npc:<spawnId>` / `object:<spawnId>` / `building:<instanceId>` |
| 表现组件 | `VisualComponent`（`resKey`、动画、缩放、层级）、`ShadowComponent` |
| 空间组件 | `TransformComponent`（`x/y`、朝向）、`CollisionComponent`（碰撞体） |
| 状态组件 | `StateComponent`（血量/耐久/状态位）、`BuffVisualComponent`（仅表现） |
| 交互组件 | `InteractComponent`（见 §8），由配置的 `interact.type` 决定装哪一个 |
| 行为组件 | `AiComponent`（仅 NPC/怪物：`idle`/`patrol`/`wander`/`chase` 状态机；位置以服务端为准） |
| 全局唯一 | `EntityRegistry` 提供按 id / 按类型 / 按矩形范围查询；`EntityFactory` 负责按配置造实体；`EntityPool` 负责回收复用 |

**「事」的表现形式**：一次性事件（掉落、演出、机关触发）不建持久实体，作为 `EventComponent` 挂在触发器或短生命周期实体上，播完即回收。

---

## 8. 交互组件化

**统一契约**（客户端）：

```ts
interface InteractComponent {
  readonly kind: InteractType;                 // 与后端 InteractType 对齐
  canInteract(ctx: InteractContext): boolean;  // 距离、前置条件、冷却显示
  interact(ctx: InteractContext): Promise<void>;
  priority: number;                            // 同屏多个可交互目标的选中优先级
}
```

**组件清单**（与后端枚举一一对应，避免自创类型）：

| 组件 | 对应后端 | 服务端链路 |
|---|---|---|
| `CollectComponent` | `InteractType.collect/fish` | `POST /world/objects/:id/interact`（校验 `interact_cd`） |
| `ContainerComponent` | `ObjectType.chest` | 同上（校验 `is_one_time` + `reward`） |
| `ReadComponent` | `InteractType.read` | 同上（返回文本/线索） |
| `TalkComponent` | `NpcInteractType.talk` | **新增** NPC 交互接口（见下） |
| `QuestComponent` | `InteractType.play` / 任务交付 | 现有任务接口 |
| `TriggerComponent` | `scene_triggers` | `POST /world/triggers/:id/activate` |
| `BuildComponent` | 建造 | **新增** 建造接口（§9） |
| `MountComponent` / `SitComponent` | `InteractType.mount/sit/lie` | 现有 `player_mount` 等 |

**交互内容由剧情背景展开**：交互目标在配置里携带 `dialogueId` / `questId` / `storyId`，互动内容（说什么、给什么、触发哪段剧情）全部来自配置与后端返回，客户端不写文案。

**服务端需新增**：`POST /api/client/v1/world/npcs/:spawnId/talk`（返回对话节点 + 可选项），并复用「CD/条件/奖励」校验骨架。触发器的 `condition`、任务的 `condition` 承载剧情条件判断。

---

## 9. 建造系统（三种模式）

| 模式 | 行为 | 服务端校验点 |
|---|---|---|
| `solo`（单独建造） | 玩家在空地块放置建筑，材料只由自己出 | 地块空闲、材料充足、数量上限、场景规则允许 |
| `coop`（共同建造） | 同一建筑由多玩家投料，达到 `coop_min_contributors` 才落成；超时未达标 `coop_expire_hours` 自动退回 | 贡献流水 `building_coop_contributions`、达标判定、超时退款（定时任务） |
| `forbidden`（不允许建造） | 场景内建造入口整体关闭 | 直接拒绝，不进入 UI |

**同步与一致**：建造是动态数据 → 客户端只做「预览态」表现（半透明地基 + 进度条），落成以服务端 `building_instances.state='built'` 为准。落成与拆除事件**复用现有房间广播通道**：服务端向 `scene:<sceneId>` 房间发 `world.entity_update`，`entityType='building'`、`entityId='building:<instanceId>'`，不新增推送机制；客户端按 `EntityRegistry` 按 id upsert（已存在则更新状态，不存在则创建）。

**共建分配**：落成时按贡献比例分配产出/收益（`payload jsonb` 记录），分配算法在对应的子系统 spec 中定；本总纲只锁「贡献必落 `building_coop_contributions`、分配必由服务端算」两条。

---

## 10. NPC 行为（随机 / 固定 / 定时巡逻）

| 需求 | 落地方式 |
|---|---|
| 固定出现 | `npc_spawn_rules.rule_type='fixed'` + `scene_entity_spawns` 固定坐标 |
| 随机出现 | `rule_type='random'` + `spawn_x/y` + `spawn_radius` + `max_alive` + `respawn_interval_sec`；**随机数由服务端生成**后随 `world.enter-scene` 下发 |
| 定时巡逻 | `rule_type='patrol'` + `npc_patrol_routes.points/schedule`，服务端按 `schedule` 决定当前时段是否存在 |
| 按任务需要出现 | `npc_spawn_rules.condition jsonb`（`questId`/`minLevel`/`flag`），服务端在玩家进场景时按该玩家任务状态过滤 |

**权威边界**：NPC「是否在场 + 当前坐标」由服务端决定并下发；客户端 AI 组件只负责**在服务端给定的路点之间做平滑插值**，不做自主决策（否则可改包刷 NPC）。

> 现状说明：以上四项能力后端**目前都不存在**（`scene_entity_spawns` 只能表达固定坐标的固定生成），属于 S4 要新增的能力；本总纲只锁「出现规则入 `npc_spawn_rules`、路径入 `npc_patrol_routes`、随机与存在性由服务端决定」三条契约。

---

## 11. 工程化与发布

### 11.1 构建与发布
- 本地命令行构建出 H5 与微信小游戏两套产物（具体 CLI 形式在 spike 中实证，见 §13）。
- 静态产物独立目录，由部署脚本同步到生产静态路径（与 `/admin` 同级约定），**不进后端 dist、不触发服务器构建**。
- 版本可见：页面/小游戏内显示客户端版本 + 配置包版本，便于线上问题定位。

### 11.2 微信小游戏约束（必须在总纲层面约束）
- 无 DOM：所有 UI 走引擎内渲染，禁用浏览器 API（`document`/`window` 直接调用集中在 `platform/`）。
- 网络：只能用 `wx.connectSocket`，且 **WS 必须是 `wss://` 且域名在白名单内**；HTTP 走 `wx.request` 且域名白名单。
- 包体：主包与分包上限以微信官方当前限制为准（实现期核对），本期按「主包 ≤ 4MB、总包 ≤ 20MB」规划；静态素材按场景分包。
- 音频/字体/触摸：走平台适配层统一封装，业务代码不直接触达。
- **前置条件**：现网 `https://game.joho.cn` 的证书链在浏览器实测有告警（`ERR_CERT_AUTHORITY_INVALID`），微信端对证书更严格，**必须在校验阶段前修复证书链**，否则小游戏端连不上 WS。

### 11.3 世界内容播种（因为基线为 0）
1. 首批 1~2 个场景（如「主城 + 野外」）+ 每场景 ≥ 10 个静态物件 + ≥ 3 个 NPC。
2. 播种方式：SQL/脚本种子（与 `seeds/` 现有做法一致），GM 后台后续可直接改。
3. 验收前必须至少有一个场景配置完整可玩，否则无法出验收结论。

---

## 12. 性能预算与降级

| 指标 | 预算 | 降级手段 |
|---|---|---|
| 帧率 | H5 60fps、微信小游戏 30fps 兜底 | 关闭阴影/粒子、降低补间精度 |
| 同屏实体 | ≤ 150 | 视口外实体回收进池；远处静态物件合批 |
| DrawCall | ≤ 60（H5）/ ≤ 40（小游戏） | 图集合并、按场景分包、静态层预渲染合图 |
| 内存 | ≤ 300MB（H5） | 场景切换释放非当前场景资源 |
| WS 上行 | `world.move` ≤ 10 次/秒/人 | 移动停止即停报；位置变化小于阈值不报 |
| 首屏 | 配置包 ≤ 300KB/场景 | 分包 + gzip + 本地缓存 |

---

## 13. Spike 验收（总纲落地第一步）

最小可运行闭环，用于实证引擎与工具链，**不是 Demo 的终点**：

| # | 验收项 | 通过标准 |
|---|---|---|
| 1 | 工具链 | 本地命令行能产出 H5 产物并在浏览器打开 |
| 2 | 登录 | 复用现有客户端登录接口，拿到 token |
| 3 | 配置包 | 能加载一个手工维护的 `scene-1-v1.json` 并渲染出地形 + ≥ 1 静态物件 |
| 4 | 进场景 | `world.enter-scene` 拿到 `{scene, spawns, triggers}` 并生成实体 |
| 5 | NPC | 渲染 ≥ 1 个 NPC，位置与配置一致 |
| 6 | 交互 | 完成 1 次采集（走 `objects/:id/interact`）与 1 次 NPC 对话（走新增接口） |
| 7 | 多人 | 两个浏览器窗口互相看到对方移动（验证 `world.move` → `world.entity_update`） |
| 8 | 小游戏 | 开发者工具中可跑通同一场景（不要求包体达标） |
| 9 | 后端回归 | 现有测试全绿，未改旧接口契约 |

---

## 14. 测试与质量策略

- **配置契约**：以 `config-schema/*.schema.json` 为唯一真源；后端导出脚本产出配置包前先校验，客户端加载后再校验一次（手写轻量校验，不引入新依赖）。
- **后端**：新增表/接口必须有单测（沿用现有 80+ suites 基线，不下降）。
- **客户端**：spike 阶段以「浏览器点检验收」为主；引入正式单测框架的决策推迟到 S3（避免在引擎未稳定时投入测试基建）。
- **端到端**：每个子系统 spec 必须自带冒烟脚本 + 生产点检清单（沿用现有 `scripts/smoke-*.sh` 模式）。

---

## 15. 子系统拆分与推荐顺序

| 序 | 子系统 | 内容 | 依赖 |
|---|---|---|---|
| S1 | 工程与最小闭环 | spike 正式化：工程结构、构建脚本、登录、进场景、配置包加载、实体框架骨架 | 本总纲 |
| S2 | 配置契约与导出管线 | `config-schema`、后端导出脚本、GM 后台「场景与实体配置」面板、发布/回滚 | S1 |
| S3 | 实体实例化与交互组件化 | 人/事/物拆分、工厂与对象池、8 类交互组件、就近交互 UI | S1、S2 |
| S4 | NPC 行为 | `npc_spawn_rules`、`npc_patrol_routes`、服务端过滤下发、客户端插值表现 | S2、S3 |
| S5 | 剧情与互动内容 | `dialogues` 表、NPC 对话接口、任务/触发器绑定剧情 | S3 |
| S6 | 建造系统 | `scene_build_rules`、建筑模板/地块/实例/贡献、三种模式、共建结算 | S2、S3 |
| S7 | 微信小游戏适配 | 平台适配层、分包策略、`wss` 与白名单、证书链修复、双端发布脚本 | S1（可与 S5/S6 并行） |
| S8 | 性能优化与压测 | 合批、对象池调优、同步频率调参、50 人同场景压测 | 全部 |

**推荐执行顺序**：S1 → S2 → S3 → S4 → S5 → S6 →（S7 与 S5/S6 并行）→ S8。理由：S1 验证工具链（最大不确定性），S2 打通「配置→客户端」的主动脉，S3 是其余全部玩法的公共底座；建造（S6）改动面最大且依赖最多，放后。

---

## 16. 风险与默认假设

| # | 风险 | 处置 |
|---|---|---|
| 1 | LayaAir 3.x 工具链未实证（CLI 构建、小游戏导出） | S1 spike 第一项验收；若不通，退路是「IDE 工程 + 命令行发布」或降级 LayaAir 2.x |
| 2 | 现网证书链告警 → 微信端连不上 `wss` | S7 前置项，必须先修证书 |
| 3 | 内容基线为 0，无内容则无法验收 | §11.3 播种策略，先做 1 个完整场景 |
| 4 | 新增 4 组表涉及生产 schema 变更 | 走既有「本地生成 DDL → 生产执行」流程，禁止服务器构建 |
| 5 | 现有广播是**全房间无视野裁剪**，50 人时上行/下行带宽未实测 | S8 压测；必要时按视口裁剪（后端小改） |
| 6 | GM 后台零构建前端承载「场景配置 + 建造审核」复杂度上升 | 第二阶段再上拖拽编辑器；本期字段级表单即可 |

**默认假设（不再单独确认，除非你反对）**
- 配置包校验用手写轻量校验，不引入 zod 等新依赖。
- 建造允许拆除，不做迁移/移动建筑。
- 对话支持 1 层分支 + 条件字段，不做可视化剧本编辑器。
- 客户端单测框架推迟到 S3 再决定。

---

## 17. 完成验收（总纲层面）

- [ ] §13 spike 9 项全过（含双浏览器互见移动、小游戏开发者工具可跑）。
- [ ] 配置包「DB → 导出 → 客户端渲染」链路可重复执行，发布/回滚可操作。
- [ ] 后端旧接口契约零改动；现有测试基线不下降。
- [ ] 三个新增后端域（NPC 行为 / 建造 / 对话）各有表结构、接口与单测。
- [ ] 生产部署脚本包含客户端静态产物同步，且不触发服务器构建。