// S6 建造冒烟：HTTP 全链路（规则读取 → forbidden 拒绝 → solo 扣料落成 → 上限/占位拒绝 →
//             coop 投料未达标 → coop 达标落成 → coop 超时 → 拆除后地块复用）
// 用法：node scripts/smoke-building-s6.mjs        （需先启动 mock-redis 与 game-server；本地 DB 已 synchronize 出 5 张建造表）
// 环境变量：SMOKE_API（默认 http://localhost:3000）、ADMIN_USERNAME / ADMIN_PASSWORD（默认 admin/admin123）
//           SMOKE_PSQL（默认 E:\PostgreSQL\16\bin\psql.exe，仅 ⑬ 组用于本地测试注入 finish_at / 只读校验；缺失则 ⑬ 组 SKIP）
//
// 设计约定（见计划 §2 Task 8 与父任务裁定）：
//   1) 断言一律走 HTTP，不直连 DB；无人格余额查库。
//   2) 测试数据自建、幂等：本脚本用 admin 接口创建 4 个 s6smoke-* 测试场景与 2 个 s6smoke-* 测试蓝图
//      （蓝图按名字判重，结束置 isActive=false），规则行 upsert 到场景（保留）。
//      账号每次运行全新注册（s6smokeXXXX），绕开历史数据残留。
//   3) 场景规则一场景一行（scene_build_rules.scene_id UNIQUE），故 solo / 上限 / coop / 超时 / 无规则(禁建)
//      各用独立场景；solo 主流程复用已有的场景 1（新手村（Spike）），与生产验收一致。
//   4) 成本统一用货币 gold（admin 接口发币），便于断言「扣币差额」，不依赖背包初始道具。
//   5) 定时器 BuildingScheduler.reconcile() 为 @Cron(EVERY_MINUTE)：落成与超时退款同一 tick，
//      故「结算后 built」「超时退款」类断言最多轮询 ~75s（脚本内轮询，不盲目固定 sleep）。
//
// 已知偏差（详见运行报告）：`coop_expire_hours=0` 时实例创建即「已超时」，而 contribute 对已超时实例
//   直接拒绝（COOP_EXPIRED 44006，有 Task 4 单测佐证），因此无法经 HTTP 在超时实例上投料；
//   断言 ⑨ 以「投料被拒 44006 + 实例被调度器移除 + 地块释放」作为超时路径证据。
//   ⑬ 组补足退款端到端缺口：用 s6smoke-共建（expire 24h）造「已投料未达标」实例，再经**本地 psql**
//   仅把 finish_at 回拨到过去（测试专用注入，非 HTTP），令调度器 refundExpiredCoop 真实退款路径执行，
//   端到端验证「按流水原路全额退款 + 不重复退 + 流水全 refunded + 地块释放可重建」。
//   ⚠️ 安全护栏：⑬ 组的 psql 写操作仅在 SMOKE_API 指向 localhost/127.0.0.1 时执行；指向任何非本地
//   主机（如 game.joho.cn）将直接报错退出，禁止对生产执行 psql UPDATE；本地 psql 不可用时 ⑬ 组整体
//   SKIP（不计 FAIL），末行如实打印 SKIP 原因。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const API = (process.env.SMOKE_API || 'http://localhost:3000').replace(/\/+$/, '');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const RUN = Date.now().toString(36).slice(-6);
const USER_A = {
  username: `s6smoke${RUN}a`,
  password: 'smoke123456',
  nickname: `s6smoke${RUN}a`,
  deviceId: `smoke-s6-${RUN}-a`,
};
const USER_B = {
  username: `s6smoke${RUN}b`,
  password: 'smoke123456',
  nickname: `s6smoke${RUN}b`,
  deviceId: `smoke-s6-${RUN}-b`,
};

/** 已有场景：solo 主流程用（计划 Task 8：solo 规则配到已有场景） */
const SCENE_SOLO = process.env.SMOKE_SCENE_SOLO || '1';
/** 本脚本自建的测试场景名（按名字判重） */
const SCENE_NAMES = {
  forbid: 's6smoke-禁建',
  limit: 's6smoke-上限',
  coop: 's6smoke-共建',
  expire: 's6smoke-超时',
};
/** 本脚本自建的测试蓝图（按名字判重；结束置停用） */
const TPL = {
  solo: {
    name: 's6smoke-木屋',
    resKey: 'building/s6smoke_hut',
    category: 'house',
    footprintW: 1,
    footprintH: 1,
    buildCost: [{ currencyType: 'gold', amount: 10 }],
    buildSeconds: 1,
    durability: 100,
    effect: {},
    isActive: true,
  },
  coop: {
    name: 's6smoke-议事厅',
    resKey: 'building/s6smoke_hall',
    category: 'public',
    footprintW: 1,
    footprintH: 1,
    buildCost: [{ currencyType: 'gold', amount: 10 }],
    buildSeconds: 1,
    durability: 100,
    effect: {},
    isActive: true,
  },
};

/** 每格边长（像素）与场景尺寸：1280×960 → 20×15 格（与服务端 floor(mapWidth/gridSize) 口径一致） */
const GRID = 64;
const MAP_W = 1280;
const MAP_H = 960;
const COST_GOLD = 10;
const GIVE_GOLD = 100;
/** 定时器每分钟一 tick：单次结算类断言最长等待（毫秒） */
const SETTLE_WAIT_MS = 75_000;
const POLL_INTERVAL_MS = 3_000;

/** ⑬ 组测试专用：本地 psql 二进制与本机 DB 连接（与 .env 一致；仅测试注入/只读，禁止指向生产） */
const PSQL_BIN = process.env.SMOKE_PSQL || 'E:\\PostgreSQL\\16\\bin\\psql.exe';
const LOCAL_DB = { host: '127.0.0.1', port: '5432', user: 'postgres', password: 'postgres', database: 'game_server' };

let failed = 0;
let skipped = 0;
let skipReason = '';
const ctx = { adminToken: null, sceneIds: {}, tplIds: {}, created: [] };

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` :: ${extra}` : ''}`);
  if (!cond) failed++;
}

function skip(name, reason) {
  console.log(`SKIP ${name} :: SKIP 原因：${reason}`);
  skipped++;
  skipReason = reason;
}

/** 安全护栏：仅允许对本地 API 执行 ⑬ 组 psql 写操作，禁止误指生产（game.joho.cn 等） */
function assertLocalApi() {
  let host;
  try {
    host = new URL(API).hostname;
  } catch {
    throw new Error(`安全护栏：SMOKE_API 非法（${API}）`);
  }
  const LOCAL = new Set(['localhost', '127.0.0.1', '::1']);
  if (!LOCAL.has(host)) {
    throw new Error(
      `安全护栏：SMOKE_API 指向非本地主机（${host}），禁止对生产执行 psql UPDATE。仅允许 localhost/127.0.0.1。`,
    );
  }
}

let _psqlAvailable = null;
function psqlAvailable() {
  if (_psqlAvailable === null) _psqlAvailable = existsSync(PSQL_BIN);
  return _psqlAvailable;
}

/** 执行 psql（默认 -t -A），返回 trim 后的文本；失败（含 ON_ERROR_STOP）抛异常 */
function psqlExec(sql) {
  return execFileSync(
    PSQL_BIN,
    ['-h', LOCAL_DB.host, '-p', LOCAL_DB.port, '-U', LOCAL_DB.user, '-d', LOCAL_DB.database, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql],
    { env: { ...process.env, PGPASSWORD: LOCAL_DB.password }, encoding: 'utf8' },
  ).trim();
}

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
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { code: -1, msg: `非 JSON 响应: ${text.slice(0, 80)}` };
  }
  return { status: res.status, payload };
}

// deviceId 必须传（DTO 无 @IsOptional）；login 不能带 nickname（forbidNonWhitelisted）
async function auth(user) {
  const cred = { username: user.username, password: user.password, deviceId: user.deviceId };
  const login = await call('POST', '/api/client/v1/auth/login', { body: cred });
  if (login.payload?.code === 0) return login.payload.data;
  const reg = await call('POST', '/api/client/v1/auth/register', { body: user });
  if (reg.payload?.code !== 0) throw new Error(`注册失败：${JSON.stringify(reg.payload)}`);
  return reg.payload.data;
}

/** 玩家 gold 余额（GET player/base-info 返回 { player, currencies }） */
async function goldOf(token) {
  const res = await call('GET', '/api/client/v1/player/base-info', { token });
  if (res.payload?.code !== 0) {
    throw new Error(`余额查询失败：${JSON.stringify(res.payload)}`);
  }
  const row = (res.payload.data?.currencies ?? []).find((c) => c.currencyType === 'gold');
  return Number(row?.amount ?? 0);
}

async function grantGold(adminToken, playerId, amount, reason) {
  const res = await call('PUT', `/api/admin/v1/player/${playerId}/currency`, {
    token: adminToken,
    body: { operation: 'add', currencyType: 'gold', amount, reason },
  });
  if (res.payload?.code !== 0) {
    throw new Error(`发币失败：${JSON.stringify(res.payload)}`);
  }
}

/** 轮询直到 predicate 命中或超时；返回 { ok, value, waitedMs, polls } */
async function poll(fn, predicate, timeoutMs = SETTLE_WAIT_MS, intervalMs = POLL_INTERVAL_MS) {
  const started = Date.now();
  let polls = 0;
  let value;
  for (;;) {
    value = await fn();
    polls++;
    if (predicate(value)) return { ok: true, value, waitedMs: Date.now() - started, polls };
    if (Date.now() - started >= timeoutMs) {
      return { ok: false, value, waitedMs: Date.now() - started, polls };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== 测试数据准备（幂等）=====

async function ensureScene(adminToken, name) {
  const list = await call('GET', '/api/admin/v1/world/scene/list?limit=100', { token: adminToken });
  const found = (list.payload?.data?.items ?? []).find((s) => s.name === name);
  if (found) return { id: String(found.id), created: false };
  const res = await call('POST', '/api/admin/v1/world/scene', {
    token: adminToken,
    body: {
      name,
      sceneType: 'town',
      mapResKey: 'map/s6smoke',
      mapWidth: MAP_W,
      mapHeight: MAP_H,
      status: 'open',
    },
  });
  if (res.payload?.code !== 0) {
    throw new Error(`创建测试场景「${name}」失败：${JSON.stringify(res.payload)}`);
  }
  return { id: String(res.payload.data.id), created: true };
}

async function ensureTemplate(adminToken, spec) {
  const list = await call('GET', '/api/admin/v1/world/building-templates', { token: adminToken });
  const found = (list.payload?.data ?? []).find((t) => t.name === spec.name);
  if (found) {
    // 复用同一行（可能上次跑完被停用）→ 重新启用并回写最新字段，保证幂等一致
    const upd = await call('PUT', `/api/admin/v1/world/building-templates/${found.id}`, {
      token: adminToken,
      body: spec,
    });
    if (upd.payload?.code !== 0) {
      throw new Error(`更新测试蓝图「${spec.name}」失败：${JSON.stringify(upd.payload)}`);
    }
    return { id: String(found.id), created: false };
  }
  const res = await call('POST', '/api/admin/v1/world/building-templates', {
    token: adminToken,
    body: spec,
  });
  if (res.payload?.code !== 0) {
    throw new Error(`创建测试蓝图「${spec.name}」失败：${JSON.stringify(res.payload)}`);
  }
  return { id: String(res.payload.data.id), created: true };
}

async function upsertRule(adminToken, sceneId, body) {
  const res = await call('PUT', `/api/admin/v1/world/scenes/${sceneId}/build-rule`, {
    token: adminToken,
    body,
  });
  if (res.payload?.code !== 0) {
    throw new Error(`upsert 规则失败 scene=${sceneId}：${JSON.stringify(res.payload)}`);
  }
  return res.payload.data;
}

// ===== HTTP 快捷方法 =====

const getRule = (token, sceneId) =>
  call('GET', `/api/client/v1/world/scenes/${sceneId}/build-rule`, { token });
const listBuildings = (token, sceneId, ownerId) =>
  call(
    'GET',
    `/api/client/v1/world/scenes/${sceneId}/buildings${ownerId ? `?ownerId=${ownerId}` : ''}`,
    { token },
  );
const createBuilding = (token, body) =>
  call('POST', '/api/client/v1/world/buildings', { token, body });
const contribute = (token, id, items) =>
  call('POST', `/api/client/v1/world/buildings/${id}/contribute`, { token, body: { items } });
const demolish = (token, id) =>
  call('POST', `/api/client/v1/world/buildings/${id}/demolish`, { token });

/** 查某建筑当前 state（从列表里找；找不到返回 null） */
async function stateOf(token, sceneId, buildingId, ownerId) {
  const res = await listBuildings(token, sceneId, ownerId);
  const row = (res.payload?.data ?? []).find((b) => String(b.id) === String(buildingId));
  return row ? row.state : null;
}

// ===== 主流程 =====

async function main() {
  // 安全护栏：⑬ 组会执行本地 psql 写操作（finish_at 回拨），非本地 API 直接报错退出
  assertLocalApi();

  const health = await call('GET', '/health').catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error('后端未启动，请先运行 mock-redis 与 npm run start:dev');
  }
  console.log(`  后端 /health 可达（${API}）`);

  // ── 0. admin 登录 + 场景/蓝图/规则准备 + 发币 ──
  const adminLogin = await call('POST', '/api/admin/v1/login', {
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  ctx.adminToken = adminLogin.payload?.data?.token ?? null;
  if (adminLogin.payload?.code !== 0 || !ctx.adminToken) {
    throw new Error(`admin 登录失败：${JSON.stringify(adminLogin.payload)}`);
  }
  console.log(`  admin 登录成功（token=${ctx.adminToken.slice(0, 12)}…）`);

  const a = await auth(USER_A);
  const b = await auth(USER_B);
  if (!a?.token || !b?.token) throw new Error('客户端登录失败');
  console.log(`  账号 A playerId=${a.playerId} 账号 B playerId=${b.playerId}`);

  for (const [key, name] of Object.entries(SCENE_NAMES)) {
    const s = await ensureScene(ctx.adminToken, name);
    ctx.sceneIds[key] = s.id;
    console.log(`  测试场景 ${key}=${s.id}「${name}」${s.created ? '（本次新建）' : '（已存在）'}`);
  }
  ctx.sceneIds.solo = SCENE_SOLO;

  for (const [key, spec] of Object.entries(TPL)) {
    const t = await ensureTemplate(ctx.adminToken, spec);
    ctx.tplIds[key] = t.id;
    console.log(
      `  测试蓝图 ${key}=${t.id}「${spec.name}」成本=${JSON.stringify(spec.buildCost)} 耗时=${spec.buildSeconds}s${t.created ? '（本次新建）' : '（已存在，已回写）'}`,
    );
  }

  await upsertRule(ctx.adminToken, ctx.sceneIds.solo, {
    mode: 'solo',
    landGridSize: GRID,
    maxBuildingsPerPlayer: 5,
    allowDemolish: true,
    reservedZones: [],
  });
  await upsertRule(ctx.adminToken, ctx.sceneIds.limit, {
    mode: 'solo',
    landGridSize: GRID,
    maxBuildingsPerPlayer: 1,
    allowDemolish: true,
    reservedZones: [],
  });
  await upsertRule(ctx.adminToken, ctx.sceneIds.coop, {
    mode: 'coop',
    landGridSize: GRID,
    maxBuildingsPerPlayer: 5,
    allowDemolish: true,
    coopMinContributors: 2,
    coopExpireHours: 24,
    reservedZones: [],
  });
  await upsertRule(ctx.adminToken, ctx.sceneIds.expire, {
    mode: 'coop',
    landGridSize: GRID,
    maxBuildingsPerPlayer: 5,
    allowDemolish: true,
    coopMinContributors: 2,
    coopExpireHours: 0,
    reservedZones: [],
  });
  // 禁建场景：**故意不配规则行** → 服务端返回 forbidden 语义
  console.log('  规则已 upsert（solo/上限/共建/超时）；禁建场景不配规则（无规则行 = forbidden）');

  await grantGold(ctx.adminToken, a.playerId, GIVE_GOLD, 's6smoke 冒烟发币');
  await grantGold(ctx.adminToken, b.playerId, GIVE_GOLD, 's6smoke 冒烟发币');

  // ── ① 规则读取 ──
  const ruleRes = await getRule(a.token, ctx.sceneIds.solo);
  const rule = ruleRes.payload?.data ?? {};
  check(
    '① 规则读取：GET scenes/:id/build-rule 返回 BuildRuleView（mode=solo 且字段齐备）',
    ruleRes.payload?.code === 0 &&
      rule.mode === 'solo' &&
      rule.sceneId === String(ctx.sceneIds.solo) &&
      rule.landGridSize === GRID &&
      rule.maxBuildingsPerPlayer === 5 &&
      rule.allowDemolish === true &&
      Array.isArray(rule.reservedZones),
    `code=${ruleRes.payload?.code} mode=${rule.mode} grid=${rule.landGridSize} max=${rule.maxBuildingsPerPlayer} demolish=${rule.allowDemolish}`,
  );
  check(
    '①b 无规则场景规则读取：返回 forbidden 默认视图（id=null/max=0/allowDemolish=false）',
    (await getRule(a.token, ctx.sceneIds.forbid)).payload?.data?.mode === 'forbidden',
    `forbidden 场景=${ctx.sceneIds.forbid}`,
  );

  // ── ② forbidden 拒绝（无规则场景建楼 → 44001）──
  const forbidRes = await createBuilding(a.token, {
    sceneId: ctx.sceneIds.forbid,
    templateId: ctx.tplIds.solo,
    gx: 1,
    gy: 1,
  });
  check(
    '② forbidden 拒绝：无规则场景建楼 → code=44001 BUILD_FORBIDDEN',
    forbidRes.payload?.code === 44001,
    `scene=${ctx.sceneIds.forbid} → code=${forbidRes.payload?.code} msg="${forbidRes.payload?.msg}"`,
  );

  // ── ③ solo 建楼扣料（建前/建后余额差额恰等于 build_cost）──
  const goldBefore = await goldOf(a.token);
  const soloRes = await createBuilding(a.token, {
    sceneId: ctx.sceneIds.solo,
    templateId: ctx.tplIds.solo,
    gx: 1,
    gy: 1,
  });
  const goldAfter = await goldOf(a.token);
  const solo = soloRes.payload?.data ?? {};
  ctx.created.push({ token: a.token, sceneId: ctx.sceneIds.solo, id: solo.id, owner: a.playerId });
  check(
    '③ solo 建楼：code=0 且 state=building，kind 与锚点格中心像素正确',
    soloRes.payload?.code === 0 && solo.state === 'building' && solo.x === (1 + 0.5) * GRID && solo.y === (1 + 0.5) * GRID,
    `code=${soloRes.payload?.code} id=${solo.id} state=${solo.state} pos=(${solo.x},${solo.y})`,
  );
  check(
    `③b solo 扣料：gold 差额恰等于 build_cost（${COST_GOLD}）`,
    goldBefore - goldAfter === COST_GOLD,
    `gold ${goldBefore} → ${goldAfter}（Δ=${goldBefore - goldAfter}，期望 ${COST_GOLD}）`,
  );

  // ── ④ 结算后 state=built（≤75s 轮询）──
  const settle = await poll(
    () => stateOf(a.token, ctx.sceneIds.solo, solo.id, a.playerId),
    (s) => s === 'built',
  );
  check(
    '④ 落成结算：定时器 tick 后 GET buildings 见 state=built',
    settle.ok,
    `state=${settle.value} 等待=${(settle.waitedMs / 1000).toFixed(1)}s 轮询=${settle.polls}次`,
  );

  // ── ⑤ 上限拒绝（max_buildings_per_player=1 场景）──
  const limitFirst = await createBuilding(a.token, {
    sceneId: ctx.sceneIds.limit,
    templateId: ctx.tplIds.solo,
    gx: 1,
    gy: 1,
  });
  const limitSecond = await createBuilding(a.token, {
    sceneId: ctx.sceneIds.limit,
    templateId: ctx.tplIds.solo,
    gx: 2,
    gy: 1,
  });
  ctx.created.push({
    token: a.token,
    sceneId: ctx.sceneIds.limit,
    id: limitFirst.payload?.data?.id,
    owner: a.playerId,
  });
  check(
    '⑤ 上限拒绝：max=1 场景建第二栋（另一格）→ code=44003 BUILD_LIMIT_REACHED',
    limitFirst.payload?.code === 0 && limitSecond.payload?.code === 44003,
    `第一栋 code=${limitFirst.payload?.code} id=${limitFirst.payload?.data?.id}；第二栋 code=${limitSecond.payload?.code} msg="${limitSecond.payload?.msg}"`,
  );

  // ── ⑥ 地块占用拒绝（同一格第二栋 → 44002）──
  const occupiedFirst = await createBuilding(a.token, {
    sceneId: ctx.sceneIds.solo,
    templateId: ctx.tplIds.solo,
    gx: 5,
    gy: 5,
  });
  const occupiedSecond = await createBuilding(a.token, {
    sceneId: ctx.sceneIds.solo,
    templateId: ctx.tplIds.solo,
    gx: 5,
    gy: 5,
  });
  ctx.created.push({
    token: a.token,
    sceneId: ctx.sceneIds.solo,
    id: occupiedFirst.payload?.data?.id,
    owner: a.playerId,
  });
  check(
    '⑥ 地块占用拒绝：同一 (gx,gy) 建第二栋 → code=44002 PLOT_OCCUPIED',
    occupiedFirst.payload?.code === 0 && occupiedSecond.payload?.code === 44002,
    `第一栋 code=${occupiedFirst.payload?.code}；同格第二栋 code=${occupiedSecond.payload?.code} msg="${occupiedSecond.payload?.msg}"`,
  );

  // ── ⑦ coop 投料未达标不落成 ──
  const coopBuild = await createBuilding(a.token, {
    sceneId: ctx.sceneIds.coop,
    templateId: ctx.tplIds.coop,
    gx: 1,
    gy: 1,
  });
  const coopId = coopBuild.payload?.data?.id;
  ctx.created.push({ token: a.token, sceneId: ctx.sceneIds.coop, id: coopId, owner: a.playerId });
  const contribA = await contribute(a.token, coopId, [{ currencyType: 'gold', amount: 5 }]);
  check(
    '⑦ coop 未达标：单人投一半 → reached=false 且 contributors=1，state 仍 building',
    coopBuild.payload?.code === 0 &&
      contribA.payload?.code === 0 &&
      contribA.payload?.data?.reached === false &&
      contribA.payload?.data?.contributors === 1 &&
      contribA.payload?.data?.building?.state === 'building',
    `create code=${coopBuild.payload?.code} id=${coopId}；投料 code=${contribA.payload?.code} reached=${contribA.payload?.data?.reached} contributors=${contribA.payload?.data?.contributors}`,
  );
  // 跨过一个定时器 tick（约 65s，远小于 24h 超时）确认未被误落成
  const tickStart = Date.now();
  await sleep(65_000);
  const stillBuilding = await stateOf(a.token, ctx.sceneIds.coop, coopId, a.playerId);
  check(
    '⑦b coop 未达标：跨定时器 tick 后仍为 building（未被误落成）',
    stillBuilding === 'building',
    `state=${stillBuilding} 观察=${((Date.now() - tickStart) / 1000).toFixed(1)}s（已跨 ≥1 个 @Cron(EVERY_MINUTE) tick）`,
  );

  // ── ⑧ coop 达标落成（第二账号投剩余部分）──
  const contribB = await contribute(b.token, coopId, [{ currencyType: 'gold', amount: 5 }]);
  check(
    '⑧ coop 达标：第二账号补足 → reached=true 且 contributors>=2',
    contribB.payload?.code === 0 &&
      contribB.payload?.data?.reached === true &&
      contribB.payload?.data?.contributors >= 2,
    `code=${contribB.payload?.code} reached=${contribB.payload?.data?.reached} contributors=${contribB.payload?.data?.contributors}`,
  );
  const coopSettle = await poll(
    () => stateOf(a.token, ctx.sceneIds.coop, coopId, a.playerId),
    (s) => s === 'built',
  );
  check(
    '⑧b coop 达标后落成：≤75s 内 state=built',
    coopSettle.ok,
    `state=${coopSettle.value} 等待=${(coopSettle.waitedMs / 1000).toFixed(1)}s 轮询=${coopSettle.polls}次`,
  );

  // ── ⑨ coop 超时（coop_expire_hours=0）──
  const expBuild = await createBuilding(a.token, {
    sceneId: ctx.sceneIds.expire,
    templateId: ctx.tplIds.coop,
    gx: 1,
    gy: 1,
  });
  const expId = expBuild.payload?.data?.id;
  const expGoldBefore = await goldOf(a.token);
  const expContrib = await contribute(a.token, expId, [{ currencyType: 'gold', amount: 5 }]);
  // 44006 = 实例仍在但已超时；44004 = 极端竞态下已被调度器移除（同为超时终态）。
  const expContribCode = expContrib.payload?.code;
  check(
    '⑨ coop 超时：expire_hours=0 实例创建即超时，投料被拒 → 44006 COOP_EXPIRED（竞态已移除时 44004）',
    expBuild.payload?.code === 0 && (expContribCode === 44006 || expContribCode === 44004),
    `create code=${expBuild.payload?.code} id=${expId} finishAt=${expBuild.payload?.data?.finishAt}；投料 code=${expContribCode} msg="${expContrib.payload?.msg}"`,
  );
  const expGone = await poll(
    () => stateOf(a.token, ctx.sceneIds.expire, expId, a.playerId),
    (s) => s === null,
  );
  const expGoldAfter = await goldOf(a.token);
  check(
    '⑨b coop 超时：调度器 ≤75s 内移除实例（软删终态=demolishing，GET buildings 不再返回）且投料方余额不变',
    expGone.ok && expGoldAfter === expGoldBefore,
    `实例=${expGone.value === null ? '已移除' : expGone.value} 等待=${(expGone.waitedMs / 1000).toFixed(1)}s；gold ${expGoldBefore} → ${expGoldAfter}（无可退，未投料）`,
  );
  const expReuse = await createBuilding(a.token, {
    sceneId: ctx.sceneIds.expire,
    templateId: ctx.tplIds.coop,
    gx: 1,
    gy: 1,
  });
  check(
    '⑨c coop 超时：地块被释放，同一格可再次建造（code=0）',
    expReuse.payload?.code === 0,
    `同格重建 code=${expReuse.payload?.code} msg="${expReuse.payload?.msg}"`,
  );

  // ── ⑩ 拆除后可复用（不退款）──
  const goldBeforeDemolish = await goldOf(a.token);
  const demolishRes = await demolish(a.token, solo.id);
  const goldAfterDemolish = await goldOf(a.token);
  check(
    '⑩ 拆除：code=0 且 refunded=false（D7 不退款）',
    demolishRes.payload?.code === 0 &&
      demolishRes.payload?.data?.refunded === false &&
      demolishRes.payload?.data?.building?.state === 'demolishing',
    `code=${demolishRes.payload?.code} state=${demolishRes.payload?.data?.building?.state} refunded=${demolishRes.payload?.data?.refunded}`,
  );
  check(
    '⑩b 拆除不退款：拆除前后 gold 余额不变',
    goldAfterDemolish === goldBeforeDemolish,
    `gold ${goldBeforeDemolish} → ${goldAfterDemolish}`,
  );
  const reuseRes = await createBuilding(a.token, {
    sceneId: ctx.sceneIds.solo,
    templateId: ctx.tplIds.solo,
    gx: 1,
    gy: 1,
  });
  ctx.created.push({
    token: a.token,
    sceneId: ctx.sceneIds.solo,
    id: reuseRes.payload?.data?.id,
    owner: a.playerId,
  });
  check(
    '⑩c 拆除后地块可复用：同一格再次建造成功（code=0）',
    reuseRes.payload?.code === 0,
    `同格重建 code=${reuseRes.payload?.code} id=${reuseRes.payload?.data?.id} msg="${reuseRes.payload?.msg}"`,
  );

  // ── ⑪ 蓝图列表只返回启用中的蓝图 ──
  const tplList = await call('GET', '/api/client/v1/world/building-templates', { token: a.token });
  const tpls = tplList.payload?.data ?? [];
  check(
    '⑪ 客户端蓝图列表：仅返回 isActive=true 的蓝图',
    tplList.payload?.code === 0 && tpls.length > 0 && tpls.every((t) => t.isActive === true),
    `共 ${tpls.length} 条，isActive 全为 true=${tpls.every((t) => t.isActive === true)}`,
  );

  // ── ⑫ 未授权校验（不带 token → 401/403，非 404）──
  const noAuth = await call('GET', `/api/client/v1/world/scenes/${ctx.sceneIds.solo}/build-rule`);
  check(
    '⑫ 未授权校验：客户端接口不带 token → 401（路由已注册，非 404）',
    noAuth.status === 401 || noAuth.status === 403,
    `HTTP ${noAuth.status}`,
  );

  // ── ⑬ coop 超时退款端到端（测试专用 psql 注入 finish_at 回拨）──
  // 依据：coop_expire_hours=0 时投料被 44006 拒，无法经 HTTP 产出「已投料未达标且已超时」实例；
  // 故用 s6smoke-共建（expire 24h）造实例 + 部分投料，再经本地 psql 仅回拨 finish_at 到过去，
  // 走调度器 refundExpiredCoop 真实退款路径（原路退流水、幂等、释放地块）。
  if (!psqlAvailable()) {
    skip('⑬ coop 超时退款端到端（⑬a/⑬b/⑬c/⑬c2/⑬d）', `本地 psql 不可用（未找到 ${PSQL_BIN}）`);
  } else {
    const COOP_GX = 3;
    const COOP_GY = 3;
    const goldBeforeCreate = await goldOf(a.token);
    const refundBuild = await createBuilding(a.token, {
      sceneId: ctx.sceneIds.coop,
      templateId: ctx.tplIds.coop,
      gx: COOP_GX,
      gy: COOP_GY,
    });
    const refundId = refundBuild.payload?.data?.id;
    // 共建创建即按蓝图成本扣料，故「投料前」基准取创建之后的余额
    const goldBeforeContrib = await goldOf(a.token);
    const partialContrib = await contribute(a.token, refundId, [{ currencyType: 'gold', amount: 5 }]);
    const goldAfterContrib = await goldOf(a.token);
    check(
      '⑬ 前置：共建实例部分投料成功（未达标）且金余额恰减 5',
      refundBuild.payload?.code === 0 &&
        partialContrib.payload?.code === 0 &&
        partialContrib.payload?.data?.reached === false &&
        goldBeforeContrib - goldAfterContrib === 5,
      `create code=${refundBuild.payload?.code} id=${refundId}（创建扣料 ${goldBeforeCreate - goldBeforeContrib}）；投料 code=${partialContrib.payload?.code} reached=${partialContrib.payload?.data?.reached}；gold ${goldBeforeContrib} → ${goldAfterContrib}（Δ=${goldBeforeContrib - goldAfterContrib}）`,
    );

    // 测试专用注入：仅把该实例 finish_at 回拨到过去（不改其它字段），令下一 tick 触发超时退款
    const rollbackSql = `UPDATE building_instances SET finish_at = now() - interval '1 minute' WHERE id = '${refundId}';`;
    console.log(`  [⑬ 注入] ${rollbackSql}`);
    const rollbackOut = psqlExec(rollbackSql);
    console.log(`  [⑬ 注入] psql → ${rollbackOut || 'UPDATE 1'}`);

    // ⑬a 实例进入超时终态（refundExpiredCoop 同一 tick 内先置 demolishing 再软删；HTTP 只能观察到二者之一）
    const reaped = await poll(
      () => stateOf(a.token, ctx.sceneIds.coop, refundId, a.playerId),
      (s) => s === 'demolishing' || s === null,
    );
    check(
      '⑬a coop 超时退款：调度器 tick 后实例进入超时终态（demolishing 或已软删不再返回）',
      reaped.ok,
      `state=${reaped.value} 等待=${(reaped.waitedMs / 1000).toFixed(1)}s 轮询=${reaped.polls}次`,
    );

    // ⑬b 按流水原路全额退款：余额恢复到投料前
    const goldAfterRefund = await goldOf(a.token);
    check(
      '⑬b coop 超时退款：账号 A 余额恢复到投料前（按流水原路全额退回，不扣税）',
      goldAfterRefund === goldBeforeContrib,
      `gold 投料前=${goldBeforeContrib} 投料后=${goldAfterContrib} 退款后=${goldAfterRefund}（期望回到 ${goldBeforeContrib}）`,
    );

    // ⑬c 等同/跨过一个 tick 后余额不再变化（不重复退款）
    await sleep(65_000);
    const goldAfterSecondTick = await goldOf(a.token);
    check(
      '⑬c coop 超时退款幂等：再跨一个 tick（约 65s）后余额不再变化（不重复退款）',
      goldAfterSecondTick === goldAfterRefund,
      `退款后=${goldAfterRefund} → 再等 65s=${goldAfterSecondTick}`,
    );

    // ⑬c2 psql 只读：该实例流水全部 refunded=true（0 条未退），实例行终态 state=demolishing 且已软删
    const cntRow = psqlExec(
      `SELECT count(*) FILTER (WHERE refunded), count(*) FROM building_coop_contributions WHERE building_instance_id = '${refundId}';`,
    );
    const [refundedCnt, totalCnt] = cntRow.split('|').map((x) => Number(x));
    const instRow = psqlExec(
      `SELECT state, (deleted_at IS NOT NULL) FROM building_instances WHERE id = '${refundId}';`,
    );
    const [instState, instDeleted] = instRow.split('|');
    check(
      '⑬c2 coop 超时退款：psql 只读确认流水分已全退（0 条未退）且实例行终态 state=demolishing 已软删',
      totalCnt >= 1 && refundedCnt === totalCnt && instState === 'demolishing' && instDeleted === 't',
      `流水 refunded=${refundedCnt}/${totalCnt}（未退=${totalCnt - refundedCnt}）；实例 state=${instState} deleted=${instDeleted}`,
    );

    // ⑬d 地块已释放：同一 (gx,gy) 可再次建造成功
    const reusedRefund = await createBuilding(a.token, {
      sceneId: ctx.sceneIds.coop,
      templateId: ctx.tplIds.coop,
      gx: COOP_GX,
      gy: COOP_GY,
    });
    check(
      '⑬d coop 超时退款：占用格点已释放，同一 (gx,gy) 可再次建造（code=0）',
      reusedRefund.payload?.code === 0,
      `同格重建 code=${reusedRefund.payload?.code} id=${reusedRefund.payload?.data?.id} msg="${reusedRefund.payload?.msg}"`,
    );
    // 收尾：对重建实例再次回拨 finish_at 并等其被回收 → 释放该格，保证脚本可重复跑
    const reusedId = reusedRefund.payload?.data?.id;
    if (reusedId) {
      psqlExec(`UPDATE building_instances SET finish_at = now() - interval '1 minute' WHERE id = '${reusedId}';`);
      const reusedGone = await poll(
        () => stateOf(a.token, ctx.sceneIds.coop, reusedId, a.playerId),
        (s) => s === null,
      );
      console.log(`  [⑬d 收尾] 重建实例 id=${reusedId} 回收=${reusedGone.ok}（释放地块保证可重跑）`);
    }
  }

  const suffix = skipped > 0 ? `（含 ${skipped} 组 SKIP）` : '';
  console.log(failed === 0 ? `\nS6 建造冒烟全部通过${suffix}` : `\nS6 建造冒烟失败 ${failed} 项${suffix}`);
  if (skipped > 0) console.log(`SKIP 原因：${skipReason}`);
  return failed === 0 ? 0 : 1;
}

// ===== 清理（幂等可重跑：停用测试蓝图 + 拆除本次创建的建筑以释放地块）=====

async function cleanup() {
  // 1) 停用本次测试蓝图（保留行，下次跑自动重新启用）
  for (const [key, id] of Object.entries(ctx.tplIds)) {
    if (!id) continue;
    const res = await call('POST', `/api/admin/v1/world/building-templates/${id}/toggle`, {
      token: ctx.adminToken,
      body: { isActive: false },
    });
    console.log(`[清理] 测试蓝图 ${key}=${id} 置停用：code=${res.payload?.code}`);
  }
  // 2) 拆除本次创建的建筑（先等其落成，再拆除 → 释放地块，保证下次跑同格可建）
  for (const item of ctx.created) {
    if (!item.id) continue;
    try {
      let state = await stateOf(item.token, item.sceneId, item.id, item.owner);
      if (state === null) continue; // 已被调度器移除（超时场景）
      if (state !== 'built') {
        const settled = await poll(
          () => stateOf(item.token, item.sceneId, item.id, item.owner),
          (s) => s === 'built' || s === null,
        );
        state = settled.value;
        if (state === null) continue;
      }
      const res = await demolish(item.token, item.id);
      console.log(`[清理] 拆除建筑 id=${item.id} scene=${item.sceneId}：code=${res.payload?.code}`);
    } catch (err) {
      console.log(`[清理] 拆除建筑 id=${item.id} 失败：${err.message}`);
    }
  }
}

let exitCode = 1;
main()
  .then((code) => {
    exitCode = code;
  })
  .catch((err) => {
    console.error(`冒烟脚本异常：${err.message}`);
    exitCode = 1;
  })
  .finally(async () => {
    try {
      if (ctx.adminToken) await cleanup();
    } catch (err) {
      console.error(`[清理] 失败：${err.message}`);
    }
    process.exit(exitCode);
  });