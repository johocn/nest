// 包体门禁（零依赖，只用 node: 内置模块）。判定微信小游戏产物目录「能否上传」：
//   (a) 主包体积 ≤4MB      (b) 总包体积 ≤20MB
//   (c) config/manifest.json 与场景文件存在，且逐文件 sha256 与 manifest.hash 一致
//   (d) 引擎脚本顺序 laya.core.js → laya.webgl_2D.js → laya.ui2.js（容忍 IDE 版本管理的 `-<hash>` 后缀）
//   小游戏会多一条 libs/laya.adapter-weixin.js（WXPub.onSetup 追加），不参与顺序判定
//   (e) 配置注入时机：Laya.PlayerConfig 先于 Laya.init 生效（H5 有独立 player-config.js，小游戏内联）
//   (f) 产物新鲜度：产物**代码**不得早于 src/（取「src 文件最新 mtime」与「git 最近提交 src 的时间」的较大者）
//
// 用法（cwd = packages-game/game-client）：
//   node tools/check-package.mjs [--target <dir>] [--entry <file>] [--src <dir>]
//                                [--main-max-mb 4] [--total-max-mb 20] [--no-freshness]
//   默认 target = release/wxgame（IDE「构建/发布 → 微信小游戏」的产物目录）
//   --entry 覆盖入口文件识别；--no-freshness 关闭 (f)（产物由「复制」装配时 mtime 语义不可靠）
//
// 退出码：0 全部通过 / 1 有检查项不通过 / 2 用法或前置错误（target 不存在、入口找不到等）
//
// ⚠️ 布局假设（**待 Task 5 Step 2 用真实导出确认**，不同则改这里的候选表，脚本不猜）：
//   入口文件：index.html → game.js → index.js → main.js；业务入口：js/boot/Main.js → js/bundles/bundle.js → js/index.js。
//   (e) 两种已核实布局：H5 = 入口页引用独立 `js/player-config.js` 且早于业务入口；
//   小游戏 = IDE 的 `common/index.js` 把 `Object.assign(Laya.PlayerConfig, …)` 与 `Laya.init` 内联在同一脚本里。
//   找不到入口即 FAIL 并打印目录顶层，由 `--entry` 指定，绝不静默放过。
//
// 主包口径：总包减去 `game.json` 里 `subpackages[].root` 声明的目录；无 game.json / 无分包时主包 = 总包。
// sha256 口径与 game-server 导出、tools/publish.mjs、tools/check-config.mjs 同源：`sha256:<64 位小写 hex>`。
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const LOG = '[check-package]';
const MB = 1024 * 1024;

const ENTRY_CANDIDATES = ['index.html', 'game.js', 'index.js', 'main.js'];
const BOOT_CANDIDATES = ['js/boot/Main.js', 'boot/Main.js', 'js/bundles/bundle.js', 'js/index.js'];
const ENGINE_SCRIPTS = ['laya.core.js', 'laya.webgl_2D.js', 'laya.ui2.js'];
const PLAYER_CONFIG = 'js/player-config.js';
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

// ── 参数 ────────────────────────────────────────────────────────────────────
function usage(message) {
  if (message) console.error(`错误：${message}`);
  console.error('用法：node tools/check-package.mjs [--target <dir>] [--entry <file>] [--src <dir>]');
  console.error('                              [--main-max-mb 4] [--total-max-mb 20] [--no-freshness]');
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) usage(`未知参数 ${a}`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));
const resolveFromRoot = (v) => (isAbsolute(v) ? v : resolve(root, v));

function numArg(key, dflt) {
  const raw = argv[key] === undefined ? dflt : argv[key];
  if (raw === true) usage(`--${key} 缺少数值`);
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) usage(`--${key} 非法：${raw}`);
  return n;
}

const targetDir = resolveFromRoot(argv.target === undefined || argv.target === true ? join('release', 'wxgame') : String(argv.target));
const srcDir = resolveFromRoot(argv.src === undefined || argv.src === true ? 'src' : String(argv.src));
const mainMaxMb = numArg('main-max-mb', 4);
const totalMaxMb = numArg('total-max-mb', 20);
const checkFreshness = argv['no-freshness'] !== true;

if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
  console.error(`${LOG} 目标目录不存在：${targetDir}`);
  console.error('  → 请在 LayaAir IDE「构建/发布 → 微信小游戏」导出产物，或用 --target 指定实际目录');
  process.exit(2);
}

// ── 工具 ────────────────────────────────────────────────────────────────────
/** 目录下所有文件的相对路径（posix 风格，已排序；与 tools/publish.mjs 同实现） */
function walkFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop();
    for (const ent of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) stack.push(r);
      else out.push(r);
    }
  }
  return out.sort();
}

const sha256File = (path) => `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
const mb = (bytes) => Math.round((bytes / MB) * 100) / 100;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 在入口文本里定位脚本的首次出现，**容忍 IDE「版本管理」插入的 hash 后缀**。
 * IDE 的 addHashToFileName 把 `-<hash>` 插在扩展名前（`libs/laya.core.js` → `libs/laya.core-a1b2c.js`），
 * 所以不能直接 indexOf 文件名，须按「主干 + 可选 -<hash> + 扩展名」匹配。
 * 返回 { index, matched }，未命中时 index = -1。
 */
function findScript(text, name) {
  const dot = name.lastIndexOf('.');
  const re = new RegExp(`${escapeRe(name.slice(0, dot))}(?:-[0-9A-Za-z]+)?${escapeRe(name.slice(dot))}`);
  const m = re.exec(text);
  return m === null ? { index: -1, matched: null } : { index: m.index, matched: m[0] };
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${detail}`);
  return pass;
}

console.log(`${LOG} 目标：${targetDir}`);
console.log(`${LOG} 阈值：主包 ≤${mainMaxMb}MB、总包 ≤${totalMaxMb}MB${checkFreshness ? '' : '（已关闭新鲜度检查）'}`);

// ── (a)(b) 包体体积 ─────────────────────────────────────────────────────────
/** `game.json` 里声明的分包根目录（无 game.json / 无分包 → 空数组，主包 = 总包） */
function subpackageRoots() {
  const p = join(targetDir, 'game.json');
  if (!existsSync(p)) return [];
  let doc;
  try {
    doc = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
  const list = doc?.subpackages ?? doc?.subPackages ?? [];
  if (!Array.isArray(list)) return [];
  return list
    .map((s) => (typeof s?.root === 'string' ? s.root.replace(/^\.?\//, '').replace(/\/$/, '') : null))
    .filter((r) => r !== null && r.length > 0);
}

const files = walkFiles(targetDir);
const sizeOf = (rel) => statSync(join(targetDir, rel)).size;
const totalBytes = files.reduce((n, rel) => n + sizeOf(rel), 0);
const roots = subpackageRoots();
const inSub = (rel) => roots.some((r) => rel === r || rel.startsWith(`${r}/`));
const mainBytes = files.filter((rel) => !inSub(rel)).reduce((n, rel) => n + sizeOf(rel), 0);

// 「产物新鲜度」只看**每次导出都会重写的构建产物**，不看被搬运进来的资源目录：
//   config/（publish 从 gamedata 复制）、assets/ libs/ vendor/（IDE 从工程/引擎目录复制）——
//   Windows 的 CopyFileW 会保留源 mtime，把它们算进来会让 (f) 恒 FAIL（S9 Task 5 Step 2 实测踩到）。
//   判据仍是「有没有忘了在改完 src 后重新导出」：入口/游戏脚本的时间就代表导出时刻。
const COPY_ASSEMBLED_DIRS = ['config', 'assets', 'libs', 'vendor'];
const pkgFiles = files.filter((rel) => !COPY_ASSEMBLED_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`)));
const pkgTs = pkgFiles.length > 0 ? Math.min(...pkgFiles.map((rel) => statSync(join(targetDir, rel)).mtimeMs)) : 0;

check(
  '主包体积',
  mainBytes <= mainMaxMb * MB,
  `${mb(mainBytes)}MB ≤ ${mainMaxMb}MB（${files.length} 个文件${roots.length > 0 ? `，分包根 ${roots.join('、')}` : '，无分包'}）`,
);
check('总包体积', totalBytes <= totalMaxMb * MB, `${mb(totalBytes)}MB ≤ ${totalMaxMb}MB`);

// ── (c) 配置包：manifest + 场景文件 + hash ──────────────────────────────────
const manifestPath = join(targetDir, 'config', 'manifest.json');
let configOk = false;
if (!existsSync(manifestPath)) {
  check('config 配置包', false, `缺少 config/manifest.json\n  → 请先执行 node tools/publish.mjs wxgame-config`);
} else {
  const issues = [];
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    issues.push(`manifest.json 不是合法 JSON：${e.message}`);
  }
  const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
  if (issues.length === 0 && scenes.length === 0) issues.push('manifest.scenes 为空');
  for (const item of scenes) {
    const file = item?.file;
    if (typeof file !== 'string' || file.length === 0) {
      issues.push(`scenes 项缺少 file：${JSON.stringify(item)}`);
      continue;
    }
    const p = join(targetDir, 'config', file);
    if (!existsSync(p)) {
      issues.push(`缺少场景文件 config/${file}`);
      continue;
    }
    if (!HASH_PATTERN.test(item?.hash ?? '')) {
      issues.push(`${file} 的 manifest.hash 非法：${item?.hash}`);
      continue;
    }
    const actual = sha256File(p);
    if (actual !== item.hash) issues.push(`${file} 的 hash 不一致（实际 ${actual.slice(0, 20)}… 期望 ${String(item.hash).slice(0, 20)}…）`);
  }
  configOk = issues.length === 0;
  check(
    'config 配置包',
    configOk,
    configOk ? `manifest + ${scenes.length} 个场景文件，hash 全部匹配` : issues.join('；'),
  );
}

// ── (d)(e) 入口：引擎脚本顺序 + player-config 时机 ──────────────────────────
function resolveEntry() {
  if (argv.entry !== undefined && argv.entry !== true) {
    const p = resolveFromRoot(String(argv.entry));
    if (!existsSync(p)) {
      console.error(`${LOG} --entry 指定的文件不存在：${p}`);
      process.exit(2);
    }
    return { path: p, how: '--entry 指定' };
  }
  for (const rel of ENTRY_CANDIDATES) {
    const p = join(targetDir, rel);
    if (existsSync(p)) return { path: p, how: '自动识别' };
  }
  return null;
}

const entry = resolveEntry();
if (!entry) {
  check(
    '入口文件识别',
    false,
    `候选 ${ENTRY_CANDIDATES.join(' → ')} 均不存在（目录顶层：${readdirSync(targetDir).slice(0, 20).join('、')}）\n` +
      `  → 若真实导出结构不同，用 --entry <相对路径> 指定`,
  );
} else {
  const text = readFileSync(entry.path, 'utf8');
  console.log(`${LOG} 入口：${entry.path}（${entry.how}）`);

  // (d) 引擎脚本顺序：三者都出现且首次出现位置严格递增（容忍 IDE 版本管理的 `-<hash>` 后缀）
  const found = ENGINE_SCRIPTS.map((n) => findScript(text, n));
  const idx = found.map((f) => f.index);
  const missing = ENGINE_SCRIPTS.filter((_, i) => idx[i] === -1);
  const ordered = missing.length === 0 && idx[0] < idx[1] && idx[1] < idx[2];
  check(
    '引擎脚本顺序',
    ordered,
    missing.length > 0
      ? `入口未引用 ${missing.join('、')}`
      : ENGINE_SCRIPTS.map((n, i) => `${found[i].matched}@${idx[i]}`).join(' < '),
  );

  // (e) 配置注入时机：Laya.PlayerConfig 必须先于 Laya.init 生效。两种布局各按各的口径判：
  //   H5      —— 入口页引用独立 js/player-config.js，位置必须早于业务入口（此时 PlayerConfig 与 init 不在同一文件，位置即顺序）
  //   小游戏  —— 无独立文件：IDE 的 common/index.js 同时含 PlayerConfig 赋值与 Laya.init，判同文件内的先后
  // 两处口径不同，别混：
  //   H5 分支在**入口文本里找子串** → 必须走 findScript（开版本管理时引用名带 -<hash>，纯 indexOf 会落空）
  //   小游戏分支在**磁盘上按字面量路径取文件** → 无需容忍 hash：IDE 的 addHashToFileName 会同步重命名磁盘文件，
  //                                        game.js 引用什么、磁盘就叫什么，直接命中
  const pc = findScript(text, PLAYER_CONFIG);
  if (pc.index !== -1) {
    const bootIdx = BOOT_CANDIDATES.map((rel) => findScript(text, rel).index).filter((i) => i !== -1);
    const bootAt = bootIdx.length > 0 ? Math.min(...bootIdx) : -1;
    const pcOk = bootAt !== -1 && pc.index < bootAt;
    check(
      '配置注入时机',
      pcOk,
      pcOk
        ? `H5：${pc.matched}@${pc.index} < 业务入口@${bootAt}`
        : `H5：${pc.matched}@${pc.index} 业务入口@${bootAt}（候选 ${BOOT_CANDIDATES.join('/')}）`,
    );
  } else {
    // 入口 require 的**相对路径**文件（小游戏 game.js 用 require；H5 的 /base/ 绝对路径在此不参与）
    const rels = [...text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .map((m) => m[1])
      .filter((p) => !p.startsWith('/') && !p.startsWith('.'));
    let hit = null;
    for (const rel of rels) {
      const p = join(dirname(entry.path), rel);
      if (!existsSync(p)) continue;
      const t = readFileSync(p, 'utf8');
      const pi = t.indexOf('Laya.PlayerConfig');
      if (pi === -1) continue;
      hit = { file: rel, pi, ii: t.indexOf('Laya.init') };
      break;
    }
    const ok = hit !== null && hit.ii !== -1 && hit.pi < hit.ii;
    check(
      '配置注入时机',
      ok,
      hit === null
        ? `小游戏：入口 require 的 ${rels.length} 个文件里找不到 Laya.PlayerConfig 赋值（入口 ${entry.path}）`
        : hit.ii === -1
          ? `小游戏：${hit.file} 内只见 Laya.PlayerConfig@${hit.pi}，未找到 Laya.init`
          : `小游戏：${hit.file} 内 Laya.PlayerConfig@${hit.pi} ${hit.pi < hit.ii ? '<' : '>'} Laya.init@${hit.ii}`,
    );
  }
}

// ── (f) 产物新鲜度 ──────────────────────────────────────────────────────────
if (checkFreshness) {
  if (!existsSync(srcDir)) {
    check('产物新鲜度', false, `源码目录不存在：${srcDir}（可用 --src 指定，或 --no-freshness 关闭）`);
  } else {
    const srcFiles = walkFiles(srcDir);
    const srcMtime = srcFiles.length > 0 ? Math.max(...srcFiles.map((rel) => statSync(join(srcDir, rel)).mtimeMs)) : 0;
    let gitTs = 0;
    try {
      const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', srcDir], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'], // src 在仓库外时 git 会打 fatal 到 stderr，这里吞掉
      }).trim();
      if (out.length > 0) gitTs = Number(out) * 1000;
    } catch {
      gitTs = 0; // 无 git / 不在仓库内：退化为纯 mtime 口径
    }
    const srcTs = Math.max(srcMtime, Number.isFinite(gitTs) ? gitTs : 0);
    const fmt = (ms) => (ms > 0 ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : 'n/a');
    check(
      '产物新鲜度',
      pkgFiles.length > 0 && pkgTs >= srcTs,
      `产物代码 ${fmt(pkgTs)} ≥ 源码 ${fmt(srcTs)}（产物 ${pkgFiles.length}/${files.length} 个文件计入，` +
        `已排除 ${COPY_ASSEMBLED_DIRS.join('/')}；mtime ${fmt(srcMtime)} / git ${fmt(gitTs)}）`,
    );
  }
}

// ── 结论 ────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`${LOG} 未通过 ${failed.length}/${results.length} 项：${failed.map((r) => r.name).join('、')}`);
  console.error('包体检查失败');
  process.exit(1);
}
console.log(`${LOG} 全部通过（${results.length}/${results.length}）`);
console.log('包体检查通过');
