// 发布装配（零依赖，只用 node:fs / node:path / node:crypto / node:url）。
// 本脚本只做**本地文件操作**，不构建、不上传、不连任何服务器 —— 上传是部署环节的事。
//
// 用法：
//   node tools/publish.mjs h5            [--target <dir>] [--source <dir>]              → <target>/gamedata/
//   node tools/publish.mjs wxgame-config [--target <dir>] [--source <dir>]              → <target>/config/
//   node tools/publish.mjs h5-site       [--target <dir>] [--source <dir>] [--base <path>] → <target>/（整站装配）
//   node tools/publish.mjs wxgame        [--target <dir>] [--source <dir>]              → GUI 导出后的整包收尾
//   --source 仅供断言脚本指向临时副本，日常发布不要传（默认 <repo>/game-server/gamedata）。
//   --base   仅 h5-site 可用（站点挂载前缀，默认 /client/，会归一化为「以 / 开头且以 / 结尾」）。
//
// 目标子目录与客户端读取口径一一对应，不允许自定义：
//   h5            → AppConfig.configBase='/gamedata'（站点根下的同名子目录）
//   wxgame-config → src/config/loader.ts 小游戏分支的 `Platform.readLocalText('config/' + file)`
//
// wxgame（S9 Task 5 Step 2）：把「GUI 导出」之后的三件事串成一条命令 ——
//   1) 补齐 config/（复用 h5/wxgame-config 同一实现，含 hash 重算比对）
//   2) 注入生产环境（调用 tools/inject-env.mjs --env prod，产物根生成 env-config.js，
//      并在入口 game.js 里 require 它；插在 weapp-adapter 之后、业务脚本之前，重复执行不重复插入）
//   3) 跑 tools/check-package.mjs（体积 / config hash / 引擎脚本顺序 / 配置注入时机 / 新鲜度），
//      不通过即 exit 1 —— 门禁不过就不该上传
//   产物结构依据 IDE 模板 `resources/template/release/wxgame/game.js` + `release/common/index.js`：
//   入口固定为 `game.js`（内容 = require weapp-adapter → 引擎 libs → 业务 bundles → js/index.js）。
//
// 两处硬性保障（h5 / wxgame-config / h5-site 的 gamedata 部分共用同一实现）：
//   1) 复制前清掉目标子目录里遗留的 manifest.json / scene-*.json —— 历史版本（scene-1-v2.json 等）
//      或已下线场景不得随包发出去（整目录复制是错的）；只删该子目录内的配置文件，不动别处。
//   2) 复制后逐文件**重算文件原始字节的 sha256**，与 manifest 的 `hash` 比对，任一不符 → exit 1。
//      口径 = `sha256:<64 位小写 hex>`，与 game-server 导出、tools/check-config.mjs 同源；
//      场景文件内部的 `hash` 字段是另一层语义，本脚本不碰。
//
// h5-site：按「IDE 的 release/web 目录结构」把 H5 站点装配进一个目录树，并在 index.html 里把
//   `/libs/ /js/ /vendor/` 全部改写成 <base> 前缀（`/assets/`、`/gamedata` 是同源根绝对路径，
//   保持原样：/gamedata 走 nginx `location /` 反代到 node，/assets/ 由 nginx alias 到本站点目录）。
//   env-config.js 的 script 标签会被插到 Main.js **之前**，改写后做断言式自校验，失败即 exit 1。
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** 子命令 → 默认目标目录、目标子目录（子目录与 loader 读取口径绑定）、允许的参数 */
const COMMANDS = {
  h5: { defaultTarget: join('release', 'web'), subdir: 'gamedata', args: ['--target', '--source'] },
  'wxgame-config': { defaultTarget: join('release', 'wxgame'), subdir: 'config', args: ['--target', '--source'] },
  'h5-site': { defaultTarget: join('release', 'client'), args: ['--target', '--source', '--base'] },
  wxgame: { defaultTarget: join('release', 'wxgame'), subdir: 'config', args: ['--target', '--source'] },
};

/** h5-site 的装配源（相对 game-client）：与 bin/index.html 里的引用路径一一对应 */
const H5_SITE_SOURCES = {
  html: join('bin', 'index.html'),
  js: join('bin', 'js'),
  envConfig: join('bin', 'js', 'env-config.js'),
  libs: join('release', 'web', 'libs'),
  vendor: join('vendor', 'socket.io.min.js'),
  assets: 'assets',
};

/** 目标子目录内视为「陈旧配置包」的文件名：manifest + 任意场景文件 */
const STALE_PATTERN = /^(manifest\.json|scene-.*\.json)$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** h5-site：index.html 改写后**不得再出现**的裸路径（自校验关键字） */
const BARE_PATH_RESIDUE = ['src="/js/', 'src="/libs/', 'src="/vendor/'];
const DEFAULT_BASE = '/client/';

function usage(message) {
  if (message) console.error(`错误：${message}`);
  console.error('用法：node tools/publish.mjs <h5|wxgame-config|h5-site|wxgame> [--target <dir>] [--source <dir>] [--base <path>]');
  console.error('  h5              → <target>/gamedata/（默认 target=release/web）');
  console.error('  wxgame-config   → <target>/config/（默认 target=release/wxgame）');
  console.error('  h5-site         → H5 站点装配到 <target>/（默认 target=release/client，base=/client/）');
  console.error('  wxgame          → GUI 导出后收尾（config/ + prod env 注入 + 包体门禁，默认 target=release/wxgame）');
  console.error('  --source 仅供断言脚本指向临时副本（默认 <repo>/game-server/gamedata）');
  console.error('  --base   仅 h5-site 可用（归一化为以 / 开头且以 / 结尾）');
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
  const spec = COMMANDS[cmd];
  const opts = { target: null, source: null, base: null };
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i];
    if (!spec.args.includes(key)) {
      usage(`未知参数 ${key}`);
      process.exit(1);
    }
    const value = argv[++i];
    if (!value) {
      usage(`${key} 缺少取值`);
      process.exit(1);
    }
    opts[key === '--target' ? 'target' : key === '--source' ? 'source' : 'base'] = value;
  }
  return { cmd, ...opts };
}

function sha256File(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

const resolveFromRoot = (value) => (isAbsolute(value) ? value : resolve(root, value));

// ── 配置包随包分发（h5 / wxgame-config / h5-site 共用）───────────────────────
// summarize=true 时打印 h5 / wxgame-config 既有结尾文案（该文案不得改动）。
function publishConfigBundle({ cmd, targetDir, subdir, source, summarize = true }) {
  const outDir = join(targetDir, subdir);
  const srcDir = source ? resolveFromRoot(source) : resolve(root, '..', 'game-server', 'gamedata');

  // ── 1. 读源 manifest（源目录缺失/为空时直接给出可执行提示）───────────────
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
  const files = [
    { name: 'manifest.json', from: manifestPath },
    ...entries.map((e) => ({ name: e.file, from: join(srcDir, e.file) })),
  ];
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
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${f.name}  ${bytes}B  ${actual.slice(0, 12)}…  ${dst}`);
  }

  if (mismatches.length > 0) {
    console.error('发布失败：复制后 sha256 与 manifest.hash 不一致');
    for (const m of mismatches) {
      console.error(`  - ${m.file}：实际 ${m.actual}`);
      console.error(`    期望 ${m.want}`);
    }
    process.exit(1);
  }

  if (summarize) {
    console.log(`summary: ${cmd} 发布 ${files.length} 个文件到 ${outDir}，sha256 校验全部通过`);
  }
  return { outDir, files: files.map((f) => join(outDir, f.name)) };
}

// ── h5-site：站点装配（目录树同步 + index.html 改写 + 断言式自校验）──────────

/** 以 / 开头且以 / 结尾；`client` / `/client` / `/client/` 都归一化到 `/client/` */
function normalizeBase(value) {
  const raw = (value ?? DEFAULT_BASE).trim();
  if (raw.length === 0) fail('--base 不能为空');
  const withLead = raw.startsWith('/') ? raw : `/${raw}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}

/** 目录下所有文件的相对路径（posix 风格，已排序） */
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

/** 目录下所有子目录的相对路径（用于保留空目录，如 assets/config/） */
function walkDirs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop();
    for (const ent of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      out.push(r);
      stack.push(r);
    }
  }
  return out.sort();
}

/**
 * 目录树同步：全量复制 → 删掉目标内「不由本次装配产出」的陈旧文件（只清本目录，绝不 rm -rf 整个 target）。
 */
function syncTree({ from, to, label, hint, counter }) {
  if (!existsSync(from)) fail(`缺少装配源 ${from}\n  → ${hint}`);
  const rels = walkFiles(from);
  mkdirSync(to, { recursive: true });
  for (const d of walkDirs(from)) mkdirSync(join(to, d), { recursive: true });
  for (const rel of rels) {
    mkdirSync(dirname(join(to, rel)), { recursive: true });
    copyFileSync(join(from, rel), join(to, rel));
  }
  const stale = walkFiles(to).filter((rel) => !rels.includes(rel));
  for (const rel of stale) rmSync(join(to, rel), { force: true });
  console.log(`  ${label}: 复制 ${rels.length} 个文件 → ${to}${stale.length > 0 ? `（清理陈旧 ${stale.length} 个）` : ''}`);
  counter.n += rels.length;
}

/** 单文件同步（目标目录内只保留该文件） */
function syncFile({ from, toDir, label, hint, counter }) {
  if (!existsSync(from)) fail(`缺少装配源 ${from}\n  → ${hint}`);
  const name = basename(from);
  mkdirSync(toDir, { recursive: true });
  copyFileSync(from, join(toDir, name));
  for (const rel of walkFiles(toDir)) {
    if (rel !== name) rmSync(join(toDir, rel), { force: true });
  }
  console.log(`  ${label}: 复制 1 个文件 → ${join(toDir, name)}`);
  counter.n += 1;
}

function runH5Site({ target, source, base }) {
  const targetDir = resolveFromRoot(target ?? COMMANDS['h5-site'].defaultTarget);
  const normBase = normalizeBase(base);
  const counter = { n: 0 };

  const htmlSrc = join(root, H5_SITE_SOURCES.html);
  const jsSrc = join(root, H5_SITE_SOURCES.js);
  const envSrc = join(root, H5_SITE_SOURCES.envConfig);
  if (!existsSync(htmlSrc) || !existsSync(jsSrc)) {
    fail(`缺少 H5 构建产物 ${H5_SITE_SOURCES.html} / ${H5_SITE_SOURCES.js}\n  → 请先执行 node tools/build-fallback.mjs`);
  }
  if (!existsSync(envSrc)) {
    fail(
      `缺少 ${H5_SITE_SOURCES.envConfig}\n` +
        `  → 请先跑 node tools/build-fallback.mjs 与 node tools/inject-env.mjs --env prod`,
    );
  }
  if (!existsSync(join(root, H5_SITE_SOURCES.libs))) {
    fail(
      `缺少引擎脚本目录 ${H5_SITE_SOURCES.libs}\n` +
        `  → 请在 LayaAir IDE 里导出 Web 版产物到 release/web（至少含 libs/laya.core.js、laya.webgl_2D.js、laya.ui2.js）`,
    );
  }

  // ── index.html：改写为 <base> 前缀，并在 Main.js 之前插入 env-config.js ────
  // 先算完 + 自校验通过再动目标目录：坏 base 不得留下半装配产物。
  const raw = readFileSync(htmlSrc, 'utf8');
  let html = raw;
  for (const dir of ['libs', 'js', 'vendor']) {
    html = html.split(`"/${dir}/`).join(`"${normBase}${dir}/`);
  }
  const mainIdx = html.indexOf('<script type="module" src="');
  if (mainIdx === -1) {
    fail(
      `${H5_SITE_SOURCES.html} 缺少 <script type="module" src="...Main.js">（构建产物异常）\n` +
        `  → 请先执行 node tools/build-fallback.mjs 重新生成入口页`,
    );
  }
  const lineStart = html.lastIndexOf('\n', mainIdx) + 1;
  html = `${html.slice(0, lineStart)}<script src="${normBase}js/env-config.js"></script>\n${html.slice(lineStart)}`;

  // ── 断言式自校验：失败即 exit 1，绝不把坏页面发出去 ──────────────────────
  const residues = BARE_PATH_RESIDUE.filter((p) => html.includes(p));
  if (residues.length > 0) {
    fail(`index.html 改写自校验失败：仍残留裸路径 ${residues.join('、')}（base=${normBase}）`);
  }
  const wronglyPrefixed = [`${normBase}assets/`, `${normBase}gamedata`].filter((p) => html.includes(p));
  if (wronglyPrefixed.length > 0) {
    fail(`index.html 改写自校验失败：/assets/ 与 /gamedata 必须保持同源根绝对路径（被改写：${wronglyPrefixed.join('、')}）`);
  }
  const envIdx = html.indexOf('js/env-config.js');
  const mainAfterIdx = html.indexOf('js/boot/Main.js');
  if (envIdx === -1 || mainAfterIdx === -1 || envIdx > mainAfterIdx) {
    fail(
      `index.html 改写自校验失败：env-config.js 的 script 标签必须在 Main.js 之前` +
        `（env-config@${envIdx} main@${mainAfterIdx}）`,
    );
  }

  console.log(`装配 h5-site → ${targetDir}（base=${normBase}）`);
  syncTree({
    from: jsSrc,
    to: join(targetDir, 'js'),
    label: 'js',
    hint: '请先执行 node tools/build-fallback.mjs',
    counter,
  });
  syncTree({
    from: join(root, H5_SITE_SOURCES.libs),
    to: join(targetDir, 'libs'),
    label: 'libs',
    hint: '请在 LayaAir IDE 里导出 Web 版产物到 release/web（libs/ 引擎脚本由 IDE 生成）',
    counter,
  });
  syncFile({
    from: join(root, H5_SITE_SOURCES.vendor),
    toDir: join(targetDir, 'vendor'),
    label: 'vendor',
    hint: '仓库缺少 vendor/socket.io.min.js（S7 不新增依赖，请从既有产物补齐）',
    counter,
  });
  syncTree({
    from: join(root, H5_SITE_SOURCES.assets),
    to: join(targetDir, 'assets'),
    label: 'assets',
    hint: '仓库缺少 assets/（LayaAir 工程资源目录），工作树不完整',
    counter,
  });
  const bundle = publishConfigBundle({
    cmd: 'h5-site',
    targetDir,
    subdir: 'gamedata',
    source,
    summarize: false,
  });
  counter.n += bundle.files.length;

  mkdirSync(targetDir, { recursive: true });
  const htmlOut = join(targetDir, 'index.html');
  writeFileSync(htmlOut, html, 'utf8');
  console.log(`  index.html: 生成 → ${htmlOut}`);
  counter.n += 1;

  console.log(`summary: h5-site 装配 ${counter.n} 个文件到 ${targetDir}`);
}

// ── wxgame：GUI 导出后的收尾（补 config/ + 注入 prod env + 跑包体门禁）───────
/** 入口里 env-config.js 的插入锚点：紧跟 weapp-adapter（它是 IDE 模板里 game.js 的第一行） */
const WEAPP_ADAPTER_REQUIRE = 'require("weapp-adapter.js");';
const ENV_REQUIRE = 'require("env-config.js");';

function runWxgame({ target, source }) {
  const targetDir = resolveFromRoot(target ?? COMMANDS.wxgame.defaultTarget);
  const entry = join(targetDir, 'game.js');
  if (!existsSync(entry)) {
    fail(
      `缺少 ${entry}\n` +
        `  → 微信小游戏产物无法命令行导出（S1 已实证 CLI 不可用），请在 LayaAir IDE\n` +
        `     「构建/发布 → 微信小游戏」导出到 ${targetDir}，再重跑本命令`,
    );
  }

  console.log(`收尾 wxgame → ${targetDir}`);

  // 1) 补齐 config/（与 h5 / wxgame-config 同一实现：清陈旧 + 复制 + 重算 sha256 比对）
  const bundle = publishConfigBundle({ cmd: 'wxgame', targetDir, subdir: 'config', source, summarize: false });

  // 2) 注入生产环境：产物根生成 env-config.js，并让入口 require 它（幂等，重跑不重复插入）
  const injected = spawnSync(
    process.execPath,
    [join(root, 'tools', 'inject-env.mjs'), '--env', 'prod', '--out', targetDir],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (injected.status !== 0) {
    fail(`注入生产环境失败（inject-env.mjs exit ${injected.status}）：${(injected.stderr || injected.stdout || '').trim()}`);
  }
  const envOut = join(targetDir, 'env-config.js');
  const gameJs = readFileSync(entry, 'utf8');
  if (gameJs.includes('env-config.js')) {
    console.log(`  env: ${envOut}（入口已引用，未重复插入）`);
  } else {
    const at = gameJs.indexOf(WEAPP_ADAPTER_REQUIRE);
    const patched =
      at === -1
        ? `${ENV_REQUIRE}\n${gameJs}`
        : `${gameJs.slice(0, at + WEAPP_ADAPTER_REQUIRE.length)}\n${ENV_REQUIRE}${gameJs.slice(at + WEAPP_ADAPTER_REQUIRE.length)}`;
    writeFileSync(entry, patched, 'utf8');
    console.log(`  env: 生成 ${envOut}，并在 game.js 插入 ${ENV_REQUIRE}`);
  }

  // 3) 包体门禁：不过即 exit 1 —— 门禁不过就不该上传
  const checked = spawnSync(process.execPath, [join(root, 'tools', 'check-package.mjs'), '--target', targetDir], {
    stdio: 'inherit',
  });
  if (checked.status !== 0) fail(`包体门禁未通过（check-package.mjs exit ${checked.status}）`);

  console.log(`summary: wxgame 收尾完成（config/ ${bundle.files.length} 个文件 + prod env 注入 + 包体门禁通过）`);
}

const { cmd, target, source, base } = parseArgv(process.argv.slice(2));

if (cmd === 'h5-site') {
  runH5Site({ target, source, base });
} else if (cmd === 'wxgame') {
  runWxgame({ target, source });
} else {
  const spec = COMMANDS[cmd];
  publishConfigBundle({
    cmd,
    targetDir: resolveFromRoot(target ?? spec.defaultTarget),
    subdir: spec.subdir,
    source,
  });
}