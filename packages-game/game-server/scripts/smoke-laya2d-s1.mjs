// S1 冒烟：HTTP 登录 → 进场景 → 双端移动互见 → 物件采集 → NPC 对话
// 用法：node scripts/smoke-laya2d-s1.mjs     （需先启动 mock-redis 与 game-server）
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const here = dirname(fileURLToPath(import.meta.url));
const API = process.env.SMOKE_API || 'http://localhost:3000';
const CONFIG_DIR = join(here, '..', '..', 'game-client', 'assets', 'config');
const USER_A = { username: 'spike01', password: 'spike123456', nickname: 'spike01', deviceId: 'smoke-s1-a' };
const USER_B = { username: 'spike02', password: 'spike123456', nickname: 'spike02', deviceId: 'smoke-s1-b' };

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

// 服务端用 @SubscribeMessage(cmd) 订阅，事件名即 cmd；handler 直接 return 时答案走 socket.io ack 回调
// （与 game-client/src/net/ws.ts 的 send() 一致）
function send(socket, cmd, data) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WS 请求超时：${cmd}`)), 8000);
    socket.emit(cmd, { cmd, seq: 1, data }, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

async function main() {
  // 0. 依赖
  const health = await call('GET', '/health').catch(() => null);
  check('后端 /health 可达', Boolean(health));
  if (!health) throw new Error('后端未启动，请先运行 mock-redis 与 npm run start:dev');

  // 1. 配置包
  const manifest = JSON.parse(readFileSync(join(CONFIG_DIR, 'manifest.json'), 'utf8'));
  const item = manifest.scenes[0];
  const cfg = JSON.parse(readFileSync(join(CONFIG_DIR, item.file), 'utf8'));
  check('配置包含静态物件与 NPC', cfg.staticEntities.length > 0 && cfg.fixedNpcs.length > 0,
    `物件=${cfg.staticEntities.length} NPC=${cfg.fixedNpcs.length} 触发器=${cfg.triggers.length}`);

  // 2. 登录
  const a = await auth(USER_A);
  const b = await auth(USER_B);
  check('HTTP 登录拿到 token/playerId', Boolean(a.token && a.playerId && b.token && b.playerId),
    `A=${a.playerId} B=${b.playerId}`);

  // 3. 进场景
  const sa = await connect(a.token);
  const sb = await connect(b.token);
  const enterA = await send(sa, 'world.enter-scene', { sceneId: cfg.sceneId });
  check('world.enter-scene 应答 world.enter_scene_sync',
    enterA?.cmd === 'world.enter_scene_sync' && enterA?.code === 0, `cmd=${enterA?.cmd} code=${enterA?.code}`);
  const sync = enterA?.data ?? {};
  check('进场景返回 scene/spawns/triggers',
    Boolean(sync.scene) && Array.isArray(sync.spawns) && Array.isArray(sync.triggers),
    `spawns=${sync.spawns?.length} triggers=${sync.triggers?.length}`);
  check('触发器按场景过滤未串场（总数等于配置包 triggers）',
    (sync.triggers?.length ?? -1) === cfg.triggers.length,
    `服务端=${sync.triggers?.length} 配置包=${cfg.triggers.length}`);

  // 4. 双端移动互见
  const broadcastSeen = new Promise((resolve) => {
    const handler = (m) => {
      if (m?.cmd === 'world.entity_update' && String(m.data?.playerId) === String(a.playerId)) {
        sb.off('message', handler);
        resolve(m);
      }
    };
    sb.on('message', handler);
  });
  await send(sb, 'world.enter-scene', { sceneId: cfg.sceneId });
  sa.emit('world.move', { cmd: 'world.move', seq: 999001, data: { x: 700, y: 500, rotation: 0, state: 'move' } });
  const seen = await Promise.race([
    broadcastSeen,
    new Promise((r) => setTimeout(() => r(null), 6000)),
  ]);
  check('B 端收到 A 的 world.entity_update 广播', Boolean(seen),
    seen ? `entityId=${seen.data.entityId} pos=${JSON.stringify(seen.data.pos)}` : '6s 内未收到');

  // 5. 物件采集
  const target = cfg.staticEntities[0];
  const interact = await call('POST', `/api/client/v1/world/objects/${target.templateId}/interact`,
    { token: a.token, body: { interactType: target.interact.type } });
  check('物件采集接口返回 code=0', interact.payload?.code === 0,
    `templateId=${target.templateId} type=${target.interact.type} → ${JSON.stringify(interact.payload).slice(0, 120)}`);

  // 6. NPC 对话
  const npc = cfg.fixedNpcs[0];
  const talk = await call('POST', `/api/client/v1/world/npcs/${npc.spawnId}/talk`, { token: a.token });
  check('NPC 对话接口返回非空文案', talk.payload?.code === 0 && Boolean(talk.payload?.data?.text),
    `spawnId=${npc.spawnId} → text=${talk.payload?.data?.text}`);

  sa.close();
  sb.close();

  console.log(failed === 0 ? '\nS1 冒烟全部通过' : `\nS1 冒烟失败 ${failed} 项`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`冒烟脚本异常：${err.message}`);
  process.exit(1);
});