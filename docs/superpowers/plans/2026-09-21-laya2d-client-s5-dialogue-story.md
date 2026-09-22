# LayaAir 2D 剧情与互动内容 S5 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（沿用 S2/S3/S4 的既定方式）。

**Goal:** 把「NPC 对话」从 S1 的单句问候升级为**服务端权威的对话树**：节点/选项/前置条件/副作用全部落库，客户端只负责显示与选择；剧情触发继续走 `scene_triggers.story_id`，不新造机制。

**Architecture:** 新增 `dialogues` 表（整棵树存 `jsonb`，单表）→ 服务端解析节点 + 按**玩家级条件**过滤可见选项 + 执行副作用（接任务/给道具/给货币/记账旗标）→ 客户端 `DialogueView`（引擎内自绘，沿用 S3 的 Hud 方式）渲染。副作用**一律走既有服务**（`QuestService` / `InventoryService` / `EconomyService` / `TriggerUnlock`），不写第二套经济逻辑。

---

## 0. 执行前必读（硬约束）

1. **不准碰 vendure**；2G 服务器（odoo, 39.106.99.9）**禁止构建**，构建一律本地完成。
2. **不新增依赖**（后端与客户端均零新增 npm 包）。
3. **不改旧契约**：`POST /api/client/v1/world/npcs/:spawnId/talk` 的**既有字段保持不变**（`spawnId/npcTemplateId/name/talkType/dialogueId/text/options`），S5 只做**增量字段**（新增 `nodeKey`/`options[].action` 等）——S1 冒烟脚本依赖旧字段。
4. **服务端权威**：客户端不得本地推进对话、不得本地发放奖励。
5. 全部提交遵守 commitlint，单次提交聚焦一个任务。
6. 范围只做剧情与对话；NPC 出现规则=S4，建造=S6，伙伴组队/社交剧情不在本批。

---

## 1. 设计

### 1.1 缺口盘点

| # | 缺口 | 现状 | S5 处置 |
|---|---|---|---|
| 1 | 无对话文本表 | `npc_templates.dialogue_id` 是**悬空整数**，无对应表；`talkNpc` 只回 `attr.greeting` | 新增 `dialogues` 表 |
| 2 | 无分支推进接口 | S1 只有一次性 `talk`，无「选择后进入下一节点」 | 新增 `POST /world/dialogue/:code/choose` |
| 3 | 对话无副作用 | NPC 不会给任务/给道具 | 服务端动作执行器（6 个动作） |
| 4 | 无玩家级条件过滤 | 节点对所有玩家一视同仁（唯一先例是 `condition.requiredPlayers`） | 节点与选项支持 `condition`，服务端按玩家状态过滤 |
| 5 | `story_id` 悬空 | `scene_triggers.story_id` 无表可指 | 指向 `dialogues.id`；新增 `POST /world/triggers/:id/story` |
| 6 | 客户端无对话 UI | S1 用 `Toast.info` 打印一句 | `DialogueView`（引擎内自绘）+ `TalkComponent` 改造 |
| 7 | 任务与 NPC 无绑定 | `quest_templates` **无 giver 字段**（已核实） | 由对话动作 `accept_quest` 承载绑定关系，**不改任务模板表** |

### 1.2 已核实的事实（实现时不要再猜）

**对话现有链路**
- `WorldService.talkNpc(playerId, spawnId)`（[world.service.ts:184-212](file:///e:/code/nest/packages-game/game-server/src/modules/world/world.service.ts#L184-L212)）：`spawnId` 是 `scene_entity_spawns.id`；校验 `entityType===NPC` 且 `interactType===NpcInteractType.TALK`；返回类型 `NpcTalkResult`（[world.service.ts:41-49](file:///e:/code/nest/packages-game/game-server/src/modules/world/world.service.ts#L41-L49)）已预留 `dialogueId` 与 `options: Array<{text,next}>`——**这就是为 S5 预留的形状**，扩展即可，不要另起返回结构。
- 客户端调用点：[InteractController.ts:62-64](file:///e:/code/nest/packages-game/game-client/src/world/InteractController.ts#L62-L64)（`Api.talkNpc(target.spawnId, Session.token)` → `Toast.info`）。S5 改为打开 `DialogueView`。
- `npc_templates` 字段（[npc-template.entity.ts](file:///e:/code/nest/packages-game/game-server/src/modules/world/entities/npc-template.entity.ts)）：`name`、`interactType`、`dialogueId`、`attr jsonb`（S1 用 `attr.greeting` 兜底）。

**任务侧（可直接复用的服务）**
- `QuestService.acceptQuest(playerId, questTemplateId)` / `submitQuest` / `claimQuestReward`（[quest.service.ts](file:///e:/code/nest/packages-game/game-server/src/modules/quest/quest.service.ts)，[quest.controller.ts:38-107](file:///e:/code/nest/packages-game/game-server/src/modules/quest/quest.controller.ts#L38-L107)）。
- `quest_templates` 字段：`questType/minLevel/acceptLimit/autoReward/targetJson/rewardJson/prerequisiteIds/targetType/prerequisiteSocial/rewardSocial/repeatable`——**无 NPC 绑定字段**。
- `player_quests`：`playerId/questTemplateId/progress/status/completeTimes/acceptedAt/completedAt`。
- 任务进度是**事件驱动**：`quest-event.listener.ts` 监听 `ECO_ACTION / FORMATION_ACTIVATED / LOOT_DISTRIBUTED / GUILD_JOINED / GIFT_SENT / FRIEND_ADDED …` 推进社交目标；**与对话无耦合**——S5 不需要动它。

**副作用可复用服务（签名已核实）**
- `EconomyService.addCurrency(playerId, currencyType, amount, source, opTrace, relatedId?)` / `deductCurrency(...)`（[economy.service.ts:42,104](file:///e:/code/nest/packages-game/game-server/src/modules/economy/economy.service.ts#L42)）。
- `InventoryService.addItem(playerId, itemTemplateId, quantity, opTrace)` / `removeItem(...)`（[inventory.service.ts:40,115](file:///e:/code/nest/packages-game/game-server/src/modules/inventory/inventory.service.ts#L40)）——自带分布式锁、变更流水 `PlayerItemChangeLog`、`ITEM_ACQUIRED/ITEM_CONSUMED` 事件。
- `TriggerUnlock` 仓库（[world.service.ts:311-315](file:///e:/code/nest/packages-game/game-server/src/modules/world/world.service.ts#L311-L315)）。

**约定**
- 错误信封：`GameException` → HTTP 200 + body `{code,msg,data}`，客户端判 `body.code`。
- 错误码先复用：`QUEST_PREREQUISITE_NOT_MET:40001`、`QUEST_ALREADY_COMPLETED:40002`、`QUEST_ACCEPT_LIMIT_REACHED:40003`、`QUEST_NOT_ACCEPTED:40004`、`ITEM_NOT_ENOUGH:20002`、`CURRENCY_NOT_ENOUGH:20007`、`FORBIDDEN:40300`；**本批新增** `DIALOGUE_NOT_FOUND:43001`、`DIALOGUE_CONDITION_NOT_MET:43002`、`DIALOGUE_NODE_INVALID:43003`（沿用 [error-codes.ts](file:///e:/code/nest/packages-game/game-server/src/constants/error-codes.ts) 的 43xxx 段，需确认该段未被占用——未占用则用，占用则顺延）。
- 一次性语义先例：`CacheService.acquireLock(key, ttlSec)`（[world.service.ts:234-240](file:///e:/code/nest/packages-game/game-server/src/modules/world/world.service.ts#L234-L240)）——`once_only` 的剧情触发直接照抄这个写法。
- 客户端 UI 现状：`Toast`（DOM 依赖的 `Platform.toast`，小游戏端降级 console）；**S3 决策「引擎内自绘 UI」**，S5 的 `DialogueView` 必须走引擎内绘制，不得用 DOM。

### 1.3 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **对话树整棵存 `dialogues.nodes jsonb`**，单表不拆节点表 | 与总纲 §5.3 一致；GM 编辑整树最简单，无 join |
| D2 | **服务端逐步下发**：`talk` 只回**当前节点 + 已过滤的可选项**；`choose` 提交 `optionIndex`（不是客户端给 `next` key） | 客户端本地推进 = 可改包跳节点/反复领奖；用 `optionIndex` 而非 key 可避免客户端伪造目标节点 |
| D3 | **动作在 `choose` 时由服务端执行**，执行失败**不推进节点**并返回业务码 | 动作与节点推进同事务语义；失败要给玩家明确原因（如背包满） |
| D4 | **条件在服务端过滤**，过滤结果体现在返回的 `options` 数组（客户端看不到被隐藏选项） | 防止客户端探测隐藏分支；与 S4 的「存在性玩家级」保持同一原则 |
| D5 | **`npc_templates.dialogue_id` 指向 `dialogues.id`；选项可 `next` 到别的 code** | 复用既有字段，零 schema 改动 |
| D6 | **`scene_triggers.story_id` 指向 `dialogues.id`**，新增独立接口 `POST /world/triggers/:id/story` | 不动 `activateTrigger`（只认 PUZZLE/GATE/TRAP），避免破坏机关语义 |
| D7 | **对话状态无持久会话**：`choose` 请求需带 `code + nodeKey`，服务端校验 `nodeKey` 属于该对话树 | 免去「会话表/redis 会话」，断线重进对话从头开始即可（单机剧情足够） |
| D8 | **NPC 任务标记（可接/可交）由服务端算**，随 `talk` 返回 `questMarks` | 客户端不能凭配置推断任务状态 |
| D9 | **不做 GM 面板**（只做 admin 接口） | 面板规范见 S2b；本批只保证数据可 CRUD |

### 1.4 数据模型

**`dialogues`（新表，注册进 `world.module.ts`）**

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | bigint PK | 与 `dialogue_id`/`story_id` 对齐 |
| `code` | varchar(64) unique | 对话唯一编码，如 `npc_blacksmith_main` |
| `title` | varchar(128) | 运营备注 |
| `nodes` | jsonb | **节点数组**：`[{ key, speaker?, text, condition?, options: [{ text, next?, action?, actionArgs? }] }]`；`next` 为空表示结束 |
| `version` | int default 1 | 文本迭代版本（运营可回退） |
| `is_active` | boolean default true | 停用即不可选 |
| `created_at/updated_at/deleted_at` | 标准列 | 软删 |

**节点 `condition`（玩家级，全部可选，AND 语义）**：`minLevel`、`questId`（需已接）、`questStatus`（`accepted/completed/claimed`）、`notQuestId`（需未接）、`hasItemId`、`flag`（字符串旗标，存 redis `dialogue:flag:<playerId>:<flag>`）。

**动作 `action` 白名单（6 个）**：`accept_quest`、`submit_quest`、`give_item`、`take_item`、`add_currency`、`set_flag`。`actionArgs`：`{questTemplateId?/itemTemplateId?/quantity?/currencyType?/amount?/flag?}`。

### 1.5 文件结构

**新增（后端，相对 `packages-game/game-server/`）**

| 路径 | 职责 |
|---|---|
| `src/modules/world/entities/dialogue.entity.ts` | `dialogues` 表 |
| `src/modules/world/dialogue/dialogue.types.ts` | `DialogueNode` / `DialogueOption` / `DialogueCondition` / `DialogueAction` 类型与**纯函数**校验 |
| `src/modules/world/dialogue/dialogue.resolver.ts` | **纯函数**：给 `(nodes, nodeKey)` + 玩家上下文 → 返回过滤后的节点视图 |
| `src/modules/world/dialogue/dialogue.service.ts` | 取表 / 解析 / 条件求值（读任务·背包·redis 旗标）/ 动作执行 |
| `src/modules/world/dialogue/dialogue.service.spec.ts` | 单测（见 §1.6） |
| `src/modules/world/dto/dialogue.dto.ts` | `ChooseDialogueDto{ code, nodeKey, optionIndex }`、admin CRUD DTO |
| `seeds/dialogue.seed.ts` | 首个 NPC 的三分支对话种子（铁匠：接任务/给道具/闲聊） |

**修改（后端）**

| 路径 | 动作 |
|---|---|
| `src/modules/world/world.service.ts` | `talkNpc` 改为委托 `dialogueService`（无 `dialogueId`/未配对话时**保持旧兜底**：`attr.greeting`） |
| `src/modules/world/world.client.controller.ts` | +`POST dialogue/choose`、+`POST triggers/:id/story` |
| `src/modules/world/world.controller.ts` | +admin CRUD（list/detail/create/update/toggle） |
| `src/modules/world/world.module.ts` | 注册实体与 service |
| `src/constants/error-codes.ts` | +3 个 `430xx` 码 |
| `src/constants/enums.ts` | +`DialogueActionType` |

**修改（客户端 `packages-game/game-client/`）**

| 路径 | 动作 |
|---|---|
| `src/ui/DialogueView.ts` | **新增**：引擎内自绘对话框（说话人/正文/选项列表/键盘 1-9 与点击选择/ESC 关闭） |
| `src/world/InteractController.ts` | `talk` 成功后打开 `DialogueView`（不再只 toast） |
| `src/net/api.ts` | +`chooseDialogue(code,nodeKey,optionIndex,token)`、+`triggerStory(id,token)` |
| `src/entity/Entity.ts` | NPC 头顶任务标记（`questMarks`），引擎内绘制小图标（复用 S3 的 `Hud` 若已存在，否则本批自绘） |

### 1.6 测试基线

- **后端**：`npm test` 全绿，基线（80 suites / 998 tests）**不下降**；新增 `dialogue.service.spec.ts` ≥10 用例：节点解析、`optionIndex` 越界、条件过滤（等级/任务态/道具/旗标）、动作执行失败不推进、`once_only` 剧情只触发一次、无 `dialogueId` 时回退旧兜底、`nodeKey` 不属于该树时拒绝、`is_active=false` 拒绝。
- **纯函数**：`dialogue.resolver` 必须有「同输入同输出」与「隐藏选项不出现在结果中」的断言。
- **冒烟**：`scripts/smoke-dialogue-s5.mjs`（零依赖 node，复用 S1 冒烟的服务端交互方式）覆盖：对话返回节点 → 选择接任务分支 → `player_quests` 出现记录 → 选择给道具分支 → 背包 +1 → 条件不满足时选项被隐藏 → 剧情触发第二次返回拒绝。
- **客户端**：延续 S1/S2 口径（浏览器点检 + 冒烟），不引入单测框架。

### 1.7 已知限制（S5 明确不覆盖）

1. 无可视化剧本编辑器（GM 面板后置）；无对话配音/立绘/表情。
2. **不做持久对话会话**：断线/重进从头开始。
3. 不做多玩家共享剧情进度（多人协作剧情=后续批次）。
4. 对话内不做「多分支回溯/已读记录」。
5. `submit_quest` 只调用既有提交逻辑，不新增任务目标类型。

---

## 2. Tasks

> 后端 cwd = `e:\code\nest\packages-game\game-server`；客户端 cwd = `e:\code\nest\packages-game\game-client`。

### Task 1: `dialogues` 表 + 枚举 + 类型

- [x] **Step 1** `DialogueActionType { ACCEPT_QUEST/SUBMIT_QUEST/GIVE_ITEM/TAKE_ITEM/ADD_CURRENCY/SET_FLAG }` 加入 `enums.ts`（**取值与动作字符串一致**）。
- [x] **Step 2** 建 `Dialogue` 实体（§1.4 列定义；`nodes` 用 `jsonb`）。
- [x] **Step 3** `dialogue.types.ts`：`DialogueNode`/`DialogueOption`/`DialogueCondition` 类型 + `assertDialogueNodes(nodes)` 结构校验纯函数（`optionIndex` 必须在范围内、`next` 必须指向存在的 key 或为空）。
- [x] **Step 4** `world.module.ts` 注册实体。
- [x] **Step 5** 起服务后 `psql -U postgres -h localhost -d game_server -c "\d dialogues"` → Expected：列齐、`nodes` 为 `jsonb`。
- [x] **Step 6** commit：`feat(game-dialogue): 新增 dialogues 对话树表与动作枚举`

### Task 2: 条件求值与解析器（纯逻辑，先测后用）

- [x] **Step 1** `dialogue.resolver.ts`：`resolveNode(nodes, nodeKey, ctx)` → `{ key, speaker, text, options: [{ index, text, action }] }`（**隐藏被条件挡掉的选项；`index` 是原始数组下标**）。
- [x] **Step 2** `dialogue.service.ts` 的 `buildContext(playerId)`：并发读 `player_quests`（任务态）、`inventory`（道具）、redis 旗标 → `DialogueContext`。
- [x] **Step 3** 单测：等级不足隐藏、任务已接隐藏「接取」、未接任务隐藏「提交」、道具不足隐藏、`optionIndex` 越界拒绝、`next` 指向不存在的 key 时结构校验报错。
- [x] **Step 4** `npm test` → 全绿。
- [x] **Step 5** commit：`feat(game-dialogue): 对话条件求值与节点解析器`

### Task 3: 动作执行器

- [x] **Step 1** `executeAction(playerId, action, args)`：6 个动作分派到 `QuestService`/`InventoryService`/`EconomyService`/redis 旗标。
- [x] **Step 2** **失败即中止**：捕获 `GameException` 原样上抛（HTTP 200 + code），**不推进节点**、不吞异常。
- [x] **Step 3** `choose(playerId, {code,nodeKey,optionIndex})`：校验 code 存在且 `isActive` → 校验 `nodeKey ∈ tree` → 重新求值条件（防重放）→ 取 action → 执行 → 返回 `next` 节点（或 `finished:true`）。
- [x] **Step 4** 单测：接任务成功推进；背包满时「给道具」失败且**停留在原节点**；`give_item` 后 `PlayerItemChangeLog` 有记录；`add_currency` 走 `EconomyService`（有 opTrace）。
- [x] **Step 5** commit：`feat(game-dialogue): 对话动作执行器与 choose 接口服务`

### Task 4: `talk` 改造 + 两个客户端接口

- [x] **Step 1** `WorldService.talkNpc` 委托 `dialogueService.start(playerId, spawnId)`：有 `dialogueId` → 返回首节点；**无 → 原样走 `attr.greeting` 兜底**（保证 S1 冒烟与老 NPC 不炸）。
- [x] **Step 2** `NpcTalkResult` **只增字段**：`code?(string)`、`nodeKey?(string)`、`questMarks?({available:string[],submittable:string[]})`；`text` 在接入对话时为当前节点正文。
- [x] **Step 3** `world.client.controller.ts`：+`POST api/client/v1/world/dialogue/choose`（`JwtAuthGuard`）、+`POST api/client/v1/world/triggers/:id/story`（读 `story_id` → 首节点；`once_only` 时用 `acquireLock('world:story:once:<triggerId>', 31536000)`）。
- [x] **Step 4** 手工验证（后端已起）：
```
curl -s -X POST $BASE/api/client/v1/world/npcs/11/talk -H "Authorization: Bearer $T"
curl -s -X POST $BASE/api/client/v1/world/dialogue/choose -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"code":"npc_blacksmith_main","nodeKey":"root","optionIndex":0}'
```
  Expected：`code=0`；选择「接任务」分支后 `psql` 查 `player_quests` 出现新行。
- [x] **Step 5** 未授权校验：两接口不带 token → **401/403**（不是 404）。
- [x] **Step 6** commit：`feat(game-dialogue): talk 接入对话树 + choose/story 客户端接口`

### Task 5: admin CRUD 接口 + 种子

- [x] **Step 1** `world.controller.ts`（admin 前缀 `api/admin/v1/world`，`AdminGuard`）：`GET dialogue/list`、`GET dialogue/:id`、`POST dialogue`、`PUT dialogue/:id`、`POST dialogue/:id/toggle`。
- [x] **Step 2** 写接口前先跑 `assertDialogueNodes` 校验，非法结构直接 `PARAM_INVALID` + 指出问题 key。
- [x] **Step 3** `seeds/dialogue.seed.ts`：铁匠（`spawnId=12` 的 NPC 模板）三分支对话：①「接任务」→ `accept_quest`；②「要矿石」→ `give_item`；③「闲聊」→ 结束。幂等（按 `code` upsert）。挂到 `package.json` 的 `seed:dialogue`。
- [x] **Step 4** `npm run seed:dialogue` → Expected：打印 upsert 结果；重复执行不产生重复行。
- [x] **Step 5** commit：`feat(game-dialogue): 对话 admin CRUD 接口与铁匠种子数据`

### Task 6: 客户端 DialogueView + TalkComponent 改造

- [x] **Step 1** `DialogueView`（引擎内自绘，禁用 DOM）：底部对话框、说话人、正文（按宽度自动换行）、选项列表（`1-9` 键盘 + 鼠标点击）、`ESC` 关闭；打开时不阻塞移动但**屏蔽交互键 F**（避免连点重复请求）。
- [x] **Step 2** `InteractController`：`talk` 成功 → `DialogueView.open(res)`；选择 → `Api.chooseDialogue` → 渲染 `next` 节点；`finished` → 关闭。
- [x] **Step 3** NPC 头顶任务标记：`questMarks.available` 非空 → 黄色 `!`；`submittable` 非空 → 绿色 `?`（引擎内 `Laya.Text` 或绘制小图，不用 DOM）。
- [x] **Step 4** 错误处理：`body.code!==0` → `DialogueView` 内红字提示（`ITEM_NOT_ENOUGH` 显示「道具不足」等中文映射）。
- [x] **Step 5** 浏览器点检：走到铁匠 → F → 出现对话框 → 选「接任务」→ 提示成功 → 头顶标记变化 → 再选「提交」分支不可见（条件过滤生效）。
- [x] **Step 6** commit：`feat(game-client): 对话视图与 NPC 任务标记`

### Task 7: 冒烟 + 回归 + 生产部署

- [x] **Step 1** `scripts/smoke-dialogue-s5.mjs`（9 条断言，每条 `PASS/FAIL` + 证据，任一 FAIL → exit 1）：登录 → talk 返回节点 → 选项条件过滤（未接任务时「提交」不可见）→ 选接任务 → `player_quests` 存在 → 选给道具 → 背包数量增加 → `take_item` 不满足时报业务码 → 剧情触发首次成功 → 二次触发被拒。
- [x] **Step 2** `node scripts/smoke-dialogue-s5.mjs` → Expected：全 PASS，退出码 0。
- [x] **Step 3** 回归：`npm test` 全绿且 ≥998；`node scripts/smoke-laya2d-s1.mjs` 9/9 PASS。
- [x] **Step 4** 生产：本地 `npm run build` → `tar -czf dist-s5.tar.gz -C dist .` → scp → 服务器备份 `dist` + 替换 + `systemctl restart game-server` → 建表（**生产执行 DDL 脚本，禁止服务器构建**）→ `seed:dialogue`（生产用 `psql` 执行种子 SQL）。
- [x] **Step 5** 线上验收：`curl -s https://game.joho.cn/health`；用线上 token 走一次 talk + choose，确认 `code=0`。
- [x] **Step 6** commit：`test(game-dialogue): S5 冒烟脚本与部署验收记录`

---

## 3. 风险与回退

| # | 风险 | 触发信号 | 回退动作 |
|---|---|---|---|
| 1 | 破坏 S1 `talk` 契约 | S1 冒烟 FAIL | `NpcTalkResult` 只增字段；无 `dialogueId` 走旧兜底（Task 4 Step 1） |
| 2 | 动作重复执行（刷奖励） | 玩家反复提交同一 `optionIndex` | `choose` 每次**重新求值条件**（D4）；领奖类动作依赖 `QuestService` 的原子占位（已核实 `claimQuestReward` 用 `update` 占位） |
| 3 | 条件过滤把选项全隐藏 → 对话卡死 | 玩家看到空选项 | 校验：**每个节点必须至少有一个无条件选项**（种子与 admin 写入时校验） |
| 4 | `dialogue_id`/`story_id` 指向不存在行 | 接口 500 | 服务层判空并抛 `DIALOGUE_NOT_FOUND`（业务码而非 500） |
| 5 | 一次道具不足把对话打死 | 玩家背包满 | 失败**不推进节点**，客户端红字提示，玩家可清包后重选 |
| 6 | `430xx` 错误码段被占用 | 冲突 | 先在 `error-codes.ts` 全文搜索该段，取未用值 |
| 7 | 生产建表漏执行 | 线上接口 500 `relation "dialogues" does not exist` | 部署 Step 4 固化 DDL 脚本；验收先 `\d dialogues` |

---

## 4. 待确认项（动手前请回答；无异议则按【默认】执行）

1. **动作清单**是否就是 6 个（`accept_quest/submit_quest/give_item/take_item/add_currency/set_flag`）？【默认：是】——是否需要 `unlock_trigger`（解锁机关）/`teleport`（剧情传送）？
2. **NPC 头顶任务标记**是否本批做？【默认：做（只看 `available/submittable` 两态）】。
3. **对话是否要支持「已读/重复对话」区分**（同一个 NPC 第二次说话换台词）？【默认：不做，用条件 `questStatus` 表达即可】。
4. **GM 面板**是否本批做？【默认：不做，只做 admin 接口（面板统一在 S2b 之后的批次）】。
5. **本批是否上线生产**？【默认：是，走 S2 已建立的部署流程】。

---

## 5. 执行方式

沿用 **Subagent-Driven**：每 Task 派新 subagent，Task 间两阶段评审（先看 diff 是否符合计划，再看验收输出是否达标），每 Task 提交后跑 S1 冒烟作回归门禁。

任务依赖：Task 1 → Task 2 → Task 3 → Task 4 →（Task 5 可与 Task 4 并行）→ Task 6 → Task 7。

---

## 6. 执行记录（S5）

> 执行时间：2026-09-22（北京时间）。本地环境：PostgreSQL 16（`E:\PostgreSQL\16`，`localhost:5432/game_server`）+ mock-redis（`:6379`）+ 后端 dev server（`:3000`）。
> 生产环境：`odoo`（39.106.99.9）、应用 `/opt/game-server`、服务 `game-server`、DB 容器 `1Panel-postgresql-4LsS`、公网 `https://game.joho.cn`。

### 6.1 各 Task 提交

| Task | commit | message |
|---|---|---|
| Task 1 | `285cfebeb` | feat(game-dialogue): 新增 dialogues 对话树表与动作枚举 |
| Task 2 | `00b03b74b` | feat(game-dialogue): 对话条件求值与节点解析器 |
| Task 3 | `4d355a979` | feat(game-dialogue): 对话动作执行器与 choose 接口服务 |
| Task 4 | `a759cb14c` | feat(game-dialogue): talk 接入对话树 + choose/story 客户端接口 |
| Task 5 | `da47c6949` | feat(game-dialogue): 对话 admin CRUD 接口与铁匠种子数据 |
| Task 6 | `e15b07e30` | feat(game-client): 对话视图与 NPC 任务标记 |
| Task 7 | `33683e191` | test(game-dialogue): S5 冒烟脚本与回归（含 `scripts/mock-redis.js` 基建修复） |
| Task 7 | （本次 docs 提交） | docs(s5): S5 验收记录与生产部署 |

> 偏离说明：计划 §2 Task 7 Step 4/Step 6 原写「一个提交 `test(game-dialogue): S5 冒烟脚本与部署验收记录`」，实际拆成两个提交——`33683e191`（冒烟脚本 + mock-redis 修复）与本次 docs 提交（勾选 + 执行记录），保持「单次提交聚焦一件事」。

### 6.2 门禁实测

| 项 | 命令 | 期望 | 实测 |
|---|---|---|---|
| S5 冒烟（服务端，新增） | `game-server: node scripts/smoke-dialogue-s5.mjs` | 9/9 PASS，exit 0 | **9/9 PASS**（末行「S5 对话冒烟全部通过」，exit 0；重复执行结果一致） |
| S1 冒烟回归 | `game-server: node scripts/smoke-laya2d-s1.mjs` | 9/9 PASS | **9/9 PASS**（末行「S1 冒烟全部通过」，exit 0） |
| 后端回归 | `game-server: npx jest --silent` | 全绿，tests ≥ 998（运行前基线 85 suites / 1079 tests） | **Test Suites: 85 passed / 85；Tests: 1079 passed / 1079**（未下降） |
| 客户端断言（S4 回归） | `game-client: node tools/build-fallback.mjs; node scripts/smoke-s4-npc.mjs` | 18/18 PASS | **构建 OK（28 个产物重写导入扩展名）；18/18 PASS** |
| 客户端断言（S5 新增） | `game-client: node scripts/smoke-s5-dialogue.mjs` | 27/27 PASS | **27/27 PASS** |

### 6.3 Task 7 冒烟脚本原始输出（9 条断言）

```
  后端 /health 可达（http://localhost:3000）
PASS ① 登录拿到客户端 token/playerId（全新账号，干净初始态） :: username=s5smokebxfmo2 playerId=49 token=eyJhbGciOiJI…
PASS ② talk(spawnId=12) 返回对话节点（code/nodeKey/options） :: code=0 dialogueCode=npc_blacksmith_main nodeKey=root text="哟，客人来得正好。要打点什么家伙什？" options=3
PASS ③ 未接任务时「提交任务」选项被服务端隐藏（options=3 且 optionIndexes 不含 2） :: options=3 optionIndexes=[0,1,3] texts=[我想找点事做 | 给我点矿石 | 闲聊]
PASS ④ talk 返回的 optionIndexes[0] 即「接任务」原始下标 0 :: optionIndexes[0]=0 text="我想找点事做"
PASS ④ choose(接任务) 返回 code=0 且推进到 accepted 节点 :: code=0 nodeKey=accepted text="任务已接下，去外面转转吧。"
PASS ⑤ quest/list 出现该玩家的任务记录（questTemplateId=1） :: 记录=playerQuestId=8 status=in_progress template="demo-铁匠的委托" 共1条
PASS ⑥ choose(给道具) 后背包道具 1 数量增加（差值 = 1） :: optionIndex=1 code=0 nodeKey=got_item；背包 0 → 1（Δ=1）
  admin 登录成功（token=eyJhbGciOiJI…）
  临时 take_item 对话 id=3（已存在，已重新启用）quantity=999
PASS ⑦ take_item 数量不足 → 返回业务码（20002 ITEM_NOT_ENOUGH）且不推进节点 :: 持有=1 需交出=999 → body.code=20002 msg="道具数量不足"
  [前置] 清理一次性锁键 world:story:once:2 → DEL=0（令首次触发必然成功）
PASS ⑧ 剧情触发首次成功（trigger=2 → 对话首节点，且一年期锁已落库） :: body.code=0 dialogueCode=npc_blacksmith_main nodeKey=root；EXISTS world:story:once:2 = 1
PASS ⑨ 二次触发被拒（返回 43002 DIALOGUE_CONDITION_NOT_MET） :: 第二次 body.code=43002 msg="该剧情只能触发一次"（期望 43002）

S5 对话冒烟全部通过
[清理] 临时对话 id=3 置为停用：code=0 msg=success
[清理] 删除一次性锁键 world:story:once:2 → DEL=1
```

**脚本设计要点（复用 S1/S4 冒烟口径）**：

- 每次运行**自动注册全新账号**（`s5smokeXXXXXX`），天然绕开历史 `player_quests` / `inventory_items` 残留（本地库中玩家 1 与历史账号 43–47 均有 Task 4 遗留的 `quest 1 = in_progress`、玩家 1 有 1 个矿石，脚本不依赖也不改动它们）。
- 断言 ⑦ 的「`take_item` 数量不足」场景由脚本经 **admin 接口**自建幂等临时对话（`code=smoke_tmp_take_item`，`quantity=999`），跑完 `PUT dialogue/:id {isActive:false}` 停用；DB 实测该行 `is_active=f`。
- 断言 ⑧⑨ 的外部前置：`scene_triggers.id=2`（`trigger_type='story'`、`once_only=true`）的 `story_id` 临时指向 `dialogues.id=1`，验证后**已还原为 NULL**（实测 `story_id` 为空）。
- 脚本内置约 40 行**极简 RESP 客户端**（原生 `net`，零新增依赖），用于清理/校验一次性锁键——同时把「⑨ 二次触发被拒」与 mock-redis 的 `NX`/`EX` 修复直接挂钩（见 6.4）。

### 6.4 附带修复：dev 基建 `scripts/mock-redis.js`（纳入 `33683e191`）

**缺陷**：mock-redis 的 `SET` 命令**忽略 `NX`**（`CacheService.acquireLock` 恒返回成功 → 一次性锁形同虚设）；且 `EX` 秒数 × 1000 超出 Node `setTimeout` 32 位上限（约 24.8 天）被静默改成 1ms，**一年期剧情锁会瞬间失效**。

**修复**：`NX` 命中已存在键时返回 nil 且不写；`EX/PX` 毫秒数做上界钳制 `Math.min(ms, 2147483647)`。

**修复验证（临时 Node 脚本直连 6379，用完已删除）**：

```
SET k v NX  #1 => "OK"  (期望 "OK")
SET k v NX  #2 => null  (期望 null)   PASS
SET k2 v EX 3600 => EXISTS #1 = 1 (期望 1)
400ms 后再 EXISTS  => EXISTS #2 = 1 (期望 1，不再瞬时消失)   PASS
exit=0
```

**端到端复证**：冒烟断言 ⑧ 在首次触发后用 `EXISTS world:story:once:2 = 1` 证明一年期锁**确实落库并存活**（正是 EX 钳制修复的现场证据），断言 ⑨ 随即被拒（`43002`）证明 NX 语义生效。

### 6.5 生产部署

| 步骤 | 命令 / 做法 | 结果 |
|---|---|---|
| 构建（本地） | `game-server: npm run build` | exit 0；`dist/src/main.js` + `dist/seeds` 生成 |
| 打包/上传 | `tar -czf dist-s5.tar.gz -C dist .`；`scp` → `odoo:/tmp/` | 700,990 bytes |
| 备份 | `cp -r dist dist_prev_20260922_081102_preS5`（首次因引号转义问题落在 `dist_prev_\`，已重命名为该目录） | 备份内 `src/modules/world/` **无** `dialogue/`（确认是 S5 前版本），可用于回滚；主 `dist` 未被破坏 |
| 替换 | `tar -xzf /tmp/dist-s5.tar.gz -C /opt/game-server/dist` | 解包后入口仍为 `dist/src/main.js`；`src/modules/world/dialogue/`、`dialogue-admin.controller.js` 就位 |
| 重启 | `sudo systemctl restart game-server` | `systemctl is-active` → **active** |
| 日志 | `journalctl -u game-server -n 60 --no-pager` | 新 PID `1905457`：`Redis connected` → `Nest application successfully started` → `Game server started on port 3000`；**该 PID 的 error 行数 = 0** |
| 新路由 | 日志 grep | `/api/client/v1/world/dialogue/choose`、`/api/client/v1/world/triggers/:id/story`、admin `dialogue/list|:id|POST|PUT|:id/toggle` 全部 `Mapped` |

> 未回滚：启动一次成功，无需回退。

### 6.6 生产建表与种子（禁止服务器构建 / 禁止 ts-node）

**建表**：走生产 `.env.prod` 的 `DB_SYNCHRONIZE=true` 在重启时自动建表，`docker exec 1Panel-postgresql-4LsS psql -U game -d game_server -c "\d dialogues"` 实测：

```
     Column   |            Type             | Nullable |           Default
--------------+-----------------------------+----------+------------------------------
 id           | bigint                      | not null | nextval('dialogues_id_seq')
 code         | character varying(64)       | not null |
 title        | character varying(128)      | not null |
 nodes        | jsonb                       | not null | '[]'::jsonb
 version      | integer                     | not null | 1
 is_active    | boolean                     | not null | true
 created_at   | timestamp without time zone | not null | now()
 updated_at   | timestamp without time zone | not null | now()
 deleted_at   | timestamp without time zone |          |
Indexes: PK_6746abe5bef7ba5c9f006569462 PRIMARY KEY (id); uq_dialogue_code UNIQUE (code)
```

**种子**：把 `seeds/dialogue.seed.ts` 的逻辑翻译成**纯 SQL**（`/tmp/s5-seed.sql`，`psql -f -` 执行，跑完已删除），全部以 **name / code** 判重、**不硬编码 id**（生产 `item_templates` 已有 40+ 行、`quest_templates` 已有 30+ 行，id 与本地不同）：

```sql
INSERT INTO item_templates (...) SELECT 'demo-铁矿石', ... WHERE NOT EXISTS (SELECT 1 FROM item_templates WHERE name='demo-铁矿石');
INSERT INTO quest_templates (...) SELECT 'demo-铁匠的委托', ... WHERE NOT EXISTS (SELECT 1 FROM quest_templates WHERE name='demo-铁匠的委托');
WITH q AS (...), i AS (...) INSERT INTO dialogues (code,title,nodes,version,is_active) SELECT 'npc_blacksmith_main', ... FROM q,i ON CONFLICT (code) DO UPDATE SET title=EXCLUDED.title, nodes=EXCLUDED.nodes, is_active=EXCLUDED.is_active, updated_at=now();
UPDATE npc_templates SET dialogue_id = (SELECT id FROM dialogues WHERE code='npc_blacksmith_main') WHERE id = (SELECT template_id FROM scene_entity_spawns WHERE id=12);
```

执行结果（首次）：`SET / BEGIN / INSERT 0 1 / INSERT 0 1 / INSERT 0 1 / UPDATE 1 / COMMIT`；**重跑**：`INSERT 0 0 / INSERT 0 0 / INSERT 0 1（ON CONFLICT 更新）/ UPDATE 1`（幂等确认）。执行后核对：

| 对象 | 生产实测 |
|---|---|
| 道具模板 | `item_templates.id=40 name='demo-铁矿石'` |
| 任务模板 | `quest_templates.id=33 name='demo-铁匠的委托'` |
| 对话树 | `dialogues.id=1 code='npc_blacksmith_main' is_active=t`，`jsonb_array_length(nodes)=5` |
| NPC 绑定 | `scene_entity_spawns.id=12`（`entity_type='npc'`）→ `npc_templates.id=2 'spike-铁匠' dialogue_id=1`；村长(11)/货郎(13) 仍为空 |
| 节点内容 | `root.options[0].actionArgs.questTemplateId="33"`、`[1].actionArgs.itemTemplateId="40"`、`[2].condition.questId="33"`（id 由子查询真实解析） |

### 6.7 线上验收

本地 `curl.exe` 因 DNS 线程问题需 `--resolve game.joho.cn:443:39.106.99.9`，且本机 schannel 缺根证书故加 `-k`（仅影响本地校验，不影响服务端）：

```
GET https://game.joho.cn/health                → http_code=200
{"code":0,"msg":"success","data":{"status":"ok","info":{"database":{"status":"up"},"redis":{"status":"up"},"bullmq":{"status":"up","waitingQueues":0}}}}
GET https://game.joho.cn/gamedata/manifest.json → manifest_http_code=200（旧接口不回归）

POST /api/client/v1/world/npcs/12/talk（线上新建账号 playerId=127）
{"code":0,...,"data":{"spawnId":"12","npcTemplateId":"2","name":"spike-铁匠","talkType":"talk","dialogueId":1,
 "text":"哟，客人来得正好。要打点什么家伙什？",
 "options":[{"text":"我想找点事做","next":"accepted"},{"text":"给我点矿石","next":"got_item"},{"text":"闲聊","next":"chat"}],
 "code":"npc_blacksmith_main","nodeKey":"root","optionIndexes":[0,1,3],"questMarks":{"available":[...],"submittable":[]}}}

POST /api/client/v1/world/dialogue/choose  {"code":"npc_blacksmith_main","nodeKey":"root","optionIndex":0}
{"code":0,...,"data":{"code":"npc_blacksmith_main","nodeKey":"accepted",
 "node":{"key":"accepted","text":"任务已接下，去外面转转吧。","options":[{"index":0,"text":"知道了"}],"speaker":"铁匠"},"finished":false}}
```

结论：**线上 `talk` / `choose` 均 `code=0`**；`talk` 旧字段（`spawnId/npcTemplateId/name/talkType/dialogueId/text/options`）形状与语义零变更，新增 `code/nodeKey/optionIndexes/questMarks` 为增量；线上同名玩家未接任务，`提交任务` 同样被隐藏（`optionIndexes=[0,1,3]`）。
清理：服务器 `/tmp/dist-s5.tar.gz`、`/tmp/s5-seed.sql`、`/tmp/s5-verify.sql` 已删；本地临时包与临时脚本已删（仓库内无残留）。

### 6.8 已知限制（S5 明确不覆盖）

1. **无可视化剧本编辑器**：只有 admin CRUD 接口（`AdminGuard`），GM 面板后置到后续批次；无配音/立绘/表情。
2. **无持久对话会话**：`choose` 需带 `code + nodeKey`，断线/重进从头开始（D7）；对话内无「已读记录 / 多分支回溯」。
3. **`submit_quest` 不新增任务目标类型**：只调用既有 `QuestService.submitQuest`；`quest_templates` 仍**无 giver 字段**，NPC↔任务绑定由对话动作 `accept_quest` 承载。
4. **`scene_triggers.story_id` 的一次性锁是「全局」而非「按玩家」**：键为 `world:story:once:<triggerId>`，同一触发器**首个玩家**触发后对所有人都不再触发。单机剧情可接受，多人共享剧情进度留后续批次。
5. **mock-redis 仅为开发替身**：`NX`/`EX` 已按本次修复语义对齐，但 `TTL` 仍固定返回 `-1`、无持久化；生产用真实 Redis（线上 `/health` 显示 `redis: up`）。
6. **本地遗留测试数据**：本地库新增若干 `s5smokeXXXXXX` / `s5chkXXXXXX` 测试账号与一条停用的临时对话（`dialogues.id=3 code='smoke_tmp_take_item' is_active=f`）；均为开发库数据，不影响交付物与生产。