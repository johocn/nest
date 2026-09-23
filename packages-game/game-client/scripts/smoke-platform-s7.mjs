// S7 Task 1 平台层（存储 / 提示 / 环境地址）零依赖断言脚本（不引入任何测试框架：只用 node + 自写 check）
// 用法：node tools/build-fallback.mjs && node scripts/smoke-platform-s7.mjs
//
// 断言对象全部取自**构建产物**（不 import src/，故不依赖 tsc 之外的转译）：
//   - bin/js/platform/Platform.js
//   - bin/js/net/http.js、bin/js/net/ws.js（只有「地址来源已接 Platform.env」这条静态断言）
//   - bin/js/config/AppConfig.js
// 三个运行环境场景都在 node 里伪造：A 小游戏（注入假 wx + 删 document）、B H5（删 wx + 假 localStorage/document）、
// C __ENV__ 优先级；D 是验收项 A2 的不变量：`src/**/*.ts` 里 document|localStorage|wx. 只允许命中 `src/platform/`。
// Task 2 追加：E `Platform.request`（wx.request / fetch 双分支）、F `createWxWebSocket`（纯逻辑，假 wx.connectSocket）。
// Task 3 追加：G 引擎内登录页 —— G-1 `login-logic` 纯逻辑、G-2 `ui.showKeyboard` 小游戏分支、
// G-3 能力缺失分支、G-4 场景 D 静态扫描仍通过、G-5 H5 仍走 DOM 表单（回归）。
// Task 4 追加：H 配置包随包分发与校验 —— H-1 小游戏分支读包内 config/ 且 fetch 0 次、
// H-2 hash 口径 = 场景文件原始字节 sha256、H-3 `tools/publish.mjs` 产物（只发 manifest 指向的版本）、
// H-4 hash 不符即 exit 1（临时副本，不碰仓库 gamedata/）、H-5 包内缺文件 → 明确报错且仍不 fetch。
// Task 5 追加：I 生产环境注入与 H5 站点装配 —— I-1 `tools/inject-env.mjs`（--env prod 预设 / --api-base 覆盖 /
// 未知 --env 与缺值 exit 1）、I-2 `tools/publish.mjs h5-site`（产物齐全、index.html 加 /client/ 前缀、
// env-config 在 Main.js 之前、/assets/ 与 /gamedata 未改写、--base 归一化）、I-3 幂等、I-4 坏输入拦截。
// 断言失败 → exit 1。
//
// 注：`bin/js/*.js` 最近的 package.json（仓库根）没有 "type" 字段，node 会先按 CJS 解析失败、
// 再按「检测到模块语法」回退为 ES module 求值，并打印一条 MODULE_TYPELESS_PACKAGE_JSON 警告 —— 属预期噪音，
// 不影响断言结果（也不能为此改根 package.json）。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// S7 Task 4（场景 H）新增：publish.mjs 产物断言需要起子进程 + 临时目录 + node:crypto 口径核对
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 需要存在的构建产物：缺任一则提示先构建，不静默失败 */
const ARTIFACTS = {
  platform: 'bin/js/platform/Platform.js',
  appConfig: 'bin/js/config/AppConfig.js',
  http: 'bin/js/net/http.js',
  ws: 'bin/js/net/ws.js',
  wxSocket: 'bin/js/platform/wx-socket.js',
  loginLogic: 'bin/js/ui/login-logic.js',
  bootLogin: 'bin/js/boot/LoginView.js',
  uiLoginView: 'bin/js/ui/LoginView.js',
  configLoader: 'bin/js/config/loader.js',
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

// ── 场景 E：Platform.request（S7 Task 2 Step 1）────────────────────────────
console.log('— 场景 E：Platform.request（wx.request / fetch 双分支）—');

/** attempt 的异步版：失败同样记 FAIL，不中断脚本 */
async function attemptAsync(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e };
  }
}

const reqCalls = [];
let reqBehavior = () => ({});
globalThis.wx = {
  request(opts) {
    reqCalls.push(opts);
    const r = reqBehavior(opts);
    if (r.fail) opts.fail(r.fail);
    else opts.success(r);
  },
};

const JSON_BODY = '{"code":0,"msg":"ok","data":{"token":"t"}}';
reqBehavior = () => ({ statusCode: 200, data: JSON_BODY });
const rE1 = await attemptAsync(() =>
  Platform.request({
    method: 'POST',
    url: 'https://game.joho.cn/api/auth/login',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tk' },
    body: '{"username":"spike01"}',
  }),
);
const cE1 = reqCalls[0] || {};
check(
  'E: wx 分支返回 {status,text}，dataType=text 且 header/method/url/data 原样透传',
  rE1.ok &&
    rE1.value.status === 200 &&
    rE1.value.text === JSON_BODY &&
    cE1.dataType === 'text' &&
    cE1.method === 'POST' &&
    cE1.url === 'https://game.joho.cn/api/auth/login' &&
    cE1.data === '{"username":"spike01"}' &&
    cE1.header.Authorization === 'Bearer tk' &&
    cE1.header['Content-Type'] === 'application/json',
  rE1.ok ? `ret=${JSON.stringify(rE1.value)} req=${JSON.stringify(cE1)}` : String(rE1.error),
);

reqCalls.length = 0;
reqBehavior = () => ({ statusCode: 500, data: { code: 7, msg: 'x' } });
const rE2 = await attemptAsync(() => Platform.request({ method: 'GET', url: 'https://game.joho.cn/api/x' }));
check(
  'E: statusCode=500 保留，data 非字符串时 text 用 JSON.stringify 兜底',
  rE2.ok && rE2.value.status === 500 && rE2.value.text === '{"code":7,"msg":"x"}',
  rE2.ok ? `ret=${JSON.stringify(rE2.value)}` : String(rE2.error),
);

reqCalls.length = 0;
reqBehavior = () => ({ fail: { errMsg: 'request:fail timeout' } });
const rE3 = await attemptAsync(() => Platform.request({ method: 'GET', url: 'https://game.joho.cn/api/y' }));
check(
  'E: wx.request fail → reject（Promise 拒绝并携带 errMsg，而非返回空值）',
  !rE3.ok && rE3.error instanceof Error && String(rE3.error.message).includes('request:fail timeout'),
  rE3.ok ? `意外 resolve：${JSON.stringify(rE3.value)}` : `rejected=${String(rE3.error.message)}`,
);

const origFetch = globalThis.fetch;
const fetchCalls = [];
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, init });
  return { status: 201, text: async () => JSON_BODY };
};

globalThis.wx = { request: 'not-a-function' };
const rE4 = await attemptAsync(() => Platform.request({ method: 'GET', url: 'https://h5.test/api/a' }));
check(
  'E: wx 存在但 request 非 function → 回落 fetch',
  rE4.ok && rE4.value.status === 201 && rE4.value.text === JSON_BODY && fetchCalls.length === 1,
  rE4.ok ? `ret=${JSON.stringify(rE4.value)} fetch=${fetchCalls.length}` : String(rE4.error),
);

delete globalThis.wx;
const rE5 = await attemptAsync(() =>
  Platform.request({
    method: 'POST',
    url: 'https://h5.test/api/b',
    headers: { Authorization: 'Bearer h5' },
    body: '{"a":1}',
  }),
);
const fE5 = fetchCalls[1] || { init: {} };
check(
  'E: H5（无 wx）走 fetch 且 method/headers/body 透传',
  rE5.ok &&
    rE5.value.status === 201 &&
    fetchCalls.length === 2 &&
    fE5.url === 'https://h5.test/api/b' &&
    fE5.init.method === 'POST' &&
    fE5.init.headers.Authorization === 'Bearer h5' &&
    fE5.init.body === '{"a":1}',
  rE5.ok ? `ret=${JSON.stringify(rE5.value)} init=${JSON.stringify(fE5.init)}` : String(rE5.error),
);
globalThis.fetch = origFetch;

// ── 场景 F：wx-socket 适配（S7 Task 2 Step 2）──────────────────────────────
console.log('— 场景 F：createWxWebSocket（假 wx.connectSocket + 可控 SocketTask）—');

const { createWxWebSocket, ensureWxWebSocket } = await load(ARTIFACTS.wxSocket);

const connectCalls = [];
const tasks = [];
globalThis.wx = {
  connectSocket(opts) {
    connectCalls.push(opts);
    const task = {
      sent: [],
      closed: [],
      onOpen(fn) {
        task._open = fn;
      },
      onMessage(fn) {
        task._msg = fn;
      },
      onClose(fn) {
        task._close = fn;
      },
      onError(fn) {
        task._err = fn;
      },
      send(o) {
        task.sent.push(o);
      },
      close(o) {
        task.closed.push(o);
      },
    };
    tasks.push(task);
    return task;
  },
};

const WxWS = createWxWebSocket();
const s1 = new WxWS('wss://game.joho.cn/game', ['websocket']);
check(
  'F: 构造后 readyState=CONNECTING，常量与浏览器一致，wx.connectSocket 收到 url/protocols',
  s1.readyState === 0 &&
    WxWS.CONNECTING === 0 &&
    WxWS.OPEN === 1 &&
    WxWS.CLOSING === 2 &&
    WxWS.CLOSED === 3 &&
    s1.CONNECTING === 0 &&
    s1.OPEN === 1 &&
    connectCalls[0].url === 'wss://game.joho.cn/game' &&
    JSON.stringify(connectCalls[0].protocols) === '["websocket"]',
  `readyState=${s1.readyState} connect=${JSON.stringify(connectCalls[0])}`,
);

const rF2 = attempt(() => s1.send('early'));
check(
  'F: 未 OPEN 时 send 不抛且不落到 wx（丢弃 + 警告）',
  rF2.ok && tasks[0].sent.length === 0,
  rF2.ok ? `sent=${tasks[0].sent.length}` : String(rF2.error),
);

let openedProp = 0;
let openedListener = 0;
const msgs = [];
const msgsRemoved = [];
let closeEvent = null;
s1.onopen = () => openedProp++;
s1.addEventListener('open', () => openedListener++);
s1.addEventListener('message', (ev) => msgs.push(ev.data));
const removedFn = (ev) => msgsRemoved.push(ev.data);
s1.addEventListener('message', removedFn);
s1.removeEventListener('message', removedFn);
s1.onclose = (ev) => {
  closeEvent = ev;
};
tasks[0]._open();
check(
  'F: onOpen → readyState=OPEN，属性式回调与 addEventListener 都被调用',
  s1.readyState === 1 && openedProp === 1 && openedListener === 1,
  `readyState=${s1.readyState} onopen=${openedProp} listener=${openedListener}`,
);

tasks[0]._msg({ data: '{"a":1}' });
check(
  'F: onMessage 字符串透传（未解析成对象），removeEventListener 生效',
  msgs.length === 1 && msgs[0] === '{"a":1}' && typeof msgs[0] === 'string' && msgsRemoved.length === 0,
  `msgs=${JSON.stringify(msgs)} removed=${msgsRemoved.length}`,
);

s1.send('hello');
check(
  'F: send 的字符串原样进入 SocketTask.send',
  tasks[0].sent.length === 1 && tasks[0].sent[0].data === 'hello',
  `sent=${JSON.stringify(tasks[0].sent)}`,
);

tasks[0]._close({ code: 1000, reason: 'x' });
check(
  'F: onClose → readyState=CLOSED，close 事件含 code/reason/wasClean',
  s1.readyState === 3 &&
    closeEvent &&
    closeEvent.code === 1000 &&
    closeEvent.reason === 'x' &&
    closeEvent.wasClean === true,
  `readyState=${s1.readyState} close=${JSON.stringify(closeEvent)}`,
);

const s2 = new WxWS('wss://game.joho.cn/game');
let errEvent = null;
s2.onerror = (ev) => {
  errEvent = ev;
};
s2.addEventListener('error', () => {});
tasks[1]._err({ errMsg: 'boom' });
check(
  'F: onError → error 监听收到 Error（errMsg 放进 message）',
  errEvent instanceof Error && errEvent.message === 'boom',
  `err=${errEvent instanceof Error ? errEvent.message : String(errEvent)}`,
);

const s3 = new WxWS('wss://game.joho.cn/game');
const rF7 = attempt(() => {
  s3.close();
  s3.close();
});
check(
  'F: close() 后再 close() 不抛，未连接时直接切 CLOSED',
  rF7.ok && s3.readyState === 3 && tasks[2].closed.length === 1,
  rF7.ok ? `readyState=${s3.readyState} closed=${JSON.stringify(tasks[2].closed)}` : String(rF7.error),
);

const beforeWS = globalThis.WebSocket;
ensureWxWebSocket();
const injectedWS = globalThis.WebSocket;
const keepWS = function ExistingWS() {};
globalThis.WebSocket = keepWS;
ensureWxWebSocket();
check(
  'F: ensureWxWebSocket 注入生效、幂等且不覆盖已存在的 WebSocket',
  typeof injectedWS === 'function' && globalThis.WebSocket === keepWS && typeof s1.removeEventListener === 'function',
  `before=${typeof beforeWS} injected=${typeof injectedWS} after=${
    globalThis.WebSocket === keepWS ? 'unchanged' : 'overwritten'
  }`,
);
if (beforeWS === undefined) delete globalThis.WebSocket;
else globalThis.WebSocket = beforeWS;
delete globalThis.wx;

check(
  'F: 暴露全局兜底名 __S7_WX_SOCKET__（供早于 socket.io 的入口脚本调用）',
  typeof globalThis.__S7_WX_SOCKET__ === 'object' &&
    typeof globalThis.__S7_WX_SOCKET__.ensureWxWebSocket === 'function' &&
    typeof globalThis.__S7_WX_SOCKET__.createWxWebSocket === 'function',
  `keys=${Object.keys(globalThis.__S7_WX_SOCKET__ || {}).join(',')}`,
);

// ── 场景 G：登录页（引擎内）+ 软键盘（S7 Task 3）──────────────────────────
// G-1 login-logic 纯逻辑（状态归约 / 校验文案 / 布局矩形 / 键盘 token 映射）
// G-2 小游戏分支 Platform.ui.showKeyboard（假 wx 软键盘接管）
// G-3 能力缺失分支（H5 / wx 无 showKeyboard）→ 返回 false 且不抛
// G-4 场景 D 的静态扫描仍通过（新增文件不得出现 document|localStorage|wx.）
// G-5 H5 仍走既有 DOM 表单（showLogin/hideLogin 分派 + 提交/异常文案 + 按钮恢复）
console.log('— 场景 G：登录页（引擎内）与软键盘 —');

const {
  createLoginState,
  applyKey,
  setFieldText,
  validateLogin,
  loginLayout,
  keyTokenFromEvent,
} = await load(ARTIFACTS.loginLogic);

check(
  'G: Platform.ui 暴露 showLogin/hideLogin/showKeyboard/hideKeyboard 四方法',
  ['showLogin', 'hideLogin', 'showKeyboard', 'hideKeyboard'].every(
    (k) => typeof Platform.ui[k] === 'function',
  ),
  `keys=${Object.keys(Platform.ui).join(',')}`,
);

// ── G-1 纯逻辑 ────────────────────────────────────────────────────────────
const st0 = createLoginState();
check(
  'G-1: 初始状态为空且焦点在账号',
  st0.username === '' && st0.password === '' && st0.focus === 'username' && st0.error === '',
  JSON.stringify(st0),
);

let st = createLoginState();
for (const ch of 'abc') st = applyKey(st, ch).state;
check(
  'G-1: 逐字符输入按 length 追加到账号字段',
  st.username === 'abc' && st.password === '',
  `username=${st.username}`,
);

let stCn = createLoginState();
for (const ch of ['张', '@', '_']) stCn = applyKey(stCn, ch).state;
check(
  'G-1: 中文/@/下划线等可见字符均可输入',
  stCn.username === '张@_',
  `username=${stCn.username}`,
);

check(
  'G-1: backspace 退格删除末字符',
  applyKey(st, 'backspace').state.username === 'ab' &&
    applyKey(applyKey(st, 'backspace').state, 'backspace').state.username === 'a',
  `after=${applyKey(st, 'backspace').state.username}`,
);

check(
  'G-1: escape 清空当前焦点字段',
  applyKey(st, 'escape').state.username === '' &&
    applyKey({ ...st, focus: 'password', password: 'p' }, 'escape').state.password === '',
);

let stNa = createLoginState();
stNa = applyKey(stNa, keyTokenFromEvent(16, 'Shift', false) || '').state;
stNa = applyKey(stNa, keyTokenFromEvent(112, 'F1', false) || '').state;
stNa = applyKey(stNa, keyTokenFromEvent(8, 'Backspace', false) || '').state;
check(
  'G-1: 不可见键（Shift/F1）不产生字符（退格可用的 keyCode 映射）',
  stNa.username === '' && stNa.password === '',
  `username=${stNa.username}`,
);

check(
  'G-1: Tab/方向键切换焦点字段',
  applyKey(createLoginState(), 'tab').state.focus === 'password' &&
    applyKey(applyKey(createLoginState(), 'arrowdown').state, 'arrowdown').state.focus === 'username',
  `focus=${applyKey(createLoginState(), 'tab').state.focus}`,
);

const enter = applyKey(st, 'enter');
check(
  'G-1: Enter 返回 submit 意图且不改动字段',
  enter.intent === 'submit' && enter.state.username === 'abc',
  `intent=${enter.intent} username=${enter.state.username}`,
);

const base = createLoginState();
applyKey(base, 'a');
applyKey(base, 'backspace');
applyKey(base, 'enter');
setFieldText(base, 'password', 'x');
check(
  'G-1: applyKey/setFieldText 为纯函数（不改入参）',
  base.username === '' && base.password === '' && base.focus === 'username' && base.error === '',
  JSON.stringify(base),
);

let longUser = createLoginState();
for (let i = 0; i < 40; i++) longUser = applyKey(longUser, 'a').state;
let longPass = { ...createLoginState(), focus: 'password' };
for (let i = 0; i < 70; i++) longPass = applyKey(longPass, 'a').state;
check(
  'G-1: 账号输入受 maxUserLen=32 截断，密码受 maxPassLen=64 截断',
  longUser.username.length === 32 && longPass.password.length === 64,
  `user=${longUser.username.length} pass=${longPass.password.length}`,
);

check(
  'G-1: validateLogin 空账号 → 文案',
  validateLogin(createLoginState()) === '账号不能为空',
  String(validateLogin(createLoginState())),
);
check(
  'G-1: validateLogin 账号过短 / 非法字符 → 文案',
  validateLogin({ ...createLoginState(), username: 'ab' }) === '账号需 3-32 位字母/数字/下划线' &&
    validateLogin({ ...createLoginState(), username: 'ab-cd' }) === '账号只能包含字母/数字/下划线',
  String(validateLogin({ ...createLoginState(), username: 'ab' })),
);
check(
  'G-1: validateLogin 密码过短 → 文案',
  validateLogin({ username: 'spike01', password: '12345', focus: 'username', error: '' }) ===
    '密码需 6-64 位',
  String(validateLogin({ username: 'spike01', password: '12345', focus: 'username', error: '' })),
);
check(
  'G-1: validateLogin 合法账号密码 → null（与 H5 表单口径一致）',
  validateLogin({
    username: 'spike01',
    password: 'spike123456',
    focus: 'username',
    error: '',
  }) === null,
  String(
    validateLogin({ username: 'spike01', password: 'spike123456', focus: 'username', error: '' }),
  ),
);

const lay = loginLayout(960, 640);
const layPanel = lay.panel;
const layControls = [
  lay.title,
  lay.userLabel,
  lay.userBox,
  lay.passLabel,
  lay.passBox,
  lay.button,
  lay.error,
];
check(
  'G-1: loginLayout(960,640) 各矩形均在舞台内且宽高为正',
  [layPanel, ...layControls].every(
    (r) => r.w > 0 && r.h > 0 && r.x >= 0 && r.y >= 0 && r.x + r.w <= 960 && r.y + r.h <= 640,
  ),
  `panel=${JSON.stringify(layPanel)} button=${JSON.stringify(lay.button)}`,
);
check(
  'G-1: loginLayout 各控件都在面板内（不越界）',
  layControls.every(
    (r) =>
      r.x >= layPanel.x &&
      r.y >= layPanel.y &&
      r.x + r.w <= layPanel.x + layPanel.w &&
      r.y + r.h <= layPanel.y + layPanel.h,
  ),
  `panel=${JSON.stringify(layPanel)}`,
);
const layOverlaps = [];
for (let i = 0; i < layControls.length; i++) {
  for (let j = i + 1; j < layControls.length; j++) {
    const a = layControls[i];
    const b = layControls[j];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
      layOverlaps.push(`${i}-${j}`);
    }
  }
}
check(
  'G-1: loginLayout 各控件互不重叠',
  layOverlaps.length === 0,
  `overlaps=${layOverlaps.join(',') || '无'}`,
);

// ── G-2 小游戏分支：wx 软键盘接管 ─────────────────────────────────────────
delete globalThis.document;
const kb = { show: [], offInput: 0, offConfirm: 0, offComplete: 0, hide: 0 };
const kbHandlers = {};
globalThis.wx = {
  showKeyboard(opts) {
    kb.show.push(opts);
  },
  onKeyboardInput(fn) {
    kbHandlers.input = fn;
  },
  onKeyboardConfirm(fn) {
    kbHandlers.confirm = fn;
  },
  onKeyboardComplete(fn) {
    kbHandlers.complete = fn;
  },
  offKeyboardInput() {
    kb.offInput++;
  },
  offKeyboardConfirm() {
    kb.offConfirm++;
  },
  offKeyboardComplete() {
    kb.offComplete++;
  },
  hideKeyboard() {
    kb.hide++;
  },
};
const kbSeen = { input: [], confirm: 0, complete: 0 };
const kbOpts = () => ({
  defaultValue: 'spike01',
  maxLength: 32,
  field: 'username',
  handlers: {
    onInput: (v) => kbSeen.input.push(v),
    onConfirm: () => kbSeen.confirm++,
    onComplete: () => kbSeen.complete++,
  },
});
const kbOpen = attempt(() => Platform.ui.showKeyboard(kbOpts()));
check(
  'G-2: 小游戏端 showKeyboard 返回 true，且 wx.showKeyboard 收到 defaultValue/maxLength/confirmType',
  kbOpen.ok &&
    kbOpen.value === true &&
    kb.show.length === 1 &&
    kb.show[0].defaultValue === 'spike01' &&
    kb.show[0].maxLength === 32 &&
    kb.show[0].multiple === false &&
    kb.show[0].confirmType === 'done',
  kbOpen.ok ? `ret=${kbOpen.value} opts=${JSON.stringify(kb.show[0])}` : String(kbOpen.error),
);
check(
  'G-2: 注册监听前先清掉上一次（offKeyboard* 各被调用一次，避免回调叠加）',
  kb.offInput === 1 && kb.offConfirm === 1 && kb.offComplete === 1,
  `off=${kb.offInput}/${kb.offConfirm}/${kb.offComplete}`,
);

kbHandlers.input({ value: 'abc' });
check(
  'G-2: onKeyboardInput({value:"abc"}) → handlers.onInput("abc")',
  kbSeen.input[0] === 'abc',
  `input=${JSON.stringify(kbSeen.input)}`,
);
kbHandlers.confirm({ value: 'abcd' });
kbHandlers.complete();
check(
  'G-2: onKeyboardConfirm → 同步末值 + onConfirm；onKeyboardComplete → onComplete',
  kbSeen.confirm === 1 && kbSeen.complete === 1 && kbSeen.input[1] === 'abcd',
  `confirm=${kbSeen.confirm} complete=${kbSeen.complete} input=${JSON.stringify(kbSeen.input)}`,
);

const kbHide = attempt(() => Platform.ui.hideKeyboard());
check(
  'G-2: hideKeyboard 不抛且命中 wx.hideKeyboard',
  kbHide.ok && kb.hide === 1,
  kbHide.ok ? `hide=${kb.hide}` : String(kbHide.error),
);

const kbReopen = attempt(() => Platform.ui.showKeyboard(kbOpts()));
check(
  'G-2: 二次打开仍先清理监听（off* 计数递增到 2）',
  kbReopen.ok && kbReopen.value === true && kb.offInput === 2 && kb.offConfirm === 2,
  kbReopen.ok ? `off=${kb.offInput}/${kb.offConfirm}` : String(kbReopen.error),
);

let miniLogin = { ok: false, error: 'not-run' };
const miniLoginLogs = captureLog(() => {
  miniLogin = attempt(() => Platform.ui.showLogin({ onSubmit: async () => {} }));
});
check(
  'G-2: 小游戏端 showLogin 分派到引擎内 LoginView（无 document、引擎未初始化也不抛）',
  miniLogin.ok && miniLoginLogs.some((l) => l.includes('LoginView')),
  miniLogin.ok ? `logs=${JSON.stringify(miniLoginLogs)}` : String(miniLogin.error),
);

// ── G-3 能力缺失分支 ─────────────────────────────────────────────────────
delete globalThis.wx;
const noWx = attempt(() => Platform.ui.showKeyboard(kbOpts()));
check(
  'G-3: 无 wx（H5）→ showKeyboard 返回 false 且不抛（由视图走引擎键盘事件）',
  noWx.ok && noWx.value === false,
  noWx.ok ? `ret=${noWx.value}` : String(noWx.error),
);

globalThis.wx = { getStorageSync() {} };
const noApi = attempt(() => Platform.ui.showKeyboard(kbOpts()));
check(
  'G-3: wx 存在但无 showKeyboard → 同样返回 false 且不抛',
  noApi.ok && noApi.value === false,
  noApi.ok ? `ret=${noApi.value}` : String(noApi.error),
);
const noApiHide = attempt(() => Platform.ui.hideKeyboard());
check(
  'G-3: wx 无 hideKeyboard → hideKeyboard 不抛',
  noApiHide.ok,
  noApiHide.ok ? 'ok' : String(noApiHide.error),
);
delete globalThis.wx;

// ── G-4 场景 D 的静态扫描仍通过 ───────────────────────────────────────────
check(
  'G-4: 场景 D 静态扫描仍 0 命中（平台 API 只在 src/platform/）',
  violations.length === 0,
  violations.length > 0 ? `越界命中：${violations.length} 处` : '仅 src/platform/Platform.ts 命中',
);
const newFiles = ['src/ui/login-logic.ts', 'src/ui/LoginView.ts'];
const newHits = newFiles.flatMap((f) =>
  readFileSync(join(root, f), 'utf8')
    .split(/\r?\n/)
    .filter((line) => PLATFORM_API.test(line))
    .map((line) => `${f}: ${line.trim()}`),
);
check(
  'G-4: 新增 login-logic.ts / LoginView.ts 文本内无 document|localStorage|wx. 命中',
  newHits.length === 0,
  newHits.length > 0 ? newHits.join(' | ') : '无命中',
);

// ── G-5 H5 仍走既有 DOM 表单（回归：分派 + 提交流程不变）──────────────────
const dom = { appended: 0, removed: 0, createElement: 0, getById: 0 };
const domParts = {
  '#s1-user': { value: '  spike01  ' },
  '#s1-pass': { value: 'spike123456' },
  '#s1-err': { textContent: '' },
  '#s1-submit': {
    disabled: false,
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
  },
};
const domBox = {
  id: '',
  innerHTML: '',
  parentNode: null,
  querySelector(sel) {
    return domParts[sel] || null;
  },
};
const domBody = {
  appendChild(el) {
    dom.appended++;
    el.parentNode = domBody;
  },
  removeChild(el) {
    dom.removed++;
    el.parentNode = null;
  },
};
globalThis.document = {
  body: domBody,
  createElement() {
    dom.createElement++;
    return domBox;
  },
  getElementById(id) {
    dom.getById++;
    return id === 's1-login' ? domBox : null;
  },
};

let h5Submitted = null;
Platform.ui.showLogin({
  onSubmit: async (username, password) => {
    h5Submitted = [username, password];
  },
});
check(
  'G-5: H5 分支 showLogin 仍建 DOM 表单（#s1-login 含四个控件并挂到 body）',
  dom.createElement === 1 &&
    dom.appended === 1 &&
    domBox.id === 's1-login' &&
    domBox.parentNode === domBody &&
    ['s1-user', 's1-pass', 's1-submit', 's1-err'].every((id) => domBox.innerHTML.includes(id)),
  `create=${dom.createElement} appended=${dom.appended} id=${domBox.id}`,
);

domParts['#s1-submit'].listeners.click();
await new Promise((r) => setTimeout(r, 0));
check(
  'G-5: H5 点击提交把 trim 后的账号/密码交给 onSubmit（H5 行为不变）',
  h5Submitted !== null && h5Submitted[0] === 'spike01' && h5Submitted[1] === 'spike123456',
  `submitted=${JSON.stringify(h5Submitted)}`,
);

domParts['#s1-err'].textContent = '';
Platform.ui.showLogin({
  onSubmit: async () => {
    throw new Error('测试提交失败');
  },
});
domParts['#s1-submit'].listeners.click();
await new Promise((r) => setTimeout(r, 0));
check(
  'G-5: H5 提交异常写入 .err 文案且按钮恢复可用',
  domParts['#s1-err'].textContent === '测试提交失败' && domParts['#s1-submit'].disabled === false,
  `err=${domParts['#s1-err'].textContent} disabled=${domParts['#s1-submit'].disabled}`,
);

Platform.ui.hideLogin();
check(
  'G-5: H5 hideLogin 移除 DOM 表单',
  dom.removed === 2 && domBox.parentNode === null,
  `removed=${dom.removed}`,
);

const bootLoginJs = readFileSync(join(root, ARTIFACTS.bootLogin), 'utf8');
check(
  'G-5: boot/LoginView 只经 Platform.ui.showLogin/hideLogin 接线（不再直触 DOM 表单）',
  bootLoginJs.includes('Platform.ui.showLogin') &&
    bootLoginJs.includes('Platform.ui.hideLogin') &&
    !bootLoginJs.includes('showLoginForm') &&
    !bootLoginJs.includes('hideLoginForm'),
  `uiShowLogin=${bootLoginJs.includes('Platform.ui.showLogin')} showLoginForm=${bootLoginJs.includes('showLoginForm')}`,
);

// ── 场景 H：配置包随包分发与校验（S7 Task 4）───────────────────────────────
// H-1 小游戏分支 loader 读包内 config/（假 wx 文件系统指向真实 gamedata），且 fetch 调用 0 次
// H-2 hash 口径：场景文件**原始字节** sha256 === manifest.hash（publish.mjs 的校验口径，双层语义不混用）
// H-3 tools/publish.mjs wxgame-config 产物：只发 manifest 指向的版本、字节一致、hash 一致、幂等
// H-4 hash 不符 → exit 非 0（临时副本篡改一字节；仓库 gamedata/ 原文件必须不变）
// H-5 包内缺文件 → 明确报「小游戏包内缺少 config/」且仍不 fetch
console.log('— 场景 H：配置包随包分发与校验 —');

const GAMEDATA = join(root, '..', 'game-server', 'gamedata');
const sha256FileH = (p) => `sha256:${createHash('sha256').update(readFileSync(p)).digest('hex')}`;

const hReads = [];
let hFsMode = 'ok'; // ok = 路径映射到真实 gamedata；missing = 一律抛错（H-5）
globalThis.wx = {
  getFileSystemManager() {
    return {
      readFileSync(p, enc) {
        hReads.push([String(p), enc]);
        if (hFsMode === 'missing') throw new Error(`no such file: ${p}`);
        const abs = join(GAMEDATA, String(p).replace(/^config\//, ''));
        if (!existsSync(abs)) throw new Error(`no such file: ${abs}`);
        return readFileSync(abs, 'utf8');
      },
    };
  },
};
const docBeforeH = globalThis.document;
delete globalThis.document;

const hFetchCalls = [];
const fetchBeforeH = globalThis.fetch;
globalThis.fetch = (url) => {
  hFetchCalls.push({ url });
  return Promise.reject(new Error(`H: 小游戏分支不应发起网络请求（${url}）`));
};

const { ConfigLoader } = await load(ARTIFACTS.configLoader);

// H-1 小游戏分支：loadScene 全程只读包内文件
const origLogH = console.log;
let rH1 = { ok: false, error: 'not-run' };
try {
  console.log = () => {};
  rH1 = await attemptAsync(() => ConfigLoader.loadScene());
} finally {
  console.log = origLogH;
}
check(
  'H-1: 小游戏分支 loadScene 成功返回场景配置（sceneId=1、静态物件>0）',
  rH1.ok && rH1.value.sceneId === 1 && rH1.value.version === 1 && rH1.value.staticEntities.length > 0,
  rH1.ok
    ? `sceneId=${rH1.value.sceneId} v${rH1.value.version} 静态物件=${rH1.value.staticEntities.length} NPC=${rH1.value.fixedNpcs.length}`
    : String(rH1.error),
);
check(
  'H-1: 小游戏分支 fetch 调用 0 次（配置包随包分发，不发网络请求）',
  hFetchCalls.length === 0,
  `fetchCalls=${hFetchCalls.length}${hFetchCalls.length > 0 ? ` url=${hFetchCalls[0].url}` : ''}`,
);
const hReadPaths = hReads.map(([p]) => p);
check(
  'H-1: 读取路径全部落在 config/ 下（manifest.json + manifest 指向的版本）',
  hReadPaths.length === 2 &&
    hReadPaths.every((p) => p.startsWith('config/')) &&
    hReadPaths.includes('config/manifest.json') &&
    hReadPaths.includes('config/scene-1-v1.json'),
  `reads=${JSON.stringify(hReadPaths)}`,
);

// H-2 hash 口径（与 tools/publish.mjs / tools/check-config.mjs 同源）
const gdManifest = JSON.parse(readFileSync(join(GAMEDATA, 'manifest.json'), 'utf8'));
const gdScene0 = gdManifest.scenes[0];
const h2Actual = sha256FileH(join(GAMEDATA, gdScene0.file));
check(
  'H-2: gamedata 场景文件原始字节 sha256 === manifest.hash（唯一校验口径）',
  h2Actual === gdScene0.hash,
  `recomputed=${h2Actual.slice(0, 20)}… manifest=${gdScene0.hash.slice(0, 20)}…`,
);

// H-3 / H-4：publish.mjs 产物与失败语义（全部在临时目录，不写仓库）
const tmpRoot = mkdtempSync(join(tmpdir(), 's7-publish-'));
const publishScript = join(root, 'tools', 'publish.mjs');
const outDir = join(tmpRoot, 'config');
const publishedFiles = ['manifest.json', gdScene0.file];
try {
  // 预置陈旧配置包（历史版本）+ 一个无关文件：验证「只清配置包、不动别处」
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'scene-1-v2.json'), '{"stale":true}', 'utf8');
  writeFileSync(join(outDir, 'keep-me.txt'), 'keep', 'utf8');

  const runPublish = () =>
    spawnSync(process.execPath, [publishScript, 'wxgame-config', '--target', tmpRoot], {
      cwd: root,
      encoding: 'utf8',
    });
  const listingOf = () =>
    publishedFiles.map((f) => `${f}:${statSync(join(outDir, f)).size}:${sha256FileH(join(outDir, f))}`).join(' | ');

  const rH3 = runPublish();
  check(
    'H-3: publish.mjs wxgame-config 退出码 0',
    rH3.status === 0,
    `status=${rH3.status} stdout=${JSON.stringify((rH3.stdout || '').trim().split(/\r?\n/).pop())}`,
  );
  check(
    'H-3: 产物含 manifest.json + manifest 指向的版本，且字节数与源文件一致',
    publishedFiles.every(
      (f) => existsSync(join(outDir, f)) && statSync(join(outDir, f)).size === statSync(join(GAMEDATA, f)).size,
    ),
    `files=${publishedFiles.map((f) => `${f}:${existsSync(join(outDir, f)) ? statSync(join(outDir, f)).size : 'missing'}`).join(' ')}`,
  );
  const staleLeft = ['scene-1-v2.json', 'scene-1-v3.json', 'scene-1-v4.json'].filter((f) =>
    existsSync(join(outDir, f)),
  );
  check(
    'H-3: 未指向的历史版本（v2/v3/v4）不随包发出（陈旧配置包被清理）',
    staleLeft.length === 0 && existsSync(join(outDir, 'keep-me.txt')),
    `残留=${staleLeft.join(',') || '无'} keep-me.txt=${existsSync(join(outDir, 'keep-me.txt'))}`,
  );
  check(
    'H-3: 产物逐个重算 sha256 === manifest.hash',
    publishedFiles.every((f) => f === 'manifest.json' || sha256FileH(join(outDir, f)) === gdScene0.hash),
    `scene=${sha256FileH(join(outDir, gdScene0.file)).slice(0, 20)}…`,
  );
  const listingA = listingOf();
  const rH3b = runPublish();
  check(
    'H-3: 连续两次发布清单（文件名/字节数/sha256）完全一致（幂等，A9 本地部分）',
    rH3b.status === 0 && listingA === listingOf(),
    `run1=${listingA.slice(0, 60)}… run2=${listingOf().slice(0, 60)}…`,
  );

  // H-4：临时副本篡改一字节（不碰仓库 gamedata/），要求 exit 非 0 + 打印失败明细
  const badSrc = join(tmpRoot, 'bad-gamedata');
  mkdirSync(badSrc, { recursive: true });
  for (const f of publishedFiles) copyFileSync(join(GAMEDATA, f), join(badSrc, f));
  const badFile = join(badSrc, gdScene0.file);
  writeFileSync(badFile, `${readFileSync(badFile, 'utf8')}\n`, 'utf8');
  const rH4 = spawnSync(
    process.execPath,
    [publishScript, 'wxgame-config', '--target', join(tmpRoot, 'bad-out'), '--source', badSrc],
    { cwd: root, encoding: 'utf8' },
  );
  const h4Text = `${rH4.stdout || ''}${rH4.stderr || ''}`;
  check(
    'H-4: 复制后 hash 与 manifest 不符 → exit 非 0 且打印失败明细',
    rH4.status !== 0 && h4Text.includes('与 manifest.hash 不一致') && h4Text.includes(gdScene0.file),
    `status=${rH4.status} 明细=${JSON.stringify(h4Text.trim().split(/\r?\n/).filter((l) => l.includes(gdScene0.file))[0] || '')}`,
  );
  check(
    'H-4: 失败用例未触碰仓库 gamedata/ 原文件（篡改只发生在临时副本）',
    sha256FileH(join(GAMEDATA, gdScene0.file)) === gdScene0.hash,
    `repo=${sha256FileH(join(GAMEDATA, gdScene0.file)).slice(0, 20)}… manifest=${gdScene0.hash.slice(0, 20)}…`,
  );
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

// H-5 包内缺文件：仍走小游戏分支（不 fetch），错误信息指明补文件位置
hFsMode = 'missing';
const rH5 = await attemptAsync(() => ConfigLoader.loadScene());
check(
  'H-5: 包内缺 config/ → 报「小游戏包内缺少 config/」且仍未 fetch',
  !rH5.ok && String(rH5.error.message).includes('小游戏包内缺少 config/') && hFetchCalls.length === 0,
  rH5.ok ? `意外成功：${JSON.stringify(rH5.value.sceneId)}` : `error=${String(rH5.error.message)} fetchCalls=${hFetchCalls.length}`,
);

globalThis.fetch = fetchBeforeH;
if (docBeforeH === undefined) delete globalThis.document;
else globalThis.document = docBeforeH;
delete globalThis.wx;

// ── 场景 I：生产环境注入 + H5 站点装配（S7 Task 5）─────────────────────────
// I-1 tools/inject-env.mjs：--env prod 预设 / --api-base 覆盖 / 未知 --env 与缺值一律 exit 1；
//     产出的 env-config.js 文本在**伪造的 globalThis** 里求值（不污染真实全局），再经 Platform.env 读回。
// I-2 tools/publish.mjs h5-site：站点装配产物齐全、index.html 前缀改写正确、
//     env-config 在 Main.js 之前、/assets/ 与 /gamedata 未被改写、--base 归一化。
// I-3 连续两次 h5-site 到同一目标 → 文件清单 + 逐文件 sha256 完全一致（幂等）。
// I-4 坏输入必须被拦：--base / 归一化边界被自校验拒绝（未产出 index.html）；
//     并断言 publish.mjs 源码内确实存在该自校验关键字。
console.log('— 场景 I：生产环境注入与 H5 站点装配 —');

const injectScript = join(root, 'tools', 'inject-env.mjs');
const runNodeI = (script, args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
const sha256FileI = (p) => `sha256:${createHash('sha256').update(readFileSync(p)).digest('hex')}`;
const readIfI = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const lastLineI = (r) => ((r.stdout || '').trim().split(/\r?\n/).pop() || '');

const tmpI = mkdtempSync(join(tmpdir(), 's7-h5site-'));
try {
  // ── I-1 ────────────────────────────────────────────────────────────────
  const envOut = join(tmpI, 'inject');
  const envFile = join(envOut, 'env-config.js');
  const rI1 = runNodeI(injectScript, ['--env', 'prod', '--out', envOut]);
  check(
    'I-1: inject-env.mjs --env prod 退出码 0，生成 env-config.js 且打印写入路径',
    rI1.status === 0 && existsSync(envFile) && (rI1.stdout || '').includes(envFile),
    `status=${rI1.status} stdout=${JSON.stringify((rI1.stdout || '').trim())}`,
  );
  const envText = readIfI(envFile);
  check(
    'I-1: env-config.js 是普通脚本（无 import/export；用 globalThis 兜底 window）',
    envText.includes('globalThis') && !/^\s*(?:import|export)\s/m.test(envText),
    `len=${envText.length}`,
  );
  check(
    'I-1: env-config.js 文件头写明「必须早于 js/boot/Main.js 加载」',
    /必须早于.*Main\.js/.test(envText),
    `head=${JSON.stringify(envText.slice(0, 40))}`,
  );

  const sandboxI = {};
  let evalErrI = null;
  try {
    new Function('globalThis', 'window', `${envText}\nreturn globalThis;`)(sandboxI, sandboxI);
  } catch (e) {
    evalErrI = e;
  }
  check(
    'I-1: 伪造 globalThis 求值后 __ENV__ === prod 预设（不污染真实全局）',
    evalErrI === null &&
      sandboxI.__ENV__?.apiBase === 'https://game.joho.cn' &&
      sandboxI.__ENV__?.wsUrl === 'wss://game.joho.cn/game',
    evalErrI ? String(evalErrI) : `__ENV__=${JSON.stringify(sandboxI.__ENV__)}`,
  );

  const savedEnvI = globalThis.__ENV__;
  let envApiBase = null;
  let envWsUrl = null;
  try {
    globalThis.__ENV__ = sandboxI.__ENV__;
    envApiBase = Platform.env.apiBase();
    envWsUrl = Platform.env.wsUrl();
  } finally {
    if (savedEnvI === undefined) delete globalThis.__ENV__;
    else globalThis.__ENV__ = savedEnvI;
  }
  check(
    'I-1: Platform.env.apiBase()/wsUrl() 读到注入值',
    envApiBase === 'https://game.joho.cn' && envWsUrl === 'wss://game.joho.cn/game',
    `apiBase=${envApiBase} wsUrl=${envWsUrl}`,
  );
  check(
    'I-1: 断言后真实全局 __ENV__ 已还原（未被污染）',
    globalThis.__ENV__ === savedEnvI,
    `restored=${globalThis.__ENV__ === savedEnvI}`,
  );

  const overrideOut = join(tmpI, 'inject-override');
  const rI1b = runNodeI(injectScript, [
    '--env',
    'prod',
    '--api-base',
    'https://api.example.com/',
    '--ws-url',
    'wss://api.example.com/game',
    '--out',
    overrideOut,
  ]);
  const overrideText = readIfI(join(overrideOut, 'env-config.js'));
  check(
    'I-1: --api-base / --ws-url 覆盖预设（只改被覆盖字段）',
    rI1b.status === 0 &&
      overrideText.includes('"https://api.example.com/"') &&
      overrideText.includes('"wss://api.example.com/game"') &&
      !overrideText.includes('game.joho.cn'),
    `status=${rI1b.status} has=${overrideText.includes('api.example.com')}`,
  );

  const rBadEnv = runNodeI(injectScript, ['--env', 'staging', '--out', join(tmpI, 'inject-bad')]);
  const rNoVal = runNodeI(injectScript, ['--env']);
  const rNoEnv = runNodeI(injectScript, ['--out', join(tmpI, 'inject-noenv')]);
  check(
    'I-1: 未知 --env / --env 缺取值 / 缺 --env → exit 1 且给出明确错误',
    rBadEnv.status === 1 &&
      /未知 --env/.test(rBadEnv.stderr || '') &&
      rNoVal.status === 1 &&
      /缺少取值/.test(rNoVal.stderr || '') &&
      rNoEnv.status === 1 &&
      /缺少 --env/.test(rNoEnv.stderr || ''),
    `badEnv=${rBadEnv.status} noVal=${rNoVal.status} noEnv=${rNoEnv.status}`,
  );

  const rI1d = runNodeI(injectScript, ['--env', 'prod']);
  const realEnvFile = join(root, 'bin', 'js', 'env-config.js');
  check(
    'I-1: --env prod（默认 out）写出 bin/js/env-config.js（h5-site 的硬前置）',
    rI1d.status === 0 && existsSync(realEnvFile),
    `status=${rI1d.status} file=${existsSync(realEnvFile)}`,
  );

  // ── I-2 ────────────────────────────────────────────────────────────────
  const siteDir = join(tmpI, 'site');
  const rI2 = runNodeI(publishScript, ['h5-site', '--target', siteDir]);
  const siteRel = [
    'index.html',
    'js/boot/Main.js',
    'js/env-config.js',
    'js/player-config.js',
    'libs/laya.core.js',
    'libs/laya.webgl_2D.js',
    'libs/laya.ui2.js',
    'vendor/socket.io.min.js',
    'assets/resources/placeholder.png',
    'assets/Scene.ls',
    'gamedata/manifest.json',
    'gamedata/scene-1-v1.json',
  ];
  const missingSite = siteRel.filter((rel) => !existsSync(join(siteDir, rel)));
  check(
    'I-2: publish.mjs h5-site 退出码 0 且产物齐全（index/js/libs/vendor/assets/gamedata）',
    rI2.status === 0 && missingSite.length === 0,
    `status=${rI2.status} missing=${missingSite.join('、') || '无'} last=${JSON.stringify(lastLineI(rI2))}`,
  );
  check(
    'I-2: 结尾打印 summary: h5-site 装配 N 个文件到 <dir>',
    /^summary: h5-site 装配 \d+ 个文件到 /.test(lastLineI(rI2)),
    JSON.stringify(lastLineI(rI2)),
  );

  const siteHtml = readIfI(join(siteDir, 'index.html'));
  check(
    'I-2: index.html 的 /js/ /libs/ /vendor/ 全部带 /client/ 前缀，且无裸 src="/js/ 残留',
    siteHtml.includes('src="/client/js/boot/Main.js') &&
      siteHtml.includes('src="/client/js/player-config.js') &&
      siteHtml.includes('src="/client/libs/laya.core.js') &&
      siteHtml.includes('src="/client/vendor/socket.io.min.js') &&
      ['src="/js/', 'src="/libs/', 'src="/vendor/'].every((p) => !siteHtml.includes(p)),
    `main=${siteHtml.includes('src="/client/js/boot/Main.js')} residue=${['src="/js/', 'src="/libs/', 'src="/vendor/'].filter((p) => siteHtml.includes(p)).join('、') || '无'}`,
  );
  check(
    'I-2: env-config.js 的 script 标签在 Main.js 之前',
    siteHtml.indexOf('js/env-config.js') !== -1 &&
      siteHtml.indexOf('js/env-config.js') < siteHtml.indexOf('js/boot/Main.js'),
    `env@${siteHtml.indexOf('js/env-config.js')} main@${siteHtml.indexOf('js/boot/Main.js')}`,
  );
  check(
    'I-2: /assets/ 与 /gamedata 未被改写（保持同源根绝对路径）',
    !siteHtml.includes('/client/assets/') && !siteHtml.includes('/client/gamedata'),
    `assets=${siteHtml.includes('/client/assets/')} gamedata=${siteHtml.includes('/client/gamedata')}`,
  );

  const siteDirBase = join(tmpI, 'site-base');
  const rI2b = runNodeI(publishScript, ['h5-site', '--target', siteDirBase, '--base', 'client']);
  const htmlBase = readIfI(join(siteDirBase, 'index.html'));
  check(
    'I-2: --base client（缺前导与尾斜杠）归一化为 /client/，产物与默认一致',
    rI2b.status === 0 && htmlBase.length > 0 && htmlBase === siteHtml,
    `status=${rI2b.status} same=${htmlBase === siteHtml}`,
  );

  // ── I-3 幂等 ───────────────────────────────────────────────────────────
  const listingSite = () => {
    const out = [];
    const stack = [''];
    while (stack.length > 0) {
      const rel = stack.pop();
      for (const ent of readdirSync(join(siteDir, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) stack.push(r);
        else out.push(`${r}:${statSync(join(siteDir, r)).size}:${sha256FileI(join(siteDir, r))}`);
      }
    }
    return out.sort().join('\n');
  };
  const listingI3a = listingSite();
  const rI3 = runNodeI(publishScript, ['h5-site', '--target', siteDir]);
  const listingI3b = listingSite();
  check(
    'I-3: 连续两次 h5-site 到同一目标 → 文件清单 + 逐文件 sha256 完全一致（幂等）',
    rI3.status === 0 && listingI3a.length > 0 && listingI3a === listingI3b,
    `files=${listingI3a.split('\n').length} same=${listingI3a === listingI3b} status=${rI3.status}`,
  );

  // ── I-4 坏输入拦截 ─────────────────────────────────────────────────────
  // base=/ 时"/js/→/js/"是空改写，裸路径必然残留 → 自校验必须拦下，且不得产出 index.html。
  const badBaseDir = join(tmpI, 'site-badbase');
  const rI4 = runNodeI(publishScript, ['h5-site', '--target', badBaseDir, '--base', '/']);
  check(
    'I-4: --base / 归一化边界被自校验拒绝（exit 1、无 index.html、且装配前即失败）',
    rI4.status === 1 &&
      !existsSync(join(badBaseDir, 'index.html')) &&
      !existsSync(join(badBaseDir, 'js')) &&
      /自校验失败/.test(rI4.stderr || ''),
    `status=${rI4.status} html=${existsSync(join(badBaseDir, 'index.html'))} js=${existsSync(join(badBaseDir, 'js'))} err=${JSON.stringify((rI4.stderr || '').trim())}`,
  );

  const publishSrcI = readIfI(publishScript);
  check(
    'I-4: publish.mjs 源码含自校验关键字（裸路径残留 + env-config 顺序）—— 退化断言',
    publishSrcI.includes('BARE_PATH_RESIDUE') &&
      publishSrcI.includes('src="/js/') &&
      publishSrcI.includes('src="/libs/') &&
      publishSrcI.includes('src="/vendor/') &&
      publishSrcI.includes('env-config.js 的 script 标签必须在 Main.js 之前'),
    `residue=${publishSrcI.includes('BARE_PATH_RESIDUE')} order=${publishSrcI.includes('env-config.js 的 script 标签必须在 Main.js 之前')}`,
  );
  check(
    'I-4: publish.mjs 源码不含 ssh/scp/curl/npm run build（S7 风险 7：脚本只做本地文件操作）',
    !/\bssh\b|\bscp\b|\bcurl\b|npm run build/.test(publishSrcI),
    `ssh=${/\bssh\b/.test(publishSrcI)} scp=${/\bscp\b/.test(publishSrcI)}`,
  );
} finally {
  rmSync(tmpI, { recursive: true, force: true });
}

console.log(
  failed === 0
    ? `\nS7 平台层断言全部通过（共 ${total} 项）`
    : `\nS7 平台层断言失败 ${failed}/${total} 项`,
);
process.exit(failed === 0 ? 0 : 1);