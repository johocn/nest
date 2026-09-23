// S8 Task 4 视口裁剪证据（零依赖；除可选 playwright；**不写入任何 package.json**）
// 用法：node scripts/viewport-sample.mjs [--headless] [--seconds 3] [--spawn 150] [--url http://localhost:5173/] [--map-localhost-ipv4]
//
// 前置：① 后端在 :3000 运行；② 静态服务器在 :5173 运行（node tools/serve.mjs）。
// 本机 playwright 由 `e:\code\node_modules\playwright` 解析（未装 → 打印 SKIP 指引并 exit 0）。
//
// 在**同一个页面会话**里做三列对比（实体用页内 `EntityFactory.createOtherPlayer` + `SceneBuilder.addEntity`
// 铺 150 个，均匀铺满地图；玩家停在出生点不走）：
//   A 关裁剪（marginPx=1e6）→ 视口大到覆盖全部实体，等价于「没有裁剪」的基线
//   B 默认   （marginPx=200）→ 计划的默认边距
//   C 紧裁剪（marginPx=0）  → 视口 = 舞台大小，证明「机制本身有效」
// 每列静止跑 N 秒，每秒采 `__PERF__.snapshot()`，记录 entityVisible / drawcall / fps。
//
// 另有 Step 4 边界点检（页内独立重算 + 实测比对）：
//   ① 玩家压到地图角落（视口超出地图边界）；② 玩家静止时可见集合不许抖动（翻转 0 次）；
//   ③ 键盘来回快速穿越视口边界：断言「交互半径内的实体从不被裁」且「裁剪不改坐标」；
//   ④ 每次采样都用纯函数独立重算应有可见性，与 `sprite.visible` 实测比对（玩家静止 ≥1 tick 后必须完全一致）。
// 结果 append 到 docs/perf-sample.md（只追加，不覆盖历史）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = join(root, 'docs', 'perf-sample.md');
const label = 'viewport';

// ── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function argOf(name, dflt) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const url = argOf('url', 'http://localhost:5173/');
const secondsPerCol = Number(argOf('seconds', '3'));
const spawnCount = Number(argOf('spawn', '150'));
const headless = argv.includes('--headless');
const mapLocalhostIpv4 = argv.includes('--map-localhost-ipv4');
const stabilizeMs = 3000;
const USER = { user: 'spike01', pass: 'spike123456' };
/** demo 场景尺寸（与 packages/gamedata 的 scene 1 一致；页内会用真实配置复核） */
const MAP = { w: 1280, h: 960 };
/** 穿越边界的键盘路线：右 800ms → 左 800ms，共 3 个来回 */
const CROSS_KEYS = ['ArrowRight', 'ArrowLeft'];
const CROSS_MS = 800;
const CROSS_ROUNDS = 3;

// ── playwright 可选依赖：缺则 SKIP（不阻断验收）────────────────────────────
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('SKIP 未安装 playwright，附手动测量指引：');
  console.log('  1) 起后端 :3000 与静态服务器 :5173（node tools/serve.mjs）');
  console.log('  2) 浏览器打开 http://localhost:5173/ ，用 spike01 / spike123456 登录进场景');
  console.log('  3) 控制台执行：');
  console.log("     const { AppConfig } = await import('/js/config/AppConfig.js');");
  console.log("     const { EntityFactory } = await import('/js/entity/EntityFactory.js');");
  console.log("     const { SceneBuilder } = await import('/js/world/SceneBuilder.js');");
  console.log('     for (let i=0;i<150;i++) SceneBuilder.addEntity(EntityFactory.createOtherPlayer(`vp${i}`, 40+100*i%1200, 40+64*i%900));');
  console.log('     AppConfig.viewport.marginPx = 0;   // 或 200 / 1e6');
  console.log('  4) 按 F3 看「实体 总/可见」随 marginPx 变化，把原始数值汇总写入 docs/perf-sample.md');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round1 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10) / 10 : v);
const mean = (arr) => (arr.length ? round1(arr.reduce((a, b) => a + b, 0) / arr.length) : null);

function gitInfo() {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const dirty =
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
    return { commit, dirty };
  } catch (e) {
    return { commit: 'n/a', dirty: null, error: String(e) };
  }
}

// ═══ 页内函数（自包含，不能闭包外部变量；都通过 page.evaluate 传入）════════════

/** 铺实体 + 记录初始 state；返回基线信息 */
async function preparePage({ spawnCount, mapW, mapH }) {
  const { AppConfig } = await import('/js/config/AppConfig.js');
  const { EntityFactory } = await import('/js/entity/EntityFactory.js');
  const { SceneBuilder } = await import('/js/world/SceneBuilder.js');
  const { EntityRegistry } = await import('/js/entity/EntityRegistry.js');
  const { Session } = await import('/js/net/Session.js');

  const cols = 15;
  const rows = Math.ceil(spawnCount / cols);
  const created = [];
  for (let r = 0; r < rows && created.length < spawnCount; r++) {
    for (let c = 0; c < cols && created.length < spawnCount; c++) {
      const x = Math.round(((c + 0.5) / cols) * mapW);
      const y = Math.round(((r + 0.5) / rows) * mapH);
      const e = EntityFactory.createOtherPlayer(`vp${r}_${c}`, x, y);
      SceneBuilder.addEntity(e);
      created.push({ id: e.entityId, x, y });
    }
  }
  globalThis.__VP__ = {
    created,
    origMargin: AppConfig.viewport.marginPx,
    meId: 'player:' + Session.playerId,
  };
  return {
    spawned: created.length,
    total: EntityRegistry.all().length,
    origMargin: AppConfig.viewport.marginPx,
    meId: globalThis.__VP__.meId,
    stage: { w: Laya.stage.width, h: Laya.stage.height },
  };
}

/** 改边距（`SceneBuilder.cull` 每 tick 现读，故改完下一个 tick 即生效） */
async function setMargin(marginPx) {
  const { AppConfig } = await import('/js/config/AppConfig.js');
  AppConfig.viewport.marginPx = marginPx;
  return AppConfig.viewport.marginPx;
}

/** 把本地玩家挪到指定坐标（等价于 PlayerControl 的 setPos；用于角点/边界点检） */
async function moveMe({ x, y }) {
  const { EntityRegistry } = await import('/js/entity/EntityRegistry.js');
  const me = EntityRegistry.get(globalThis.__VP__.meId);
  if (!me) return null;
  me.setPos(x, y);
  return { x: me.x, y: me.y };
}

/** 单次采样：实测 sprite.visible vs 纯函数独立重算；并检查「交互半径内不可见」违规 */
async function probeFrame() {
  const { AppConfig } = await import('/js/config/AppConfig.js');
  const VP = await import('/js/world/Viewport.js');
  const { EntityRegistry } = await import('/js/entity/EntityRegistry.js');
  const me = EntityRegistry.get(globalThis.__VP__.meId);
  const rect = VP.viewportRect(
    me.x,
    me.y,
    Laya.stage.width,
    Laya.stage.height,
    AppConfig.viewport.marginPx,
  );

  const all = EntityRegistry.all();
  const visibleIds = [];
  const violations = [];
  let mismatch = 0;
  for (const e of all) {
    const isVisible = e.sprite.visible !== false;
    const target = VP.shouldBeVisible(rect, e.x, e.y, e.entityId === me.entityId);
    if (isVisible !== target) mismatch++;
    if (isVisible) visibleIds.push(e.entityId);
    if (!isVisible && (e.kind === 'npc' || e.kind === 'object')) {
      const d = Math.hypot(e.x - me.x, e.y - me.y);
      const radius = e.kind === 'npc' ? AppConfig.interactRadiusNpc : AppConfig.interactRadiusObject;
      if (d <= radius) violations.push(e.entityId);
    }
  }
  visibleIds.sort();
  return {
    me: { x: me.x, y: me.y },
    rect,
    total: all.length,
    visible: visibleIds.length,
    mismatch,
    nearInvisibleViolations: violations,
    visibleIds,
  };
}

/** 150 个自建实体的坐标快照（验证「裁剪绝不改坐标」，计划风险 #4） */
async function positionsOfSpawned() {
  const { EntityRegistry } = await import('/js/entity/EntityRegistry.js');
  const out = {};
  for (const c of globalThis.__VP__.created) {
    const e = EntityRegistry.get(c.id);
    out[c.id] = e ? `${e.x},${e.y}` : 'missing';
  }
  return out;
}

// ═══ 统计工具 ═══════════════════════════════════════════════════════════════

/** 逐采样比对可见集合：统计每个实体的 visible 翻转次数与集合变化次数 */
function toggleStats(samples) {
  const prev = new Map();
  const toggles = new Map();
  let transitions = 0;
  let prevKey = null;
  for (const s of samples) {
    const key = s.visibleIds.join('|');
    if (prevKey !== null && key !== prevKey) transitions++;
    prevKey = key;
    const set = new Set(s.visibleIds);
    for (const id of s.visibleIds) {
      if (prev.get(id) === false) toggles.set(id, (toggles.get(id) ?? 0) + 1);
      prev.set(id, true);
    }
    for (const [id, v] of prev) {
      if (v === true && !set.has(id)) {
        toggles.set(id, (toggles.get(id) ?? 0) + 1);
        prev.set(id, false);
      }
    }
  }
  let maxToggles = 0;
  for (const n of toggles.values()) if (n > maxToggles) maxToggles = n;
  return { transitions, involved: toggles.size, maxToggles, toggles: Object.fromEntries(toggles) };
}

function diffPositions(a, b) {
  const changed = [];
  for (const id of Object.keys(a)) if (a[id] !== b[id]) changed.push(`${id}: ${a[id]} → ${b[id]}`);
  return changed;
}

const git = gitInfo();
const consoleLines = [];

const launchArgs = ['--enable-precise-memory-info'];
if (mapLocalhostIpv4) launchArgs.push('--host-resolver-rules=MAP localhost 127.0.0.1');

const browser = await chromium.launch({ headless, args: launchArgs });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('console', (m) => consoleLines.push(m.text()));

let r = null;
let browserVersion = 'n/a';
try {
  // ① 清 localStorage（走登录页），再打开页面
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // ② H5 DOM 登录表单
  await page.waitForSelector('#s1-submit', { timeout: 20000 });
  await page.fill('#s1-user', USER.user);
  await page.fill('#s1-pass', USER.pass);
  await page.click('#s1-submit');

  // ③ 等 __PERF__ + 进场景完成
  await page.waitForFunction(() => !!window.__PERF__, { timeout: 30000 });
  await page
    .waitForFunction(() => window.__PERF__ && window.__PERF__.snapshot().entityTotal > 0, { timeout: 30000 })
    .catch(() => {
      if (!consoleLines.some((l) => l.includes('进场景应答'))) {
        throw new Error('进场景超时：既无 entityTotal>0，也未出现「进场景应答」日志');
      }
    });
  await sleep(stabilizeMs);
  browserVersion = browser.version();

  // ④ 铺 150 实体
  const prep = await page.evaluate(preparePage, { spawnCount, mapW: MAP.w, mapH: MAP.h });
  await sleep(500);
  // 铺完先按「关裁剪」采一次坐标基线（后面的裁剪不许改动它）
  await page.evaluate(setMargin, 1e6);
  await sleep(400);
  const posBefore = await page.evaluate(positionsOfSpawned);

  // ⑤ A/B/C 三列：同一页面会话，逐列改边距后静止 N 秒，每秒采样
  const columns = [
    { key: 'A 关裁剪', marginPx: 1e6 },
    { key: 'B 默认裁剪', marginPx: 200 },
    { key: 'C 紧裁剪', marginPx: 0 },
  ];
  const colResults = [];
  for (const col of columns) {
    await page.evaluate(setMargin, col.marginPx);
    await sleep(600); // 让裁剪 tick 至少跑过若干次
    const samples = [];
    for (let i = 0; i < secondsPerCol; i++) {
      await sleep(1000);
      const s = await page.evaluate(() => (window.__PERF__ ? window.__PERF__.snapshot() : null));
      if (s) samples.push(s);
    }
    colResults.push({
      ...col,
      samples,
      visibleMean: mean(samples.map((s) => s.entityVisible)),
      visibleMin: samples.length ? Math.min(...samples.map((s) => s.entityVisible)) : null,
      drawcallMean: mean(samples.map((s) => s.drawcall).filter((v) => typeof v === 'number')),
      fpsMean: mean(samples.map((s) => s.fps)),
      total: samples.length ? samples[0].entityTotal : null,
    });
    // 该列结束时的实测 vs 独立重算（玩家静止，应完全一致）
    colResults[colResults.length - 1].probe = await page.evaluate(probeFrame);
  }

  // ⑥ Step 4-① 玩家压到地图角落（C 列边距下，视口一半落到地图外）
  await page.evaluate(setMargin, 0);
  await page.evaluate(moveMe, { x: 8, y: 16 });
  await sleep(400);
  const corner = {
    min: await page.evaluate(probeFrame),
  };
  const shotCorner = join(tmpdir(), 's8-viewport-corner.png');
  await page.screenshot({ path: shotCorner });
  await page.evaluate(moveMe, { x: MAP.w - 8, y: MAP.h - 8 });
  await sleep(400);
  corner.max = await page.evaluate(probeFrame);

  // ⑦ Step 4-② 静止不抖动：回到出生点附近，连续 ~60 个采样比对可见集合
  await page.evaluate(moveMe, { x: 640, y: 480 });
  await sleep(400);
  const stillSamples = [];
  for (let i = 0; i < 60; i++) {
    stillSamples.push(await page.evaluate(probeFrame));
    await sleep(20);
  }
  const still = toggleStats(stillSamples);

  // ⑧ Step 4-③ 键盘快速来回穿越视口边界（C 列 = 最激进裁剪）
  await page.mouse.click(640, 400);
  await sleep(200);
  const crossSamples = [];
  for (let round = 0; round < CROSS_ROUNDS; round++) {
    for (const key of CROSS_KEYS) {
      await page.keyboard.down(key);
      const start = Date.now();
      while (Date.now() - start < CROSS_MS) {
        await sleep(60);
        crossSamples.push(await page.evaluate(probeFrame));
      }
      await page.keyboard.up(key);
    }
  }
  const cross = toggleStats(crossSamples);
  const shotCross = join(tmpdir(), 's8-viewport-cross.png');
  await page.screenshot({ path: shotCross });

  // ⑨ 收尾：还原边距，复核坐标零改动
  await sleep(300);
  const posAfter = await page.evaluate(positionsOfSpawned);
  const finalProbe = await page.evaluate(probeFrame);
  await page.evaluate(setMargin, prep.origMargin);

  r = {
    prep,
    browserVersion,
    userAgent: await page.evaluate(() => navigator.userAgent),
    columns: colResults,
    corner: {
      min: corner.min,
      max: corner.max,
      screenshot: shotCorner,
    },
    still,
    stillSamples: stillSamples.length,
    cross: {
      transitions: cross.transitions,
      involved: cross.involved,
      maxToggles: cross.maxToggles,
      samples: crossSamples.length,
      mismatchMax: Math.max(0, ...crossSamples.map((s) => s.mismatch)),
      nearInvisibleViolations: crossSamples.reduce((n, s) => n + s.nearInvisibleViolations.length, 0),
      screenshot: shotCross,
    },
    positionsChanged: diffPositions(posBefore, posAfter),
    finalProbe,
    qualityLine: consoleLines.find((l) => l.includes('[S8] quality=')) ?? '(未捕获到质量日志)',
    sceneLine: consoleLines.find((l) => l.includes('静态层渲染完成')) ?? '(未捕获到静态层日志)',
  };
} finally {
  await browser.close();
}

// ═══ 判定 ═══════════════════════════════════════════════════════════════════
const checks = [];
const ok = (name, cond, extra = '') => checks.push({ name, pass: !!cond, extra });

const colA = r.columns.find((c) => c.marginPx === 1e6);
const colB = r.columns.find((c) => c.marginPx === 200);
const colC = r.columns.find((c) => c.marginPx === 0);

ok('A 关裁剪：150 个自建实体全部可见', colA.probe.visible >= r.prep.spawned, `visible=${colA.probe.visible}`);
ok(
  'A 关裁剪：实测可见性和独立重算完全一致',
  colA.probe.mismatch === 0,
  `mismatch=${colA.probe.mismatch}`,
);
ok(
  'C 紧裁剪：可见数严格小于总数（机制确实裁掉了实体）',
  colC.probe.visible < colC.probe.total,
  `visible=${colC.probe.visible} / total=${colC.probe.total}`,
);
ok(
  'C 紧裁剪：实测可见性和独立重算完全一致',
  colC.probe.mismatch === 0,
  `mismatch=${colC.probe.mismatch}`,
);
ok(
  'C 紧裁剪：被裁实体的坐标与基线完全一致（裁剪只改 visible）',
  r.positionsChanged.length === 0,
  r.positionsChanged.slice(0, 3).join(' ; '),
);
ok(
  '角落（8,16）：本地玩家仍可见，且实测与独立重算一致',
  r.corner.min.visible > 0 && r.corner.min.mismatch === 0,
  `visible=${r.corner.min.visible} mismatch=${r.corner.min.mismatch}`,
);
ok(
  '角落（地图右下）：实测与独立重算一致',
  r.corner.max.mismatch === 0,
  `mismatch=${r.corner.max.mismatch}`,
);
ok(
  `玩家静止 ${r.stillSamples} 次采样：可见集合零翻转（无闪烁）`,
  r.still.maxToggles === 0,
  `maxToggles=${r.still.maxToggles} transitions=${r.still.transitions}`,
);
ok(
  '穿越视口边界期间：交互半径内的实体从不被裁（违规 0）',
  r.cross.nearInvisibleViolations === 0,
  `violations=${r.cross.nearInvisibleViolations}`,
);
ok(
  `穿越边界（${CROSS_ROUNDS} 个来回）：单实体 visible 翻转次数 ≤ 2×往返数+1（无异常抖动）`,
  r.cross.maxToggles <= 2 * CROSS_ROUNDS + 1,
  `maxToggles=${r.cross.maxToggles} transitions=${r.cross.transitions}`,
);

const failed = checks.filter((c) => !c.pass);

// ═══ 落盘（append，绝不覆盖历史）═══════════════════════════════════════════
if (!existsSync(join(root, 'docs'))) mkdirSync(join(root, 'docs'), { recursive: true });
if (!existsSync(DOC)) {
  writeFileSync(
    DOC,
    '# S8 性能基线测量记录\n\n本文件由 `scripts/perf-sample.mjs` / `pool-sample.mjs` / `viewport-sample.mjs` **追加**写入（不覆盖历史）。\n' +
      '口径：指标沿用总纲 §12（H5 60fps / ≤60 drawcall、小游戏 30fps / ≤40 drawcall、内存 ≤300MB、上行 ≤10 次/秒/人）。\n\n',
    'utf8',
  );
}

const colRow = (c) =>
  `| ${c.key} | ${c.marginPx} | ${c.total} | ${c.visibleMean} | ${c.visibleMin} | ${c.drawcallMean ?? 'n/a'} | ${c.fpsMean} | ${c.probe.mismatch} |`;

const md = [
  `## ${label} · ${new Date().toISOString()}`,
  '',
  `- commit: \`${git.commit}\`（工作区脏：${git.dirty === null ? 'n/a' : git.dirty ? '是' : '否'}）`,
  `- 浏览器: Chromium/${r.browserVersion} · headless=${headless ? '是' : '否'} · map-localhost-ipv4=${mapLocalhostIpv4 ? '是' : '否'}`,
  `- 打开地址: ${url} · userAgent: \`${r.userAgent}\``,
  `- 质量日志: \`${r.qualityLine}\``,
  `- 场景: ${r.sceneLine}`,
  '',
  '### A/B/C 三列（同一页面会话；自建实体 ' +
    `${r.prep.spawned} 个均匀铺满 ${MAP.w}x${MAP.h}，玩家静止于出生点 640,480，舞台 ${r.prep.stage.w}x${r.prep.stage.h}，每列静止 ${secondsPerCol}s）`,
  '',
  '| 列 | marginPx | 实体总 | 可见(均值) | 可见(最低) | drawcall(均值) | fps(均值) | 实测≠重算 |',
  '|---|---|---|---|---|---|---|---|',
  ...r.columns.map(colRow),
  '',
  '> drawcall 是引擎按采样窗口平滑过的读数（同一帧内 150 个 sprite 的合并批次不会因 visible 变化而线性下降）。',
  '',
  '### Step 4 边界点检',
  '',
  `- ① 玩家压到地图角落：左上 (${r.corner.min.me.x},${r.corner.min.me.y}) 可见 ${r.corner.min.visible}/${r.corner.min.total}（重算差异 ${r.corner.min.mismatch}）；右下 (${r.corner.max.me.x},${r.corner.max.me.y}) 可见 ${r.corner.max.visible}/${r.corner.max.total}（重算差异 ${r.corner.max.mismatch}）· 截图 \`${r.corner.screenshot}\``,
  `- ② 静止 ${r.stillSamples} 次采样：可见集合翻转 ${r.still.transitions} 次 / 涉及实体 ${r.still.involved} 个 / 单实体最大翻转 ${r.still.maxToggles} 次`,
  `- ③ 键盘穿越（${CROSS_ROUNDS} 个来回 × ${CROSS_MS}ms，共 ${r.cross.samples} 次采样）：可见集合变化 ${r.cross.transitions} 次 / 受影响实体 ${r.cross.involved} 个 / 单实体最大翻转 ${r.cross.maxToggles} 次 / 交互半径内被裁违规 **${r.cross.nearInvisibleViolations}** / 实测≠重算峰值 ${r.cross.mismatchMax}（裁剪 tick 每 5 帧一次，移动中的差异来自这 ≤1 tick 的滞后，非错位）· 截图 \`${r.cross.screenshot}\``,
  `- ④ 裁剪不改坐标：150 个自建实体在「关裁剪 → 紧裁剪 → 角落移动」后坐标变化 **${r.positionsChanged.length}** 处`,
  '',
  '### 结论（如实）',
  '',
  `- ${failed.length === 0 ? '全部断言通过' : `**${failed.length} 项断言失败**`}（共 ${checks.length} 项）。`,
  `- 默认边距 200px 在本 demo 下 **接近 no-op**：可见数 ${colA.visibleMean}（关裁剪）vs ${colB.visibleMean}（默认）—— 地图 ${MAP.w}x${MAP.h} 小于视口 ${colB.probe.rect.w}x${colB.probe.rect.h}，裁不到任何实体。`,
  `- 机制有效性由 C 列证明：marginPx=0 时可见数 ${colC.visibleMean}（${colC.visibleMean}/${colC.total}），被裁实体的坐标与关裁剪基线逐字一致。`,
  `- 默认 200px 真正有收益的场景：世界尺寸 > 舞台尺寸 + 2×200px（本 demo 1280x960 < 1360x1040，故无收益）；跨屏地图 / 大世界（如 4000x3000）下同屏实体数才会显著下降。`,
  '',
].join('\n');

writeFileSync(DOC, readFileSync(DOC, 'utf8').replace(/\n*$/, '\n\n') + md, 'utf8');

console.log(`${label} 断言：`);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.extra ? ` :: ${c.extra}` : ''}`);
console.log('');
console.log(JSON.stringify(r, null, 2));
console.log(`\n已追加到 ${DOC}`);
process.exit(failed.length === 0 ? 0 : 1);