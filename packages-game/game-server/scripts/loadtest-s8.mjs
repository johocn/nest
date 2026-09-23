// S8 压测：N 个 bot 登录 → world.enter-scene → Hz 频率 world.move（fire-and-forget）
//         → 采样各 bot 收到的 world.entity_update 条数与「单机近似延迟」
//
// 用法：node scripts/loadtest-s8.mjs --bots 50 --seconds 30 --scene 1
// 依赖：零新增依赖，复用 game-server/node_modules 的 socket.io-client
// 安全：默认只允许打 localhost；指向其它 host 必须显式加 --allow-remote（会大声告警）
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(here, '..', 'gamedata');
const DEFAULT_OUT = join(here, 'loadtest-s8-result.json');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// ---------- 参数 ----------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(readFileSync(join(CONFIG_DIR, 'manifest.json'), 'utf8'));
const manifestSceneIds = manifest.scenes.map((s) => Number(s.sceneId));

const opts = {
  bots: Number(argv.bots ?? 50),
  seconds: Number(argv.seconds ?? 30),
  hz: Number(argv.hz ?? 10),
  scene: Number(argv.scene ?? manifestSceneIds[0]),
  base: String(argv.base ?? 'http://localhost:3000'),
  out: resolve(String(argv.out ?? DEFAULT_OUT)),
  label: String(argv.label ?? `${Number(argv.bots ?? 50)}bots`),
  serverPid: argv['server-pid'] ? Number(argv['server-pid']) : null,
  allowRemote: argv['allow-remote'] === true,
  authBurst: Number(argv['auth-burst'] ?? 5),
  authWindowMs: Number(argv['auth-window-ms'] ?? 61000),
};

if (!Number.isFinite(opts.bots) || opts.bots < 1 || opts.bots > 200) {
  console.error(`--bots 非法：${argv.bots}（1~200）`);
  process.exit(2);
}
if (!Number.isFinite(opts.seconds) || opts.seconds < 1) {
  console.error(`--seconds 非法：${argv.seconds}`);
  process.exit(2);
}
if (!Number.isFinite(opts.hz) || opts.hz < 1 || opts.hz > 60) {
  console.error(`--hz 非法：${argv.hz}（1~60）`);
  process.exit(2);
}
if (!manifestSceneIds.includes(opts.scene)) {
  console.error(`--scene 非法：${opts.scene} 不在配置包 scenes=[${manifestSceneIds}] 内`);
  process.exit(2);
}

// 风险 #7：默认只打本机
let baseHost;
try {
  baseHost = new URL(opts.base).hostname;
} catch {
  console.error(`--base 非法：${opts.base}`);
  process.exit(2);
}
if (!LOCAL_HOSTS.has(baseHost)) {
  if (!opts.allowRemote) {
    console.error(`拒绝执行：--base 指向非本机 host「${baseHost}」。`);
    console.error('本脚本默认只允许压测 localhost（风险 #7）。确需压测其它环境请显式加 --allow-remote。');
    process.exit(2);
  }
  console.error('='.repeat(72));
  console.error(`!! 警告：正在压测非本机环境：${opts.base}（--allow-remote 已显式开启）`);
  console.error('!! 计划 D9 禁止对生产做高压测；生产最多 ≤5 bot / ≤10 秒冒烟。');
  console.error('='.repeat(72));
}

// ---------- HTTP ----------
const API = opts.base;
async function call(method, path, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { code: -1, msg: text.slice(0, 80) }; }
  return { status: res.status, payload };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 后端 RateLimitGuard：/auth/login 与 /auth/register 各自 windowSeconds=60 / maxRequests=5，
// 键为 `route:${ip}` —— 全部 bot 同一个 IP，且 TTL 每次调用都刷新（等价「最后一次调用 +60s」才重置）。
// 所以必须「突发 5 次 → 静默 61s」按批放行，否则必然 90005。
function makePacer(limit, windowMs) {
  return { limit, windowMs, batch: [], waits: [], totalWaitMs: 0, calls: 0 };
}
async function pace(pacer, tag, onWait) {
  if (pacer.batch.length >= pacer.limit) {
    const wait = pacer.batch[pacer.batch.length - 1] + pacer.windowMs - Date.now();
    if (wait > 0) {
      pacer.waits.push(wait);
      pacer.totalWaitMs += wait;
      if (onWait) onWait(wait);
      await sleep(wait);
    }
    pacer.batch = [];
  }
  pacer.batch.push(Date.now());
  pacer.calls++;
}

const RETRY_BACKOFF = [2000, 5000, 15000, 61000, 61000, 61000, 61000, 61000, 61000, 61000, 61000, 61000];

// 登录（串行 + 主动限速）；90005 兜底退避重试；login 失败再 register 兜底
async function loginBot(bot, stats) {
  const cred = { username: bot.username, password: bot.password, deviceId: bot.deviceId };
  const onWait = (ms) => console.log(`[auth] bot ${bot.index}/${opts.bots} ${tag} 限速静默 ${(ms / 1000).toFixed(1)}s`);
  let tag = 'login';
  for (let attempt = 0; attempt <= RETRY_BACKOFF.length; attempt++) {
    await pace(stats.loginPacer, tag, onWait);
    const login = await call('POST', '/api/client/v1/auth/login', { body: cred });
    if (login.payload?.code === 0) {
      stats.logins.push('login');
      return login.payload.data;
    }
    if (login.payload?.code === 90005) {
      stats.rateLimited++;
      const wait = RETRY_BACKOFF[Math.min(attempt, RETRY_BACKOFF.length - 1)];
      stats.rateLimitWaits.push(wait);
      stats.loginPacer.batch = []; // 服务端计数已超，强制下一轮重新计批
      await sleep(wait);
      continue;
    }
    // 非限流失败（用户不存在等）→ 注册兜底
    tag = 'register';
    await pace(stats.registerPacer, tag, onWait);
    const reg = await call('POST', '/api/client/v1/auth/register', {
      body: { username: bot.username, password: bot.password, nickname: bot.username, deviceId: bot.deviceId },
    });
    if (reg.payload?.code === 0) {
      stats.logins.push('register');
      return reg.payload.data;
    }
    if (reg.payload?.code === 90005) {
      stats.rateLimited++;
      const wait = RETRY_BACKOFF[Math.min(attempt, RETRY_BACKOFF.length - 1)];
      stats.rateLimitWaits.push(wait);
      stats.registerPacer.batch = [];
      await sleep(wait);
      continue;
    }
    throw new Error(`bot ${bot.index} 登录/注册失败：${JSON.stringify(reg.payload ?? login.payload)}`);
  }
  throw new Error(`bot ${bot.index} 登录重试耗尽（限流 90005）`);
}

function connect(token) {
  return new Promise((resolve_, reject) => {
    const socket = io(`${API}/game`, {
      transports: ['websocket'],
      query: { token },
      reconnection: false, // 不做自愈，掉线如实计数
    });
    const timer = setTimeout(() => reject(new Error('WS 连接超时')), 10000);
    socket.on('connect', () => { clearTimeout(timer); resolve_(socket); });
    socket.on('connect_error', (e) => { clearTimeout(timer); reject(new Error(`WS 连接失败：${e?.message ?? e}`)); });
  });
}

// handler 直接 return → 答案走 ack 回调（事件名即 cmd）
function send(socket, cmd, data) {
  return new Promise((resolve_, reject) => {
    const timer = setTimeout(() => reject(new Error(`WS 请求超时：${cmd}`)), 10000);
    socket.emit(cmd, { cmd, seq: 1, data }, (ack) => { clearTimeout(timer); resolve_(ack); });
  });
}

// ---------- 服务端进程指标（本机只读采集，不干预） ----------
function psJson(cmd) {
  try {
    const raw = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    const trimmed = raw.trim();
    return trimmed ? JSON.parse(trimmed) : null;
  } catch { return null; }
}

function detectServerPid(port) {
  if (opts.serverPid) return opts.serverPid;
  const r = psJson(`Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -First 1 -ExpandProperty OwningProcess`);
  const pid = Number(Array.isArray(r) ? r[0] : r);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function sampleServer(pid) {
  if (!pid) return { cpuSec: null, rssMb: null };
  const r = psJson(`Get-Process -Id ${pid} -ErrorAction Stop | Select-Object CPU,WorkingSet64 | ConvertTo-Json -Compress`);
  if (!r) return { cpuSec: null, rssMb: null };
  const cpuSec = typeof r.CPU === 'number' ? r.CPU : null;
  const rssMb = typeof r.WorkingSet64 === 'number' ? r.WorkingSet64 / 1048576 : null;
  return { cpuSec, rssMb };
}

// ---------- 统计工具 ----------
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}
const round2 = (n) => (n === null || n === undefined ? null : Number(n.toFixed(2)));

// ---------- 主流程 ----------
async function main() {
  const health = await call('GET', '/health').catch(() => null);
  if (health?.payload?.code !== 0) {
    console.error('后端 /health 不可达，压测终止（风险 #6：不健康立即停手）');
    process.exit(1);
  }

  const sceneEntry = manifest.scenes.find((s) => Number(s.sceneId) === opts.scene);
  const cfg = JSON.parse(readFileSync(join(CONFIG_DIR, sceneEntry.file), 'utf8'));
  const sceneMeta = {
    sceneId: cfg.sceneId,
    name: cfg.scene?.name ?? '',
    mapWidth: cfg.scene?.mapWidth ?? 1280,
    mapHeight: cfg.scene?.mapHeight ?? 960,
    maxPlayers: cfg.scene?.maxPlayers ?? null,
  };

  console.log(`[loadtest-s8] base=${opts.base} bots=${opts.bots} seconds=${opts.seconds} hz=${opts.hz} scene=${opts.scene}`);
  console.log(`[loadtest-s8] 场景「${sceneMeta.name}」${sceneMeta.mapWidth}x${sceneMeta.mapHeight} maxPlayers=${sceneMeta.maxPlayers}`);

  const loginStats = {
    logins: [], rateLimited: 0, rateLimitWaits: [],
    loginPacer: makePacer(opts.authBurst, opts.authWindowMs),
    registerPacer: makePacer(opts.authBurst, opts.authWindowMs),
  };
  const bots = [];
  for (let i = 1; i <= opts.bots; i++) {
    const id = String(i).padStart(2, '0');
    bots.push({
      index: i,
      username: `loadtest${id}`,
      password: 'loadtest123456',
      deviceId: `loadtest-bot-${id}`,
      playerId: null, token: null, socket: null,
      upCount: 0, downCount: 0, downPlayer: 0, downOther: 0,
      disconnectCount: 0, connectErrorCount: 0,
      entered: false, enterError: null,
    });
  }

  // 1. 串行登录（限流友好）
  const tLogin0 = Date.now();
  for (const bot of bots) {
    const data = await loginBot(bot, loginStats);
    bot.token = data?.token;
    bot.playerId = String(data?.playerId ?? '');
    if (!bot.token || !bot.playerId) throw new Error(`bot ${bot.index} 未拿到 token/playerId`);
    console.log(`[auth] ${bot.index}/${opts.bots} ${bot.username} 就绪（playerId=${bot.playerId}，累计静默 ${(loginStats.loginPacer.totalWaitMs + loginStats.registerPacer.totalWaitMs) / 1000 | 0}s）`);
  }
  const loginMs = Date.now() - tLogin0;

  // 2. 逐个连 WS（连接阶段不计入测量窗口）
  for (const bot of bots) {
    bot.socket = await connect(bot.token);
    bot.socket.on('disconnect', () => { bot.disconnectCount++; });
    bot.socket.on('connect_error', () => { bot.connectErrorCount++; });
    bot.socket.on('message', (m) => onMessage(bot, m));
  }

  // 3. 进场景
  for (const bot of bots) {
    try {
      const ack = await send(bot.socket, 'world.enter-scene', { sceneId: sceneMeta.sceneId });
      bot.entered = ack?.cmd === 'world.enter_scene_sync' && ack?.code === 0;
      if (!bot.entered) bot.enterError = JSON.stringify(ack).slice(0, 120);
    } catch (e) { bot.enterError = e.message; }
  }
  const enteredCount = bots.filter((b) => b.entered).length;
  console.log(`[loadtest-s8] 登录完成 ${bots.length}/${opts.bots}（${loginMs}ms，限流 ${loginStats.rateLimited} 次）→ 进场景成功 ${enteredCount}/${bots.length}`);
  if (enteredCount < bots.length) {
    for (const b of bots) if (!b.entered) console.error(`  bot ${b.index} 进场景失败：${b.enterError}`);
    if (enteredCount < opts.bots) throw new Error('存在未进场景的 bot，压测终止');
  }

  // 4. 服务端进程指标（窗口前）
  const port = Number(new URL(opts.base).port || (new URL(opts.base).protocol === 'https:' ? 443 : 80));
  const serverPid = detectServerPid(port);
  const before = sampleServer(serverPid);
  if (serverPid) console.log(`[loadtest-s8] 服务端 PID=${serverPid} CPU=${before.cpuSec}s RSS=${round2(before.rssMb)}MB`);

  // 5. 测量窗口：全局单定时器统一 tick（比 N 个 interval 更准）
  const pending = new Map();  // `${playerId}|${x},${y}` → 本机发送时刻(ms)
  const samples = [];
  let staleDropped = 0;
  let pendingSet = 0;
  const intervalMs = Math.max(1, Math.round(1000 / opts.hz));
  const startAt = performance.now();
  const endAt = startAt + opts.seconds * 1000;
  let tick = 0;

  await new Promise((resolveRun) => {
    const timer = setInterval(() => {
      const now = performance.now();
      if (now >= endAt) {
        clearInterval(timer);
        clearInterval(pruneTimer);
        resolveRun();
        return;
      }
      tick++;
      for (const bot of bots) {
        if (!bot.socket?.connected) continue;
        const x = 100 + ((tick * 7 + bot.index * 23) % (sceneMeta.mapWidth - 200));
        const y = 120 + (bot.index * 15) % Math.max(1, sceneMeta.mapHeight - 200);
        const key = `${bot.playerId}|${x},${y}`;
        pending.set(key, performance.now());
        pendingSet++;
        bot.upCount++;
        // fire-and-forget：不传 ack 回调（等价客户端 expectAck=false）
        bot.socket.emit('world.move', { cmd: 'world.move', seq: tick, data: { x, y, rotation: 0, state: 'move' } });
      }
    }, intervalMs);

    const pruneTimer = setInterval(() => {
      const cutoff = performance.now() - 3000;
      for (const [k, t] of pending) if (t < cutoff) { pending.delete(k); staleDropped++; }
    }, 1000);
  });

  // 6. 排空：等 600ms 收尾在途广播
  await sleep(600);

  function onMessage(bot, m) {
    if (m?.cmd !== 'world.entity_update') return;
    bot.downCount++;
    if (m.data?.entityType === 'player') {
      bot.downPlayer++;
      const pid = String(m.data?.playerId ?? '');
      const pos = m.data?.pos ?? {};
      const key = `${pid}|${pos.x},${pos.y}`;
      const t0 = pending.get(key);
      if (t0 !== undefined) {
        pending.delete(key);
        samples.push(performance.now() - t0);
      }
    } else {
      bot.downOther++;
    }
  }

  // 7. 服务端进程指标（窗口后）
  const after = sampleServer(serverPid);

  // 8. 汇总
  const upMsgs = bots.reduce((s, b) => s + b.upCount, 0);
  const downMsgs = bots.reduce((s, b) => s + b.downCount, 0);
  const downPlayerMsgs = bots.reduce((s, b) => s + b.downPlayer, 0);
  const downOtherMsgs = bots.reduce((s, b) => s + b.downOther, 0);
  const disconnects = bots.reduce((s, b) => s + b.disconnectCount, 0);
  const connectErrors = bots.reduce((s, b) => s + b.connectErrorCount, 0);
  samples.sort((a, b) => a - b);

  const serverCpu = before.cpuSec !== null && after.cpuSec !== null
    ? round2(((after.cpuSec - before.cpuSec) / opts.seconds) * 100) : null;
  const serverRss = after.rssMb !== null ? round2(after.rssMb) : null;
  const serverRssDeltaMb = before.rssMb !== null && after.rssMb !== null
    ? round2(after.rssMb - before.rssMb) : null;

  const run = {
    label: opts.label,
    bots: opts.bots,
    durationSec: opts.seconds,
    hz: opts.hz,
    base: opts.base,
    scene: sceneMeta,
    upMsgs,
    upPerSecPerBot: round2(upMsgs / opts.seconds / opts.bots),
    downMsgs,
    downPerSecPerBot: round2(downMsgs / opts.seconds / opts.bots),
    downPlayerMsgs,
    downOtherMsgs,
    latencyP50: percentile(samples, 50),
    latencyP95: percentile(samples, 95),
    latencyMin: samples.length ? round2(samples[0]) : null,
    latencyMax: samples.length ? round2(samples[samples.length - 1]) : null,
    latencySamples: samples.length,
    latencyMethod: 'same-process pair: sender records local emit time by `${playerId}|${x},${y}`, any bot receiving that broadcast computes delta (single-host one-way approximation, includes event-loop queueing)',
    latencyNullable: samples.length === 0,
    pendingSet,
    pendingStaleDropped: staleDropped,
    disconnects,
    connectErrors,
    serverPid,
    serverCpu,
    serverRss,
    serverRssDeltaMb,
    serverCpuSecBefore: before.cpuSec,
    serverCpuSecAfter: after.cpuSec,
    auth: {
      authMs: loginMs,
      loginViaLogin: loginStats.logins.filter((x) => x === 'login').length,
      loginViaRegister: loginStats.logins.filter((x) => x === 'register').length,
      httpAuthCalls: loginStats.loginPacer.calls + loginStats.registerPacer.calls,
      pacedWaitMs: loginStats.loginPacer.totalWaitMs + loginStats.registerPacer.totalWaitMs,
      rateLimited90005: loginStats.rateLimited,
      rateLimitWaitsMs: loginStats.rateLimitWaits,
      note: 'RateLimitGuard 按 IP 计：/auth/login 与 /auth/register 各 5 次/60s，TTL 每次刷新 → 脚本按「突发 5 → 静默 61s」主动放行；bot 账号会写入本机 dev 库',
    },
    generatedAt: new Date().toISOString(),
  };

  // 9. 落盘（追加进 runs 数组，便于 Task 7 生成曲线）
  let doc = { generatedAt: run.generatedAt, runs: [] };
  if (existsSync(opts.out)) {
    try {
      const prev = JSON.parse(readFileSync(opts.out, 'utf8'));
      if (Array.isArray(prev?.runs)) doc = { generatedAt: run.generatedAt, runs: prev.runs };
    } catch { /* 旧文件损坏则重建 */ }
  }
  doc.generatedAt = run.generatedAt;
  doc.runs.push(run);
  writeFileSync(opts.out, JSON.stringify(doc, null, 2) + '\n', 'utf8');

  // 10. 收尾
  for (const bot of bots) { try { bot.socket?.close(); } catch { /* ignore */ } }

  console.log('[loadtest-s8] 结果：');
  console.log(`  上行 world.move = ${upMsgs}（${run.upPerSecPerBot}/s/bot）`);
  console.log(`  下行 entity_update = ${downMsgs}（${run.downPerSecPerBot}/s/bot；player ${downPlayerMsgs} / 其它 ${downOtherMsgs}）`);
  console.log(`  延迟样本 = ${samples.length}${run.latencyNullable ? '（无法估算）' : ''}  P50 = ${run.latencyP50}ms  P95 = ${run.latencyP95}ms`);
  console.log(`  掉线 = ${disconnects}  连接错误 = ${connectErrors}`);
  console.log(`  服务端 CPU = ${run.serverCpu}%  RSS = ${run.serverRss}MB（Δ ${run.serverRssDeltaMb}MB）`);
  console.log(`  已写入 ${opts.out}`);

  await sleep(100);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[loadtest-s8] 异常终止：${err.message}`);
  process.exit(1);
});