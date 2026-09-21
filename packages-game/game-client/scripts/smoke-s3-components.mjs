// S3 核心逻辑零依赖断言脚本（不引入任何测试框架：只用 node + 自写 check）
// 用法：node tools/build-fallback.mjs && node scripts/smoke-s3-components.mjs
//
// 断言对象全部取自**构建产物** `bin/js/**`（构建输出，不入库）里的纯模块：
//   - entity/targeting.js                    就近选择器（priority → 距离）
//   - entity/components/interact/registry-map.js  kind → 组件策略映射 + 占位语义
//   - world/spawn-merge.js                   服务端 spawn 去重（配置包优先）
// 这三个模块不 import Laya（类型只走 import type），故 node 可直接求值（§3 风险 6）。
// 断言失败 → exit 1。
//
// 注：`bin/js/*.js` 最近的 package.json（仓库根）没有 "type" 字段，node 会先按 CJS 解析失败、
// 再按「检测到模块语法」回退为 ES module 求值，并打印一条 MODULE_TYPELESS_PACKAGE_JSON 警告 —— 属预期噪音，
// 不影响断言结果（也不能为此改根 package.json）。
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 需要存在的构建产物：缺任一则提示先构建，不静默失败 */
const ARTIFACTS = {
  targeting: 'bin/js/entity/targeting.js',
  registryMap: 'bin/js/entity/components/interact/registry-map.js',
  spawnMerge: 'bin/js/world/spawn-merge.js',
};

const missing = Object.values(ARTIFACTS).filter((p) => !existsSync(join(root, p)));
if (missing.length > 0) {
  console.error(`缺少构建产物：${missing.join('、')}`);
  console.error('请先执行 node tools/build-fallback.mjs');
  process.exit(1);
}

const load = (rel) => import(pathToFileURL(join(root, rel)).href);
const { pickTarget } = await load(ARTIFACTS.targeting);
const { INTERACT_KINDS, INTERACT_STRATEGY, PLACEHOLDER_META, resolveStrategy } = await load(
  ARTIFACTS.registryMap,
);
const { mergeServerSpawns } = await load(ARTIFACTS.spawnMerge);

let total = 0;
let failed = 0;
function check(name, cond, extra = '') {
  total++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` :: ${extra}` : ''}`);
  if (!cond) failed++;
}

/**
 * 造一个假实体（鸭子类型）：选择器只读 `kind` / `components` / `distanceTo`，
 * 故无需构造真实 Entity（那会牵连引擎）。
 */
function fakeEntity(id, kind, x, y, interact = null) {
  const components = new Map();
  if (interact) {
    components.set('InteractComponent', {
      priority: 0,
      canInteract: () => true,
      interact: async () => {},
      ...interact,
    });
  }
  return {
    entityId: id,
    kind,
    x,
    y,
    components,
    distanceTo(other) {
      return Math.hypot(this.x - other.x, this.y - other.y);
    },
  };
}

/** 与 InteractController.radiusOf 同规则：人（NPC）90 / 物（object）70 */
const radiusOf = (e) => (e.kind === 'npc' ? 90 : 70);
const me = fakeEntity('player:1', 'player', 0, 0);

// ── 1. pickTarget 优先级规则 ────────────────────────────────────────────────
console.log('— pickTarget（就近选择：先比 priority，再比距离）—');

{
  // ① 人与物同半径内：人的 priority 高 → 选人
  const npc = fakeEntity('npc:1', 'npc', 40, 0, { kind: 'talk', priority: 10 });
  const obj = fakeEntity('object:1', 'object', 10, 0, { kind: 'collect', priority: 0 });
  const picked = pickTarget([obj, npc], me, radiusOf);
  check(
    '人与物同在半径内 → 选人（priority 高者，距离更远的也算）',
    picked?.entity === npc,
    `picked=${picked?.entity?.entityId ?? 'null'}`,
  );
}

{
  // ② 两个物不同 priority：选高者（近的低优先级不抢）
  const near = fakeEntity('object:near', 'object', 10, 0, { kind: 'collect', priority: 0 });
  const far = fakeEntity('object:far', 'object', 60, 0, { kind: 'chest', priority: 5 });
  const picked = pickTarget([near, far], me, radiusOf);
  check(
    '两个物 priority 不同 → 选 priority 高者',
    picked?.entity === far,
    `picked=${picked?.entity?.entityId ?? 'null'}`,
  );
}

{
  // ③ 全部超出半径：NPC 90 / 物件 70 各自越界 → null
  const npc = fakeEntity('npc:1', 'npc', 91, 0, { kind: 'talk', priority: 10 });
  const obj = fakeEntity('object:1', 'object', 0, 71, { kind: 'collect', priority: 0 });
  const picked = pickTarget([npc, obj], me, radiusOf);
  check(
    '全部超出半径 → null',
    picked === null,
    `picked=${picked?.entity?.entityId ?? 'null'}`,
  );
}

{
  // ④ canInteract=false 的目标不被选中（已开启的一次性箱子）；另一个可交互者被选中
  const opened = fakeEntity('object:opened', 'object', 10, 0, {
    kind: 'chest',
    priority: 99,
    canInteract: () => false,
  });
  const picked = pickTarget([opened], me, radiusOf);
  check(
    'canInteract=false 的目标不被选中（高 priority 也不行）',
    picked === null,
    `picked=${picked?.entity?.entityId ?? 'null'}`,
  );

  const ok = fakeEntity('object:ok', 'object', 20, 0, { kind: 'collect', priority: 0 });
  const picked2 = pickTarget([opened, ok], me, radiusOf);
  check(
    'canInteract=false 与 true 并存 → 选中可交互的那个',
    picked2?.entity === ok,
    `picked=${picked2?.entity?.entityId ?? 'null'}`,
  );
}

{
  // ⑤ priority 相同 → 比距离（近者优先）
  const near = fakeEntity('object:near', 'object', 10, 0, { kind: 'collect', priority: 3 });
  const far = fakeEntity('object:far', 'object', 50, 0, { kind: 'collect', priority: 3 });
  const picked = pickTarget([far, near], me, radiusOf);
  check(
    'priority 相同 → 取距离更近者',
    picked?.entity === near,
    `picked=${picked?.entity?.entityId ?? 'null'}`,
  );
}

{
  // ⑥ 玩家实体（含自己）一律跳过；无交互组件的目标跳过
  const other = fakeEntity('player:2', 'player', 5, 0, { kind: 'talk', priority: 99 });
  const plain = fakeEntity('object:plain', 'object', 5, 0, null);
  const picked = pickTarget([other, plain], me, radiusOf);
  check(
    '玩家实体与无交互组件的目标均不参与选中',
    picked === null,
    `picked=${picked?.entity?.entityId ?? 'null'}`,
  );
}

// ── 2. registry 映射完整性 ─────────────────────────────────────────────────
console.log('— registry 映射（kind → 组件策略）—');

/** 独立于实现的期望清单：后端 InteractType 全值 + 客户端额外接入的 ObjectType/NpcInteractType/TriggerType 值 */
const EXPECTED_KINDS = [
  'collect',
  'fish',
  'stone',
  'plant',
  'chest',
  'read',
  'talk',
  'quest',
  'mount',
  'puzzle',
  'gate',
  'trap',
  'transport',
  'story',
  'battle',
  'activity',
  'sit',
  'lie',
  'hide',
  'camp',
  'carve',
  'play',
];
/** 计划规定：本批不实现行为的 kind → 必须解析到占位组件 */
const UNIMPLEMENTED_KINDS = ['sit', 'lie', 'hide', 'camp', 'carve'];
/** 本批真实现的 5 条链路 + 触发器族 的策略归属 */
const EXPECTED_STRATEGY = {
  collect: 'collect',
  fish: 'collect',
  stone: 'collect',
  plant: 'collect',
  chest: 'container',
  read: 'read',
  talk: 'talk',
  quest: 'quest',
  mount: 'mount',
  puzzle: 'trigger',
  gate: 'trigger',
  trap: 'trigger',
  transport: 'trigger',
  story: 'trigger',
  battle: 'trigger',
  activity: 'trigger',
};

const unregistered = EXPECTED_KINDS.filter((k) => resolveStrategy(k) === null);
check(
  '全部 InteractType 取值都能解析到组件策略（无落空）',
  unregistered.length === 0,
  `未解析=${unregistered.length === 0 ? '无' : unregistered.join(',')}`,
);

const unknownInMap = INTERACT_KINDS.filter((k) => !EXPECTED_KINDS.includes(k));
const missingInMap = EXPECTED_KINDS.filter((k) => !INTERACT_KINDS.includes(k));
check(
  '运行时 kind 列表与期望清单一致（无遗漏、无多出）',
  unknownInMap.length === 0 && missingInMap.length === 0,
  `共 ${INTERACT_KINDS.length} 项；多出=${unknownInMap.join(',') || '无'}；遗漏=${missingInMap.join(',') || '无'}`,
);

const strategyDiff = Object.entries(EXPECTED_STRATEGY).filter(
  ([k, s]) => INTERACT_STRATEGY[k] !== s,
);
check(
  '已实现链路的 kind 各自映射到正确组件策略（collect/container/read/talk/quest/mount/trigger）',
  strategyDiff.length === 0,
  strategyDiff.map(([k, s]) => `${k}≠${s}`).join(',') || `校验 ${Object.keys(EXPECTED_STRATEGY).length} 项`,
);

const notPlaceholder = UNIMPLEMENTED_KINDS.filter((k) => INTERACT_STRATEGY[k] !== 'placeholder');
check(
  '未实现的 5 类（sit/lie/hide/camp/carve）解析到占位组件',
  notPlaceholder.length === 0,
  notPlaceholder.length === 0 ? UNIMPLEMENTED_KINDS.join(',') : `异常=${notPlaceholder.join(',')}`,
);

check(
  '占位组件语义：能被选中（canInteract=true）且优先级最低（priority=-1）',
  PLACEHOLDER_META.canInteract === true && PLACEHOLDER_META.priority === -1,
  `canInteract=${PLACEHOLDER_META.canInteract} priority=${PLACEHOLDER_META.priority}`,
);

check(
  '未登记的 kind 解析为 null → 由 registry 收口到占位组件',
  resolveStrategy('not-a-kind') === null && resolveStrategy('') === null,
  `not-a-kind=${resolveStrategy('not-a-kind')} ''=${resolveStrategy('')}`,
);

// ── 3. mergeServerSpawns 去重规则 ──────────────────────────────────────────
console.log('— mergeServerSpawns（配置包优先）—');

const spawn = (id, entityType, x = 100, y = 100) => ({
  id: String(id),
  sceneId: '1',
  entityType,
  templateId: '1',
  spawnX: x,
  spawnY: y,
  spawnRotation: 0,
  spawnCount: 1,
  spawnRadius: 0,
  isActive: true,
});

const cfg = {
  schemaVersion: 1,
  sceneId: 1,
  fixedNpcs: [{ spawnId: 7 }],
  staticEntities: [{ spawnId: 11 }],
};

{
  // ① 同 spawnId（NPC）：配置包已声明 → 服务器 spawn 被忽略；未声明的保留
  const accepted = mergeServerSpawns(cfg, [spawn(7, 'npc'), spawn(9, 'npc')]);
  check(
    'NPC 同 spawnId 时配置包优先（已在 fixedNpcs 的服务器 spawn 被忽略）',
    accepted.length === 1 && accepted[0].id === '9',
    `accept=[${accepted.map((s) => `${s.entityType}:${s.id}`).join(',')}]`,
  );
}

{
  // ② entity_type='object' 一律忽略（即使 spawnId 与配置包静态物件相同也走同一条规则）
  const accepted = mergeServerSpawns(cfg, [spawn(11, 'object'), spawn(12, 'object')]);
  check(
    "entity_type='object' 的服务器 spawn 一律被忽略",
    accepted.length === 0,
    `accept=${accepted.length} 条`,
  );
}

{
  // ③ 混合输入 + 怪物（monster 不在规则内）保留；统计日志随调用一起打印
  const accepted = mergeServerSpawns(cfg, [
    spawn(7, 'npc'),
    spawn(11, 'object'),
    spawn(9, 'npc'),
    spawn(13, 'monster'),
  ]);
  const ids = accepted.map((s) => `${s.entityType}:${s.id}`);
  check(
    '混合输入：只保留未被配置包覆盖的 npc 与 monster（顺次保持）',
    ids.join(',') === 'npc:9,monster:13',
    `accept=[${ids.join(',')}]`,
  );
}

console.log(
  failed === 0
    ? `\nS3 核心逻辑断言全部通过（共 ${total} 项）`
    : `\nS3 核心逻辑断言失败 ${failed}/${total} 项`,
);
process.exit(failed === 0 ? 0 : 1);
