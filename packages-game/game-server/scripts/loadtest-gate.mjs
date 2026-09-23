// S9 Task 7：后端广播硬指标门禁（只断阈值 + 给退出码，不改广播）
//   loadtest-s8.mjs 只产数据 → 本脚本只判定（计划 D6）
//
// 用法（cwd = packages-game/game-server）：
//   判定历史数据：node scripts/loadtest-gate.mjs --in scripts/loadtest-s8-result.json --bots 50
//   现场压测判定：node scripts/loadtest-gate.mjs --run --bots 50 --seconds 25 --hz 10
//
// 退出码：0 全部通过 / 1 任一超限或子进程失败 / 2 用法或输入错误
// 零新增依赖：只用 node: 内置模块
//
// ---------- 五个断言的计算口径（勿漂移） ----------
//   1. P95 延迟      ：run.latencyP95（同机近似单向，含事件循环排队）≤ --p95；为 null（无延迟样本）→ FAIL
//   2. 下行投递      ：run.downMsgs / run.durationSec ≤ --down-per-sec（按秒折算，不用 downPerSecPerBot）
//   3. 上行          ：run.upPerSecPerBot ≤ --up-per-sec-per-bot
//   4. 服务端内存增量：run.serverRssDeltaMb ≤ --rss-delta；为 null（未采到服务端 PID）→「无法度量」，按 FAIL
//   5. 掉线          ：run.disconnects ≤ --disconnects（默认 0）
//   另：run.connectErrors > 0 判 FAIL（一并打印）；run.latencyP95 为 null 同按 FAIL
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LOADTEST = join(here, 'loadtest-s8.mjs');
const DEFAULT_IN = join(here, 'loadtest-s8-result.json');
const LOG = '[loadtest-gate]';

// ---------- 参数（与 loadtest-s8.mjs 同款 parseArgs） ----------
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
const quiet = argv.quiet === true;
const wantRun = argv.run === true;

function usageError(msg) {
  console.error(`${LOG} 用法错误：${msg}`);
  process.exit(2);
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const round2 = (n) => (n === null || n === undefined ? null : Number(n.toFixed(2)));

// 数值型参数统一校验（缺省即 §1.2 硬指标）
function numArg(key, dflt) {
  const raw = argv[key] === undefined ? dflt : argv[key];
  if (raw === true) usageError(`--${key} 缺少数值`);
  const n = numOrNull(raw);
  if (n === null) usageError(`--${key} 非法：${raw}`);
  return n;
}

const thresholds = {
  p95: numArg('p95', 200),
  downPerSec: numArg('down-per-sec', 25000),
  upPerSecPerBot: numArg('up-per-sec-per-bot', 10),
  rssDeltaMb: numArg('rss-delta', 50),
  disconnects: numArg('disconnects', 0),
};

// ---------- run 选择参数 ----------
const hasLabel = argv.label !== undefined && argv.label !== true;
const hasBots = argv.bots !== undefined && argv.bots !== true;
if (hasLabel && hasBots) usageError('--label 与 --bots 不能同时给出（二选一）');
if (argv.label === true) usageError('--label 缺少取值');
if (hasBots && numOrNull(argv.bots) === null) usageError(`--bots 非法：${argv.bots}`);

// ---------- 路径 ----------
let inPath = resolve(String(argv.in === true || argv.in === undefined ? DEFAULT_IN : argv.in));
const outPath = argv.out === true ? null : (argv.out === undefined ? null : resolve(String(argv.out)));
const writeJsonPath = argv['write-json'] === undefined || argv['write-json'] === true
  ? null : resolve(String(argv['write-json']));
if (argv.out === true) usageError('--out 缺少取值');
if (argv['write-json'] === true) usageError('--write-json 缺少取值');

// ---------- --run：先跑压测（透传参数），再读结果判定 ----------
if (wantRun) {
  if (!existsSync(LOADTEST)) usageError(`找不到压测脚本：${LOADTEST}`);
  const runOut = outPath ?? DEFAULT_IN;
  const childArgs = [
    LOADTEST,
    '--bots', String(hasBots ? numOrNull(argv.bots) : 50),   // --run 默认 --bots 50
    '--seconds', String(argv.seconds === undefined || argv.seconds === true ? 25 : numArg('seconds', 25)),
    '--hz', String(argv.hz === undefined || argv.hz === true ? 10 : numArg('hz', 10)),
    '--out', runOut,
  ];
  if (argv.scene !== undefined && argv.scene !== true) childArgs.push('--scene', String(argv.scene));
  if (argv.base !== undefined && argv.base !== true) childArgs.push('--base', String(argv.base));
  if (hasLabel) childArgs.push('--label', String(argv.label));
  // --allow-remote 原样透传：本脚本不额外放开（压测脚本默认只允许 localhost 的保护不削弱）
  if (argv['allow-remote'] === true) childArgs.push('--allow-remote');

  console.log(`${LOG} --run 调用压测：node ${childArgs.join(' ')}`);
  const res = spawnSync(process.execPath, childArgs, { stdio: 'inherit' });
  if (res.error) {
    console.error(`${LOG} 无法启动压测子进程：${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`${LOG} 压测子进程退出码 ${res.status ?? '（被信号终止）'}，门禁判定终止`);
    process.exit(1);
  }
  inPath = runOut;
}

// ---------- 读结果文件 ----------
if (!existsSync(inPath)) usageError(`结果文件不存在：${inPath}`);
let doc;
try {
  doc = JSON.parse(readFileSync(inPath, 'utf8'));
} catch (e) {
  usageError(`结果 JSON 解析失败：${e.message}`);
}
const runs = Array.isArray(doc?.runs) ? doc.runs : null;
if (!runs || runs.length === 0) usageError(`结果文件无 runs[] 或为空：${inPath}`);

// ---------- 选哪一条 run ----------
function pickRun() {
  if (hasLabel) {
    const want = String(argv.label);
    for (let i = runs.length - 1; i >= 0; i--) if (String(runs[i].label) === want) return runs[i];
    return null;
  }
  if (hasBots) {
    const want = numOrNull(argv.bots);
    for (let i = runs.length - 1; i >= 0; i--) if (Number(runs[i].bots) === want) return runs[i];
    return null;
  }
  // 都不给：取 bots 最大；`>=` 保证并列取最后一条
  let best = runs[0];
  for (const r of runs) if (Number(r.bots) >= Number(best.bots)) best = r;
  return best;
}

const run = pickRun();
if (!run) {
  usageError(hasLabel
    ? `未找到 label=${argv.label} 的 run（现有：${runs.map((r) => r.label).join(', ')}）`
    : `未找到 bots=${argv.bots} 的 run（现有：${runs.map((r) => `${r.bots}bots`).join(', ')}）`);
}

// ---------- 实测值 ----------
const durationSec = Number(run.durationSec);
const downPerSec = Number.isFinite(durationSec) && durationSec > 0
  ? round2(Number(run.downMsgs) / durationSec) : null;

const checks = [
  { metric: 'P95 延迟', unit: 'ms', actual: run.latencyP95, limit: thresholds.p95, field: 'latencyP95' },
  { metric: '下行投递', unit: '条/秒', actual: downPerSec, limit: thresholds.downPerSec, field: 'downMsgs / durationSec' },
  { metric: '上行', unit: '次/秒/人', actual: run.upPerSecPerBot, limit: thresholds.upPerSecPerBot, field: 'upPerSecPerBot' },
  { metric: '服务端 RSS 增量', unit: 'MB', actual: run.serverRssDeltaMb, limit: thresholds.rssDeltaMb, field: 'serverRssDeltaMb' },
  { metric: '掉线', unit: '次', actual: run.disconnects, limit: thresholds.disconnects, field: 'disconnects' },
];

for (const c of checks) {
  if (c.actual === null || c.actual === undefined || !Number.isFinite(Number(c.actual))) {
    c.pass = false;
    c.detail = `无法度量（${c.field} 为 null）`;
  } else {
    c.actual = Number(c.actual);
    c.pass = c.actual <= c.limit;
    if (c.pass) {
      c.detail = c.actual === 0
        ? `达标（实测 0，阈值 ${c.limit}${c.unit}）`
        : `余量 ${(c.limit / c.actual).toFixed(2)}×`;
    } else {
      c.detail = `超出 ${round2(c.actual - c.limit)}${c.unit}`
        + (c.limit > 0 ? `（${(c.actual / c.limit).toFixed(2)}×）` : '');
    }
  }
}

const connectErrors = Number(run.connectErrors ?? 0);
const connectErrorsFail = connectErrors > 0;
const failed = checks.filter((c) => !c.pass);
const pass = failed.length === 0 && !connectErrorsFail;

// ---------- 输出 ----------
const sceneName = run.scene?.name ?? '';
if (!quiet) {
  console.log(`${LOG} 数据文件：${inPath}`);
  console.log(`${LOG} 判定 run：label=${run.label} bots=${run.bots} durationSec=${run.durationSec} scene=「${sceneName}」 generatedAt=${run.generatedAt}`);
  const rows = [
    ['指标', '实测', '阈值', '判定'],
    ...checks.map((c) => [
      c.metric,
      c.actual === null || !Number.isFinite(c.actual) ? 'n/a' : `${c.actual} ${c.unit}`,
      `${c.limit} ${c.unit}`,
      c.pass ? 'PASS' : 'FAIL',
    ]),
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => dispWidth(r[i]))));
  for (const r of rows) console.log('  ' + r.map((cell, i) => padEndW(cell, widths[i])).join(' | '));
  console.log(`${LOG} 连接错误 connectErrors=${connectErrors}${connectErrorsFail ? '（> 0，判 FAIL）' : ''}`);
}

if (!pass) {
  if (!quiet) console.log(`${LOG} 超限项：`);
  for (const c of failed) {
    const line = `  - ${c.metric}：${c.actual === null || !Number.isFinite(c.actual) ? 'n/a' : `${c.actual} ${c.unit}`} vs 阈值 ${c.limit} ${c.unit} → ${c.detail}`;
    console.log(quiet ? line.trim() : line);
  }
  if (connectErrorsFail) {
    console.log(`${quiet ? '' : '  - '}connectErrors=${connectErrors} > 0（连接错误，判 FAIL）`);
  }
}
console.log(`门禁结论：${pass ? 'PASS' : 'FAIL'}`);

// ---------- 结论落盘 ----------
if (writeJsonPath) {
  const report = {
    generatedAt: new Date().toISOString(),
    gate: pass ? 'PASS' : 'FAIL',
    exitCode: pass ? 0 : 1,
    input: inPath,
    run: {
      label: run.label,
      bots: run.bots,
      durationSec: run.durationSec,
      hz: run.hz,
      scene: sceneName,
      generatedAt: run.generatedAt,
    },
    thresholds,
    checks: checks.map((c) => ({
      metric: c.metric,
      field: c.field,
      actual: c.actual === null || !Number.isFinite(c.actual) ? null : c.actual,
      limit: c.limit,
      unit: c.unit,
      pass: c.pass,
      detail: c.detail,
    })),
    connectErrors,
  };
  writeFileSync(writeJsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  if (!quiet) console.log(`${LOG} 结论已写入 ${writeJsonPath}`);
}

// ---------- 中文对齐工具（CJK 按 2 列宽） ----------
function charWidth(ch) {
  const c = ch.codePointAt(0);
  const wide = (c >= 0x1100 && c <= 0x115f) || c === 0x2329 || c === 0x232a
    || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3)
    || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f)
    || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6)
    || (c >= 0x20000 && c <= 0x3fffd);
  return wide ? 2 : 1;
}
function dispWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += charWidth(ch);
  return w;
}
function padEndW(s, w) {
  return String(s) + ' '.repeat(Math.max(0, w - dispWidth(s)));
}

process.exit(pass ? 0 : 1);