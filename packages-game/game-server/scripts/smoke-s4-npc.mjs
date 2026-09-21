// S4 服务端冒烟：进场景下发 npcs → condition 按玩家过滤 → random 半径 → patrol 路点
//                → tick 低频广播校正 → 空场景不广播 → 旧契约（spawns=13）不回归
// 用法：node scripts/smoke-s4-npc.mjs     （需先启动 mock-redis 与 game-server）
// 环境变量：SMOKE_API（默认 http://localhost:3000）、ADMIN_USERNAME / ADMIN_PASSWORD（默认 admin/admin123）
//
// 前置条件（脚本无法自造，需操作者准备）：
//   两个客户端账号等级必须**不同**，且一个 < 5、一个 ≥ 5（用于验证 condition.minLevel 过滤）。
//   本地库两个账号默认都是 1 级，可用：
//     UPDATE players SET level=5 WHERE id=3;   -- 临时抬高，验证后还原为 1
//
// ⚠️ NpcPresenceService 的场景级实例缓存不随规则变更失效（见 npc-presence.service.ts 注释）：
//   脚本开跑前会确保「临时 condition 规则」存在，缺失则新建。若本次是**新建**，
//   必须重启后端进程让缓存重算，否则断言 ③ 会因缓存陈旧而失败（脚本会在输出中明确提示）。
import { io } from 'socket.io-client';

const API = (process.env.SMOKE_API || 'http://localhost:3000').replace(/\/+$/, '');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const SCENE_ID = '1';
const EXPECTED_SPAWNS = 13; // S1 契约：scene 1 的 spawns 固定 13 条
const TMP_RULE_NAME = 'smoke-tmp-minlevel5';
const TMP_MIN_LEVEL = 5;
const NPC_TICK_WAIT_MS = 7000; // 覆盖 ≥3 个 tick（tick 间隔 2s）
const EMPTY_SCENE_WAIT_MS = 6000; // 空场景观察窗口（≥2 个 tick）

const USER_LOW = { username: 'spike01', password: 'spike123456', nickname: 'spike01', deviceId: 'smoke-s4-low' };
const USER_HIGH = { username: 'spike02', password: 'spike123456', nickname: 'spike02', deviceId: 'smoke-s4-high' };

let failed = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` :: ${extra}` : ''}`);
  if (!cond) failed++;
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
  if (reg.payload?.code !== 0) throw new Error(`登录/注册失败：${JSON.stringify(reg.payload)}`);
  return reg.payload.data;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(`${API}/game`, { transports: ['websocket'], query: { token } });
    const timer = setTimeout(() => reject(new Error('WS 连接超时')), 8000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (e) => {
      clearTimeout(timer);
      reject(new Error(`WS 连接失败：${e?.message ?? e}`));
    });
  });
}

function send(socket, cmd, data) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WS 请求超时：${cmd}`)), 8000);
    socket.emit(cmd, { cmd, seq: 1, data }, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== 临时 condition 规则（脚本自建、跑完自删） =====

async function listRules(token) {
  const res = await call('GET', `/api/admin/v1/world/npc-rules/list?sceneId=${SCENE_ID}`, { token });
  if (res.payload?.code !== 0) throw new Error(`规则列表查询失败：${JSON.stringify(res.payload)}`);
  return res.payload.data.list ?? [];
}

async function ensureTmpRule(token) {
  const rules = await listRules(token);
  const found = rules.find((r) => r.name === TMP_RULE_NAME);
  if (found) {
    console.log(`  临时规则已存在：id=${found.id} condition=${JSON.stringify(found.condition)}`);
    return { id: String(found.id), created: false };
  }
  const res = await call('POST', '/api/admin/v1/world/npc-rules', {
    token,
    body: {
      sceneId: SCENE_ID,
      npcTemplateId: '1',
      ruleType: 'random',
      spawnX: 600,
      spawnY: 380,
      spawnRadius: 60,
      spawnCount: 1,
      condition: { minLevel: TMP_MIN_LEVEL },
      name: TMP_RULE_NAME,
    },
  });
  if (res.payload?.code !== 0) throw new Error(`临时规则创建失败：${JSON.stringify(res.payload)}`);
  console.log(`  临时规则已新建：id=${res.payload.data.id}（condition={minLevel:${TMP_MIN_LEVEL}}）`);
  return { id: String(res.payload.data.id), created: true };
}

async function deleteTmpRule(token, id) {
  if (!token || !id) return;
  const res = await call('DELETE', `/api/admin/v1/world/npc-rules/${id}`, { token });
  console.log(`[清理] 删除临时规则 id=${id}：code=${res.payload?.code} msg=${res.payload?.msg}`);
}

// ===== 主流程 =====

const ctx = { adminToken: null, tmpRuleId: null, sockets: [] };

async function main() {
  // ── 前置：后端可达 ──
  const health = await call('GET', '/health').catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error('后端未启动，请先运行 mock-redis 与 npm run start:dev');
  }
  console.log(`  后端 /health 可达（${API}）`);

  // ── 前置：admin 登录 + 临时规则就位 ──
  const login = await call('POST', '/api/admin/v1/login', {
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  const adminToken = login.payload?.data?.token;
  if (login.payload?.code !== 0 || !adminToken) {
    throw new Error(`admin 登录失败：${JSON.stringify(login.payload)}`);
  }
  ctx.adminToken = adminToken;
  console.log(`  admin 登录成功（token=${adminToken.slice(0, 12)}…）`);

  const tmp = await ensureTmpRule(adminToken);
  ctx.tmpRuleId = tmp.id;
  if (tmp.created) {
    console.log('  ⚠️ 本次新建了临时规则：若断言 ③ 未通过，请重启后端进程（场景级实例缓存）后重跑');
  }

  // ── 前置：两个账号（等级必须不同）──
  const low = await auth(USER_LOW);
  const high = await auth(USER_HIGH);
  const lowInfo = await call('GET', '/api/client/v1/player/base-info', { token: low.token });
  const highInfo = await call('GET', '/api/client/v1/player/base-info', { token: high.token });
  const lowLevel = lowInfo.payload?.data?.player?.level;
  const highLevel = highInfo.payload?.data?.player?.level;
  console.log(`  账号等级：${USER_LOW.username}=${lowLevel}（playerId=${low.playerId}），${USER_HIGH.username}=${highLevel}（playerId=${high.playerId}）`);
  if (!(lowLevel < TMP_MIN_LEVEL && highLevel >= TMP_MIN_LEVEL)) {
    throw new Error(
      `前置不满足：需要「一个账号等级 < ${TMP_MIN_LEVEL}、另一个 ≥ ${TMP_MIN_LEVEL}」。` +
        `当前 ${USER_LOW.username}=${lowLevel}、${USER_HIGH.username}=${highLevel}。` +
        `可执行：UPDATE players SET level=${TMP_MIN_LEVEL} WHERE id=${high.playerId};（验证后还原）`,
    );
  }

  // ── ① 登录两个账号 ──
  check(
    '① 登录两个账号（等级不同）',
    Boolean(low.token && low.playerId && high.token && high.playerId) && lowLevel !== highLevel,
    `low=${low.playerId}(lv${lowLevel}) high=${high.playerId}(lv${highLevel})`,
  );

  const sa = await connect(low.token);
  const sb = await connect(high.token);
  ctx.sockets.push(sa, sb);

  // 广播采集器：从进场景前就挂上，避免漏包
  const broadcasts = [];
  const onMessage = (m) => {
    if (m?.cmd === 'world.entity_update' && m?.data?.entityType === 'npc') {
      broadcasts.push({ at: Date.now(), ...m.data });
    }
  };
  sa.on('message', onMessage);
  sb.on('message', onMessage);

  // ── ② 进场景拿到 npcs ──
  const enterLow = await send(sa, 'world.enter-scene', { sceneId: SCENE_ID });
  const syncLow = enterLow?.data ?? {};
  check(
    '② 进场景应答携带 npcs 数组',
    enterLow?.cmd === 'world.enter_scene_sync' && enterLow?.code === 0 && Array.isArray(syncLow.npcs),
    `cmd=${enterLow?.cmd} code=${enterLow?.code} npcs=${Array.isArray(syncLow.npcs) ? syncLow.npcs.length : syncLow.npcs}`,
  );
  const enterHigh = await send(sb, 'world.enter-scene', { sceneId: SCENE_ID });
  const syncHigh = enterHigh?.data ?? {};
  if (!Array.isArray(syncLow.npcs) || !Array.isArray(syncHigh.npcs)) {
    throw new Error('进场景未返回 npcs 数组，后续断言无法执行');
  }

  // ── ③ condition 按玩家过滤（低等级看不到 minLevel=5 的临时规则）──
  const lowCount = syncLow.npcs.length;
  const highCount = syncHigh.npcs.length;
  const tmpPrefix = `npcs:${ctx.tmpRuleId}:`;
  const lowSeesTmp = syncLow.npcs.some((n) => String(n.npcId).startsWith(tmpPrefix));
  const highSeesTmp = syncHigh.npcs.some((n) => String(n.npcId).startsWith(tmpPrefix));
  check(
    '③ 低等级 npcs 条数 ≤ 高等级，且低等级看不到 condition 不满足的 NPC',
    lowCount <= highCount && highSeesTmp && !lowSeesTmp,
    `low=${lowCount} high=${highCount}；临时规则(${tmpPrefix}) 低等级可见=${lowSeesTmp} 高等级可见=${highSeesTmp}`,
  );

  // ── ④ random 实例坐标落在 spawn_x/y ± spawn_radius 内 ──
  const rules = await listRules(adminToken);
  const randomRule = rules.find((r) => r.ruleType === 'random' && r.name !== TMP_RULE_NAME);
  const randomInsts = randomRule
    ? syncHigh.npcs.filter((n) => String(n.npcId).startsWith(`npcs:${randomRule.id}:`))
    : [];
  const inRadius = randomInsts.every(
    (n) =>
      Math.abs(n.x - randomRule.spawnX) <= randomRule.spawnRadius &&
      Math.abs(n.y - randomRule.spawnY) <= randomRule.spawnRadius,
  );
  check(
    '④ random 实例坐标落在 spawn_x/y ± spawn_radius 内',
    Boolean(randomRule) && randomInsts.length === randomRule.spawnCount && inRadius,
    randomRule
      ? `rule=${randomRule.id} 期望 ${randomRule.spawnCount} 个 → 实际 ${randomInsts.length} 个；` +
        `中心=(${randomRule.spawnX},${randomRule.spawnY}) r=${randomRule.spawnRadius}；` +
        `坐标=${randomInsts.map((n) => `(${n.x.toFixed(1)},${n.y.toFixed(1)})`).join(' ')}`
      : '未找到 seed random 规则',
  );

  // ── ⑤ patrol 实例带 route.points（长度 4）──
  const patrolRule = rules.find((r) => r.ruleType === 'patrol');
  const patrolInsts = patrolRule
    ? syncHigh.npcs.filter((n) => String(n.npcId).startsWith(`npcs:${patrolRule.id}:`))
    : [];
  const patrolWithRoute = patrolInsts.filter((n) => Array.isArray(n.route?.points));
  check(
    '⑤ patrol 实例带 route.points 且路点数 = 4',
    patrolWithRoute.length > 0 && patrolWithRoute.every((n) => n.route.points.length === 4),
    patrolWithRoute.length > 0
      ? `rule=${patrolRule?.id} 实例=${patrolInsts.length} 带路点=${patrolWithRoute.length}；` +
        `points=${patrolWithRoute[0].route.points.length} speed=${patrolWithRoute[0].route.speed} loopMode=${patrolWithRoute[0].route.loopMode}`
      : 'patrol 实例未携带 route.points',
  );

  // ── ⑥⑦ 观察广播：2 个 tick 内收到 npc 校正包，且两次坐标不同 ──
  const waitStart = Date.now();
  await sleep(NPC_TICK_WAIT_MS);
  const inWindow = broadcasts.filter((b) => b.at >= waitStart);
  const firstAt = inWindow.length > 0 ? inWindow[0].at - waitStart : null;
  check(
    `⑥ ${NPC_TICK_WAIT_MS / 1000}s 窗口内收到 entityType='npc' 的 world.entity_update 广播`,
    inWindow.length > 0,
    inWindow.length > 0
      ? `首个广播 +${firstAt}ms，共 ${inWindow.length} 条；entityId=${[...new Set(inWindow.map((b) => b.entityId))].join(',')}`
      : '窗口内未收到 npc 广播',
  );

  const byId = new Map();
  for (const b of inWindow) {
    if (!byId.has(b.entityId)) byId.set(b.entityId, []);
    byId.get(b.entityId).push(b);
  }
  const movingId = [...byId.entries()].find(([, list]) =>
    list.some((b) => b.pos.x !== list[0].pos.x || b.pos.y !== list[0].pos.y),
  );
  check(
    '⑦ 同一 NPC 的两次广播坐标不同（服务端确实在推进位置）',
    Boolean(movingId),
    movingId
      ? `entityId=${movingId[0]} 坐标序列=${movingId[1].map((b) => `(${b.pos.x.toFixed(1)},${b.pos.y.toFixed(1)})`).join(' → ')}`
      : `窗口内每个 NPC 坐标都未变化（${[...byId.keys()].join(',') || '无广播'}）`,
  );

  // ── ⑧ 空场景无广播（所有玩家离开后不再收到该场景 npc 广播）──
  sa.close();
  sb.close();
  await sleep(1500); // 等 disconnect → leaveScene → 摘除活跃场景标记
  const emptyStart = Date.now();
  await sleep(EMPTY_SCENE_WAIT_MS);
  const afterLeave = broadcasts.filter((b) => b.at >= emptyStart);
  check(
    `⑧ 玩家全部离开后 ${EMPTY_SCENE_WAIT_MS / 1000}s 内无该场景 npc 广播`,
    afterLeave.length === 0,
    afterLeave.length === 0
      ? '离开后 0 条 npc 广播'
      : `离开后仍收到 ${afterLeave.length} 条：${afterLeave.slice(0, 3).map((b) => b.entityId).join(',')}`,
  );

  // ── ⑨ 旧契约不回归：spawns 仍是 13 ──
  check(
    `⑨ 旧契约不回归：data.spawns.length === ${EXPECTED_SPAWNS}`,
    syncLow.spawns?.length === EXPECTED_SPAWNS,
    `spawns=${syncLow.spawns?.length}（期望 ${EXPECTED_SPAWNS}）triggers=${syncLow.triggers?.length}`,
  );

  console.log(failed === 0 ? '\nS4 冒烟全部通过' : `\nS4 冒烟失败 ${failed} 项`);
  return failed === 0 ? 0 : 1;
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
    for (const s of ctx.sockets) {
      try {
        s.close();
      } catch {
        /* 忽略关闭异常 */
      }
    }
    try {
      await deleteTmpRule(ctx.adminToken, ctx.tmpRuleId);
    } catch (err) {
      console.error(`[清理] 删除临时规则失败：${err.message}`);
    }
    process.exit(exitCode);
  });
