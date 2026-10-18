# 内容共享 scope 基础设施（阶段 1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为所有内容表装上 `app_scope` 归属过滤网——本阶段机制就位但运行时行为零变化（全部调用传 null → 只见 common，存量内容即 common）。

**Architecture:** `ContentScopedEntity` 基类提供 scope 列；`visibleTo()/applyContentScope()` 是 scope 条件唯一出口；契约断言 helper 抓「漏写过滤」（mock repo 捕获 where 断言含 appScope 条件）。apps 表本阶段只建 entity+表结构，凭证 API 在阶段 3。

**Tech Stack:** NestJS 11 + TypeORM + PostgreSQL 16 + Jest/ts-jest。

**依据 spec:** `docs/superpowers/specs/2026-10-07-content-sharing-design.md`（阶段 1 范围 = 第 3/4/7 节）

**环境须知（执行者必读）:**
- 工作目录 `e:\code\nest\packages-game\game-server`（git 仓库根在 `e:\code\nest`）
- PowerShell 不支持 `&&`，用 `;`
- tsc：`& ".\node_modules\.bin\tsc.cmd" --noEmit -p tsconfig.json`（cwd=game-server）
- 测试：`npx jest <pattern> --silent`（jest 已配 forceExit）
- 路径别名：`@shared/*` `@modules/*` `@constants/*` 等，见 package.json jest.moduleNameMapper
- commit 只 add 本任务文件，不碰工作区其它改动

---

### Task 1: content-scope 基础（基类 + helper + 单测）

**Files:**
- Create: `src/shared/content-scope.ts`
- Test: `src/shared/content-scope.spec.ts`

- [ ] **Step 1.1: 写失败测试**

```ts
// src/shared/content-scope.spec.ts
import { In, type FindOperator } from 'typeorm';
import { COMMON_SCOPE, visibleTo, applyContentScope } from './content-scope';

describe('visibleTo', () => {
  it('null → only common', () => {
    const w = visibleTo(null);
    expect((w.appScope as FindOperator<string>).value).toEqual([COMMON_SCOPE]);
  });

  it('appCode → common + app', () => {
    const w = visibleTo('gameB');
    expect((w.appScope as FindOperator<string>).value).toEqual([COMMON_SCOPE, 'gameB']);
  });
});

describe('applyContentScope', () => {
  it('appends app_scope condition to query builder', () => {
    const calls: Array<{ sql: string; params: unknown }> = [];
    const qb = {
      andWhere: (sql: string, params: unknown) => {
        calls.push({ sql, params });
        return qb;
      },
    } as never;
    applyContentScope(qb, 'sp', 'gameB');
    expect(calls[0].sql).toContain('sp.app_scope IN (:...scopes)');
    expect(calls[0].params).toEqual({ scopes: [COMMON_SCOPE, 'gameB'] });
  });
});
```

- [ ] **Step 1.2: 跑测试确认失败**

Run: `npx jest content-scope --silent`
Expected: FAIL（模块不存在）

- [ ] **Step 1.3: 实现**

```ts
// src/shared/content-scope.ts
import { In, type FindOptionsWhere, type SelectQueryBuilder } from 'typeorm';

/** 公共内容归属值：所有游戏可见 */
export const COMMON_SCOPE = 'common';

/**
 * 内容归属基类：scenes/scene_entity_spawns/scene_triggers/npc_templates/
 * npc_spawn_rules/dialogues/quest_templates 及 quiz 系列实体继承。
 * appCode 语义见 docs/superpowers/specs/2026-10-07-content-sharing-design.md 第 4 节。
 */
export abstract class ContentScopedEntity {
  appScope: string;
}

/** find/findOne 形态的 scope 条件（展开进 where 对象） */
export function visibleTo(appCode: string | null): FindOptionsWhere<never> {
  return {
    appScope: In(appCode ? [COMMON_SCOPE, appCode] : [COMMON_SCOPE]),
  } as FindOptionsWhere<never>;
}

/** QueryBuilder 形态的 scope 条件 */
export function applyContentScope<T>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  appCode: string | null,
): SelectQueryBuilder<T> {
  return qb.andWhere(`${alias}.app_scope IN (:...scopes)`, {
    scopes: appCode ? [COMMON_SCOPE, appCode] : [COMMON_SCOPE],
  });
}
```

注意：`ContentScopedEntity` 此处只有字段声明（无 `@Column`），`@Column` 装饰器必须放在各实体文件内（TypeORM 装饰器在抽象基类上需要子类显式继承列元数据，跨文件抽象基类装饰列在 ts-jest mock 场景下易踩坑且迁移脚本已含列定义）。各实体 Task 3 自己声明列。——若实现时验证抽象基类带 `@Column` 工作正常，可回迁基类，二选一，保持「列定义只有一处」原则。

- [ ] **Step 1.4: 跑测试确认通过**

Run: `npx jest content-scope --silent`
Expected: PASS（3 tests）

- [ ] **Step 1.5: Commit**

```powershell
git add packages-game/game-server/src/shared/content-scope.ts packages-game/game-server/src/shared/content-scope.spec.ts
git commit -m "feat(game-server): content scope 基础（visibleTo/applyContentScope + 单测）"
```

---

### Task 2: apps 表 + migration 0005 + DDL SQL

**Files:**
- Create: `src/modules/apps/entities/app.entity.ts`
- Create: `src/modules/apps/apps.module.ts`
- Create: `src/migrations/1791340000000-ContentScope0005.ts`
- Create: `scripts/ddl/2026-10-07-content-scope-0005.sql`
- Modify: `src/app.module.ts`（注册 AppsModule）

- [ ] **Step 2.1: 确认内容表真实表名**

Run: `Grep pattern "@Entity\(" path src/modules` ——记录 7 张内容表的准确表名（scenes / dialogues 已知；其余以 grep 结果为准：scene_entity_spawns / scene_triggers / npc_templates / npc_spawn_rules / quest_templates 预期如此，若不同以实际为准并在 Step 2.4/2.5 使用实际表名）。

- [ ] **Step 2.2: App entity + module**

```ts
// src/modules/apps/entities/app.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn,
} from 'typeorm';

@Entity('apps')
export class App {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** 游戏 app 标识（= 内容表 app_scope 值），如 main / gameB */
  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  /** 独立客户端接入凭证（阶段 3 启用鉴权） */
  @Column({ type: 'varchar', length: 128, default: '' })
  apiKey: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
```

```ts
// src/modules/apps/apps.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { App } from './entities/app.entity';

@Module({
  imports: [TypeOrmModule.forFeature([App])],
  exports: [TypeOrmModule],
})
export class AppsModule {}
```

`src/app.module.ts` imports 数组追加 `AppsModule`（跟随现有模块 import 排序惯例）。

- [ ] **Step 2.3: 跑 tsc**

Run: `& ".\node_modules\.bin\tsc.cmd" --noEmit -p tsconfig.json`
Expected: 退出码 0

- [ ] **Step 2.4: TypeORM migration 0005**

```ts
// src/migrations/1791340000000-ContentScope0005.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

const CONTENT_TABLES = [
  'scenes',
  'scene_entity_spawns',
  'scene_triggers',
  'npc_templates',
  'npc_spawn_rules',
  'quest_templates',
];

export class ContentScope00051791340000000 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    for (const t of CONTENT_TABLES) {
      await qr.query(
        `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common'`,
      );
    }
    await qr.query(`ALTER TABLE dialogues ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common'`);
    // dialogue 唯一索引改复合（约束名按现有 uq_dialogue_code）
    await qr.query(`ALTER TABLE dialogues DROP CONSTRAINT IF EXISTS uq_dialogue_code`);
    await qr.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_dialogue_code ON dialogues (app_scope, code)`);
    await qr.query(`
      CREATE TABLE IF NOT EXISTS apps (
        id bigserial PRIMARY KEY,
        code varchar(32) NOT NULL UNIQUE,
        name varchar(64) NOT NULL,
        api_key varchar(128) NOT NULL DEFAULT '',
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS apps`);
    await qr.query(`DROP INDEX IF EXISTS uq_dialogue_code`);
    await qr.query(`ALTER TABLE dialogues ADD CONSTRAINT uq_dialogue_code UNIQUE (code)`);
    await qr.query(`ALTER TABLE dialogues DROP COLUMN IF EXISTS app_scope`);
    for (const t of CONTENT_TABLES) {
      await qr.query(`ALTER TABLE ${t} DROP COLUMN IF EXISTS app_scope`);
    }
  }
}
```

⚠️ 执行前用 Step 2.1 的实际表名核对 `CONTENT_TABLES`。dialogues 的索引若当前实现是 `@Index('uq_dialogue_code', ['code'], { unique: true })`（TypeORM 生成唯一索引而非约束），则 `DROP CONSTRAINT` 失败属正常——改为 `DROP INDEX IF EXISTS uq_dialogue_code`。先在本地库 `\d dialogues` 确认是约束还是索引再定稿。

- [ ] **Step 2.5: DDL SQL（生产双轨惯例，幂等）**

```sql
-- scripts/ddl/2026-10-07-content-scope-0005.sql
-- 内容共享 scope 基础设施（阶段 1）：内容表 app_scope + dialogues 复合唯一 + apps 表
-- 幂等：可重复执行。执行后验证见文件尾注释。
\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE scenes            ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common';
ALTER TABLE scene_entity_spawns ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common';
ALTER TABLE scene_triggers    ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common';
ALTER TABLE npc_templates     ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common';
ALTER TABLE npc_spawn_rules   ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common';
ALTER TABLE quest_templates   ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common';
ALTER TABLE dialogues         ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common';

DROP INDEX IF EXISTS uq_dialogue_code;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dialogue_code ON dialogues (app_scope, code);

CREATE TABLE IF NOT EXISTS apps (
  id bigserial PRIMARY KEY,
  code varchar(32) NOT NULL UNIQUE,
  name varchar(64) NOT NULL,
  api_key varchar(128) NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

INSERT INTO apps (code, name) VALUES ('main', '主游戏') ON CONFLICT (code) DO NOTHING;

COMMIT;

-- 验证：SELECT app_scope, count(*) FROM scenes GROUP BY 1;  → 仅 common
-- 验证：SELECT code FROM apps;                              → main
```

- [ ] **Step 2.6: 本机库执行 DDL 并验证**

Run: `psql` 执行脚本（沿用既往本机 PostgreSQL 连接方式），然后：
`npx jest --silent` 抽查 world 相关套件仍绿；`& ".\node_modules\.bin\tsc.cmd" --noEmit -p tsconfig.json` 退出码 0
Expected: 全绿（实体尚未继承基类，本步仅表结构就位）

- [ ] **Step 2.7: Commit**

```powershell
git add packages-game/game-server/src/modules/apps packages-game/game-server/src/migrations/1791340000000-ContentScope0005.ts packages-game/game-server/scripts/ddl/2026-10-07-content-scope-0005.sql packages-game/game-server/src/app.module.ts
git commit -m "feat(game-server): apps 表 + content scope 迁移 0005（双轨 DDL）"
```

---

### Task 3: 7 个内容实体继承基类 + dialogue 复合唯一索引

**Files:**
- Modify: `src/modules/world/entities/scene.entity.ts`
- Modify: `src/modules/world/entities/scene-entity-spawn.entity.ts`
- Modify: `src/modules/world/entities/scene-trigger.entity.ts`
- Modify: `src/modules/world/entities/npc-template.entity.ts`
- Modify: `src/modules/world/entities/npc-spawn-rule.entity.ts`
- Modify: `src/modules/world/entities/dialogue.entity.ts`
- Modify: `src/modules/quest/entities/quest-template.entity.ts`

- [ ] **Step 3.1: 逐实体改造**

每个实体（以 scene 为例，其余同模式）：

```ts
import { COMMON_SCOPE } from '@shared/content-scope';

@Entity('scenes')
export class Scene {
  // ...现有字段不动...

  @Column({ name: 'app_scope', type: 'varchar', length: 32, default: COMMON_SCOPE })
  appScope: string;
}
```

不继承抽象类（Task 1.3 的决策：列声明留在实体内），只统一 import `COMMON_SCOPE` 常量保证默认值单一来源。dialogue 实体额外改索引：

```ts
@Index('uq_dialogue_code', ['appScope', 'code'], { unique: true })
```

- [ ] **Step 3.2: 验证**

Run: `& ".\node_modules\.bin\tsc.cmd" --noEmit -p tsconfig.json; npx jest world --silent; npx jest dialogue --silent; npx jest quest --silent`
Expected: tsc 0；相关套件全绿（若 spec 的 create() 字面量缺 appScope 导致校验失败，给 mock 数据补 `appScope: 'common'`，只改测试 fixture 不改断言语义）

- [ ] **Step 3.3: Commit**

```powershell
git add packages-game/game-server/src/modules/world/entities/scene.entity.ts packages-game/game-server/src/modules/world/entities/scene-entity-spawn.entity.ts packages-game/game-server/src/modules/world/entities/scene-trigger.entity.ts packages-game/game-server/src/modules/world/entities/npc-template.entity.ts packages-game/game-server/src/modules/world/entities/npc-spawn-rule.entity.ts packages-game/game-server/src/modules/world/entities/dialogue.entity.ts packages-game/game-server/src/modules/quest/entities/quest-template.entity.ts
git commit -m "feat(game-server): 内容实体挂 app_scope 列，dialogue 唯一索引改 (app_scope, code)"
```

---

### Task 4: 契约断言 helper + 单测

**Files:**
- Create: `src/testing/content-scope-contract.shared.ts`
- Test: `src/testing/content-scope-contract.shared.spec.ts`

（后缀 `.shared.ts` 不匹配 jest testRegex `.*\.spec\.ts$` 的主文件设计：helper 本体不被当作套件执行，只有它的自测 `.spec.ts` 会跑。）

- [ ] **Step 4.1: 写失败测试**

```ts
// src/testing/content-scope-contract.shared.spec.ts
import { In } from 'typeorm';
import { expectScopedFind } from './content-scope-contract.shared';

describe('expectScopedFind', () => {
  const makeMock = (firstArg: unknown) => ({ mock: { calls: [[firstArg]] } }) as jest.Mock;

  it('passes when find where carries appScope In', () => {
    const m = makeMock({ where: { id: '1', appScope: In(['common', 'gameB']) } });
    expect(() => expectScopedFind(m, ['common', 'gameB'])).not.toThrow();
  });

  it('fails when appScope filter missing', () => {
    const m = makeMock({ where: { id: '1' } });
    expect(() => expectScopedFind(m, ['common', 'gameB'])).toThrow(/appScope/);
  });

  it('supports findOne with flat where and findAndCount tuple args', () => {
    const m1 = makeMock({ where: { appScope: In(['common']) } });
    expect(() => expectScopedFind(m1, ['common'])).not.toThrow();
    const m2 = makeMock({ where: { appScope: In(['common']) }, skip: 0 });
    expect(() => expectScopedFind(m2, ['common'])).not.toThrow();
  });
});
```

- [ ] **Step 4.2: 跑测试确认失败**

Run: `npx jest content-scope-contract --silent`
Expected: FAIL（模块不存在）

- [ ] **Step 4.3: 实现**

```ts
// src/testing/content-scope-contract.shared.ts
import { type FindOperator } from 'typeorm';
import { COMMON_SCOPE } from '@shared/content-scope';

/**
 * 契约断言：mock repo 的 find/findOne/findAndCount 首参 where 必须携带 appScope 过滤。
 * 每张内容表的 service spec 在覆盖其查询方法的用例末尾调用本函数——
 * 漏写 visibleTo 展开即 CI 红灯（spec 第 4 节第 4 层防线的单测级实现）。
 */
export function expectScopedFind(
  repoMock: jest.Mock,
  expectedApps: string[] = [COMMON_SCOPE],
): void {
  const call = repoMock.mock.calls[0]?.[0] as
    | { where?: Record<string, unknown> }
    | Array<{ where?: Record<string, unknown> }>
    | undefined;
  const first = Array.isArray(call) ? call[0] : call;
  const scope = first?.where?.appScope as FindOperator<string> | undefined;
  if (!scope || !Array.isArray(scope.value)) {
    throw new Error(
      `where 缺少 appScope 过滤：查询必须展开 visibleTo(appCode)（expected ${expectedApps.join('/')}）`,
    );
  }
  expect(scope.value).toEqual(expectedApps);
}
```

- [ ] **Step 4.4: 跑测试确认通过**

Run: `npx jest content-scope-contract --silent`
Expected: PASS（3 tests）

- [ ] **Step 4.5: Commit**

```powershell
git add packages-game/game-server/src/testing/content-scope-contract.shared.ts packages-game/game-server/src/testing/content-scope-contract.shared.spec.ts
git commit -m "test(game-server): content scope 契约断言 helper（漏写过滤=红灯）"
```

---

### Task 5: 现有内容查询点改造（21 处，全传 null）

**原则：** 阶段 1 所有调用点传 `visibleTo(null)`（只见 common = 现有行为零变化）；每处改完在其 spec 对应用例追加 `expectScopedFind` 断言；**admin controller 5 处（dialogue-admin.controller.ts）不改**——管理面全量可见。

**Files（Modify）:**
- `src/modules/world/world.service.ts`（9 处：108, 128, 138, 226, 235, 239, 318, 408, 513 行附近）
- `src/modules/world/npc/npc-presence.service.ts`（1 处：162）
- `src/modules/explore/explore.service.ts`（1 处：113）
- `src/modules/world/dialogue/dialogue.service.ts`（3 处：187, 227, 475）
- `src/modules/world/config/scene-config.service.ts`（4 处：83, 99, 103, 286）
- `src/modules/world/building/building.service.ts`（2 处：149, 263）
- `src/modules/world/building/build-rule.service.ts`（1 处：179）

- [ ] **Step 5.1: 防遗漏复查 grep**

Run: `Grep pattern "(sceneRepo|spawnRepo|triggerRepo|npcTemplateRepo|npcSpawnRepo|dialogueRepo|questTemplateRepo)\.(find|findOne|findAndCount|createQueryBuilder)\(" path src/modules output_mode content`
若出现上表之外的调用点（含其他 repo 变量命名），一并纳入本 Task；admin-* 文件除外。

- [ ] **Step 5.2: world.service.ts 9 处改造示例（其余同模式）**

```ts
// 108：场景行
const scene = await this.sceneRepo.findOne({
  where: { id, ...visibleTo(null) },
});
// 128：场景分页列表
const [items, total] = await this.sceneRepo.findAndCount({
  where: { ...existing, ...visibleTo(null) },   // 保留原有条件，追加展开
  ...
});
// 235：spawn 列表
return this.spawnRepo.find({
  where: { sceneId, isActive: true, ...visibleTo(null) },
});
```

每处 import `import { visibleTo } from '@shared/content-scope';`（每文件一次）。

- [ ] **Step 5.3: 按文件逐个改 + 跑对应测试**

每改完一个 service：`npx jest <模块关键词> --silent` 确认绿；再在其 spec 中「查询类用例」追加契约断言（示例）：

```ts
// world.service.spec.ts —— 列场景用例
await service.listScenes(/* ... */);
expectScopedFind(sceneRepo.find as jest.Mock);
```

Expected: 各套件绿；若断言红 → 该处漏展开，回改 service。

- [ ] **Step 5.4: 全量回归**

Run: `npx jest --silent 2>&1 | Select-Object -Last 4`
Expected: 116+ suites 全绿（新增 content-scope-contract 3 + content-scope 3 = 1388 tests）

- [ ] **Step 5.5: Commit**

```powershell
git add packages-game/game-server/src/modules/world/world.service.ts packages-game/game-server/src/modules/world/npc/npc-presence.service.ts packages-game/game-server/src/modules/explore/explore.service.ts packages-game/game-server/src/modules/world/dialogue/dialogue.service.ts packages-game/game-server/src/modules/world/config/scene-config.service.ts packages-game/game-server/src/modules/world/building/building.service.ts packages-game/game-server/src/modules/world/building/build-rule.service.ts packages-game/game-server/src/modules/world/world.service.spec.ts
git commit -m "feat(game-server): 21 处内容查询接入 app_scope 过滤（阶段1全传 null，行为不变）"
```

（以实际改动 spec 文件列表为准补全 add 清单。）

---

### Task 6: 收尾验证与推送

- [ ] **Step 6.1: 双端构建**

Run（game-server）：`npm run build` → 退出码 0
Run（game-client）：`& "..\game-server\node_modules\.bin\tsc.cmd" --noEmit -p ..\game-client\tsconfig.json` → 0（client 未消费新字段，应无影响）

- [ ] **Step 6.2: 冒烟（本地 server）**

后台起 server（REDIS_PROTOCOL=RESP2）→ `GET /api/client/v1/world/scenes`（或既有场景列表接口）返回与改造前一致（数据全 common）。
验证 SQL：`SELECT app_scope, count(*) FROM scenes GROUP BY 1;` → 仅 common。

- [ ] **Step 6.3: push**

```powershell
git push
```

---

## Self-Review 记录

- **Spec 覆盖**：spec 第 3 节（apps/scope 列/依赖方向）→ Task 2/3；第 4 节（四层过滤）→ Task 1/4/5（第 3 层 appCode 解析在阶段 3，本阶段调用点显式 null，spec 7 节阶段表一致）；第 7 节迁移 → Task 2。第 5/6 节（叠加明细/quiz）属阶段 2/3，不在本计划。
- **Placeholder 扫描**：无 TBD；Task 2.1/5.1 的 grep 步骤是「防现场漂移」的核对动作而非占位（预期值已给出，偏离时按实际）。
- **类型一致性**：`visibleTo` 返回 `FindOptionsWhere<never>` 与各调用点展开兼容；`expectScopedFind(repoMock, expectedApps)` 签名在 Task 4 定义、Task 5 引用一致。
