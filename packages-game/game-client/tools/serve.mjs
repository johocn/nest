// 零依赖静态服务器：把「源码资源 / IDE 引擎库 / vendored 三方库」映射到统一 URL 空间，并把 /gamedata 反向代理到后端
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const IDE = process.env.LAYA_IDE_DIR || 'D:\\Program Files\\LayaAirIDE';
const PORT = Number(process.env.S1_PORT || 5173);
const BACKEND = process.env.S1_BACKEND || 'http://localhost:3000';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

const ROUTES = [
  ['/assets/', join(root, 'assets')],
  ['/vendor/', join(root, 'vendor')],
  ['/libs/', join(IDE, 'resources', 'engine', 'libs')],
  ['/js/', join(root, 'bin', 'js')],
  ['/', join(root, 'bin')],
];

function resolveFile(urlPath) {
  const path = decodeURIComponent(urlPath.split('?')[0]);
  for (const [prefix, base] of ROUTES) {
    if (prefix === '/' ? true : path.startsWith(prefix)) {
      const rel = prefix === '/' ? path.slice(1) : path.slice(prefix.length);
      let full = normalize(join(base, rel));
      if (!full.startsWith(normalize(base) + sep) && full !== normalize(base)) return null;
      // 目录请求回退到 index.html（否则 GET / 会 404）
      if (existsSync(full) && statSync(full).isDirectory()) full = join(full, 'index.html');
      if (existsSync(full) && statSync(full).isFile()) return full;
      return null;
    }
  }
  return null;
}

// /gamedata/* 反向代理到后端：客户端与配置包同源，规避静态响应不带 CORS 头的问题
function proxyGamedata(req, res) {
  const target = new URL(req.url ?? '/gamedata', BACKEND);
  const headers = { ...req.headers, host: target.host };
  const upstream = httpRequest(target, { method: req.method, headers }, (up) => {
    const outHeaders = { ...up.headers };
    // 逐跳首部不转发（由本机连接自行决定）
    delete outHeaders.connection;
    delete outHeaders['keep-alive'];
    delete outHeaders['transfer-encoding'];
    res.writeHead(up.statusCode ?? 502, outHeaders);
    up.pipe(res);
    console.log(`${up.statusCode} ${req.url} (proxy)`);
  });
  upstream.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`502 代理后端失败（${BACKEND}）：${e.message}`);
    console.log(`502 ${req.url} (proxy) ${e.message}`);
  });
  req.pipe(upstream);
}

createServer((req, res) => {
  if ((req.url ?? '').startsWith('/gamedata/')) {
    proxyGamedata(req, res);
    return;
  }
  const file = resolveFile(req.url ?? '/');
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 ${req.url}`);
    console.log(`404 ${req.url}`);
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
  console.log(`200 ${req.url}`);
}).listen(PORT, () => {
  console.log(`S1 static server: http://localhost:${PORT}/`);
  console.log(`libs 来源: ${join(IDE, 'resources', 'engine', 'libs')}`);
  console.log(`/gamedata 代理到: ${BACKEND}`);
  console.log('提示：请确保后端已在 3000 端口运行（配置包与接口均依赖它）');
});