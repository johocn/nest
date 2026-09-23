// 配置包随包分发：把 game-server/gamedata 里「manifest 指向的版本」复制进发布目录并重算 sha256 校验。
//
// 用法（零依赖，只用 node:fs / node:path / node:crypto / node:url；本脚本只做**本地文件操作**，
// 不构建、不上传、不连任何服务器 —— 上传是部署环节的事）：
//   node tools/publish.mjs h5            [--target <dir>] [--source <dir>]   → <target>/gamedata/
//   node tools/publish.mjs wxgame-config [--target <dir>] [--source <dir>]   → <target>/config/
//   --source 仅供断言脚本指向临时副本，日常发布不要传（默认 <repo>/game-server/gamedata）。
//
// 目标子目录与客户端读取口径一一对应，不允许自定义：
//   h5            → AppConfig.configBase='/gamedata'（站点根下的同名子目录）
//   wxgame-config → src/config/loader.ts 小游戏分支的 `Platform.readLocalText('config/' + file)`
//
// 两处硬性保障：
//   1) 复制前清掉目标子目录里遗留的 manifest.json / scene-*.json —— 历史版本（scene-1-v2.json 等）
//      或已下线场景不得随包发出去（整目录复制是错的）；只删该子目录内的配置文件，不动别处。
//   2) 复制后逐文件**重算文件原始字节的 sha256**，与 manifest 的 `hash` 比对，任一不符 → exit 1。
//      口径 = `sha256:<64 位小写 hex>`，与 game-server 导出、tools/check-config.mjs 同源；
//      场景文件内部的 `hash` 字段是另一层语义，本脚本不碰。
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** 子命令 → 默认目标目录与目标子目录（子目录与 loader 读取口径绑定） */
const COMMANDS = {
  h5: { defaultTarget: join('release', 'web'), subdir: 'gamedata' },
  'wxgame-config': { defaultTarget: join('release', 'wxgame'), subdir: 'config' },
};

/** 目标子目录内视为「陈旧配置包」的文件名：manifest + 任意场景文件 */
const STALE_PATTERN = /^(manifest\.json|scene-.*\.json)$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function usage(message) {
  if (message) console.error(`错误：${message}`);
  console.error('用法：node tools/publish.mjs <h5|wxgame-config> [--target <dir>] [--source <dir>]');
  console.error('  h5              → <target>/gamedata/（默认 target=release/web）');
  console.error('  wxgame-config   → <target>/config/（默认 target=release/wxgame）');
}

function fail(message) {
  console.error(`发布失败：${message}`);
  process.exit(1);
}

function parseArgv(argv) {
  const cmd = argv[0];
  if (!cmd) {
    usage('缺少子命令');
    process.exit(1);
  }
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, cmd)) {
    usage(`未知子命令 ${cmd}`);
    process.exit(1);
  }
  const opts = { target: null, source: null };
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i];
    if (key !== '--target' && key !== '--source') {
      usage(`未知参数 ${key}`);
      process.exit(1);
    }
    const value = argv[++i];
    if (!value) {
      usage(`${key} 缺少取值`);
      process.exit(1);
    }
    opts[key === '--target' ? 'target' : 'source'] = value;
  }
  return { cmd, ...opts };
}

function sha256File(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

const { cmd, target, source } = parseArgv(process.argv.slice(2));
const spec = COMMANDS[cmd];
const targetDir = isAbsolute(target ?? spec.defaultTarget)
  ? (target ?? spec.defaultTarget)
  : resolve(root, target ?? spec.defaultTarget);
const outDir = join(targetDir, spec.subdir);
const srcDir = isAbsolute(source ?? '') ? source : resolve(root, source ?? join(root, '..', 'game-server', 'gamedata'));

// ── 1. 读源 manifest（源目录缺失/为空时直接给出可执行提示）─────────────────
const manifestPath = join(srcDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  fail(`缺少 ${manifestPath}\n  → 请先在 game-server 执行 npm run config:export（必要时再 npm run config:publish）`);
}
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (e) {
  fail(`${manifestPath} 不是合法 JSON：${e.message}`);
}
const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
if (scenes.length === 0) {
  fail(`${manifestPath} 的 scenes 为空\n  → 请先在 game-server 执行 npm run config:export`);
}

const entries = [];
for (const item of scenes) {
  const file = item?.file;
  if (typeof file !== 'string' || file.length === 0) {
    fail(`manifest.scenes 项缺少 file：${JSON.stringify(item)}`);
  }
  if (!HASH_PATTERN.test(item?.hash ?? '')) {
    fail(`${file} 的 manifest.hash 非法（应为 sha256:<64 位小写十六进制>）：${item?.hash}`);
  }
  entries.push({ file, hash: item.hash });
}

const missingSrc = entries.filter((e) => !existsSync(join(srcDir, e.file)));
if (missingSrc.length > 0) {
  fail(
    `manifest 指向的文件在源目录不存在：${missingSrc.map((e) => e.file).join('、')}\n` +
      `  → 请先在 game-server 执行 npm run config:export && npm run config:publish（源目录 ${srcDir}）`,
  );
}

// ── 2. 清掉目标子目录里遗留的陈旧配置包（只删这个子目录内的配置文件）──────
mkdirSync(outDir, { recursive: true });
const removed = [];
for (const ent of readdirSync(outDir, { withFileTypes: true })) {
  if (ent.isFile() && STALE_PATTERN.test(ent.name)) {
    rmSync(join(outDir, ent.name), { force: true });
    removed.push(ent.name);
  }
}

// ── 3. 复制 manifest + manifest 指向的场景文件 ────────────────────────────
const files = [{ name: 'manifest.json', from: manifestPath }, ...entries.map((e) => ({ name: e.file, from: join(srcDir, e.file) }))];
for (const f of files) copyFileSync(f.from, join(outDir, f.name));

// ── 4. 复制后逐文件重算 sha256，与 manifest.hash 比对 ─────────────────────
// manifest.json 自身没有 hash 字段（只有 scenes[].hash），故只校验场景文件。
const expected = new Map(entries.map((e) => [e.file, e.hash]));
const mismatches = [];
console.log(`发布 ${cmd} → ${outDir}（源 ${srcDir}）`);
if (removed.length > 0) console.log(`  清理陈旧配置包 ${removed.length} 个：${removed.join('、')}`);
for (const f of files) {
  const dst = join(outDir, f.name);
  const bytes = statSync(dst).size;
  const actual = sha256File(dst);
  const want = expected.get(f.name);
  const ok = want === undefined || want === actual;
  if (!ok) mismatches.push({ file: f.name, actual, want });
  console.log(
    `  ${ok ? 'OK  ' : 'FAIL'} ${f.name}  ${bytes}B  ${actual.slice(0, 12)}…  ${dst}`,
  );
}

if (mismatches.length > 0) {
  console.error('发布失败：复制后 sha256 与 manifest.hash 不一致');
  for (const m of mismatches) {
    console.error(`  - ${m.file}：实际 ${m.actual}`);
    console.error(`    期望 ${m.want}`);
  }
  process.exit(1);
}

console.log(`summary: ${cmd} 发布 ${files.length} 个文件到 ${outDir}，sha256 校验全部通过`);