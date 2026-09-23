// S7 Task 1 平台层（存储 / 提示 / 环境地址）零依赖断言脚本（不引入任何测试框架：只用 node + 自写 check）
// 用法：node tools/build-fallback.mjs && node scripts/smoke-platform-s7.mjs
//
// 断言对象全部取自**构建产物**（不 import src/，故不依赖 tsc 之外的转译）：
//   - bin/js/platform/Platform.js
//   - bin/js/net/http.js、bin/js/net/ws.js（只有「地址来源已接 Platform.env」这条静态断言）
//   - bin/js/config/AppConfig.js
// 三个运行环境场景都在 node 里伪造：A 小游戏（注入假 wx + 删 document）、B H5（删 wx + 假 localStorage/document）、
// C __ENV__ 优先级；D 是验收项 A2 的不变量：`src/**/*.ts` 里 document|localStorage|wx. 只允许命中 `src/platform/`。
// 断言失败 → exit 1。
//
// 注：`bin/js/*.js` 最近的 package.json（仓库根）没有 "type" 字段，node 会先按 CJS 解析失败、
// 再按「检测到模块语法」回退为 ES module 求值，并打印一条 MODULE_TYPELESS_PACKAGE_JSON 警告 —— 属预期噪音，
// 不影响断言结果（也不能为此改根 package.json）。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 需要存在的构建产物：缺任一则提示先构建，不静默失败 */
const ARTIFACTS = {
  platform: 'bin/js/platform/Platform.js',
  appConfig: 'bin/js/config/AppConfig.js',
  http: 'bin/js/net/http.js',
  ws: 'bin/js/net/ws.js',
};

const missing = Object.values(ARTIFACTS).filter((p) => !existsSync(join(root, p)));
if (missing.length > 0) {
  console.error(`缺少构建产物：${missing.join('、')}`);
  console.error('请先执行 node tools/build-fallback.mjs');
  process.exit(1);
}

let total = 0;
let failed = 0;
function check(name, cond, extra = '') {
  total++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` :: ${extra}` : ''}`);
  if (!cond) failed++;
}

/** 包住可能抛出的调用：异常记为 FAIL，但不中断整个脚本 */
function attempt(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: e };
  }
}

/** 临时接管 console.log，捕获「引擎未初始化时降级输出」 */
function captureLog(fn) {
  const logs = [];
  const orig = console.log;
  console.log = (...args) => logs.push(args.map(String).join(' '));
  try {
    fn();
  } finally {
    console.log = orig;
  }
  return logs;
}

const load = (rel) => import(pathToFileURL(join(root, rel)).href);
const { Platform } = await load(ARTIFACTS.platform);
const { AppConfig } = await load(ARTIFACTS.appConfig);

// ── 场景 A：小游戏模拟 ─────────────────────────────────────────────────────
console.log('— 场景 A：小游戏模拟（假 wx + 删 document）—');

const wxCalls = { get: [], set: [], remove: [], readFile: [], request: [], connectSocket: [] };
const wxStore = new Map();
const FAKE_FILE = '{"schemaVersion":1,"scenes":[]}';
const fakeWx = {
  getStorageSync(key) {
    wxCalls.get.push(key);
    return wxStore.has(key) ? wxStore.get(key) : '';
  },
  setStorageSync(key, value) {
    wxCalls.set.push([key, value]);
    wxStore.set(key, value);
  },
  removeStorageSync(key) {
    wxCalls.remove.push(key);
    wxStore.delete(key);
  },
  getFileSystemManager() {
    return {
      readFileSync(p, enc) {
        wxCalls.readFile.push([p, enc]);
        return FAKE_FILE;
      },
    };
  },
  // 网络域属 S7 Task 2，本任务不使用；按计划 §1.6 预置可用 stub，供后续任务扩展本脚本
  request(opts) {
    wxCalls.request.push(opts);
  },
  connectSocket(opts) {
    wxCalls.connectSocket.push(opts);
    return { onOpen() {}, onMessage() {}, onClose() {}, onError() {}, send() {}, close() {} };
  },
};

globalThis.wx = fakeWx;
delete globalThis.document;

check(
  'A: isMiniGame() === true',
  Platform.isMiniGame() === true,
  `wx=${typeof globalThis.wx} document=${typeof globalThis.document}`,
);

const rSet = attempt(() => Platform.storageSet('s7:k', 'v1'));
check(
  'A: storageSet 不抛且命中假 wx（已写入）',
  rSet.ok && wxCalls.set.length === 1 && wxStore.get('s7:k') === 'v1',
  rSet.ok ? `calls=${JSON.stringify(wxCalls.set)}` : String(rSet.error),
);

const rGet = attempt(() => Platform.storageGet('s7:k'));
check(
  'A: storageGet 不抛且命中假 wx（读回写入值）',
  rGet.ok && rGet.value === 'v1' && wxCalls.get.length === 1,
  rGet.ok ? `value=${rGet.value} calls=${JSON.stringify(wxCalls.get)}` : String(rGet.error),
);

const rAbsent = attempt(() => Platform.storageGet('s7:absent'));
check(
  'A: 缺键 storageGet 返回 null（wx 的 "" 对齐为 null）',
  rAbsent.ok && rAbsent.value === null,
  rAbsent.ok ? `value=${rAbsent.value}` : String(rAbsent.error),
);

const rDel = attempt(() => Platform.storageRemove('s7:k'));
check(
  'A: storageRemove 不抛且命中假 wx（已删除）',
  rDel.ok && wxCalls.remove.length === 1 && !wxStore.has('s7:k'),
  rDel.ok ? `calls=${JSON.stringify(wxCalls.remove)}` : String(rDel.error),
);

const rDelGet = attempt(() => Platform.storageGet('s7:k'));
check(
  'A: 删除后 storageGet 返回 null',
  rDelGet.ok && rDelGet.value === null,
  rDelGet.ok ? `value=${rDelGet.value}` : String(rDelGet.error),
);

const rRead = attempt(() => Platform.readLocalText('config/manifest.json'));
check(
  'A: readLocalText 读到假文件系统内容（无 fetch/DOM）',
  rRead.ok && rRead.value === FAKE_FILE && wxCalls.readFile.length === 1,
  rRead.ok ? `files=${JSON.stringify(wxCalls.readFile)}` : String(rRead.error),
);

let rToast = { ok: false, error: 'not-run' };
const toastLogs = captureLog(() => {
  rToast = attempt(() => Platform.ui.toast('S7-A'));
});
check(
  'A: ui.toast 不抛（Hud 未初始化 → 其自身 console 兜底，不依赖 DOM）',
  rToast.ok && toastLogs.some((l) => l.includes('S7-A')),
  rToast.ok ? `logs=${JSON.stringify(toastLogs)}` : String(rToast.error),
);

const rawA = Platform.env.raw();
check(
  'A: env.raw() 无 __ENV__ 时回落 AppConfig 默认（dev）',
  rawA.apiBase === AppConfig.apiBase && rawA.wsUrl === AppConfig.wsUrl,
  `raw=${JSON.stringify(rawA)}`,
);

// 消费端接线（避免 Platform.env 成为死代码）：只做产物文本断言，不在此处调用网络
const httpJs = readFileSync(join(root, ARTIFACTS.http), 'utf8');
const wsJs = readFileSync(join(root, ARTIFACTS.ws), 'utf8');
check(
  'A: http.js 地址来源为 Platform.env.apiBase()',
  httpJs.includes('Platform.env.apiBase()'),
  `AppConfig.apiBase 残留=${httpJs.includes('AppConfig.apiBase')}`,
);
check(
  'A: ws.js 地址来源为 Platform.env.wsUrl()',
  wsJs.includes('Platform.env.wsUrl()'),
  `AppConfig.wsUrl 残留=${wsJs.includes('AppConfig.wsUrl')}`,
);

// ── 场景 B：H5 模拟 ───────────────────────────────────────────────────────
console.log('— 场景 B：H5 模拟（删 wx + 假 localStorage/document）—');

delete globalThis.wx;
const lsCalls = { get: 0, set: 0, remove: 0 };
const lsStore = new Map();
globalThis.localStorage = {
  getItem(key) {
    lsCalls.get++;
    return lsStore.has(key) ? lsStore.get(key) : null;
  },
  setItem(key, value) {
    lsCalls.set++;
    lsStore.set(key, String(value));
  },
  removeItem(key) {
    lsCalls.remove++;
    lsStore.delete(key);
  },
};
globalThis.document = {
  body: { appendChild() {} },
  createElement: () => ({ style: {}, children: [] }),
  getElementById: () => null,
};

check(
  'B: isMiniGame() === false',
  Platform.isMiniGame() === false,
  `wx=${typeof globalThis.wx} document=${typeof globalThis.document}`,
);

const rSetB = attempt(() => Platform.storageSet('s7:h5', 'h5v'));
const rGetB = attempt(() => Platform.storageGet('s7:h5'));
const rDelB = attempt(() => Platform.storageRemove('s7:h5'));
check(
  'B: 存储三方法走 localStorage 且不抛',
  rSetB.ok &&
    rGetB.ok &&
    rGetB.value === 'h5v' &&
    rDelB.ok &&
    lsCalls.set === 1 &&
    lsCalls.get === 1 &&
    lsCalls.remove === 1,
  rSetB.ok && rGetB.ok && rDelB.ok ? `calls=${JSON.stringify(lsCalls)}` : '有方法抛出',
);

const rAbsentB = attempt(() => Platform.storageGet('s7:h5'));
check(
  'B: 删除后 storageGet 返回 null（localStorage.getItem 语义）',
  rAbsentB.ok && rAbsentB.value === null,
  rAbsentB.ok ? `value=${rAbsentB.value}` : String(rAbsentB.error),
);

// ── 场景 C：__ENV__ 优先级 ────────────────────────────────────────────────
console.log('— 场景 C：__ENV__ 注入优先级 —');

globalThis.__ENV__ = { apiBase: 'https://game.joho.cn/', wsUrl: 'wss://game.joho.cn/game' };
check(
  'C: __ENV__.apiBase 生效且去掉尾部 /',
  Platform.env.apiBase() === 'https://game.joho.cn',
  `apiBase=${Platform.env.apiBase()}`,
);
check(
  'C: __ENV__.wsUrl 生效',
  Platform.env.wsUrl() === 'wss://game.joho.cn/game',
  `wsUrl=${Platform.env.wsUrl()}`,
);
const rawC = Platform.env.raw();
check(
  'C: raw() 与实际生效值一致',
  rawC.apiBase === 'https://game.joho.cn' && rawC.wsUrl === 'wss://game.joho.cn/game',
  `raw=${JSON.stringify(rawC)}`,
);

globalThis.__ENV__ = { apiBase: '', wsUrl: 123 };
check(
  'C: 脏值（空串 / 非字符串）回落 AppConfig 默认',
  Platform.env.apiBase() === AppConfig.apiBase && Platform.env.wsUrl() === AppConfig.wsUrl,
  `raw=${JSON.stringify(Platform.env.raw())}`,
);

globalThis.__ENV__ = 'not-an-object';
check(
  'C: __ENV__ 非对象回落 AppConfig 默认',
  Platform.env.apiBase() === AppConfig.apiBase && Platform.env.wsUrl() === AppConfig.wsUrl,
  `raw=${JSON.stringify(Platform.env.raw())}`,
);

delete globalThis.__ENV__;
check(
  'C: 无 __ENV__ 回落 AppConfig 默认（dev）',
  Platform.env.apiBase() === AppConfig.apiBase && Platform.env.wsUrl() === AppConfig.wsUrl,
  `raw=${JSON.stringify(Platform.env.raw())}`,
);

// ── 场景 D：A2 不变量（平台差异只在 src/platform/）─────────────────────────
console.log('— 场景 D：A2 不变量（src/**/*.ts 中平台 API 只在 src/platform/）—');

const PLATFORM_API = /(document|localStorage|wx\.)/;

function walkTs(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) return walkTs(full);
    return ent.name.endsWith('.ts') ? [full] : [];
  });
}

const srcRoot = join(root, 'src');
let scanned = 0;
const violations = [];
for (const file of walkTs(srcRoot)) {
  scanned++;
  const rel = relative(srcRoot, file).split(sep).join('/');
  if (rel.startsWith('platform/')) continue;
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (PLATFORM_API.test(line)) violations.push(`${rel}:${i + 1}  ${line.trim()}`);
    });
}

check(
  `D: 扫描 ${scanned} 个 src/**/*.ts，平台 API 命中只在 src/platform/ 内`,
  violations.length === 0,
  violations.length > 0 ? `越界命中：\n  ${violations.join('\n  ')}` : '仅 src/platform/Platform.ts 命中',
);

console.log(
  failed === 0
    ? `\nS7 平台层断言全部通过（共 ${total} 项）`
    : `\nS7 平台层断言失败 ${failed}/${total} 项`,
);
process.exit(failed === 0 ? 0 : 1);