// 移动端（模拟）验收采样器（零依赖：除可选的 playwright）
// 用法：node scripts/accept-mobile.mjs --label mobile-sim [--url http://localhost:5173/]
//       [--vw 915] [--vh 412] [--dpr 1.75] [--move-ms 10000] [--idle-ms 10000]
//       [--cpu-throttle 0] [--quality low] [--headless] [--map-localhost-ipv4]
//       [--out <json>] [--shot <png>]
//
// 口径（重要）：本脚本用 Chromium 移动端模拟（移动 UA + DPR + 触摸 + `isMobile`）**近似**手机，
// **不等于真机验收** —— 不反映真实移动 GPU / 内存带宽 / 机型差异。产出用于三件事的取证：
//   ① 触控通路端到端可用（S9 §7.4.5）；② 真机验收的 T1/T2/T3、F、M、D 各项「可自动化的部分」；
//   ③ 复现 §7.4.3 的人工步骤。真机数据仍需人工按 §7.4.3 填入（模拟值不得当作真机值）。
//
// 前置：后端 :3000 + 静态服务器 :5173（node tools/serve.mjs）已在跑。
// 触控按下走 CDP `Input.dispatchTouchEvent`（Playwright 的 touchscreen 只支持 tap，无法「按住持续移动」）。
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const has = (n) => argv.includes(`--${n}`);

const label = argOf('label', 'mobile-sim');
const url = argOf('url', 'http://localhost:5173/');
const vw = Number(argOf('vw', '915'));
const vh = Number(argOf('vh', '412'));
const dpr = Number(argOf('dpr', '1.75'));
const ua = argOf(
  'ua',
  'Mozilla/5.0 (Linux; Android 10; SM-A105F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
);
const moveMs = Number(argOf('move-ms', '10000'));
const idleMs = Number(argOf('idle-ms', '10000'));
const quality = argOf('quality', null); // 'high' | 'low' | null
const cpuThrottle = Math.max(0, Number(argOf('cpu-throttle', '0')) || 0);
const headless = has('headless');
const mapLocalhostIpv4 = has('map-localhost-ipv4');
const outPath = argOf('out', null);
const shotPath = argOf('shot', join(root, 'docs', 'perf-shots', `${label}.png`));

const USER = { user: 'spike01', pass: 'spike123456' };
/** 移动段固定路线（与 perf-sample.mjs 同路线，便于对照）：按住 → ↓ ← ↑ →，占比合计 1.0 */
const DIR_PLAN = [
  ['→', 0.19],
  ['↓', 0.19],
  ['←', 0.19],
  ['↑', 0.19],
  ['→', 0.24],
];
/** 采集点（场景 1 静态实体，见 gamedata/scene-1-v4.json）：站点只让 stone_01 进半径，NPC 均在 90 外
 *（NPC 半径 90 > 物件 70，且 NPC 会巡逻 → 越小越好；smith(700,520) 距此 122px 是最近的一个） */
const COLLECT_SPOT = { x: 720, y: 400, expect: 'stone_01 (720,400)，半径 70；最近 NPC smith(700,520) 距离 122 > 90' };
const PX_PER_MS = 0.24; // PlayerControl.moveSpeedPxPerMs

// ── playwright 可选依赖 ─────────────────────────────────────────────────────
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('SKIP 未安装 playwright：请按 S9 计划 §7.4.3 人工执行（手机浏览器 + chrome://inspect）');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, n = 2) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10 ** n) / 10 ** n : v);
const nums = (a) => a.filter((v) => typeof v === 'number' && isFinite(v));
const mean = (a) => (a.length ? round(nums(a).reduce((x, y) => x + y, 0) / nums(a).length) : null);

function gitInfo() {
  try {
    return {
      commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
    };
  } catch {
    return { commit: 'n/a', dirty: null };
  }
}

const launchArgs = ['--enable-precise-memory-info'];
if (mapLocalhostIpv4) launchArgs.push('--host-resolver-rules=MAP localhost 127.0.0.1');

const browser = await chromium.launch({ headless, args: launchArgs });
const context = await browser.newContext({
  viewport: { width: vw, height: vh },
  deviceScaleFactor: dpr,
  isMobile: true,
  hasTouch: true,
  userAgent: ua,
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

const consoleLines = [];
const pageErrors = [];
const apiHits = [];
const failedRequests = [];
/** 最近一条 `world.move` 上行（闭环走位用，比截图硬） */
let lastMove = null;

page.on('console', (m) => consoleLines.push(m.text()));
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/')) apiHits.push(`${r.status()} ${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, '')}`);
});
page.on('websocket', (ws) => {
  ws.on('framesent', (f) => {
    const s = String(f.payload);
    const i = s.indexOf('[');
    if (i < 0) return;
    try {
      const arr = JSON.parse(s.slice(i));
      // 帧样例：`42/game,["world.move",{"cmd":"world.move","seq":2,"data":{"x":644,"y":480,…}}]`
      // → 坐标在 arr[1].data（不是 arr[1] 本身）
      if (arr[0] !== 'world.move' || !arr[1]) return;
      const d = arr[1].data ?? arr[1];
      if (typeof d?.x === 'number') lastMove = d;
    } catch {
      /* 非 JSON 帧忽略 */
    }
  });
});

if (cpuThrottle > 0) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
}

// ── 触控原语 ────────────────────────────────────────────────────────────────
const touchDown = (x, y) =>
  cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 }],
  });
const touchUp = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

/** 读触控层几何（舞台坐标 → CSS 坐标的换算按 SCALE_SHOWALL 定义：等比 + 居中） */
async function readPad() {
  return page.evaluate(() => {
    const stage = window.Laya.stage;
    const canvas = document.querySelector('canvas');
    const r = canvas.getBoundingClientRect();
    const scale = Math.min(r.width / stage.width, r.height / stage.height);
    const ox = r.left + (r.width - stage.width * scale) / 2;
    const oy = r.top + (r.height - stage.height * scale) / 2;
    let found = null;
    const walk = (n) => {
      if (found) return;
      if (n.name === 's9-touch') return void (found = n);
      for (let i = 0; i < n.numChildren; i++) walk(n.getChildAt(i));
    };
    walk(stage);
    if (!found) return null;
    const buttons = [];
    for (let i = 0; i < found.numChildren; i++) {
      const c = found.getChildAt(i);
      let text = '';
      for (let j = 0; j < c.numChildren; j++) {
        const t = c.getChildAt(j);
        if (t && typeof t.text === 'string') text += t.text;
      }
      buttons.push({ text, sx: c.x + c.width / 2, sy: c.y + c.height / 2, w: c.width, h: c.height });
    }
    return {
      scale: Math.round(scale * 1000) / 1000,
      ox: Math.round(ox),
      oy: Math.round(oy),
      canvas: { w: Math.round(r.width), h: Math.round(r.height) },
      stage: { w: stage.width, h: stage.height },
      buttons,
    };
  });
}

/** 读 HUD 文本（`s3-hud` 下的 hint/toast）：`Hud.toast` 在 root 存在时**不**打 console，只能读显示列表 */
function readHudText() {
  return page.evaluate(() => {
    let hud = null;
    const walk = (n) => {
      if (hud) return;
      if (n.name === 's3-hud') return void (hud = n);
      for (let i = 0; i < n.numChildren; i++) walk(n.getChildAt(i));
    };
    walk(window.Laya.stage);
    if (!hud) return '(未找到 s3-hud)';
    const out = [];
    const collect = (n) => {
      if (typeof n.text === 'string' && n.text) out.push(n.text);
      for (let i = 0; i < n.numChildren; i++) collect(n.getChildAt(i));
    };
    collect(hud);
    return out.join(' | ') || '(空)';
  });
}

const sampleOnce = () => page.evaluate(() => (window.__PERF__ ? window.__PERF__.snapshot() : null));

async function sampleDuring(ms) {
  const out = [];
  const start = Date.now();
  for (;;) {
    const remain = ms - (Date.now() - start);
    if (remain <= 0) break;
    await sleep(Math.min(1000, remain));
    const s = await sampleOnce();
    if (s) out.push({ t: round((Date.now() - start) / 1000), ...s });
  }
  return out;
}

const git = gitInfo();
const pageUrl = quality ? `${url}${url.includes('?') ? '&' : '?'}quality=${quality}` : url;
let record = null;

try {
  // ① T1：打开地址 → 登录表单可输入（新 context 天然无登录态，只导航一次 = 冷启动口径）
  const t1Start = Date.now();
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#s1-user', { state: 'visible', timeout: 20000 });
  await page.fill('#s1-user', USER.user);
  await page.fill('#s1-pass', USER.pass);
  const t1 = round((Date.now() - t1Start) / 1000);

  // ② T2：点登录 → 场景首帧（entityTotal > 0）
  const t2Start = Date.now();
  await page.click('#s1-submit');
  await page.waitForFunction(() => window.__PERF__ && window.__PERF__.snapshot().entityTotal > 0, { timeout: 30000 });
  const t2 = round((Date.now() - t2Start) / 1000);

  await sleep(3000); // 稳定
  // 触摸是否真的送达舞台（区分「触控坏了」与「选中逻辑没命中」）：只计数，不改任何行为
  await page.evaluate(() => {
    window.__UI = { down: 0 };
    window.Laya.stage.on(window.Laya.Event.MOUSE_DOWN, null, () => window.__UI.down++);
  });
  const pad = await readPad();
  const btnCss = (t) => {
    const b = pad.buttons.find((x) => x.text === t);
    return b ? { x: pad.ox + b.sx * pad.scale, y: pad.oy + b.sy * pad.scale } : null;
  };

  /** 按住某方向键 ms 毫秒（触控，非键盘），松开即停 */
  async function hold(dir, ms) {
    const p = btnCss(dir);
    if (!p) throw new Error(`触控层缺少方向键 ${dir}（readPad=${JSON.stringify(pad?.buttons?.map((b) => b.text))}）`);
    await touchDown(p.x, p.y);
    await sleep(ms);
    await touchUp();
  }

  /** 闭环走位：读 WS 上行位置，分 x/y 两段逼近目标（±12px 视为到位） */
  async function walkTo(tx, ty, tries = 4) {
    for (let i = 0; i < tries; i++) {
      if (!lastMove) {
        await sleep(300);
        continue;
      }
      const dx = tx - lastMove.x;
      const dy = ty - lastMove.y;
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return lastMove;
      if (Math.abs(dx) >= 12) await hold(dx > 0 ? '→' : '←', Math.min(1500, Math.abs(dx) / PX_PER_MS));
      if (Math.abs(dy) >= 12) await hold(dy > 0 ? '↓' : '↑', Math.min(1500, Math.abs(dy) / PX_PER_MS));
      await sleep(200);
    }
    return lastMove;
  }

  // ③ 移动段（固定路线，触控长按）—— **必须排在交互取证之前**：交互一旦成功（如 talk）会弹出对话，
  //    对话是 zOrder 10000 的顶层遮罩，会把后续所有触摸吃掉（2026-09-24 实测：先做交互则移动段 upPerSec 恒 0）
  await page.evaluate(() => window.__PERF__.panel(true));
  const moveTask = (async () => {
    for (const [dir, frac] of DIR_PLAN) {
      await hold(dir, frac * moveMs);
      await sleep(120);
    }
  })();
  const moveSamples = await sampleDuring(moveMs);
  await moveTask;

  // ④ 静止段（兼作 M 项「回落」口径：静止 10s 后 heap 相对峰值是否回落）
  const idleSamples = await sampleDuring(idleMs);
  const heapAtIdleEnd = idleSamples.length ? idleSamples[idleSamples.length - 1].heapMB : null;

  // ⑤ 触控交互取证（放在最后，理由见 ③ 的注释）：走到 stone_01 采集点 → 点「交互」
  const apiBefore = apiHits.length;
  const posAtSpot = await walkTo(COLLECT_SPOT.x, COLLECT_SPOT.y);
  // NPC 会巡逻抢目标（半径 90 > 物件 70），站点后给它最多 8s 让巡逻走开，直到 HUD 选中的是物件
  let hudAtSpot = await readHudText();
  const huntDeadline = Date.now() + 8000;
  while (Date.now() < huntDeadline && hudAtSpot.includes('按 F 交互：npcs')) {
    await sleep(500);
    hudAtSpot = await readHudText();
  }
  const downBefore = await page.evaluate(() => window.__UI?.down ?? -1);
  const uiBefore = consoleLines.length;
  const interactBtn = btnCss('交互');
  if (interactBtn) {
    await touchDown(interactBtn.x, interactBtn.y);
    await sleep(120);
    await touchUp();
    await sleep(1800);
  }
  const downAfter = await page.evaluate(() => window.__UI?.down ?? -1);
  const hudAfter = await readHudText(); // 采集成功 toast / 「附近没有可交互目标」
  const interactHits = apiHits.slice(apiBefore);
  const toastLine = consoleLines.slice(uiBefore).find((l) => l.includes('[S3]')) ?? '(无 [S3] 日志)';

  // ⑥ 截图（移动视口原尺寸）
  mkdirSync(dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath });

  const final = (await sampleOnce()) ?? {};
  record = {
    label,
    at: new Date().toISOString(),
    commit: git.commit,
    dirty: git.dirty,
    mode: '移动端模拟（非真机）',
    browser: browser.version(),
    headless,
    mobile: { vw, vh, dpr, isMobile: true, hasTouch: true, userAgent: ua },
    url: pageUrl,
    cpuThrottle,
    quality,
    timing: { T1_s: t1, T2_s: t2, T3_s: round(t1 + t2) },
    padGeometry: pad,
    interact: {
      spot: COLLECT_SPOT,
      posAtSpot: posAtSpot ? { x: posAtSpot.x, y: posAtSpot.y } : null,
      hudAtSpot,
      hudAfter,
      touchDelivered: downBefore >= 0 && downAfter >= 0 ? downAfter - downBefore : null,
      hits: interactHits,
      toastLine,
    },
    route: DIR_PLAN.map(([d, f]) => `${d} ${round((f * moveMs) / 1000, 2)}s`).join(' → '),
    moveSamples,
    idleSamples,
    degradeLine: consoleLines.find((l) => l.includes('自动降级')) ?? '(未触发自动降级)',
    qualityLine: consoleLines.find((l) => l.includes('[S8] quality=')) ?? '(未捕获到质量日志)',
    finalQuality: final.quality ?? null,
    heapAtIdleEndMB: heapAtIdleEnd,
    pageErrors,
    failedRequests,
    consoleTouch: consoleLines.find((l) => l.includes('[S9]')) ?? '(无 [S9] 日志)',
    screenshot: shotPath,
  };
} finally {
  await browser.close();
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
const mFps = nums(record.moveSamples.map((s) => s.fps));
const iFps = nums(record.idleSamples.map((s) => s.fps));
const heaps = nums([...record.moveSamples, ...record.idleSamples].map((s) => s.heapMB));
const dcs = nums([...record.moveSamples, ...record.idleSamples].map((s) => s.drawcall));
const summary = {
  moveFpsMean: mean(mFps),
  moveFpsMin: mFps.length ? Math.min(...mFps) : null,
  idleFpsMean: mean(iFps),
  drawcallPeak: dcs.length ? Math.max(...dcs) : null,
  heapPeakMB: heaps.length ? Math.max(...heaps) : null,
  heapAtIdleEndMB: record.heapAtIdleEndMB,
  heapFellBack: heaps.length && record.heapAtIdleEndMB != null ? record.heapAtIdleEndMB < Math.max(...heaps) : null,
  moveUpPerSecMean: mean(record.moveSamples.map((s) => s.upPerSec)),
  idleUpPerSecSum: nums(record.idleSamples.map((s) => s.upPerSec)).reduce((a, b) => a + b, 0),
  finalQuality: record.finalQuality,
};

writeFileSync(outPath ?? join(root, 'docs', 'perf-shots', `${label}.json`), JSON.stringify({ ...record, summary }, null, 2), 'utf8');
console.log(JSON.stringify({ summary, timing: record.timing, interact: record.interact, degradeLine: record.degradeLine, padChildren: record.padGeometry?.buttons?.length, pageErrors: record.pageErrors.length, failedRequests: record.failedRequests.length }, null, 2));
console.log(`\n截图：${record.screenshot}`);