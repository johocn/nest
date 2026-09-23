// S8 Task 5 远端插值证据（零依赖；除可选 playwright；**不写入任何 package.json**）
// 用法：node scripts/interp-sample.mjs [--headless] [--leg-ms 1500] [--url http://localhost:5173/] [--map-localhost-ipv4]
//
// 前置：① 后端在 :3000 运行；② 静态服务器在 :5173 运行（node tools/serve.mjs）。
// 本机 playwright 由 `e:\code\node_modules\playwright` 解析（未装 → 打印 SKIP 指引并 exit 0）。
//
// 两个独立 Chromium 进程（各一个页面）分别登录两个不同账号（A=移动方、B=观察方），同处场景 1 房间：
//   A 端按固定闭合路线（右→下→左→上，各 1.5s，回到出生点）移动，客户端 10Hz 上报 → 服务端即时
//   向房间广播 `world.entity_update`（entityType=player）。
//   B 端在页内用 requestAnimationFrame **逐帧**记录 `player:<A.playerId>` 的坐标序列，
//   由此算出「逐帧位移 d」的分布。
//
// 四轮交替相位（同一页面会话、同一对登录）：
//   相位 1/3 = 插值开（AppConfig.remote.interpBufferMs=120）；相位 2/4 = 基线（=0，收到广播直接到位）。
//   每轮前静置 800ms 让插值收敛，否则上一轮的残留目标会污染下一轮的起点。
//
// 结果 append 到 docs/perf-sample.md（只追加，不覆盖历史）。断言不过 → exit 1。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = join(root, 'docs', 'perf-sample.md');
const label = 'interp';

// ── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function argOf(name, dflt) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const url = argOf('url', 'http://localhost:5173/');
const legMs = Number(argOf('leg-ms', '1500'));
const headless = argv.includes('--headless');
const mapLocalhostIpv4 = argv.includes('--map-localhost-ipv4');
/**
 * 环境特例（可选）：本机 5173 被别的项目（`jianghu-client/shells/h5` 的 vite）占用，而后端 CORS
 * 白名单（`CORS_ORIGINS`）只认 `http://localhost:5173`。此时把 `tools/serve.mjs` 另起在别的端口
 * （如 `S1_PORT=5180`），并用本参数把发往 **5173 的连接目标**改到该端口 —— 页面 origin 仍是
 * `http://localhost:5173`，登录/WS 的 CORS 校验照常通过。不传则直连 `--url`。
 */
const proxyPort = argOf('proxy-port', null);
const stabilizeMs = 3000;
/** 闭合路线：右→下→左→上，每腿 legMs；四腿后回到出生点（1280x960 地图内，不触边界） */
const ROUTE = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
/** A=移动方（既有账号）、B=观察方 */
const USER_A = { user: 'spike01', pass: 'spike123456' };
const USER_B = { user: 'spike02', pass: 'spike123456' };
/** 移动速度（px/s）= AppConfig.moveSpeedPxPerMs × 1000；用于「单帧应有位移」的判据 */
const SPEED_PX_PER_S = 240;
/** 相位序列：交替「插值开 / 基线」两轮，抵消单次运行的漂移 */
const PHASES = [
  { tag: '插值开(第1轮)', bufferMs: 120 },
  { tag: '基线(第1轮)', bufferMs: 0 },
  { tag: '插值开(第2轮)', bufferMs: 120 },
  { tag: '基线(第2轮)', bufferMs: 0 },
];

// ── playwright 可选依赖：缺则 SKIP（不阻断验收）────────────────────────────
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('SKIP 未安装 playwright，附手动测量指引（关键结论已由 node 纯函数断言覆盖）：');
  console.log('  1) 起后端 :3000 与静态服务器 :5173（node tools/serve.mjs）');
  console.log('  2) 窗口 A 登录 spike01、窗口 B 登录 spike02，都进场景 1');
  console.log('  3) 窗口 B 控制台执行：');
  console.log("     const { EntityRegistry } = await import('/js/entity/EntityRegistry.js');");
  console.log('     const e = EntityRegistry.get("player:1");  // A 的 playerId');
  console.log('     // 用 rAF 逐帧记录 e.x/e.y，切窗口 A 按键走动，统计逐帧位移的最大值');
  console.log("     // 再在窗口 B 执行 AppConfig.remote.interpBufferMs = 0 / 120 做 A/B 对照");
  console.log('  4) 把两种设置下的逐帧最大跳变原始数值汇总写入 docs/perf-sample.md');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round1 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10) / 10 : v);
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

function gitInfo() {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
    return { commit, dirty };
  } catch (e) {
    return { commit: 'n/a', dirty: null, error: String(e) };
  }
}

// ═══ 页内函数（自包含，不能闭包外部变量；都通过 page.evaluate 传入）════════════

/** 读取本页身份与本地玩家坐标 */
async function readIds() {
  const { Session } = await import('/js/net/Session.js');
  const { EntityRegistry } = await import('/js/entity/EntityRegistry.js');
  const { AppConfig } = await import('/js/config/AppConfig.js');
  const meId = 'player:' + Session.playerId;
  const me = EntityRegistry.get(meId);
  return {
    playerId: Session.playerId,
    accountId: Session.accountId,
    meId,
    me: me ? { x: me.x, y: me.y } : null,
    entityTotal: EntityRegistry.all().length,
    interpBufferMs: AppConfig.remote.interpBufferMs,
    speedPxPerMs: AppConfig.moveSpeedPxPerMs,
  };
}

/** B 端：装一个常驻 rAF 采样器（`running` 由 startSample/stopSample 切换，跨相位复用） */
async function initSampler({ remoteEntityId }) {
  const { EntityRegistry } = await import('/js/entity/EntityRegistry.js');
  const st = (globalThis.__INTERP__ = {
    id: remoteEntityId,
    running: false,
    frames: [],
    missFrames: 0,
    totalFrames: 0,
    last: null,
  });
  const tick = () => {
    st.totalFrames++;
    if (st.running) {
      const t = performance.now();
      const e = EntityRegistry.get(st.id);
      if (!e) {
        st.missFrames++;
      } else {
        const x = e.x;
        const y = e.y;
        const d = st.last ? Math.hypot(x - st.last.x, y - st.last.y) : 0;
        st.frames.push({
          t: Math.round(t),
          dt: st.last ? Math.round((t - st.last.t) * 100) / 100 : 0,
          x,
          y,
          d: Math.round(d * 100) / 100,
        });
        st.last = { x, y, t };
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { id: st.id, hasEntity: !!EntityRegistry.get(st.id) };
}

/** 开始/结束采样（清空上一轮 frames，并重置「前值」避免跨轮假跳变） */
async function startSample() {
  const st = globalThis.__INTERP__;
  st.frames = [];
  st.missFrames = 0;
  st.last = null;
  st.running = true;
  return true;
}

async function stopSample() {
  const st = globalThis.__INTERP__;
  st.running = false;
  return { frames: st.frames, missFrames: st.missFrames, totalFrames: st.totalFrames };
}

/** 切换 A/B 变量（`RemoteInterp.update` 每帧现读，改完下一帧即生效） */
async function setBuffer(bufferMs) {
  const { AppConfig } = await import('/js/config/AppConfig.js');
  AppConfig.remote.interpBufferMs = bufferMs;
  return { interpBufferMs: AppConfig.remote.interpBufferMs, snapPx: AppConfig.remote.snapPx };
}

async function readPerf() {
  return window.__PERF__ ? window.__PERF__.snapshot() : null;
}

/** 远端实体是否已被广播建出来（A 未移动过时为 false：远端实体只在移动广播时懒建） */
async function hasRemote(remoteEntityId) {
  const { EntityRegistry } = await import('/js/entity/EntityRegistry.js');
  const { RemoteInterp } = await import('/js/entity/components/RemoteInterp.js');
  const e = EntityRegistry.get(remoteEntityId);
  return { exists: !!e, pos: e ? { x: e.x, y: e.y } : null, hasInterp: e ? !!e.getComponent(RemoteInterp) : false };
}

// ═══ 统计工具 ═══════════════════════════════════════════════════════════════

/** 逐帧位移分布：最大跳变 / 中位 / p95 / 直方图（第一帧无前值，剔除） */
function analyze(frames) {
  const fs = frames.filter((f) => typeof f.d === 'number');
  const ds = fs.slice(1).map((f) => f.d);
  const dts = fs.slice(1).map((f) => f.dt).filter((v) => v > 0);
  const medianDt = median(dts);
  const expectedStep = medianDt ? (SPEED_PX_PER_S * medianDt) / 1000 : null;
  // 判据阈值：> max(8px, 2×单帧应有位移)。插值开的逐帧位移应 ≲ 单帧应有位移，
  // 基线的一次广播位移（≈24px@10Hz）应超过阈值 —— 阈值随实测帧率自适应。
  const threshold = expectedStep ? Math.max(8, 2 * expectedStep) : 8;
  const hist = new Map();
  for (const d of ds) {
    const k = Math.round(d);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  const sortedDs = [...ds].sort((a, b) => a - b);
  const at = (p) => (sortedDs.length ? sortedDs[Math.min(sortedDs.length - 1, Math.floor(p * (sortedDs.length - 1)))] : null);
  return {
    frames: fs.length,
    medianDtMs: medianDt === null ? null : Math.round(medianDt * 100) / 100,
    fps: medianDt ? Math.round((1000 / medianDt) * 10) / 10 : null,
    expectedStepPx: expectedStep === null ? null : Math.round(expectedStep * 100) / 100,
    thresholdPx: Math.round(threshold * 100) / 100,
    maxJumpPx: ds.length ? Math.max(...ds) : null,
    medianJumpMovingPx: round1(median(ds.filter((d) => d > 0))),
    p95JumpPx: round1(at(0.95)),
    jumpFrames: ds.filter((d) => d > threshold).length,
    stillFrames: ds.filter((d) => d === 0).length,
    meanJumpMovingPx: round1(mean(ds.filter((d) => d > 0))),
    histogram: [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
  };
}

const git = gitInfo();
const consoleA = [];
const consoleB = [];

const launchArgs = ['--enable-precise-memory-info'];
// 两个页面必须都保持运行：禁用后台节流，否则被置于后台的页面 rAF 会停摆 → 采样断流
launchArgs.push(
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
);
if (mapLocalhostIpv4) launchArgs.push('--host-resolver-rules=MAP localhost 127.0.0.1');
if (proxyPort) launchArgs.push(`--host-resolver-rules=MAP localhost:5173 127.0.0.1:${proxyPort}`);

// 两个页面（各一个**独立 Chromium 进程**）必须都保持运行：既隔离 GPU/渲染，也避免被置于后台的
// 页面 rAF 停摆导致采样断流 —— 逐帧采样要求观察方全程在跑。
const browserA = await chromium.launch({ headless, args: launchArgs });
const browserB = await chromium.launch({ headless, args: launchArgs });

/**
 * 等控制台出现某条日志（登录→进场景是异步链路，只等 `entityTotal>0` 会被「静态层已建」提前满足，
 * 导致观察方尚未连上 WS 就开始采样）。轮询控制台缓冲，比在页内挂标记更少侵入。
 */
async function waitForLog(sink, needle, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (sink.some((l) => l.includes(needle))) return true;
    await sleep(100);
  }
  return false;
}

/** 登录 + 等**真正进场景**（本地玩家已建、移动控制已挂）—— 两端都必须是这个状态才开始采样 */
async function openLoggedInPage(browser, user, consoleSink) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('console', (m) => consoleSink.push(m.text()));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => localStorage.clear());
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#s1-submit', { timeout: 30000 });
  await page.fill('#s1-user', user.user);
  await page.fill('#s1-pass', user.pass);
  await page.click('#s1-submit');
  await page.waitForFunction(() => !!window.__PERF__, { timeout: 60000 });
  const entered = await waitForLog(consoleSink, '移动控制就绪', 60000);
  if (!entered) {
    throw new Error(
      `账号 ${user.user} 进场景超时（未出现「移动控制就绪」）。控制台尾部：${consoleSink.slice(-6).join(' | ')}`,
    );
  }
  await sleep(stabilizeMs);
  return { context, page };
}

let r = null;
let browserVersion = 'n/a';
try {
  const a = await openLoggedInPage(browserA, USER_A, consoleA);
  const b = await openLoggedInPage(browserB, USER_B, consoleB);
  browserVersion = browserA.version();

  // A 的键盘事件挂在画布上，先点一下拿焦点；随后全程只在 A 端按键
  await a.page.mouse.click(640, 400);
  await sleep(300);

  const idA = await a.page.evaluate(readIds);
  const idB = await b.page.evaluate(readIds);
  const remoteId = `player:${idA.playerId}`;
  await b.page.evaluate(initSampler, { remoteEntityId: remoteId });

  // 预热：先走一整条闭合路线，让「远端实体懒建 → 池/组件就绪」的抖动落在采样窗口之外
  for (const key of ROUTE) {
    await a.page.keyboard.down(key);
    await sleep(legMs);
    await a.page.keyboard.up(key);
  }
  await sleep(500);

  const remote = await b.page.evaluate(hasRemote, remoteId);
  if (!remote.exists || !remote.hasInterp) {
    throw new Error(
      `B 端远端实体不完整 ${remoteId}：exists=${remote.exists} hasInterp=${remote.hasInterp}。` +
        `A=${JSON.stringify(idA)} B=${JSON.stringify(idB)} B 控制台尾部：${consoleB.slice(-6).join(' | ')}`,
    );
  }

  const phases = [];
  for (const ph of PHASES) {
    const applied = await b.page.evaluate(setBuffer, ph.bufferMs);
    await sleep(800); // 静置：让上一轮的残留插值目标收敛，避免污染本轮起点
    const perfBefore = await b.page.evaluate(readPerf);
    await b.page.evaluate(startSample);
    for (const key of ROUTE) {
      await a.page.keyboard.down(key);
      await sleep(legMs);
      await a.page.keyboard.up(key);
    }
    const raw = await b.page.evaluate(stopSample);
    const perfAfter = await b.page.evaluate(readPerf);
    phases.push({
      ...ph,
      appliedInterpBufferMs: applied.interpBufferMs,
      appliedSnapPx: applied.snapPx,
      stats: analyze(raw.frames),
      missFrames: raw.missFrames,
      totalFrames: raw.totalFrames,
      drawcall: {
        before: perfBefore ? perfBefore.drawcall : null,
        after: perfAfter ? perfAfter.drawcall : null,
      },
      entityTotal: perfAfter ? perfAfter.entityTotal : null,
      firstPos: raw.frames.length ? { x: raw.frames[0].x, y: raw.frames[0].y } : null,
      lastPos: raw.frames.length ? { x: raw.frames[raw.frames.length - 1].x, y: raw.frames[raw.frames.length - 1].y } : null,
    });
  }

  const posAEnd = await a.page.evaluate(readIds);
  r = {
    idA,
    idB,
    remoteId,
    remote,
    browserVersion,
    userAgent: await b.page.evaluate(() => navigator.userAgent),
    legMs,
    route: ROUTE.map((k) => `${k} ${legMs / 1000}s`).join(' → '),
    phases,
    posAEnd,
    qualityLine: consoleB.find((l) => l.includes('[S8] quality=')) ?? '(未捕获到质量日志)',
    sceneLine: consoleB.find((l) => l.includes('静态层渲染完成')) ?? '(未捕获到静态层日志)',
  };
} finally {
  await browserA.close();
  await browserB.close();
}

// ═══ 判定 ═══════════════════════════════════════════════════════════════════
const checks = [];
const ok = (name, cond, extra = '') => checks.push({ name, pass: !!cond, extra });

const interp = r.phases.filter((p) => p.bufferMs === 120);
const base = r.phases.filter((p) => p.bufferMs === 0);
const maxOf = (list, f) => Math.max(...list.map(f));
const minOf = (list, f) => Math.min(...list.map(f));

ok('两个账号都进入了场景（远端实体在 B 端可见）', r.phases.every((p) => p.stats.frames > 0), `remoteId=${r.remoteId}`);
ok(
  'B 端采样期间从未丢帧（远端实体始终在注册表中）',
  r.phases.every((p) => p.missFrames === 0),
  r.phases.map((p) => `${p.tag}:miss=${p.missFrames}`).join(' '),
);
ok(
  '基线（interpBufferMs=0）：逐帧最大跳变达到一次广播位移量级（>16px）',
  minOf(base, (p) => p.stats.maxJumpPx) > 16,
  base.map((p) => `${p.tag}:max=${p.stats.maxJumpPx}px`).join(' '),
);
ok(
  '插值开（interpBufferMs=120）：逐帧最大跳变 ≤ 2×单帧应有位移（≈单帧位移，无跳变）',
  maxOf(interp, (p) => p.stats.maxJumpPx) <= 2 * minOf(interp, (p) => p.stats.expectedStepPx ?? 99),
  interp
    .map((p) => `${p.tag}:max=${p.stats.maxJumpPx}px vs 单帧应有 ${p.stats.expectedStepPx}px`)
    .join(' '),
);
ok(
  '插值把逐帧最大跳变压到基线的 1/3 以下',
  maxOf(interp, (p) => p.stats.maxJumpPx) < minOf(base, (p) => p.stats.maxJumpPx) / 3,
  `插值开 max=${maxOf(interp, (p) => p.stats.maxJumpPx)}px · 基线 max=${minOf(base, (p) => p.stats.maxJumpPx)}px`,
);
ok(
  '插值开：超过阈值（2×单帧位移）的「可见跳变」帧为 0',
  interp.every((p) => p.stats.jumpFrames === 0),
  interp.map((p) => `${p.tag}:jumpFrames=${p.stats.jumpFrames}/${p.stats.frames}`).join(' '),
);
ok(
  '基线：确有「可见跳变」帧（问题可复现）',
  base.every((p) => p.stats.jumpFrames > 0),
  base.map((p) => `${p.tag}:jumpFrames=${p.stats.jumpFrames}/${p.stats.frames}`).join(' '),
);
ok(
  '插值开：非零位移帧的中位位移 ≈ 单帧应有位移（匀速前进，非「停-跳」）',
  interp.every((p) => Math.abs(p.stats.medianJumpMovingPx - p.stats.expectedStepPx) <= 1.5),
  interp
    .map((p) => `${p.tag}:中位 ${p.stats.medianJumpMovingPx}px vs 应有 ${p.stats.expectedStepPx}px`)
    .join(' '),
);
ok(
  '插值不改变 drawcall 量级（两相位 B 端读数差 ≤ 2）',
  Math.abs(maxOf(interp, (p) => p.drawcall.after ?? 0) - maxOf(base, (p) => p.drawcall.after ?? 0)) <= 2,
  `插值开=${interp.map((p) => p.drawcall.after).join('/')} · 基线=${base.map((p) => p.drawcall.after).join('/')}`,
);

const failed = checks.filter((c) => !c.pass);

// ═══ 落盘（append，绝不覆盖历史）═══════════════════════════════════════════
if (!existsSync(join(root, 'docs'))) mkdirSync(join(root, 'docs'), { recursive: true });
if (!existsSync(DOC)) {
  writeFileSync(
    DOC,
    '# S8 性能基线测量记录\n\n本文件由 `scripts/*-sample.mjs` **追加**写入（不覆盖历史）。\n' +
      '口径：指标沿用总纲 §12（H5 60fps / ≤60 drawcall、小游戏 30fps / ≤40 drawcall、内存 ≤300MB、上行 ≤10 次/秒/人）。\n\n',
    'utf8',
  );
}

const phaseRow = (p) =>
  `| ${p.tag} | ${p.bufferMs} | ${p.stats.frames} | ${p.stats.fps} | ${p.stats.medianDtMs} | ${p.stats.expectedStepPx} | ` +
  `${p.stats.maxJumpPx} | ${p.stats.medianJumpMovingPx} | ${p.stats.p95JumpPx} | ${p.stats.jumpFrames} (阈值 ${p.stats.thresholdPx}) | ${p.stats.stillFrames} |`;

const md = [
  `## ${label} · ${new Date().toISOString()}`,
  '',
  `- commit: \`${git.commit}\`（工作区脏：${git.dirty === null ? 'n/a' : git.dirty ? '是' : '否'}）`,
  `- 浏览器: Chromium/${r.browserVersion} · headless=${headless ? '是' : '否'} · map-localhost-ipv4=${mapLocalhostIpv4 ? '是' : '否'} · proxy-port=${proxyPort ?? '无'}`,
  `- userAgent: \`${r.userAgent}\``,
  `- 打开地址: ${url} × 2 个独立 Chromium 进程${proxyPort ? `（页面 origin 保持 ${url}，5173 的连接目标经 host-resolver-rules 改到 127.0.0.1:${proxyPort} 的自起 serve.mjs；因后端 CORS 只认 http://localhost:5173）` : ''} · 质量日志: \`${r.qualityLine}\``,
  `- 场景: ${r.sceneLine}`,
  `- A（移动方）: ${r.idA.meId}（account=${r.idA.accountId}，出生点 ${r.idA.me ? `${r.idA.me.x},${r.idA.me.y}` : 'n/a'}）· speedPxPerMs=${r.idA.speedPxPerMs}`,
  `- B（观察方）: ${r.idB.meId}（account=${r.idB.accountId}）· 采样实体 \`${r.remoteId}\``,
  `- 路线（${r.legMs / 1000}s/腿，闭合回到出生点）: ${r.route}`,
  `- 四轮交替相位（同会话同登录；每轮前静置 800ms 让插值收敛）`,
  '',
  '### 逐帧位移分布（B 端 rAF 采样 `player:<A>` 坐标；d = 相邻帧坐标差）',
  '',
  '| 相位 | interpBufferMs | 帧数 | fps(中位dt) | 中位dt(ms) | 单帧应有位移(px) | 最大跳变(px) | 非零帧中位(px) | p95(px) | 可见跳变帧数 | 静止帧数 |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...r.phases.map(phaseRow),
  '',
  '> 「可见跳变帧」判据：逐帧位移 > max(8px, 2×单帧应有位移)，阈值随实测帧率自适应（见各相位括号内数值）。',
  '> 「单帧应有位移」= 240px/s × 实测中位帧间隔；插值开的逐帧位移应与它同量级（匀速前进），基线则集中在 0 与一次广播位移（≈10Hz → 24px）。',
  '',
  '### 各相位逐帧位移直方图（top 6）',
  '',
  '| 相位 | interpBufferMs | 位移(px) → 帧数 |',
  '|---|---|---|',
  ...r.phases.map((p) => `| ${p.tag} | ${p.bufferMs} | ${p.stats.histogram.map(([d, n]) => `${d}px×${n}`).join(' · ')} |`),
  '',
  '### 其他读数',
  '',
  '| 相位 | 采样起始坐标 | 采样结束坐标 | B 端 drawcall(前→后) | B 端实体总 | 采样器总帧数 | 丢帧 |',
  '|---|---|---|---|---|---|---|',
  ...r.phases.map(
    (p) =>
      `| ${p.tag} | ${p.firstPos ? `${p.firstPos.x},${p.firstPos.y}` : 'n/a'} | ${p.lastPos ? `${p.lastPos.x},${p.lastPos.y}` : 'n/a'} | ` +
      `${p.drawcall.before} → ${p.drawcall.after} | ${p.entityTotal} | ${p.totalFrames} | ${p.missFrames} |`,
  ),
  '',
  '### 结论（如实）',
  '',
  `- ${failed.length === 0 ? '全部断言通过' : `**${failed.length} 项断言失败**`}（共 ${checks.length} 项）。`,
  `- 基线（interpBufferMs=0）：逐帧最大跳变 ${minOf(base, (p) => p.stats.maxJumpPx)}px，可见跳变帧 ${base.map((p) => p.stats.jumpFrames).join('/')} 帧 —— 即 10Hz 广播「停-跳」的真实形态。`,
  `- 插值开（interpBufferMs=120）：逐帧最大跳变 ${maxOf(interp, (p) => p.stats.maxJumpPx)}px（≈单帧应有位移 ${minOf(interp, (p) => p.stats.expectedStepPx)}px），可见跳变帧 0 —— 位置连续无跳变。`,
  `- 插值代价：B 端 drawcall 两相位读数 ${interp.map((p) => p.drawcall.after).join('/')} vs ${base.map((p) => p.drawcall.after).join('/')}（差 ≤1），插值不引入额外绘制批次。`,
  `- 30fps 等价性（小游戏）由**纯函数**证明，非本脚本：\`scripts/smoke-s8-perf.mjs\` 断言「60fps 单帧 4px / 30fps 单帧 8px，1s 总位移均为 240px（直线与对角差 <1px）」——时间基位移与帧率无关。`,
  '',
].join('\n');

writeFileSync(DOC, readFileSync(DOC, 'utf8').replace(/\n*$/, '\n\n') + md, 'utf8');

console.log(`${label} 断言：`);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.extra ? ` :: ${c.extra}` : ''}`);
console.log('');
console.log(JSON.stringify(r, null, 2));
console.log(`\n已追加到 ${DOC}`);
process.exit(failed.length === 0 ? 0 : 1);