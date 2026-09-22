// S6 建造纯逻辑零依赖断言脚本（不引入任何测试框架：只用 node + 自写 check）
// 用法：node tools/build-fallback.mjs && node scripts/smoke-s6-build.mjs
//
// 断言对象取自**构建产物** `bin/js/**`（构建输出，不入库）——这些模块顶层不触碰 Laya
// （类型只走 import type），故 node 可直接求值（同 S3/S4/S5 的 smoke 脚本）：
//   - entity/components/BuildComponent.js         建造入口组件（canInteract 语义）+ 建筑表现组件
//   - world/build-logic.js                        本地预判 / 三态分支 / 进度 / 广播帧解析
//   - entity/EntityFactory.js                     createFromBuilding 装配（存在性 + 组件清单来源）
//   - entity/EntityRegistry.js                    广播接入的 upsert 语义（真实调用，不猴补）
// 断言失败 → exit 1。
//
// 注：`bin/js/*.js` 最近的 package.json（仓库根）没有 "type" 字段，node 会先按 CJS 解析失败、
// 再按「检测到模块语法」回退为 ES module 求值，并打印一条 MODULE_TYPELESS_PACKAGE_JSON 警告 —— 属预期噪音。
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 需要存在的构建产物：缺任一则提示先构建，不静默失败 */
const ARTIFACTS = {
  buildComponent: 'bin/js/entity/components/BuildComponent.js',
  buildLogic: 'bin/js/world/build-logic.js',
  entityFactory: 'bin/js/entity/EntityFactory.js',
  entityRegistry: 'bin/js/entity/EntityRegistry.js',
  registryMap: 'bin/js/entity/components/interact/registry-map.js',
  appConfig: 'bin/js/config/AppConfig.js',
};

const missing = Object.values(ARTIFACTS).filter((p) => !existsSync(join(root, p)));
if (missing.length > 0) {
  console.error(`缺少构建产物：${missing.join('、')}`);
  console.error('请先执行 node tools/build-fallback.mjs');
  process.exit(1);
}

const load = (rel) => import(pathToFileURL(join(root, rel)).href);
const { BuildComponent, BuildingViewComponent } = await load(ARTIFACTS.buildComponent);
const {
  PLOT_REASON,
  buildingAppearance,
  calcProgress,
  gridCenter,
  parseBuildingUpdate,
  predictPlot,
  toBuildingSpawn,
  upsertBuildingEntity,
  viewToSpawn,
  worldToGrid,
} = await load(ARTIFACTS.buildLogic);
const { EntityFactory } = await load(ARTIFACTS.entityFactory);
const { EntityRegistry } = await load(ARTIFACTS.entityRegistry);
const { INTERACT_KINDS } = await load(ARTIFACTS.registryMap);
const { AppConfig } = await load(ARTIFACTS.appConfig);

let total = 0;
let failed = 0;
function check(name, cond, extra = '') {
  total++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` :: ${extra}` : ''}`);
  if (!cond) failed++;
}

/** 建造规则视图工厂（与后端 BuildRuleView 字段逐字一致） */
function rule(over = {}) {
  return { id: '1', sceneId: '7', mode: 'solo', landGridSize: 64, maxBuildingsPerPlayer: 5, allowDemolish: true, coopMinContributors: 2, coopExpireHours: 24, reservedZones: [], ...over };
}

/** 建筑视图工厂（`x/y` 是锚点格中心像素） */
function buildingView(over = {}) {
  return { id: String(over.id ?? 1), sceneId: '7', templateId: '55', ownerId: '1001', state: 'building', finishAt: null, x: 32, y: 32, w: 1, h: 1, ...over };
}

/** 蓝图工厂（默认 2×2、耗时 120s、耐久 300） */
function template(over = {}) {
  return { id: '55', name: '木屋', resKey: '', category: 'house', footprintW: 2, footprintH: 2, buildCost: [], buildSeconds: 120, durability: 300, effect: {}, unlockCondition: null, isActive: true, ...over };
}

// ── 1. BuildComponent：forbidden → canInteract false；solo/coop → true ────────
console.log('— BuildComponent.canInteract（建造入口的选中语义）—');

{
  const forbidden = new BuildComponent(rule({ mode: 'forbidden' }));
  check('mode=forbidden → canInteract() === false', forbidden.canInteract() === false, `mode=${forbidden.mode}`);
  const solo = new BuildComponent(rule({ mode: 'solo' }));
  check('mode=solo → canInteract() === true', solo.canInteract() === true, `mode=${solo.mode}`);
  const coop = new BuildComponent(rule({ mode: 'coop' }));
  check('mode=coop → canInteract() === true', coop.canInteract() === true, `mode=${coop.mode}`);
  const none = new BuildComponent(null);
  check('规则缺失（接口失败）→ 视为 forbidden 不可选中（宁可禁用不可误建）', none.mode === 'forbidden' && none.canInteract() === false, `mode=${none.mode}`);
  check(
    '结构性交互契约齐备：kind 为字符串 + priority 为数字（选择器只看这三个成员）',
    typeof solo.kind === 'string' && solo.kind === 'build' && typeof solo.priority === 'number' && typeof solo.interact === 'function',
    `kind=${solo.kind} priority=${solo.priority}`,
  );
  check(
    'kind 未登记进 interact/registry-map（新增 kind 会破坏 S3 的 kind 清单门禁，故选择器零改动）',
    Array.isArray(INTERACT_KINDS) && !INTERACT_KINDS.includes(solo.kind),
    `kinds=[${INTERACT_KINDS}]`,
  );
}

// ── 2. 格点本地预判（越界/保留区/上限/已占用/空位）────────────────────────────
console.log('— predictPlot（本地预判，服务端 assertCanBuild 才是权威）—');

const MAP = 640; // 10×10 格（64px/格）
const base = {
  rule: rule(),
  gx: 0,
  gy: 0,
  w: 1,
  h: 1,
  mapWidth: MAP,
  mapHeight: MAP,
  occupied: [],
  ownBuildingCount: 0,
};

{
  const r = predictPlot({ ...base, gx: -1 });
  check('负坐标（越界）→ 非法', r.legal === false && r.reason === PLOT_REASON.outOfBounds, `reason=${r.reason}`);
}
{
  const r = predictPlot({ ...base, gx: 9, gy: 9, w: 2, h: 2 });
  check('锚点 9,9 占地 2×2（超出 10×10）→ 非法', r.legal === false && r.reason === PLOT_REASON.outOfBounds, `reason=${r.reason}`);
}
{
  const r = predictPlot({ ...base, rule: rule({ reservedZones: [{ x: 2, y: 2, w: 2, h: 2 }] }), gx: 2, gy: 3 });
  check('落在保留区内 → 非法', r.legal === false && r.reason === PLOT_REASON.reserved, `reason=${r.reason}`);
}
{
  const r = predictPlot({ ...base, rule: rule({ reservedZones: [{ x: 3, y: 3, w: 1, h: 1 }] }), gx: 2, gy: 2, w: 2, h: 2 });
  check('保留区在占地矩形内（部分相交）→ 非法', r.legal === false && r.reason === PLOT_REASON.reserved, `reason=${r.reason}`);
}
{
  const r = predictPlot({ ...base, rule: rule({ reservedZones: [{ x: 5, y: 5, w: 1, h: 1 }] }), gx: 0, gy: 0, w: 2, h: 2 });
  check('保留区在占地矩形之外（不相交）→ 合法', r.legal === true && r.reason === PLOT_REASON.ok, `reason=${r.reason}`);
}
{
  const r = predictPlot({ ...base, rule: rule({ maxBuildingsPerPlayer: 2 }), ownBuildingCount: 2 });
  check('已达玩家上限（2/2）→ 非法', r.legal === false && r.reason === PLOT_REASON.limit, `reason=${r.reason}`);
}
{
  const r = predictPlot({ ...base, occupied: [{ gx: 1, gy: 1 }], gx: 1, gy: 1 });
  check('地块已被建筑占用 → 非法', r.legal === false && r.reason === PLOT_REASON.occupied, `reason=${r.reason}`);
}
{
  const r = predictPlot({ ...base, occupied: [{ gx: 2, gy: 1 }], gx: 1, gy: 1, w: 2, h: 1 });
  check('多格占地：占用点落在占地矩形内（非锚点格）→ 非法', r.legal === false && r.reason === PLOT_REASON.occupied, `reason=${r.reason}`);
}
{
  const r = predictPlot({ ...base, occupied: [{ gx: 5, gy: 5 }] });
  check('空位（有其它建筑但不重叠）→ 合法', r.legal === true && r.reason === PLOT_REASON.ok, `reason=${r.reason}`);
}
{
  const r = predictPlot({ ...base, rule: rule({ mode: 'forbidden' }) });
  check('mode=forbidden 优先于其它判定 → forbidden', r.legal === false && r.reason === PLOT_REASON.forbidden, `reason=${r.reason}`);
}
{
  // 判定顺序与后端 assertCanBuild 一致：保留区先于上限、上限先于占用
  const r = predictPlot({
    ...base,
    rule: rule({ reservedZones: [{ x: 0, y: 0, w: 1, h: 1 }], maxBuildingsPerPlayer: 1 }),
    ownBuildingCount: 1,
    occupied: [{ gx: 0, gy: 0 }],
  });
  check('判定顺序：保留区 > 上限 > 占用', r.reason === PLOT_REASON.reserved, `reason=${r.reason}`);
}
{
  const r = predictPlot({ ...base, rule: rule({ maxBuildingsPerPlayer: 1 }), ownBuildingCount: 1, occupied: [{ gx: 0, gy: 0 }] });
  check('判定顺序：上限 > 占用', r.reason === PLOT_REASON.limit, `reason=${r.reason}`);
}
{
  const r = predictPlot({ ...base, rule: null });
  check('规则为空（未加载）→ 非法且不抛错', r.legal === false, `reason=${r.reason}`);
}
{
  const a = worldToGrid(200, 300, 64);
  const b = gridCenter(a.gx, a.gy, 64);
  const c = worldToGrid(b.x, b.y, 64);
  check('格点换算与后端同口径：toGrid(toCenter(g)) === g', c.gx === a.gx && c.gy === a.gy, `(${a.gx},${a.gy}) → (${b.x},${b.y}) → (${c.gx},${c.gy})`);
}

// ── 3. 建筑三态表现分支（createFromBuilding 的装配来源）──────────────────────
console.log('— buildingAppearance + BuildingViewComponent（building / built / demolishing）—');

{
  const building = buildingAppearance('building');
  check(
    'building 态：半透明 + 进度条 + 不淡出',
    building.alpha > 0 && building.alpha < 1 && building.progressBar === true && building.fadeOut === false,
    `alpha=${building.alpha} bar=${building.progressBar}`,
  );
  const built = buildingAppearance('built');
  check(
    'built 态：不透明 + 不进度条 + 显示耐久',
    built.alpha === 1 && built.progressBar === false && built.durability === true && built.fadeOut === false,
    `alpha=${built.alpha} durability=${built.durability}`,
  );
  const demolishing = buildingAppearance('demolishing');
  check(
    'demolishing 态：淡出移除 + 无进度条/耐久',
    demolishing.fadeOut === true && demolishing.progressBar === false && demolishing.durability === false,
    `fadeOut=${demolishing.fadeOut}`,
  );
  const unknown = buildingAppearance('weird-state');
  check('未知状态兜底按 building 处理（不抛错）', unknown.progressBar === true, `bar=${unknown.progressBar}`);
}

{
  check(
    'EntityFactory.createFromBuilding 存在（Task 7 Step 3 的实体表现入口）',
    typeof EntityFactory.createFromBuilding === 'function',
  );
  const view = new BuildingViewComponent('building', null, 120, 300);
  check('BuildingViewComponent：注入三态不抛错且状态保真', view.state === 'building', `state=${view.state}`);

  // 无 owner 时 applyState 只改写字段、不动引擎节点（避免断言脚本牵连 Laya）
  view.applyState('built', '2026-01-01T00:00:00.000Z');
  check(
    'applyState（广播驱动）改写 state 且保留传入 finishAt',
    view.state === 'built' && view.finishAt === '2026-01-01T00:00:00.000Z',
    `state=${view.state} finishAt=${view.finishAt}`,
  );
  view.applyState('demolishing');
  check('applyState 缺省 finishAt 时保留既有值（进度条信息不丢）', view.state === 'demolishing' && view.finishAt === '2026-01-01T00:00:00.000Z');
  check(
    '淡出时长取自 AppConfig.build.demolishFadeMs',
    typeof AppConfig.build.demolishFadeMs === 'number' && AppConfig.build.demolishFadeMs > 0,
    `demolishFadeMs=${AppConfig.build.demolishFadeMs}`,
  );
  check(
    '建造面板 zOrder 高于 HUD 与对话框（屏幕空间顶层）',
    AppConfig.build.zOrder > AppConfig.hud.zOrder && AppConfig.build.zOrder > AppConfig.dialogue.zOrder,
    `build=${AppConfig.build.zOrder} hud=${AppConfig.hud.zOrder} dialogue=${AppConfig.dialogue.zOrder}`,
  );
}

// ── 4. 广播帧解析 + EntityRegistry.upsert 接入 ──────────────────────────────
console.log('— parseBuildingUpdate / upsertBuildingEntity（entityType=building 帧）—');

/** 假实体（鸭子类型）：EntityRegistry 只读 entityId/sprite/kind/components 等，upsert 只用 setPos */
function fakeEntity(entityId, x, y) {
  let pos = { x, y };
  return {
    entityId,
    // EntityRegistry.remove 会读 e.sprite.parent（无父节点则只删表项）
    sprite: { parent: null },
    get x() {
      return pos.x;
    },
    get y() {
      return pos.y;
    },
    setPos(nx, ny) {
      pos = { x: nx, y: ny };
    },
  };
}

{
  // 建造广播帧：`data.playerId` 为 null（建造不属于任何玩家）——不得非空断言/不得抛错
  const frame = {
    entityType: 'building',
    playerId: null,
    entityId: 'building:77',
    buildingId: '77',
    templateId: '55',
    state: 'building',
    pos: { x: 160, y: 96 },
  };
  const parsed = parseBuildingUpdate(frame);
  check(
    'parseBuildingUpdate：entityId/buildingId/templateId/pos/state 解析正确',
    parsed &&
      parsed.entityId === 'building:77' &&
      parsed.buildingId === '77' &&
      parsed.templateId === '55' &&
      parsed.x === 160 &&
      parsed.y === 96 &&
      parsed.state === 'building',
    parsed ? `entityId=${parsed.entityId} pos=(${parsed.x},${parsed.y})` : 'null',
  );
  check('广播帧不带 finishAt → 解析为 null（进度由 HTTP 视图回灌）', parsed.finishAt === null, `finishAt=${parsed.finishAt}`);
}
{
  check('非建筑帧（player/npc）→ 返回 null，不影响既有分支', parseBuildingUpdate({ entityType: 'npc', pos: { x: 1, y: 1 } }) === null);
  check('缺 buildingId 的建筑帧 → 返回 null（防御脏帧）', parseBuildingUpdate({ entityType: 'building', pos: { x: 1, y: 1 } }) === null);
  check('null/非对象 → 返回 null 且不抛错', parseBuildingUpdate(null) === null && parseBuildingUpdate('x') === null);
}
{
  let created = 0;
  const frame = { entityType: 'building', playerId: null, buildingId: '77', templateId: '55', state: 'building', pos: { x: 160, y: 96 } };
  const first = upsertBuildingEntity(frame, (u) => {
    created++;
    return fakeEntity(u.entityId, u.x, u.y);
  });
  check(
    '首次广播：EntityRegistry.upsert 建实体，entityId 为 building:<id>，pos 取自 data.pos',
    first !== null &&
      first.created === true &&
      created === 1 &&
      EntityRegistry.get('building:77') === first.entity &&
      first.entity.x === 160 &&
      first.entity.y === 96,
    `created=${first?.created} entityId=${first?.entity?.entityId} pos=(${first?.entity?.x},${first?.entity?.y})`,
  );
  check('playerId 为 null 不抛异常（帧内字段不参与建造实体判定）', first !== null);

  const second = upsertBuildingEntity(
    { ...frame, pos: { x: 224, y: 96 } },
    (u) => {
      created++;
      return fakeEntity(u.entityId, u.x, u.y);
    },
  );
  check(
    '重复广播：复用既有实体（只更新坐标，create 不再调用）',
    second !== null &&
      second.created === false &&
      created === 1 &&
      second.entity === first.entity &&
      second.entity.x === 224,
    `created=${second?.created} createCalls=${created} x=${second?.entity?.x}`,
  );
  check('非建筑帧不建实体（upsertBuildingEntity 返回 null）', upsertBuildingEntity({ entityType: 'player' }, () => fakeEntity('x', 0, 0)) === null);
  EntityRegistry.remove('building:77');
}

// ── 5. 进度换算 + 视图→实体描述 ─────────────────────────────────────────────
console.log('— calcProgress / toBuildingSpawn / viewToSpawn —');

{
  const now = Date.now();
  const finishAt = new Date(now + 60_000).toISOString();
  const progress = calcProgress(finishAt, now, 120);
  check(
    '耗时 120s、finishAt 在 60s 后 → 进度约 0.5（±0.05）',
    progress !== null && Math.abs(progress - 0.5) <= 0.05,
    `progress=${progress}`,
  );
  check('刚开工（finishAt = buildSeconds 之后）→ 进度约 0', Math.abs(calcProgress(new Date(now + 120_000).toISOString(), now, 120) - 0) <= 0.01);
  check('已到点 → 进度夹紧为 1', calcProgress(new Date(now - 5_000).toISOString(), now, 120) === 1);
  check('finishAt 为空 → null（不确定进度，UI 画中性条）', calcProgress(null, now, 120) === null);
  check('buildSeconds<=0 → null（蓝图缺耗时）', calcProgress(finishAt, now, 0) === null);
  check('finishAt 非法字符串 → null 且不抛错', calcProgress('not-a-date', now, 120) === null);
}

{
  const spawn = viewToSpawn(buildingView({ id: '77', x: 160, y: 96, w: 2, h: 2, state: 'building', finishAt: '2026-01-01T00:00:00.000Z' }), template());
  check(
    'viewToSpawn：entityId 前缀 building: + 视图 x/y/state/finishAt 透传',
    spawn.entityId === 'building:77' && spawn.x === 160 && spawn.y === 96 && spawn.state === 'building' && spawn.finishAt === '2026-01-01T00:00:00.000Z',
    `entityId=${spawn.entityId} finishAt=${spawn.finishAt}`,
  );
  check(
    'viewToSpawn：蓝图补齐 name/durability/buildSeconds',
    spawn.name === '木屋' && spawn.durability === 300 && spawn.buildSeconds === 120,
    `name=${spawn.name} durability=${spawn.durability} buildSeconds=${spawn.buildSeconds}`,
  );
  check('viewToSpawn：w/h 取视图值（缺失才回退蓝图占地）', spawn.w === 2 && spawn.h === 2, `w=${spawn.w} h=${spawn.h}`);

  const noTemplate = toBuildingSpawn({ buildingId: '9', templateId: '', x: 0, y: 0, state: 'built' }, null);
  check(
    '蓝图缺失 → 退化为 1×1、无耐久（null，不显示）、无耗时，不抛错',
    noTemplate.w === 1 && noTemplate.h === 1 && noTemplate.durability === null && noTemplate.buildSeconds === 0,
    `w=${noTemplate.w} durability=${noTemplate.durability}`,
  );
  check('蓝图缺失 → 名称兜底为「建筑<id>」', noTemplate.name === '建筑9', `name=${noTemplate.name}`);
}

console.log(
  failed === 0
    ? `\nS6 建造断言全部通过（共 ${total} 项）`
    : `\nS6 建造断言失败 ${failed}/${total} 项`,
);
process.exit(failed === 0 ? 0 : 1);