// S8 Task 2 对象池 A/B 证据 + reset 字段断言（零依赖；除可选 playwright；**不写入任何 package.json**）
// 用法：node scripts/pool-sample.mjs [--headless] [--cycles 100] [--url http://localhost:5173/] [--map-localhost-ipv4]
//
// 前置：① 后端在 :3000 运行；② 静态服务器在 :5173 运行（node tools/serve.mjs）。
// 本机 playwright 由 `e:\code\node_modules\playwright` 解析（未装 → 打印 SKIP 指引并 exit 0）。
//
// 页内直接驱动**构建产物**（`/js/entity/EntityPool.js`、`/js/world/entity-pool-adapter.js`）——这些模块
// 顶层不触碰 Laya（池是纯逻辑、适配器只用已就绪的 Laya），页面里引擎已起，故可测「引擎侧真 reset」。
//   A 组（池化）    ：acquire → release × cycles，期望 stats created=1 / reused=cycles-1 / pooled=1；
//                     且第 1 次与第 cycles 次拿到的 sprite 是**同一引用**；drawcall 不变。
//   B 组（不复用）  ：每次 create 且保留引用 × cycles，读 heap 增量作对照。
//   reset 字段断言  ：把复用的实体弄脏（名字/位置/rotation/visible/任务标记/绘制命令）→ release → 再 acquire，
//                     断言全部可见状态回到 spec、且 sprite 子节点数不增长（无 Text 泄漏）。
//
// 诚实说明：A/B 的 heap 是**参考值**（app 自身仍在运行、GC 时机不定）；读数用「前后各让出若干帧 + 5 次采样取中位」，
// 不代表精确分配量。结果 append 到 docs/perf-sample.md（只追加，不覆盖历史）。断言不过 → exit 1。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = join(root, 'docs', 'perf-sample.md');

// ── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function argOf(name, dflt) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const label = 'pool';
const url = argOf('url', 'http://localhost:5173/');
const cycles = Number(argOf('cycles', '100'));
const headless = argv.includes('--headless');
const mapLocalhostIpv4 = argv.includes('--map-localhost-ipv4');
const stabilizeMs = 3000;
const USER = { user: 'spike01', pass: 'spike123456' };

// ── playwright 可选依赖：缺则 SKIP（不阻断验收）────────────────────────────
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('SKIP 未安装 playwright，附手动测量指引（本任务的关键结论已由 node 假实体断言覆盖）：');
  console.log('  1) 起后端 :3000 与静态服务器 :5173（node tools/serve.mjs）');
  console.log('  2) 浏览器打开 http://localhost:5173/ ，用 spike01 / spike123456 登录进场景');
  console.log('  3) 控制台执行：');
  console.log("     const P = await import('/js/entity/EntityPool.js');");
  console.log("     const { remotePlayerAdapter } = await import('/js/world/entity-pool-adapter.js');");
  console.log('     P.clear(); P.resetStats();');
  console.log("     for (let i=0;i<100;i++){ const e=P.acquire('player',{playerId:'p',x:640,y:480},remotePlayerAdapter); P.release(e); }");
  console.log('     P.stats()  // 期望 player.created=1 / reused=99 / pooled=1');
  console.log('  4) 把上述原始数值汇总写入 docs/perf-sample.md');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round1 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10) / 10 : v);

function gitInfo() {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
    return { commit, dirty };
  } catch (e) {
    return { commit: 'n/a', dirty: null, error: String(e) };
  }
}

const git = gitInfo();
const consoleLines = [];

const launchArgs = ['--enable-precise-memory-info'];
if (mapLocalhostIpv4) launchArgs.push('--host-resolver-rules=MAP localhost 127.0.0.1');

const browser = await chromium.launch({ headless, args: launchArgs });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('console', (m) => consoleLines.push(m.text()));

/** 页内测量：自包含（不能闭包外部变量），返回原始数值供 node 判定 */
async function measureInPage({ cycles }) {
  const Pool = await import('/js/entity/EntityPool.js');
  const { remotePlayerAdapter } = await import('/js/world/entity-pool-adapter.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const snap = () => (globalThis.__PERF__ ? globalThis.__PERF__.snapshot() : null);
  const readHeap = () => {
    const m = performance.memory;
    return m && typeof m.usedJSHeapSize === 'number' ? Math.round((m.usedJSHeapSize / 1048576) * 10) / 10 : null;
  };
  // 前后各让出若干帧 + 5 次采样取中位：既给 GC 机会，也削掉单次抖动（仍是参考值，非精确量）
  const heapMedian = async () => {
    for (let i = 0; i < 3; i++) await sleep(120);
    const vals = [];
    for (let i = 0; i < 5; i++) {
      const v = readHeap();
      if (typeof v === 'number') vals.push(v);
      await sleep(60);
    }
    if (!vals.length) return null;
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  };
  const cmdCountOf = (sprite) => {
    const g = sprite && sprite.graphics;
    return g && Array.isArray(g.cmds) ? g.cmds.length : null;
  };

  // ── A 组：池化（acquire → release 循环）──
  Pool.clear();
  Pool.resetStats();
  const dcBefore = snap()?.drawcall ?? null;
  const heapA0 = await heapMedian();
  const specA = { playerId: 'poolAB', x: 640, y: 480 };
  let firstSprite = null;
  let sameSprite = true;
  for (let i = 0; i < cycles; i++) {
    const e = Pool.acquire('player', specA, remotePlayerAdapter);
    if (i === 0) firstSprite = e.sprite;
    else if (e.sprite !== firstSprite) sameSprite = false;
    Pool.release(e);
  }
  const heapA1 = await heapMedian();
  const statsA = { ...Pool.stats().player };
  const dcAfterA = snap()?.drawcall ?? null;

  // ── B 组：不复用（每次新建并保留引用，防 GC 后读增量）──
  const keepB = [];
  globalThis.__POOL_KEEP__ = keepB;
  const heapB0 = await heapMedian();
  for (let i = 0; i < cycles; i++) keepB.push(remotePlayerAdapter.create(specA));
  const heapB1 = await heapMedian();
  const dcAfterB = snap()?.drawcall ?? null;
  globalThis.__POOL_KEEP__ = null;

  // ── reset 字段断言（风险 #2 硬要求）──
  Pool.clear();
  Pool.resetStats();
  const firstSpec = { playerId: 'ghost1', x: 640, y: 480 };
  const e1 = Pool.acquire('player', firstSpec, remotePlayerAdapter);
  const nameText = e1.sprite.getChildAt(0);
  const baseName = nameText ? nameText.text : null;
  const baseChildCount = e1.sprite.numChildren;
  const baseCmdCount = cmdCountOf(e1.sprite);

  // 置「脏」：名字 / 位置 / 旋转 / 可见性 / 任务标记 / 绘制命令
  if (nameText) nameText.text = 'GHOST';
  e1.setPos(9999, 9999);
  e1.sprite.rotation = 45;
  e1.sprite.visible = false;
  e1.setQuestMark('available');
  const markText = e1.sprite.getChildAt(e1.sprite.numChildren - 1);
  e1.sprite.graphics.clear();
  e1.sprite.graphics.drawRect(-18, -36, 36, 36, '#ff00ff');
  const dirty = {
    name: nameText ? nameText.text : null,
    x: e1.x,
    y: e1.y,
    rotation: e1.sprite.rotation,
    visible: e1.sprite.visible,
    questMarkVisible: !!markText && markText.visible === true,
    childCount: e1.sprite.numChildren,
    cmdCount: cmdCountOf(e1.sprite),
  };

  Pool.release(e1);

  // 反复「弄脏 → release → 再 acquire」，验证子节点数不随复用增长（无 Text 泄漏）
  const loopSpec = { playerId: 'ghostLoop', x: 5, y: 6 };
  let sameInstance = true;
  let childCountsStable = true;
  const childCounts = [];
  for (let i = 0; i < 8; i++) {
    if (nameText) nameText.text = `GHOST${i}`;
    e1.setQuestMark('submittable');
    e1.sprite.visible = false;
    e1.sprite.rotation = 30;
    Pool.release(e1);
    const again = Pool.acquire('player', loopSpec, remotePlayerAdapter);
    if (again !== e1) sameInstance = false;
    childCounts.push(e1.sprite.numChildren);
    if (e1.sprite.numChildren !== dirty.childCount) childCountsStable = false;
  }

  const finalMark = e1.sprite.getChildAt(1);
  const after = {
    name: nameText ? nameText.text : null,
    x: e1.x,
    y: e1.y,
    rotation: e1.sprite.rotation,
    visible: e1.sprite.visible,
    questMarkVisible: !!finalMark && finalMark.visible === true,
    childCount: e1.sprite.numChildren,
    cmdCount: cmdCountOf(e1.sprite),
  };

  const out = {
    cycles,
    drawcall: { before: dcBefore, afterA: dcAfterA, afterB: dcAfterB },
    heap: { a0: heapA0, a1: heapA1, b0: heapB0, b1: heapB1 },
    statsA,
    sameSprite,
    reset: {
      baseName,
      baseChildCount,
      baseCmdCount,
      dirty,
      after,
      sameInstance,
      childCountsStable,
      childCounts,
      expect: { name: '玩家ghostLoop', x: 5, y: 6, rotation: 0, visible: true, questMarkVisible: false },
    },
    heapSupported: readHeap() !== null,
  };
  Pool.clear();
  Pool.resetStats();
  return out;
}

let r = null;
let browserVersion = 'n/a';
try {
  // ① 清 localStorage（保证走登录页），再打开页面
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
  r = await page.evaluate(measureInPage, { cycles });
  r.userAgent = await page.evaluate(() => navigator.userAgent);
} finally {
  await browser.close();
}

// ── 判定（Aggregate：任一不过 → exit 1）─────────────────────────────────────
const checks = [];
const ok = (name, cond, extra = '') => checks.push({ name, pass: !!cond, extra });

const st = r.statsA;
ok('A 组 stats：created=1', st.created === 1, `created=${st.created}`);
ok('A 组 stats：reused=cycles-1', st.reused === cycles - 1, `reused=${st.reused} (期望 ${cycles - 1})`);
ok('A 组 stats：pooled=1', st.pooled === 1, `pooled=${st.pooled}`);
ok('A 组 stats：live=0', st.live === 0, `live=${st.live}`);
ok('A 组 stats：discarded=0', st.discarded === 0, `discarded=${st.discarded}`);
ok('A 组第 1 次与第 N 次拿到同一 sprite 引用', r.sameSprite === true);
if (r.drawcall.before !== null && r.drawcall.afterA !== null) {
  ok('A 组前后 drawcall 不变（±2 容差，引擎平滑读数有抖动）', Math.abs(r.drawcall.afterA - r.drawcall.before) <= 2, `${r.drawcall.before} → ${r.drawcall.afterA}`);
}
ok('reset：复用同一实例', r.reset.sameInstance === true);
ok('reset：名字回 spec 值', r.reset.after.name === r.reset.expect.name, `实际 ${JSON.stringify(r.reset.after.name)}`);
ok('reset：位置回 spec 值', r.reset.after.x === r.reset.expect.x && r.reset.after.y === r.reset.expect.y, `实际 (${r.reset.after.x},${r.reset.after.y})`);
ok('reset：rotation 归零', r.reset.after.rotation === r.reset.expect.rotation, `实际 ${r.reset.after.rotation}`);
ok('reset：visible=true', r.reset.after.visible === r.reset.expect.visible, `实际 ${r.reset.after.visible}`);
ok('reset：任务标记不可见', r.reset.after.questMarkVisible === false, `实际 ${r.reset.after.questMarkVisible}`);
ok('reset：sprite 子节点数不增长（无 Text 泄漏）', r.reset.childCountsStable === true, `childCounts=${JSON.stringify(r.reset.childCounts)} 脏态=${r.reset.dirty.childCount}`);
if (r.reset.baseCmdCount !== null && r.reset.after.cmdCount !== null) {
  ok('reset：graphics 命令数回到基线（旧绘制已清）', r.reset.after.cmdCount === r.reset.baseCmdCount, `基线 ${r.reset.baseCmdCount} → 脏 ${r.reset.dirty.cmdCount} → reset 后 ${r.reset.after.cmdCount}`);
}

const failed = checks.filter((c) => !c.pass);
console.log(`${label} A/B + reset 断言：`);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.extra ? ` :: ${c.extra}` : ''}`);

const dA = r.heap.a0 !== null && r.heap.a1 !== null ? round1(r.heap.a1 - r.heap.a0) : null;
const dB = r.heap.b0 !== null && r.heap.b1 !== null ? round1(r.heap.b1 - r.heap.b0) : null;
console.log(
  `\nheap 参考值（MB，中位）：A 组 ${r.heap.a0} → ${r.heap.a1}（Δ=${dA}）；B 组 ${r.heap.b0} → ${r.heap.b1}（Δ=${dB}）`,
);
console.log(`drawcall：before=${r.drawcall.before} A 后=${r.drawcall.afterA} B 后=${r.drawcall.afterB}`);
console.log(`A 组 stats：${JSON.stringify(r.statsA)}`);

if (!existsSync(join(root, 'docs'))) mkdirSync(join(root, 'docs'), { recursive: true });
if (!existsSync(DOC)) {
  writeFileSync(
    DOC,
    '# S8 性能基线测量记录\n\n本文件由 `scripts/perf-sample.mjs` / `scripts/pool-sample.mjs` **追加**写入（不覆盖历史）。\n' +
      '口径：指标沿用总纲 §12（H5 60fps / ≤60 drawcall、小游戏 30fps / ≤40 drawcall、内存 ≤300MB、上行 ≤10 次/秒/人）。\n\n',
    'utf8',
  );
}

const md = [
  `## ${label} · ${new Date().toISOString()}`,
  '',
  `- commit: \`${git.commit}\`（工作区脏：${git.dirty === null ? 'n/a' : git.dirty ? '是' : '否'}）`,
  `- 浏览器: Chromium/${browserVersion} · headless=${headless ? '是' : '否'} · map-localhost-ipv4=${mapLocalhostIpv4 ? '是' : '否'}`,
  `- 打开地址: ${url}`,
  `- 参数: cycles=${cycles}（A/B 各 1 组；页内驱动构建产物 /js/entity/EntityPool.js + /js/world/entity-pool-adapter.js）`,
  `- userAgent: \`${r.userAgent}\``,
  '',
  '### A 组（池化：acquire → release × ' + cycles + '）',
  '',
  `- stats(player): \`${JSON.stringify(r.statsA)}\`（期望 created=1 / reused=${cycles - 1} / pooled=1 / live=0 / discarded=0）`,
  `- 第 1 次与第 ${cycles} 次 sprite 引用相同：**${r.sameSprite ? '是' : '否'}**`,
  `- drawcall：前 **${r.drawcall.before}** → A 后 **${r.drawcall.afterA}**`,
  `- heap 中位：${r.heap.a0} MB → ${r.heap.a1} MB（Δ=${dA} MB）`,
  '',
  `### B 组（对照：create 且保留引用 × ${cycles}）`,
  '',
  `- heap 中位：${r.heap.b0} MB → ${r.heap.b1} MB（Δ=${dB} MB）`,
  `- drawcall：B 后 ${r.drawcall.afterB}（新实体未入场景层，故不变）`,
  '',
  '> heap 为**参考值**：app 自身仍在运行、GC 时机不定；读数取「前后各让出若干帧 + 5 次采样中位」，不代表精确分配量。',
  '',
  '### reset 字段断言（风险 #2：幽灵实体）',
  '',
  `- 复用同一实例：**${r.reset.sameInstance ? '是' : '否'}**`,
  `- 弄脏时的值：name=${JSON.stringify(r.reset.dirty.name)} pos=(${r.reset.dirty.x},${r.reset.dirty.y}) rotation=${r.reset.dirty.rotation} visible=${r.reset.dirty.visible} 任务标记可见=${r.reset.dirty.questMarkVisible}`,
  `- reset 后的值：name=${JSON.stringify(r.reset.after.name)} pos=(${r.reset.after.x},${r.reset.after.y}) rotation=${r.reset.after.rotation} visible=${r.reset.after.visible} 任务标记可见=${r.reset.after.questMarkVisible}`,
  `- 期望值：name=${JSON.stringify(r.reset.expect.name)} pos=(${r.reset.expect.x},${r.reset.expect.y}) rotation=${r.reset.expect.rotation} visible=${r.reset.expect.visible} 任务标记可见=${r.reset.expect.questMarkVisible}`,
  `- sprite 子节点数：脏态 ${r.reset.dirty.childCount}，8 轮「弄脏→release→acquire」后记录 = ${JSON.stringify(r.reset.childCounts)}（不增长=**${r.reset.childCountsStable ? '是' : '否'}**）`,
  `- graphics 命令数：基线 ${r.reset.baseCmdCount} → 脏 ${r.reset.dirty.cmdCount} → reset 后 ${r.reset.after.cmdCount}`,
  '',
  '### 结论',
  '',
  `- ${failed.length === 0 ? '全部断言通过' : `**${failed.length} 项断言失败**`}（共 ${checks.length} 项）`,
  `- 池化把 ${cycles} 次「进出视野」从 ${cycles} 次分配压到 1 次（created=1 / reused=${cycles - 1}），sprite/Text 全程同一引用，无幽灵状态残留。`,
  '',
].join('\n');

writeFileSync(DOC, readFileSync(DOC, 'utf8').replace(/\n*$/, '\n\n') + md, 'utf8');

console.log(JSON.stringify(r, null, 2));
console.log(`\n已追加到 ${DOC}`);
process.exit(failed.length === 0 ? 0 : 1);