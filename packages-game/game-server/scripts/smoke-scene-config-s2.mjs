// S2 冒烟：admin 登录 → 导出 → 发布 → 静态拉取 → hash 校验 → 回滚 → 再拉取
// 用法：node scripts/smoke-scene-config-s2.mjs        （需先启动 mock-redis 与 game-server）
// 环境变量：SMOKE_API 覆盖后端地址（默认 http://localhost:3000）、SMOKE_SCENE 覆盖场景 ID（默认 1）
// 脚本自洽可重复：跑完把线上 published 版本还原为脚本开始前那个版本
import { createHash } from 'node:crypto';

const API = (process.env.SMOKE_API || 'http://localhost:3000').replace(/\/+$/, '');
const SCENE_ID = Number(process.env.SMOKE_SCENE || 1);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

let failed = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` :: ${extra}` : ''}`);
  if (!cond) failed++;
}

// —— 以下两函数与 src/modules/world/config/scene-package.builder.ts 逐字一致（D4 两端算法冻结，改一个字符配置包全红）——
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}
function sha256(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/** 统一请求：错误信封一律 HTTP 200 + {code,msg,data}，判定看 payload.code */
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
  return { status: res.status, text, payload };
}

/** 拉取静态产物原始文本（hash 按文本算，不能经过 JSON 往返） */
async function fetchText(url) {
  const res = await fetch(url);
  return { status: res.status, text: await res.text() };
}

/** 读 /gamedata/manifest.json（best effort，不抛异常） */
async function readManifest() {
  const r = await fetchText(`${API}/gamedata/manifest.json`);
  let json = null;
  try {
    json = r.status === 200 ? JSON.parse(r.text) : null;
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

function entryOf(manifest, sceneId) {
  return (manifest?.json?.scenes ?? []).find((s) => Number(s.sceneId) === sceneId) ?? null;
}

async function versions(token) {
  const { payload } = await call('GET', `/api/admin/v1/world/scene-config/${SCENE_ID}/versions`, { token });
  return payload?.data ?? null;
}

function rowOf(snapshot, version) {
  return (snapshot?.items ?? []).find((it) => it.version === version) ?? null;
}

// 恢复上下文：异常时尽力把 published 还原到脚本开始前的版本
const restoreCtx = { token: null, originalVersion: null, needRestore: false };

async function restorePublishedVersion() {
  if (!restoreCtx.needRestore || !restoreCtx.token) return;
  const { payload } = await call('POST', `/api/admin/v1/world/scene-config/${SCENE_ID}/rollback`, {
    token: restoreCtx.token,
    body: { version: restoreCtx.originalVersion },
  });
  console.log(`[恢复] rollback → v${restoreCtx.originalVersion}：code=${payload?.code} msg=${payload?.msg}`);
  if (payload?.code === 0) restoreCtx.needRestore = false;
}

async function main() {
  // 1. 登录
  const login = await call('POST', '/api/admin/v1/login', {
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  const token = login.payload?.data?.token;
  check(
    '1. admin 登录拿到 token',
    login.payload?.code === 0 && Boolean(token),
    `code=${login.payload?.code} token=${token ? `${token.slice(0, 12)}…` : '无'}`,
  );
  if (!token) throw new Error('管理员登录失败，后续断言无法执行');
  restoreCtx.token = token;

  // 2. list：场景与当前发布版本
  const list = await call('GET', '/api/admin/v1/world/scene-config/list', { token });
  const scene = (list.payload?.data?.items ?? []).find((it) => it.sceneId === SCENE_ID);
  const original = scene?.published ?? null;
  check(
    '2. config:list 返回场景与当前发布版本',
    list.payload?.code === 0 && Boolean(scene) && Boolean(original),
    `scene=${SCENE_ID} name=${scene?.name} published=${original ? `v${original.version} ${original.file} hash=${original.hash}` : '无'}`,
  );
  if (!original) throw new Error(`场景 ${SCENE_ID} 当前无 published 版本，无法验证发布/回滚`);
  restoreCtx.originalVersion = original.version;

  // 版本真源：同场景历史最大版本（export 走 max(version)+1），用于断言「原版本+1」
  const snapshotBefore = await versions(token);
  const maxBefore = Math.max(0, ...(snapshotBefore?.items ?? []).map((it) => it.version));
  console.log(`  基线：published=v${original.version}，同场景历史最大版本=v${maxBefore}`);

  // 3. export → draft，版本号自增
  const exp = await call('POST', `/api/admin/v1/world/scene-config/${SCENE_ID}/export`, { token });
  const draft = exp.payload?.data;
  check(
    '3. export 返回 version = 原版本+1 且 status=draft',
    exp.payload?.code === 0 && draft?.version === maxBefore + 1 && draft?.status === 'draft',
    `version=${draft?.version}（历史最大 v${maxBefore}）status=${draft?.status} hash=${draft?.hash}`,
  );
  if (exp.payload?.code !== 0 || draft?.status !== 'draft') throw new Error('导出未生成 draft 版本，后续断言无法执行');
  const newVersion = draft.version;
  const snapshotAfterExport = await versions(token);

  // 4. draft 不对外：manifest 仍指旧版本
  const manifest4 = await readManifest();
  const entry4 = entryOf(manifest4, SCENE_ID);
  check(
    '4. 导出后 manifest 未指向 draft 版本（draft 不对外）',
    manifest4.status === 200 && entry4?.version === original.version,
    `manifest → ${entry4 ? `v${entry4.version} ${entry4.file}` : '无该场景'}（draft=v${newVersion}）`,
  );

  // 5. publish → manifest 指新版本，且 manifest.hash == 该文件文本 sha256
  const pub = await call('POST', `/api/admin/v1/world/scene-config/${SCENE_ID}/publish`, {
    token,
    body: { version: newVersion },
  });
  restoreCtx.needRestore = true;
  const publishedRow = pub.payload?.data;
  const manifest5 = await readManifest();
  const entry5 = entryOf(manifest5, SCENE_ID);
  const file5 = entry5 ? await fetchText(`${API}/gamedata/${entry5.file}`) : { status: 0, text: '' };
  const fileHash5 = sha256(file5.text);
  check(
    '5. publish 后 manifest 指向新版本且 hash 与文件文本 sha256 一致',
    pub.payload?.code === 0 &&
      publishedRow?.status === 'published' &&
      entry5?.version === newVersion &&
      file5.status === 200 &&
      entry5?.hash === fileHash5,
    `manifest→v${entry5?.version} hash=${entry5?.hash} 自算=${fileHash5}（publish.status=${publishedRow?.status}）`,
  );
  const snapshotAfterPublish = await versions(token);

  // 6. 文件内 hash（payload hash）由 canonicalJson 重算一致
  let payloadCheck = { recomputed: '未校验', inFile: '无' };
  let payloadOk = false;
  try {
    const pkg = JSON.parse(file5.text);
    const { hash: hashInFile, ...payloadPart } = pkg;
    const recomputed = sha256(canonicalJson(payloadPart));
    payloadOk = Boolean(hashInFile) && recomputed === hashInFile;
    payloadCheck = { recomputed, inFile: hashInFile };
  } catch (err) {
    payloadCheck = { recomputed: `解析失败：${err.message}`, inFile: '无' };
  }
  check(
    '6. 新版本文件内 hash（payload）由 canonicalJson 重算一致',
    payloadOk,
    `文件=${payloadCheck.inFile} 重算=${payloadCheck.recomputed}`,
  );

  // 7. rollback → manifest 指回旧版本，旧文件仍可 200 拉取
  const rb = await call('POST', `/api/admin/v1/world/scene-config/${SCENE_ID}/rollback`, {
    token,
    body: { version: original.version },
  });
  if (rb.payload?.code === 0) restoreCtx.needRestore = false;
  const manifest7 = await readManifest();
  const entry7 = entryOf(manifest7, SCENE_ID);
  const oldFile = await fetchText(`${API}/gamedata/${original.file}`);
  check(
    '7. rollback 到旧版本后 manifest 指回旧版本，旧文件仍可 200 拉取',
    rb.payload?.code === 0 &&
      rb.payload?.data?.status === 'published' &&
      entry7?.version === original.version &&
      entry7?.file === original.file &&
      oldFile.status === 200,
    `rollback→v${rb.payload?.data?.version}；manifest→v${entry7?.version} ${entry7?.file}；GET ${original.file} → ${oldFile.status}`,
  );
  const snapshotAfterRollback = await versions(token);

  // 8. manifest 中每个 entry 的 file 均可 200 且 hash 校验通过
  const entryChecks = [];
  for (const en of manifest7?.json?.scenes ?? []) {
    const r = await fetchText(`${API}/gamedata/${en.file}`);
    entryChecks.push({
      file: en.file,
      status: r.status,
      ok: r.status === 200 && sha256(r.text) === en.hash,
    });
  }
  check(
    '8. manifest 每个 entry 的 file 均可 200 且 hash 校验通过',
    entryChecks.length > 0 && entryChecks.every((c) => c.ok),
    entryChecks.map((c) => `${c.file}:${c.status}${c.ok ? '' : '(hash 不符)'}`).join(', ') || 'manifest 无 entry',
  );

  // 9. 版本历史含 export/publish/rollback 全过程（status 变化可追溯）
  const draftRow = rowOf(snapshotAfterExport, newVersion);
  const publishedSnapshotRow = rowOf(snapshotAfterPublish, newVersion);
  const archivedRow = rowOf(snapshotAfterRollback, newVersion);
  const oldRow = rowOf(snapshotAfterRollback, original.version);
  check(
    '9. 版本历史含 export/publish/rollback 全过程记录（status 可追溯）',
    draftRow?.status === 'draft' &&
      publishedSnapshotRow?.status === 'published' &&
      archivedRow?.status === 'archived' &&
      oldRow?.status === 'published',
    `v${newVersion}: ${draftRow?.status} → ${publishedSnapshotRow?.status} → ${archivedRow?.status}；v${original.version} 终态=${oldRow?.status}`,
  );

  // 收尾：确认 published 已回到脚本开始前那个版本
  const finalManifest = await readManifest();
  const finalVersion = entryOf(finalManifest, SCENE_ID)?.version;
  if (finalVersion !== original.version) await restorePublishedVersion();
  const finalSnapshot = await versions(token);
  const publishedNow = (finalSnapshot?.items ?? []).find((it) => it.status === 'published');
  console.log(
    `\n收尾：published=v${publishedNow?.version ?? '?'}（脚本开始前 v${original.version}）${publishedNow?.version === original.version ? '，状态已还原' : '，状态未还原'}`,
  );

  console.log(failed === 0 ? '\nS2 冒烟全部通过' : `\nS2 冒烟失败 ${failed} 项`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`冒烟脚本异常：${err.message}`);
  try {
    await restorePublishedVersion();
  } catch (e) {
    console.error(`恢复线上版本失败：${e.message}`);
  }
  process.exit(1);
});