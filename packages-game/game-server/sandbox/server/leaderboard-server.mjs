/**
 * 财商沙盘 · 排行榜后端（零依赖，仅用 Node 内置 http / fs）
 * 提供 /api/sandbox/v1/leaderboard 的提交 / 拉取 / 排名接口，JSON 文件持久化。
 *
 * 启动：node server/leaderboard-server.mjs  （或 npm run server）
 * 环境变量：
 *   PORT      监听端口（默认 8787）
 *   DATA_FILE 数据文件路径（默认 server/data/leaderboard.json）
 *
 * 接口：
 *   POST /api/sandbox/v1/leaderboard        提交一局成绩，返回 { ok, entry, rank }
 *   GET  /api/sandbox/v1/leaderboard        拉取榜单：?scope=all|scenario|level&scenario=&level=&limit=
 *   GET  /api/sandbox/v1/leaderboard/me     计算某成绩在指定范围的排名：?scope=&scenario=&level=&returnRate=
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'leaderboard.json');
const MAX_ENTRIES = 2000;
const READONLY = process.env.READONLY === '1';

const RATING_RANK = { A: 4, B: 3, C: 2, D: 1 };
const LEVELS = ['conservative', 'balanced', 'aggressive'];

const SAMPLE_NAMES = ['稳健小张', '定投老王', '分散配置喵', '风控小美', '长期持有君', '低买高卖侠'];

// ---- 行情数据（与前端 MarketDataLoader 同算法 / 同种子，便于复现）----
function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function buildHolidays() {
  const holidays = new Set();
  const addRange = (year, month, day, days) => {
    for (let i = 0; i < days; i++) {
      const d = new Date(year, month - 1, day + i);
      holidays.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
  };
  for (let y = 2022; y <= 2026; y++) {
    addRange(y, 1, 1, 3);
    addRange(y, 2, 1, 7);
    addRange(y, 5, 1, 3);
    addRange(y, 10, 1, 7);
  }
  return holidays;
}
function generateMarketData(seed) {
  const rng = createRng(seed);
  const holidays = buildHolidays();
  const start = new Date('2022-01-01');
  const end = new Date('2026-07-01');
  const data = [];
  let fundNav = 1.0;
  let closedFundNav = 1.0;
  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const cur = new Date(start);
  while (cur <= end) {
    const dateStr = fmt(cur);
    const dow = cur.getDay();
    const isTradingDay = dow !== 0 && dow !== 6 && !holidays.has(dateStr);
    const fundChange = isTradingDay ? (rng() - 0.48) * 0.04 : 0;
    const closedChange = isTradingDay ? (rng() - 0.45) * 0.02 : 0;
    if (isTradingDay) {
      fundNav = Math.max(0.5, fundNav * (1 + fundChange));
      closedFundNav = Math.max(0.8, closedFundNav * (1 + closedChange));
    }
    const cashMgmtRate = 0.025 + (rng() - 0.5) * 0.01;
    const suspendedSlices = [];
    if (isTradingDay && rng() < 0.05) suspendedSlices.push(Math.floor(rng() * 52));
    data.push({
      date: dateStr,
      fundNav: Math.round(fundNav * 10000) / 10000,
      cashMgmtRate: Math.round(cashMgmtRate * 10000) / 10000,
      closedFundNav: Math.round(closedFundNav * 10000) / 10000,
      isTradingDay,
      suspendedSlices,
    });
    cur.setDate(cur.getDate() + 1);
  }
  return data;
}
const MARKET_SEED = 20260101;
const marketCache = generateMarketData(MARKET_SEED);

/** 读写持久化存储（首次运行写入示例数据，便于演示） */
function ensureStore() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const seeded = seedSamples();
    writeFile(seeded);
    return seeded;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFile(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data));
  } catch (e) {
    console.error('[lb] 持久化失败：', e);
  }
}

/** 示例数据：同一份行情（种子固定）下不同同学的演练成绩 */
function seedSamples() {
  const base = Date.now() - 1000 * 60 * 60 * 24 * 7;
  const rows = [
    { name: SAMPLE_NAMES[0], level: 'balanced', scenario: 'standard', returnRate: 0.137, maxDrawdown: 0.042, rating: 'A', missions: 7, total: 7, days: 60 },
    { name: SAMPLE_NAMES[1], level: 'balanced', scenario: 'standard', returnRate: 0.098, maxDrawdown: 0.061, rating: 'B', missions: 6, total: 7, days: 60 },
    { name: SAMPLE_NAMES[2], level: 'conservative', scenario: 'recent', returnRate: 0.081, maxDrawdown: 0.028, rating: 'B', missions: 5, total: 7, days: 60 },
    { name: SAMPLE_NAMES[3], level: 'aggressive', scenario: 'mid', returnRate: 0.176, maxDrawdown: 0.102, rating: 'A', missions: 6, total: 7, days: 60 },
    { name: SAMPLE_NAMES[4], level: 'long', scenario: 'long', returnRate: 0.121, maxDrawdown: 0.073, rating: 'B', missions: 7, total: 7, days: 120 },
    { name: SAMPLE_NAMES[5], level: 'aggressive', scenario: 'standard', returnRate: 0.064, maxDrawdown: 0.118, rating: 'C', missions: 4, total: 7, days: 60 },
  ];
  return rows.map((r, i) => normalize({
    ...r,
    id: `seed-${i}`,
    seed: 20260101,
    createdAt: base + i * 1000,
  }));
}

/** 校验并归一化一条成绩（非法值钳制/丢弃） */
function normalize(raw) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const level = LEVELS.includes(raw.level) ? raw.level : 'balanced';
  const scenario = typeof raw.scenario === 'string' && raw.scenario ? raw.scenario : 'standard';
  const rating = typeof raw.rating === 'string' && /^[A-D]$/.test(raw.rating) ? raw.rating : '—';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 16) : '匿名同学',
    seed: Math.floor(num(raw.seed)),
    level,
    scenario,
    returnRate: num(raw.returnRate),
    maxDrawdown: Math.abs(num(raw.maxDrawdown)),
    rating,
    missions: Math.floor(num(raw.missions)),
    total: Math.max(1, Math.floor(num(raw.total))),
    days: Math.floor(num(raw.days)),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
}

/** 排序：收益率降序 → 回撤升序（越小越好）→ 评级降序 → 提交时间升序 */
function sortEntries(list) {
  return [...list].sort((a, b) => {
    if (b.returnRate !== a.returnRate) return b.returnRate - a.returnRate;
    if (a.maxDrawdown !== b.maxDrawdown) return a.maxDrawdown - b.maxDrawdown;
    const ra = RATING_RANK[b.rating] || 0;
    const rb = RATING_RANK[a.rating] || 0;
    if (ra !== rb) return ra - rb;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

/** 在给定范围内，严格优于给定成绩的数量 + 1 = 排名 */
function rankInScope(list, scope, q, entry) {
  const filtered = list.filter((e) => inScope(e, scope, q));
  const better = filtered.filter((e) => isBetter(e, entry)).length;
  return better + 1;
}

function inScope(entry, scope, q) {
  if (scope === 'scenario') return entry.scenario === q.scenario;
  if (scope === 'level') return entry.level === q.level;
  return true;
}

/** a 是否严格优于 b */
function isBetter(a, b) {
  if (a.returnRate !== b.returnRate) return a.returnRate > b.returnRate;
  if (a.maxDrawdown !== b.maxDrawdown) return a.maxDrawdown < b.maxDrawdown;
  const ra = RATING_RANK[a.rating] || 0;
  const rb = RATING_RANK[b.rating] || 0;
  if (ra !== rb) return ra > rb;
  return (a.createdAt || 0) < (b.createdAt || 0);
}

let store = ensureStore();

function send(res, status, body, cors = true) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (cors) {
    headers['Access-Control-Allow-Origin'] = '*';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 1e5) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => (tooBig ? reject(new Error('payload too large')) : resolve(data)));
    req.on('error', reject);
  });
}

function parseQuery(url) {
  const q = Object.fromEntries(new URL(url, 'http://x').searchParams.entries());
  const scope = q.scope === 'scenario' || q.scope === 'level' ? q.scope : 'all';
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
  return { scope, scenario: q.scenario || '', level: q.level || '', limit };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url || '/';
    const pathname = url.split('?')[0];

    if (req.method === 'OPTIONS') {
      send(res, 204, '');
      return;
    }

    // 健康检查
    if (pathname === '/healthz') {
      send(res, 200, { ok: true, entries: store.length });
      return;
    }

    // 市场历史数据（与前端 MarketDataItem 同形；分页返回，便于前端逐页拉取）
    if (pathname === '/api/sandbox/v1/market-data' && req.method === 'GET') {
      const sp = new URL(url, 'http://x').searchParams;
      const page = Math.max(1, Number(sp.get('page')) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(sp.get('pageSize')) || 30));
      const startIdx = (page - 1) * pageSize;
      const items = marketCache.slice(startIdx, startIdx + pageSize);
      send(res, 200, { items, total: marketCache.length, page, pageSize });
      return;
    }

    if (pathname === '/api/sandbox/v1/leaderboard' && req.method === 'GET') {
      const q = parseQuery(url);
      const filtered = store.filter((e) => inScope(e, q.scope, q));
      const sorted = sortEntries(filtered).slice(0, q.limit);
      send(res, 200, { ok: true, scope: q.scope, total: filtered.length, entries: sorted });
      return;
    }

    if (pathname === '/api/sandbox/v1/leaderboard/me' && req.method === 'GET') {
      const q = parseQuery(url);
      const sp = new URL(url, 'http://x').searchParams;
      const probe = {
        returnRate: Number(sp.get('returnRate')) || 0,
        maxDrawdown: Math.abs(Number(sp.get('maxDrawdown')) || 0),
        rating: (sp.get('rating') || '—'),
      };
      const filtered = store.filter((e) => inScope(e, q.scope, q));
      // 严格领先才计入（收益率/回撤/评级逐项比较），完全相同的成绩视为并列，
      // 使得「我」的排名不会被自己刚提交的同分成绩挤到后面。
      const isAhead = (a, b) => {
        if (a.returnRate !== b.returnRate) return a.returnRate > b.returnRate;
        if (a.maxDrawdown !== b.maxDrawdown) return a.maxDrawdown < b.maxDrawdown;
        const ra = RATING_RANK[a.rating] || 0;
        const rb = RATING_RANK[b.rating] || 0;
        if (ra !== rb) return ra > rb;
        return false;
      };
      const better = filtered.filter((e) => isAhead(e, probe)).length;
      send(res, 200, { ok: true, scope: q.scope, rank: better + 1, total: filtered.length });
      return;
    }

    if (pathname === '/api/sandbox/v1/leaderboard' && req.method === 'POST') {
      if (READONLY) {
        send(res, 403, { ok: false, error: 'readonly' });
        return;
      }
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        send(res, 400, { ok: false, error: 'invalid json' });
        return;
      }
      const entry = normalize(body);
      store.push(entry);
      store = sortEntries(store).slice(0, MAX_ENTRIES);
      writeFile(store);
      const q = { scenario: entry.scenario, level: entry.level };
      const rank = rankInScope(store, 'all', q, entry);
      send(res, 200, { ok: true, entry, rank });
      return;
    }

    send(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error('[lb] 处理出错：', e);
    send(res, 500, { ok: false, error: 'internal' });
  }
});

server.listen(PORT, () => {
  console.log(`[lb] 排行榜服务已启动：http://localhost:${PORT}  (数据：${DATA_FILE})`);
});
