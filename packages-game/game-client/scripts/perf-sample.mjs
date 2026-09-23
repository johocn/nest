// S8 性能基线采样器（零依赖：除可选的 playwright；不写入任何 package.json）
// 用法：node scripts/perf-sample.mjs --label baseline [--headless] [--move-ms 10000] [--idle-ms 10000] [--quality high|low]
//
// 前置：① 后端在 :3000 运行；② 静态服务器在 :5173 运行（node tools/serve.mjs）。
// 本机 playwright 由 `e:\code\node_modules\playwright` 解析（未装 → 打印 SKIP 与手动测量指引并 exit 0）。
//
// 固定路线（场景 1 = 1280x960、出生点 640,480、基线速 4px/帧@60fps ≈ 240px/s，不触边界）：
//   按住 ArrowRight 1.9s → ArrowDown 1.9s → ArrowLeft 1.9s → ArrowUp 1.9s → ArrowRight 2.4s（共 10.0s），
//   随后不按键静止 10.0s；移动段与静止段各自每秒采一次 `__PERF__.snapshot()`。
// 结果 append 到 docs/perf-sample.md（只追加，不覆盖历史），并把 JSON 原样打到 stdout。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = join(root, 'docs', 'perf-sample.md');

/** 键盘路线：占比 × moveMs（合计 1.0） */
const KEY_PLAN = [
  ['ArrowRight', 0.19],
  ['ArrowDown', 0.19],
  ['ArrowLeft', 0.19],
  ['ArrowUp', 0.19],
  ['ArrowRight', 0.24],
];

// ── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function argOf(name, dflt) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const label = argOf('label', 'baseline');
const url = argOf('url', 'http://localhost:5173/');
const moveMs = Number(argOf('move-ms', '10000'));
const idleMs = Number(argOf('idle-ms', '10000'));
const quality = argOf('quality', null); // 'high' | 'low' | null（不传 = 走平台默认）
const headless = argv.includes('--headless');
/**
 * 把 `localhost` 强制解析到 127.0.0.1。仅用于「本机 ::1:5173 被别的 dev server 占用」这类环境：
 * 页面 origin 仍保持 `http://localhost:5173`（后端 CORS 白名单认这个），只是解析走 IPv4。
 */
const mapLocalhostIpv4 = argv.includes('--map-localhost-ipv4');
const stabilizeMs = 3000;
const USER = { user: 'spike01', pass: 'spike123456' };

// ── playwright 可选依赖：缺则 SKIP（不阻断验收）────────────────────────────
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('SKIP 未安装 playwright，附手动测量指引：');
  console.log('  1) 起后端 :3000 与静态服务器 :5173（node tools/serve.mjs）');
  console.log('  2) 浏览器打开 http://localhost:5173/ ，用 spike01 / spike123456 登录进场景');
  console.log('  3) 按 F3 打开性能面板，按上述固定路线移动 10s、静止 10s');
  console.log('  4) 每秒记录面板 fps/drawcall/实体/上行/内存，汇总写入 docs/perf-sample.md');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gitInfo() {
  try {
    const cwd = root;
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim().length > 0;
    return { commit, dirty };
  } catch (e) {
    return { commit: 'n/a', dirty: null, error: String(e) };
  }
}

const round = (v, n = 1) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10 ** n) / 10 ** n : v);
const mean = (arr) => (arr.length ? round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
const max = (arr) => (arr.length ? Math.max(...arr) : null);
const nums = (arr) => arr.filter((v) => typeof v === 'number' && isFinite(v));

async function sampleOnce(page) {
  return page.evaluate(() => (window.__PERF__ ? window.__PERF__.snapshot() : null));
}

/** 每秒一次采样，共 ms 毫秒（最后一段不足 1s 也算一次） */
async function sampleDuring(page, ms) {
  const out = [];
  const start = Date.now();
  for (;;) {
    const remain = ms - (Date.now() - start);
    if (remain <= 0) break;
    await sleep(Math.min(1000, remain));
    const s = await sampleOnce(page);
    if (s) out.push({ t: round((Date.now() - start) / 1000), ...s });
  }
  return out;
}

const git = gitInfo();
const urlWithQuality = quality ? `${url}${url.includes('?') ? '&' : '?'}quality=${quality}` : url;
const consoleLines = [];

const launchArgs = ['--enable-precise-memory-info'];
if (mapLocalhostIpv4) launchArgs.push('--host-resolver-rules=MAP localhost 127.0.0.1');

const browser = await chromium.launch({
  headless,
  args: launchArgs,
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('console', (m) => consoleLines.push(m.text()));

let record = null;
try {
  // ① 清 localStorage（保证走登录页），再打开页面
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(urlWithQuality, { waitUntil: 'domcontentloaded' });

  // ② H5 DOM 登录表单
  await page.waitForSelector('#s1-submit', { timeout: 20000 });
  await page.fill('#s1-user', USER.user);
  await page.fill('#s1-pass', USER.pass);
  await page.click('#s1-submit');

  // ③ 等 __PERF__ 可用 + 进场景完成（entityTotal > 0 或出现「进场景应答」日志）
  await page.waitForFunction(() => !!window.__PERF__, { timeout: 30000 });
  await page
    .waitForFunction(
      () => window.__PERF__ && window.__PERF__.snapshot().entityTotal > 0,
      { timeout: 30000 },
    )
    .catch(() => {
      if (!consoleLines.some((l) => l.includes('进场景应答'))) {
        throw new Error('进场景超时：既无 entityTotal>0，也未出现「进场景应答」日志');
      }
    });
  // ④ 稳定 3 秒 → 打开面板
  await sleep(stabilizeMs);
  await page.evaluate(() => window.__PERF__.panel(true));
  // 让画布拿到焦点（Laya 的键盘事件挂在画布上），随后才开始固定路线
  await page.mouse.click(640, 400);
  await sleep(300);

  // ⑤ 移动段（按键与采样并行）
  const moveTask = (async () => {
    for (const [key, frac] of KEY_PLAN) {
      await page.keyboard.down(key);
      await sleep(frac * moveMs);
      await page.keyboard.up(key);
    }
  })();
  const moveSamples = await sampleDuring(page, moveMs);
  await moveTask;

  // ⑥ 静止段
  const idleSamples = await sampleDuring(page, idleMs);

  const ua = await page.evaluate(() => navigator.userAgent);
  const browserVersion = browser.version();
  const sceneLine = consoleLines.find((l) => l.includes('静态层渲染完成')) ?? '(未捕获到静态层日志)';
  const qualityLine = consoleLines.find((l) => l.includes('[S8] quality=')) ?? '(未捕获到质量日志)';
  const finalSnapshot = (await sampleOnce(page)) ?? {};

  record = {
    label,
    at: new Date().toISOString(),
    commit: git.commit,
    dirty: git.dirty,
    browser: browserVersion,
    headless,
    mapLocalhostIpv4,
    userAgent: ua,
    url: urlWithQuality,
    quality,
    qualityLine,
    sceneLine,
    route: KEY_PLAN.map(([k, f]) => `${k} ${round(f * moveMs / 1000, 2)}s`).join(' → '),
    moveMs,
    idleMs,
    moveSamples,
    idleSamples,
    finalQuality: finalSnapshot.quality ?? null,
  };
} finally {
  await browser.close();
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
const mFps = nums(record.moveSamples.map((s) => s.fps));
const iFps = nums(record.idleSamples.map((s) => s.fps));
const dcs = nums([...record.moveSamples, ...record.idleSamples].map((s) => s.drawcall));
const heaps = nums([...record.moveSamples, ...record.idleSamples].map((s) => s.heapMB));
const mUp = nums(record.moveSamples.map((s) => s.upPerSec));
const iUp = nums(record.idleSamples.map((s) => s.upPerSec));

const summary = {
  moveFpsMean: mean(mFps),
  moveFpsMin: mFps.length ? Math.min(...mFps) : null,
  idleFpsMean: mean(iFps),
  drawcallPeak: max(dcs),
  heapPeakMB: max(heaps),
  moveUpPerSecMean: mean(mUp),
  idleUpPerSecSum: iUp.reduce((a, b) => a + b, 0),
  finalQuality: record.finalQuality,
};

// ── 落盘（append，绝不覆盖历史）────────────────────────────────────────────
if (!existsSync(join(root, 'docs'))) mkdirSync(join(root, 'docs'), { recursive: true });
if (!existsSync(DOC)) {
  writeFileSync(
    DOC,
    '# S8 性能基线测量记录\n\n本文件由 `scripts/perf-sample.mjs` **追加**写入（不覆盖历史）。\n' +
      '口径：指标沿用总纲 §12（H5 60fps / ≤60 drawcall、小游戏 30fps / ≤40 drawcall、内存 ≤300MB、上行 ≤10 次/秒/人）。\n\n' +
      '> 重要：首段基线是在**加了性能面板之后、任何渲染/同步优化之前**采集的（面板本身开销已计入）。\n\n',
    'utf8',
  );
}

const row = (seg, s) =>
  `| ${seg} | ${s.t} | ${s.fps} | ${s.statFps ?? 'n/a'} | ${s.drawcall ?? 'n/a'} | ${s.entityTotal} | ${s.entityVisible} | ${s.upPerSec} | ${s.heapMB ?? 'n/a'} |`;

const md = [
  `## ${record.label} · ${record.at}`,
  '',
  `- commit: \`${record.commit}\`（工作区脏：${record.dirty === null ? 'n/a' : record.dirty ? '是' : '否'}）`,
  `- 浏览器: Chromium/${record.browser} · headless=${record.headless ? '是' : '否'} · map-localhost-ipv4=${record.mapLocalhostIpv4 ? '是' : '否'}`,
  `- userAgent: \`${record.userAgent}\``,
  `- 打开地址: ${record.url}（--quality ${record.quality ?? '未指定（走平台默认）'}）`,
  `- 质量日志: \`${record.qualityLine}\``,
  `- 场景: ${record.sceneLine}`,
  `- 路线: ${record.route}（共 ${record.moveMs / 1000}s），随后静止 ${record.idleMs / 1000}s`,
  '',
  '### 每秒采样',
  '',
  '| 段 | t(s) | fps(自计) | statFps | drawcall | 实体总 | 可见 | up/s | heap(MB) |',
  '|---|---|---|---|---|---|---|---|---|',
  ...record.moveSamples.map((s) => row('移动', s)),
  ...record.idleSamples.map((s) => row('静止', s)),
  '',
  '### 汇总',
  '',
  `- 移动段 fps：均值 **${summary.moveFpsMean}** · 最低 **${summary.moveFpsMin}**（目标 60）`,
  `- 静止段 fps：均值 **${summary.idleFpsMean}**`,
  `- drawcall 峰值：**${summary.drawcallPeak}**（目标 ≤60）`,
  `- heap 峰值：**${summary.heapPeakMB}** MB（目标 ≤300MB）`,
  `- 移动段 up/s 均值：**${summary.moveUpPerSecMean}**（目标 ≤10）`,
  `- 静止段 up/s 合计：**${summary.idleUpPerSecSum}**（应 ≈0）`,
  `- 结束档位：**${summary.finalQuality}**`,
  '',
].join('\n');

// 归一化尾部空行后写入（保留历史段落，不覆盖）：保证每段之间恰好一个空行
writeFileSync(DOC, readFileSync(DOC, 'utf8').replace(/\n*$/, '\n\n') + md, 'utf8');

console.log(JSON.stringify({ ...record, summary }, null, 2));
console.log(`\n已追加到 ${DOC}`);