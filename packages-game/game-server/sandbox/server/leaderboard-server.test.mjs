/**
 * 排行榜后端 · 本地测试（零依赖，纯 Node http 驱动）
 * 启动真实 server 进程，走 HTTP 验证提交 / 拉取 / 排名 / 范围过滤 / 错误与 CORS。
 *
 * 运行：node server/leaderboard-server.test.mjs
 * 或：  npm run test:server
 *
 * 该测试不依赖浏览器与构建产物，单测后端逻辑，定位问题比 page:check 更快。
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MAIN_PORT = 8791;
const RO_PORT = 8792;
const MAIN_DATA = path.join(__dirname, '.test-lb-main.json');
const RO_DATA = path.join(__dirname, '.test-lb-ro.json');

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

function request(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      { host: 'localhost', port, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try { json = buf ? JSON.parse(buf) : null; } catch { /* 非 JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, json });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function waitHealth(port, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: 'localhost', port, path: '/healthz' }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('server timeout'));
        else setTimeout(tick, 150);
      });
    };
    tick();
  });
}

function cleanup() {
  for (const f of [MAIN_DATA, RO_DATA]) {
    try { fs.rmSync(f); } catch { /* 忽略 */ }
  }
}

async function main() {
  cleanup();
  console.log('排行榜后端本地测试');
  console.log('[1] 启动服务');
  const mainSrv = spawn(process.execPath, ['server/leaderboard-server.mjs'], {
    cwd: ROOT, env: { ...process.env, PORT: String(MAIN_PORT), DATA_FILE: MAIN_DATA }, stdio: 'ignore',
  });
  const roSrv = spawn(process.execPath, ['server/leaderboard-server.mjs'], {
    cwd: ROOT, env: { ...process.env, PORT: String(RO_PORT), DATA_FILE: RO_DATA, READONLY: '1' }, stdio: 'ignore',
  });
  try {
    await waitHealth(MAIN_PORT);
    await waitHealth(RO_PORT);
  } catch (e) {
    console.error('服务启动失败：', e);
    mainSrv.kill(); roSrv.kill(); cleanup(); process.exit(1);
  }

  try {
    // [2] 健康检查 + 首次写入示例数据
    const h = await request(MAIN_PORT, 'GET', '/healthz');
    check('健康检查 ok', h.status === 200 && h.json?.ok === true);
    check('首次启动写入示例数据（≥6 条）', (h.json?.entries ?? 0) >= 6, `entries=${h.json?.entries}`);

    // [3] CORS 头
    const cors = await request(MAIN_PORT, 'GET', '/api/sandbox/v1/leaderboard');
    check('CORS 头 Access-Control-Allow-Origin=*', cors.headers['access-control-allow-origin'] === '*');
    check('GET 榜单结构正确', cors.json?.ok === true && Array.isArray(cors.json.entries) && cors.json.total >= 6,
      `total=${cors.json?.total}`);

    // [4] 提交一局高分（全量第一）
    const post = await request(MAIN_PORT, 'POST', '/api/sandbox/v1/leaderboard', {
      name: '  本地测试员  ', seed: 42, level: 'aggressive', scenario: 'standard',
      returnRate: 0.5, maxDrawdown: 0.03, rating: 'A', missions: 7, total: 7, days: 60,
    });
    check('提交成功返回条目', post.status === 200 && post.json?.ok === true && !!post.json.entry?.id);
    check('昵称被裁剪空白', post.json.entry?.name === '本地测试员', post.json.entry?.name);
    check('高分提交全量排名第一', post.json?.rank === 1, `rank=${post.json?.rank}`);

    // [5] 全量榜单：首条即我，且按收益率降序
    const all = await request(MAIN_PORT, 'GET', '/api/sandbox/v1/leaderboard?scope=all&limit=50');
    check('榜单首条是刚提交的高分', all.json.entries[0].name === '本地测试员' && all.json.entries[0].returnRate === 0.5);
    const sortedOk = all.json.entries.every((e, i, a) => i === 0 || a[i - 1].returnRate >= e.returnRate);
    check('榜单按收益率降序', sortedOk);

    // [6] 同收益、更小回撤应排更前
    const post2 = await request(MAIN_PORT, 'POST', '/api/sandbox/v1/leaderboard', {
      name: '低回撤同学', seed: 42, level: 'aggressive', scenario: 'standard',
      returnRate: 0.5, maxDrawdown: 0.01, rating: 'A', missions: 7, total: 7, days: 60,
    });
    check('同收益更小回撤提交全量第一', post2.json?.rank === 1, `rank=${post2.json?.rank}`);
    const all2 = await request(MAIN_PORT, 'GET', '/api/sandbox/v1/leaderboard?scope=all&limit=50');
    check('低回撤同学排在本地测试员之前', all2.json.entries.findIndex(e => e.name === '低回撤同学') < all2.json.entries.findIndex(e => e.name === '本地测试员'));

    // [7] 范围过滤：scenario=standard 只含该情景
    const bySc = await request(MAIN_PORT, 'GET', '/api/sandbox/v1/leaderboard?scope=scenario&scenario=standard');
    check('按情景过滤只含 standard', bySc.json.ok && bySc.json.entries.every(e => e.scenario === 'standard'),
      `total=${bySc.json.total}`);
    check('standard 含我提交的成绩', bySc.json.entries.some(e => e.name === '本地测试员'));

    // [8] 按难度过滤
    const byLv = await request(MAIN_PORT, 'GET', '/api/sandbox/v1/leaderboard?scope=level&level=aggressive');
    check('按难度过滤只含 aggressive', byLv.json.ok && byLv.json.entries.every(e => e.level === 'aggressive'),
      `total=${byLv.json.total}`);

    // [9] 我的排名：相同成绩视为并列（不被同分旧成绩挤到后面）
    // 先以唯一高分 0.66 提交，再以完全相同成绩查询排名（应并列第 1）
    const post3 = await request(MAIN_PORT, 'POST', '/api/sandbox/v1/leaderboard', {
      name: '唯一分同学', seed: 42, level: 'balanced', scenario: 'recent',
      returnRate: 0.66, maxDrawdown: 0.02, rating: 'B', missions: 5, total: 7, days: 60,
    });
    check('唯一高分提交成功', post3.json?.ok === true && post3.json?.rank === 1, `rank=${post3.json?.rank}`);
    const meSame = await request(MAIN_PORT, 'GET', '/api/sandbox/v1/leaderboard/me?scope=all&returnRate=0.66&maxDrawdown=0.02&rating=B');
    check('我的排名接口：同分返回第 1 名', meSame.json?.ok && meSame.json.rank === 1, `rank=${meSame.json?.rank}`);
    const meHigher = await request(MAIN_PORT, 'GET', '/api/sandbox/v1/leaderboard/me?scope=all&returnRate=0.9&maxDrawdown=0.0&rating=A');
    check('更高分排名仍为第 1', meHigher.json?.ok && meHigher.json.rank === 1, `rank=${meHigher.json?.rank}`);
    const meLow = await request(MAIN_PORT, 'GET', '/api/sandbox/v1/leaderboard/me?scope=all&returnRate=0.01&maxDrawdown=0.0&rating=D');
    check('低分排名靠后（>1）', meLow.json?.ok && meLow.json.rank > 1, `rank=${meLow.json?.rank}`);

    // [10] 非法 JSON → 400
    const bad = await request(MAIN_PORT, 'POST', '/api/sandbox/v1/leaderboard', undefined);
    // 直接发一段非法 body
    const badRaw = await new Promise((resolve) => {
      const req = http.request({ host: 'localhost', port: MAIN_PORT, path: '/api/sandbox/v1/leaderboard', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
        let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
      });
      req.write('{ not json'); req.end();
    });
    check('非法 JSON 返回 400', badRaw.status === 400 && JSON.parse(badRaw.body).ok === false, `status=${badRaw.status}`);

    // [11] 只读模式：POST 被拒
    const ro = await request(RO_PORT, 'POST', '/api/sandbox/v1/leaderboard', { name: 'x', returnRate: 0.1 });
    check('只读模式拒绝提交（403）', ro.status === 403 && ro.json?.ok === false, `status=${ro.status}`);

    // [12] 未知路径 → 404
    const nf = await request(MAIN_PORT, 'GET', '/api/sandbox/v1/nope');
    check('未知路径返回 404', nf.status === 404 && nf.json?.ok === false);

    // [13] 行情数据接口（与前端 MarketDataItem 同形，分页）
    const md = await request(MAIN_PORT, 'GET', '/api/sandbox/v1/market-data?page=1&pageSize=3');
    check('行情接口分页结构正确', md.status === 200 && Array.isArray(md.json?.items) && md.json.items.length === 3 && md.json.total > 0,
      `total=${md.json?.total}`);
    const f = md.json.items[0];
    check('行情条目字段完整',
      typeof f?.date === 'string' && typeof f.fundNav === 'number' && typeof f.cashMgmtRate === 'number'
      && typeof f.closedFundNav === 'number' && typeof f.isTradingDay === 'boolean' && Array.isArray(f.suspendedSlices),
      f ? f.date : 'null');
    const md2 = await request(MAIN_PORT, 'GET', '/api/sandbox/v1/market-data?page=2&pageSize=3');
    check('分页第二页数据不同', md2.json.items[0]?.date !== f.date, `${md2.json.items[0]?.date} vs ${f.date}`);
    const mdAll = await request(MAIN_PORT, 'GET', '/api/sandbox/v1/market-data?page=1&pageSize=200');
    check('全量行情总数覆盖约 4.5 年', mdAll.json.total > 1600 && mdAll.json.items[0].date.startsWith('2022'),
      `total=${mdAll.json.total}, first=${mdAll.json.items[0].date}`);
    const lastPage = Math.ceil(mdAll.json.total / 200);
    const mdLast = await request(MAIN_PORT, 'GET', `/api/sandbox/v1/market-data?page=${lastPage}&pageSize=200`);
    const lastItem = mdLast.json.items[mdLast.json.items.length - 1];
    check('行情末日落在 2026', lastItem.date.startsWith('2026'), lastItem.date);

    console.log(`\n本地测试结果：${pass} 通过 / ${fail} 失败`);
  } finally {
    try { mainSrv.kill(); } catch { /* 忽略 */ }
    try { roSrv.kill(); } catch { /* 忽略 */ }
    cleanup();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); cleanup(); process.exit(1); });
