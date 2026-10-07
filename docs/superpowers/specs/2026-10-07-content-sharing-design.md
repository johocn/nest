# 内容共享与题库系统设计（游戏框架数据中心）

- 日期：2026-10-07
- 状态：已确认（分节评审通过）
- 范围：game-server 内容层归属机制 + quiz 题库模块 + 接入层

## 1. 目标与约束

本框架是所有小游戏的数据中心。需要：

- 共享公共基础数据（场景、题库等客观内容），所有游戏可见
- 各游戏实现特色剧情、支线任务，互不干扰
- 两种接入形态都要支持：本引擎内玩法模块 + 独立客户端（API 取数）
- 特色内容以「剧本/内容差异」为主，引擎预留 action/condition 扩展点但不新增机制
- 最简方案：零数据复制、单一事实源、增量迁移

非目标（本期不做）：内容中台独立服务化、内容版本化/灰度发布、玩家数据跨游戏分域。

## 2. 方案选型（已定）

**方案 A：内容归属字段 + 叠加共享**（否决 B：命名前缀约定——数值主键表无法覆盖；否决 C：独立内容中台——当前规模过重）。

核心：新增 `apps` 表（游戏产品注册，区别于玩法级 `street_games`）；内容表加 `app_scope` 列；统一读取规则 `app_scope IN ('common', :currentApp)`。

## 3. 数据模型

### 3.1 apps（游戏产品注册）

| 列 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | |
| code | varchar(32) UNIQUE | 游戏 app 标识（即 app_scope 值） |
| name | varchar(64) | |
| api_key | varchar(128) | 独立客户端接入凭证（阶段 3） |
| status | enum | enabled/disabled |
| created_at / updated_at / deleted_at | | |

### 3.2 内容表归属

继承基类：

```ts
export const COMMON_SCOPE = 'common';

export abstract class ContentScopedEntity {
  @Column({ name: 'app_scope', type: 'varchar', length: 32, default: COMMON_SCOPE })
  appScope: string;
}
```

改造范围（阶段 1）：`scenes`、`scene_entity_spawns`、`scene_triggers`、`npc_templates`、`npc_spawn_rules`、`dialogues`、`quest_templates`；阶段 2 新表同继承。

存量迁移：加列 `default 'common'`，存量行天然为公共内容，零回填。

唯一索引调整：`dialogues.uq_dialogue_code` → `(app_scope, code)`。

### 3.3 依赖方向约束

跨 scope 引用只允许 **游戏内容 → 公共内容**（如 B 的触发器 story_id 指向 B 的对话或公共对话），不允许反向。在 service 校验，不加 DB 外键。

## 4. 查询过滤机制（防越权可见，四层）

1. **实体基类**：scope 列收敛一处（见 3.2）
2. **查询 helper 唯一出口**：

```ts
export function visibleTo(appCode: string | null) {
  return { appScope: In(appCode ? [COMMON_SCOPE, appCode] : [COMMON_SCOPE]) };
}

export function applyContentScope<T>(
  qb: SelectQueryBuilder<T>, alias: string, appCode: string | null,
): SelectQueryBuilder<T> {
  return qb.andWhere(`${alias}.app_scope IN (:...scopes)`, {
    scopes: appCode ? [COMMON_SCOPE, appCode] : [COMMON_SCOPE],
  });
}
```

3. **appCode 不信任前端**：本框架主游戏在 apps 表注册为默认 app（code=`main`）；引擎内玩法模块各自登记一行，后端调用点显式传入对应 appCode；独立客户端 = `apps.api_key` 凭证解析 appCode。appCode 一律来自服务端注册信息，与玩家 JWT 身份解耦
4. **契约测试基类** `testing/content-scope-contract.spec.shared.ts`：每张 scope 表的 service 测试继承，自动断言：A 可见 common、A 不可见 B 自有、null 只见 common。漏写过滤 = CI 红灯

## 5. 特色内容叠加

场景是公共基础设施（scene 行默认 common，也允许游戏自建私有场景）。游戏特色内容挂在内容层，统一读取即叠加——一个游戏的场景视图 = common 内容 + 自己的内容，零运行时合并逻辑。

| 表 | 叠加形态 |
|---|---|
| scene_entity_spawns | 游戏 B 的采集物/怪物只有 B 可见 |
| scene_triggers | 游戏 B 的剧情入口触发器仅 B 可触发 |
| npc_templates + npc_spawn_rules | 游戏 B 的特色 NPC 出现在公共城镇 |
| dialogues / quest_templates | 各游戏独立剧本/任务命名空间 |

- 不同游戏的 spawn 允许重叠（互不可见）；与公共物件重叠由 admin 端可视化提示 + 内容规范解决，不设 DB 约束
- 对话引擎 `action/actionArgs` 体系即扩展点，新增 action 类型不侵入现有引擎

## 6. 题库系统（quiz）

用途：情商测试、性格评估（心理测评）为主，兼容知识问答。三层模型：

```
quiz_questions（题目池） --< quiz_assessment_items >-- quiz_assessments（测评卷）
                                                            ↓ result_rules
                                                      quiz_results（结果库）
```

### 6.1 quiz_questions

| 列 | 说明 |
|---|---|
| kind | `knowledge`（有对错）/ `assessment`（无对错，计分+分支） |
| content | 题干 |
| options jsonb | `[{ text, answer?, score?, goto? }]`：knowledge 用 answer；assessment 用 score + goto（缺省走卷内顺序） |
| multi_select | 仅 knowledge（多选） |
| category / difficulty / tags | 分类/难度/标签 |
| app_scope | 继承基类 |

### 6.2 quiz_assessments（测评卷）

- `code`（UNIQUE within scope，start API 按它定位卷）/ `title` / `description` / `status` / `app_scope`
- `start_question_id` + items 顺序 = 默认流程；单题 goto 覆盖（实现「选 A 跳到第几题」）
- `scoring_rule jsonb` 两种模式：
  - 总分制：得分区间 → 结果（`[{min,max,result}]`）
  - 维度制：items 标 `dimension`，按维度分桶累计 → 各维度区间映射结果（性格类型式）
- **admin 保存时校验流程连通性**：goto 无死链/死循环、所有路径可达 result
- items（`quiz_assessment_items`）：assessment_id、question_id、sort_order、next_question_id（默认顺序）、dimension

### 6.3 quiz_results（结果库）

`code / title / content(文案+建议) / app_scope`。题目池可共享（公共情商题库 common），**卷和结果文案各游戏自有**——游戏 B 用公共题目组自己的卷、写自己的结果文案。

### 6.4 运行时（服务端持有敏感字段）

- `quiz_sessions`：player_id、assessment_id、当前题指针、按维度累计分、answers jsonb
- `POST /assessments/:code/start` → 建会话，返回首题（options 剥离 answer/score/goto）
- `POST /quiz/sessions/:id/answer` → 服务端读 score/goto，累计跳转，返回下一题或 `{ finished, result }`
- 下发裁剪在序列化层统一剥离，伪造提交拿不到分值信息
- 续答：session 持有指针与累计分
- 清理：未完成 session 24h 过期，scheduler 加清理任务
- 知识问答：`POST /quiz/draw`（返回不含 answer）+ `POST /quiz/submit`（服务端判定，返回对错+解析+奖励）
- `quiz_answers`：player_id、question_id、is_correct、app_code、created_at（防重复计分 + 正确率统计；draw 默认优先抽未答过的题）

### 6.5 奖励与剧情衔接

评测定结果、知识题答对均走现有 reward 体系。对话树 action 新增 `'quiz'`（知识问答）与 `'assess'`（启动测评），actionArgs 指定卷/题类与奖励。

## 7. 迁移与落地顺序

一次 migration（DDL 按惯例双轨：`scripts/ddl/*.sql` + TypeORM migration）：

1. 内容表加 `app_scope`（default 'common'）
2. `dialogues` 唯一索引改 `(app_scope, code)`
3. 新表：apps、quiz_questions、quiz_assessments、quiz_assessment_items、quiz_results、quiz_sessions、quiz_answers

三阶段落地（每阶段独立可验证、可上线）：

| 阶段 | 内容 | 验证 |
|---|---|---|
| 1. scope 基础设施 | apps 表 + 基类 + helper + 契约测试基类 + 现有内容 service 查询改造 | 既有全量测试绿 + 新契约测试 |
| 2. quiz 模块 | 题目池/卷/结果/会话全套 + 两类 API + admin CRUD（含流程校验） | 单测 + curl 冒烟（含越权用例）。已实施（2026-10-07，计划 2026-10-07-quiz-phase2.md，提交链 bb42fb076..本提交） |
| 3. 接入层 | client API 封装 + 对话 action + 独立客户端凭证（apps.api_key） | UI 实测 + API 冒烟 |

已定决策：独立客户端复用本框架账号体系（auth/player 通用 HTTP）；阶段 2 admin 页面顺带按 app 过滤改造。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 内容查询漏写 scope 过滤 | 四层机制：helper 唯一出口 + 契约测试兜底（CI 红灯） |
| 测评流程 goto 死链/死循环 | admin 保存时连通性校验 |
| 题库量小 draw 重复率高 | quiz_answers 支持「优先抽未答过」为默认行为 |
| 会话状态堆积 | 24h 过期清理任务 |
| 存量内容迁移 | 列默认值即 common，零回填 |
