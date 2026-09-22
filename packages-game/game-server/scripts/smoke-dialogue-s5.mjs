// S5 服务端冒烟：对话树 talk/choose + 玩家级条件过滤 + 动作副作用 + 剧情触发一次性
// 用法：node scripts/smoke-dialogue-s5.mjs     （需先启动 mock-redis 与 game-server）
// 环境变量：SMOKE_API（默认 http://localhost:3000）、SMOKE_REDIS_HOST/PORT（默认 127.0.0.1:6379）、
//           SMOKE_STORY_TRIGGER_ID（默认 2）、ADMIN_USERNAME / ADMIN_PASSWORD（默认 admin/admin123）
//
// 前置条件（脚本无法自造，需操作者准备；与 S4 冒烟同样在头部声明）：
//   1) 种子数据已就绪：dialogues.id=1 code='npc_blacksmith_main'（spawn 12 → npc_templates.id=2）、
//      quest_templates.id=1、item_templates.id=1；可用 psql 核对。
//   2) 剧情触发：scene_triggers.id=2（trigger_type='story'、once_only=true）的 story_id 临时指向对话 id=1：
//        UPDATE scene_triggers SET story_id = 1 WHERE id = 2;      -- 跑之前
//        UPDATE scene_triggers SET story_id = NULL WHERE id = 2;   -- 跑完后还原
//   3) 玩家数据：脚本每次自动注册一个全新账号（s5smokeXXXXXX），因此无需清理历史 player_quests /
//      inventory_items；断言 ③⑤⑥ 依赖「该账号未曾接过任务、背包为空」这一初始态。
//
// 断言 ⑨ 依赖 mock-redis 的 SET NX / EX 语义（`scripts/mock-redis.js`）：
//   NX 缺失会让一次性剧情锁恒成功（二次触发不被拒）；EX 秒数过大被静默改成 1ms 会让锁瞬间失效
//   （二次触发同样不被拒）。脚本用内置的极简 RESP 客户端直接读写该锁键，把这两点一并证伪。
import net from 'node:net';

const API = (process.env.SMOKE_API || 'http://localhost:3000').replace(/\/+$/, '');
const REDIS_HOST = process.env.SMOKE_REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.SMOKE_REDIS_PORT || '6379', 10);
const STORY_TRIGGER_ID = process.env.SMOKE_STORY_TRIGGER_ID || '2';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const BLACKSMITH_SPAWN_ID = '12';
const DIALOGUE_CODE = 'npc_blacksmith_main';
const QUEST_TEMPLATE_ID = '1';
const ITEM_TEMPLATE_ID = '1';
const SUBMIT_OPTION_TEXT = '提交任务';
const GIVE_ITEM_OPTION_TEXT = '给我点矿石';
const TMP_DIALOGUE_CODE = 'smoke_tmp_take_item';
const TMP_TAKE_QUANTITY = 999; // 远大于脚本内该玩家的持有量，制造「数量不足」

const run = Date.now().toString(36).slice(-6);
const USER = {
  username: `s5smoke${run}`,
  password: 'smoke123456',
  nickname: `s5smoke${run}`,
  deviceId: `smoke-s5-${run}`,
};

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
  if (reg.payload?.code !== 0) throw new Error(`注册失败：${JSON.stringify(reg.payload)}`);
  return reg.payload.data;
}

const talk = (token, spawnId) =>
  call('POST', `/api/client/v1/world/npcs/${spawnId}/talk`, { token });
const choose = (token, body) => call('POST', '/api/client/v1/world/dialogue/choose', { token, body });
const triggerStory = (token, id) =>
  call('POST', `/api/client/v1/world/triggers/${id}/story`, { token });

/** 背包内某道具的总数量（inventory/list 返回 InventoryItem[]） */
async function itemCount(token, itemTemplateId) {
  const res = await call('GET', '/api/client/v1/inventory/list', { token });
  if (res.payload?.code !== 0 || !Array.isArray(res.payload.data)) {
    throw new Error(`背包查询失败：${JSON.stringify(res.payload)}`);
  }
  return res.payload.data
    .filter((it) => String(it.itemTemplateId) === String(itemTemplateId))
    .reduce((sum, it) => sum + Number(it.quantity ?? 0), 0);
}

// ===== 极简 RESP 客户端（零依赖，仅用于清理/校验开发用 mock-redis 的一次性锁键）=====
function redisCmd(...args) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(REDIS_PORT, REDIS_HOST);
    let buf = '';
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn(value);
    };
    const timer = setTimeout(() => done(reject, new Error('mock-redis 响应超时')), 3000);
    socket.setEncoding('utf8');
    socket.on('error', (err) => done(reject, err));
    socket.on('connect', () => {
      let out = `*${args.length}\r\n`;
      for (const a of args) {
        const s = String(a);
        out += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
      }
      socket.write(out);
    });
    socket.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\r\n');
      if (nl === -1) return;
      const head = buf.slice(0, nl);
      if (head[0] === ':') return done(resolve, parseInt(head.slice(1), 10));
      if (head[0] === '$') {
        const len = parseInt(head.slice(1), 10);
        return done(resolve, len === -1 ? null : buf.slice(nl + 2, nl + 2 + len));
      }
      return done(resolve, head.slice(1));
    });
  });
}

// ===== 临时对话（断言 ⑦：take_item 数量不足 → 业务码，不推进节点）=====
const TMP_NODES = [
  {
    key: 'root',
    speaker: '临时校验',
    text: `把你身上的矿石交 ${TMP_TAKE_QUANTITY} 个给我。`,
    options: [
      {
        text: `交出 ${TMP_TAKE_QUANTITY} 个矿石`,
        action: 'take_item',
        actionArgs: { itemTemplateId: ITEM_TEMPLATE_ID, quantity: TMP_TAKE_QUANTITY },
        next: 'ok',
      },
      { text: '算了' },
    ],
  },
  { key: 'ok', text: '收到。', options: [{ text: '好' }] },
];

/** 幂等准备临时对话：已存在则（重新）启用，返回 id */
async function ensureTmpDialogue(adminToken) {
  const created = await call('POST', '/api/admin/v1/world/dialogue', {
    token: adminToken,
    body: { code: TMP_DIALOGUE_CODE, title: 'S5 冒烟临时：take_item 数量不足', nodes: TMP_NODES },
  });
  if (created.payload?.code === 0) {
    return { id: String(created.payload.data.id), created: true };
  }
  const listed = await call(
    'GET',
    `/api/admin/v1/world/dialogue/list?keyword=${TMP_DIALOGUE_CODE}&limit=20`,
    { token: adminToken },
  );
  const found = (listed.payload?.data?.items ?? []).find((d) => d.code === TMP_DIALOGUE_CODE);
  if (!found) {
    throw new Error(`临时对话创建失败且列表中找不到：${JSON.stringify(created.payload)}`);
  }
  await call('PUT', `/api/admin/v1/world/dialogue/${found.id}`, {
    token: adminToken,
    body: { nodes: TMP_NODES, isActive: true },
  });
  return { id: String(found.id), created: false };
}

async function cleanupTmpDialogue(adminToken, id) {
  if (!adminToken || !id) return;
  const res = await call('PUT', `/api/admin/v1/world/dialogue/${id}`, {
    token: adminToken,
    body: { isActive: false },
  });
  console.log(`[清理] 临时对话 id=${id} 置为停用：code=${res.payload?.code} msg=${res.payload?.msg}`);
}

// ===== 主流程 =====

const ctx = { adminToken: null, tmpDialogueId: null };
const STORY_LOCK_KEY = `world:story:once:${STORY_TRIGGER_ID}`;

async function main() {
  const health = await call('GET', '/health').catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error('后端未启动，请先运行 mock-redis 与 npm run start:dev');
  }
  console.log(`  后端 /health 可达（${API}）`);

  // ── ① 登录（脚本自建全新账号，保证「未接任务 / 背包为空」初始态）──
  const me = await auth(USER);
  check(
    '① 登录拿到客户端 token/playerId（全新账号，干净初始态）',
    Boolean(me.token && me.playerId),
    `username=${USER.username} playerId=${me.playerId} token=${String(me.token).slice(0, 12)}…`,
  );
  if (!me.token) throw new Error('登录失败，后续断言无法执行');

  // ── ② talk 返回对话节点 ──
  const t1 = await talk(me.token, BLACKSMITH_SPAWN_ID);
  const d1 = t1.payload?.data ?? {};
  check(
    '② talk(spawnId=12) 返回对话节点（code/nodeKey/options）',
    t1.payload?.code === 0 &&
      d1.code === DIALOGUE_CODE &&
      d1.nodeKey === 'root' &&
      Array.isArray(d1.options) &&
      d1.options.length > 0,
    `code=${t1.payload?.code} dialogueCode=${d1.code} nodeKey=${d1.nodeKey} text="${d1.text}" options=${d1.options?.length}`,
  );

  // ── ③ 选项条件过滤：未接任务时「提交任务」不可见 ──
  const submitRawIndex = 2; // 种子 root 的原始下标 2 = 「提交任务」（带 condition.questId）
  const texts1 = (d1.options ?? []).map((o) => o.text);
  check(
    '③ 未接任务时「提交任务」选项被服务端隐藏（options=3 且 optionIndexes 不含 2）',
    d1.options?.length === 3 &&
      Array.isArray(d1.optionIndexes) &&
      d1.optionIndexes.join(',') === '0,1,3' &&
      !d1.optionIndexes.includes(submitRawIndex) &&
      !texts1.includes(SUBMIT_OPTION_TEXT),
    `options=${d1.options?.length} optionIndexes=[${d1.optionIndexes}] texts=[${texts1.join(' | ')}]`,
  );

  // ── ④ 选「接任务」分支推进 ──
  const acceptIndex = d1.optionIndexes?.[0];
  check(
    '④ talk 返回的 optionIndexes[0] 即「接任务」原始下标 0',
    acceptIndex === 0 && texts1[0] === '我想找点事做',
    `optionIndexes[0]=${acceptIndex} text="${texts1[0]}"`,
  );
  const c1 = await choose(me.token, {
    code: d1.code ?? DIALOGUE_CODE,
    nodeKey: d1.nodeKey ?? 'root',
    optionIndex: acceptIndex,
  });
  check(
    '④ choose(接任务) 返回 code=0 且推进到 accepted 节点',
    c1.payload?.code === 0 && c1.payload?.data?.nodeKey === 'accepted',
    `code=${c1.payload?.code} nodeKey=${c1.payload?.data?.nodeKey} text="${c1.payload?.data?.node?.text}"`,
  );

  // ── ⑤ player_quests 出现该玩家该任务记录 ──
  const quests = await call('GET', '/api/client/v1/quest/list', { token: me.token });
  const mine = (quests.payload?.data ?? []).find(
    (x) => String(x.playerQuest?.questTemplateId) === QUEST_TEMPLATE_ID,
  );
  check(
    `⑤ quest/list 出现该玩家的任务记录（questTemplateId=${QUEST_TEMPLATE_ID}）`,
    quests.payload?.code === 0 &&
      Boolean(mine) &&
      mine.playerQuest.status === 'in_progress',
    `记录=${mine ? `playerQuestId=${mine.playerQuest.id} status=${mine.playerQuest.status} template="${mine.template?.name}"` : '无'} 共${quests.payload?.data?.length ?? 0}条`,
  );

  // ── ⑥ 选「给道具」分支 → 背包数量增加 ──
  const t2 = await talk(me.token, BLACKSMITH_SPAWN_ID);
  const d2 = t2.payload?.data ?? {};
  const giveIndex = (d2.options ?? []).findIndex((o) => o.text === GIVE_ITEM_OPTION_TEXT);
  const rawGiveIndex = d2.optionIndexes?.[giveIndex];
  const beforeCount = await itemCount(me.token, ITEM_TEMPLATE_ID);
  const c2 = await choose(me.token, {
    code: d2.code ?? DIALOGUE_CODE,
    nodeKey: d2.nodeKey ?? 'root',
    optionIndex: rawGiveIndex,
  });
  const afterCount = await itemCount(me.token, ITEM_TEMPLATE_ID);
  check(
    `⑥ choose(给道具) 后背包道具 ${ITEM_TEMPLATE_ID} 数量增加（差值 = 1）`,
    c2.payload?.code === 0 && afterCount - beforeCount === 1,
    `optionIndex=${rawGiveIndex} code=${c2.payload?.code} nodeKey=${c2.payload?.data?.nodeKey}；背包 ${beforeCount} → ${afterCount}（Δ=${afterCount - beforeCount}）`,
  );

  // ── ⑦ take_item 数量不足 → 业务码，不推进节点 ──
  const adminLogin = await call('POST', '/api/admin/v1/login', {
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  ctx.adminToken = adminLogin.payload?.data?.token ?? null;
  if (adminLogin.payload?.code !== 0 || !ctx.adminToken) {
    throw new Error(`admin 登录失败：${JSON.stringify(adminLogin.payload)}`);
  }
  console.log(`  admin 登录成功（token=${ctx.adminToken.slice(0, 12)}…）`);

  const tmp = await ensureTmpDialogue(ctx.adminToken);
  ctx.tmpDialogueId = tmp.id;
  console.log(
    `  临时 take_item 对话 id=${tmp.id}（${tmp.created ? '本次新建' : '已存在，已重新启用'}）quantity=${TMP_TAKE_QUANTITY}`,
  );
  const holdCount = await itemCount(me.token, ITEM_TEMPLATE_ID);
  const c3 = await choose(me.token, {
    code: TMP_DIALOGUE_CODE,
    nodeKey: 'root',
    optionIndex: 0,
  });
  check(
    '⑦ take_item 数量不足 → 返回业务码（20002 ITEM_NOT_ENOUGH）且不推进节点',
    c3.payload?.code === 20002 && !c3.payload?.data?.nodeKey,
    `持有=${holdCount} 需交出=${TMP_TAKE_QUANTITY} → body.code=${c3.payload?.code} msg="${c3.payload?.msg}"`,
  );

  // ── ⑧ 剧情触发首次成功（前置：scene_triggers.story_id 已临时指向对话 id=1）──
  try {
    const deleted = await redisCmd('DEL', STORY_LOCK_KEY);
    console.log(`  [前置] 清理一次性锁键 ${STORY_LOCK_KEY} → DEL=${deleted}（令首次触发必然成功）`);
  } catch (err) {
    console.log(`  [前置] 清理锁键失败（${err.message}）：若断言 ⑧ 失败请重启 mock-redis 后重跑`);
  }
  const s1 = await triggerStory(me.token, STORY_TRIGGER_ID);
  const lockExists = await redisCmd('EXISTS', STORY_LOCK_KEY).catch(() => -1);
  check(
    `⑧ 剧情触发首次成功（trigger=${STORY_TRIGGER_ID} → 对话首节点，且一年期锁已落库）`,
    s1.payload?.code === 0 &&
      s1.payload?.data?.nodeKey === 'root' &&
      s1.payload?.data?.code === DIALOGUE_CODE &&
      lockExists === 1,
    `body.code=${s1.payload?.code} dialogueCode=${s1.payload?.data?.code} nodeKey=${s1.payload?.data?.nodeKey}；` +
      `EXISTS ${STORY_LOCK_KEY} = ${lockExists}` +
      (s1.payload?.code === 43001 ? '（story_id 未配置？见脚本头部前置条件 2）' : ''),
  );

  // ── ⑨ 二次触发被拒（一次性锁生效，依赖 mock-redis 的 NX + EX 语义）──
  const s2 = await triggerStory(me.token, STORY_TRIGGER_ID);
  check(
    `⑨ 二次触发被拒（返回 43002 DIALOGUE_CONDITION_NOT_MET）`,
    s2.payload?.code === 43002,
    `第二次 body.code=${s2.payload?.code} msg="${s2.payload?.msg}"（期望 43002）`,
  );

  console.log(failed === 0 ? '\nS5 对话冒烟全部通过' : `\nS5 对话冒烟失败 ${failed} 项`);
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
    try {
      await cleanupTmpDialogue(ctx.adminToken, ctx.tmpDialogueId);
    } catch (err) {
      console.error(`[清理] 停用临时对话失败：${err.message}`);
    }
    try {
      const deleted = await redisCmd('DEL', STORY_LOCK_KEY);
      console.log(`[清理] 删除一次性锁键 ${STORY_LOCK_KEY} → DEL=${deleted}`);
    } catch (err) {
      console.error(`[清理] 删除锁键失败：${err.message}`);
    }
    process.exit(exitCode);
  });