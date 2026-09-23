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
  wxSocket: 'bin/js/platform/wx-socket.js',
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

console.log(
  failed === 0
    ? `\nS7 平台层断言全部通过（共 ${total} 项）`
    : `\nS7 平台层断言失败 ${failed}/${total} 项`,
);
process.exit(failed === 0 ? 0 : 1);