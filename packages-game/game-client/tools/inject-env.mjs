// 构建期环境注入：生成 <out>/env-config.js（普通脚本，非 ES module），把 { apiBase, wsUrl } 挂到全局 __ENV__。
//
// 用法（零依赖，只用 node:fs / node:path / node:url；本脚本只做**本地文件写入**，不构建、不上传、不连任何服务器）：
//   node tools/inject-env.mjs --env prod [--out <dir>] [--api-base <url>] [--ws-url <url>]
//
// 契约（S7 Task 1 已定死，见 src/platform/Platform.ts）：
//   Platform.env 读 globalThis.__ENV__ = { apiBase, wsUrl }，仅非空字符串生效，注入值优先于 AppConfig 默认
//   （dev 默认 http://localhost:3000 / http://localhost:3000/game）—— 故 dev 无需注入，本脚本只认 prod。
//
// 加载位置：env-config.js 必须早于 <base>js/boot/Main.js 加载（env 在请求时惰性读取，
//   但早于业务脚本更安全）；tools/publish.mjs h5-site 会把它插到 Main.js 之前。
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** 已知环境预设：只有 prod 需要注入（dev 走 AppConfig 默认值，无需生成文件） */
const ENVS = {
  prod: { apiBase: 'https://game.joho.cn', wsUrl: 'wss://game.joho.cn/game' },
};

/** 与 AppConfig.configBase 无关：env-config.js 固定落在 js/ 目录（入口页同源根绝对路径） */
const DEFAULT_OUT = join('bin', 'js');

function usage(message) {
  if (message) console.error(`错误：${message}`);
  console.error('用法：node tools/inject-env.mjs --env <prod> [--out <dir>] [--api-base <url>] [--ws-url <url>]');
  console.error('  --env       必填；已知取值：prod（dev 走 AppConfig 默认值，无需注入）');
  console.error('  --out       输出目录，默认 bin/js（文件名固定 env-config.js）');
  console.error('  --api-base  覆盖预设 apiBase（非空字符串）');
  console.error('  --ws-url    覆盖预设 wsUrl（非空字符串）');
}

function fail(message) {
  console.error(`注入失败：${message}`);
  process.exit(1);
}

function nonEmpty(name, value) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${name} 不能为空字符串`);
  return value;
}

const FIELDS = { '--env': 'env', '--out': 'out', '--api-base': 'apiBase', '--ws-url': 'wsUrl' };
const opts = { env: null, out: null, apiBase: null, wsUrl: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const key = argv[i];
  const field = FIELDS[key];
  if (!field) {
    usage(`未知参数 ${key}`);
    process.exit(1);
  }
  const value = argv[++i];
  if (typeof value !== 'string' || value.length === 0) {
    usage(`${key} 缺少取值`);
    process.exit(1);
  }
  opts[field] = value;
}
if (!opts.env) {
  usage('缺少 --env');
  process.exit(1);
}

if (!Object.prototype.hasOwnProperty.call(ENVS, opts.env)) {
  fail(`未知 --env ${opts.env}（已知：${Object.keys(ENVS).join('|')}）`);
}
const preset = ENVS[opts.env];
const apiBase = nonEmpty('apiBase', opts.apiBase ?? preset.apiBase);
const wsUrl = nonEmpty('wsUrl', opts.wsUrl ?? preset.wsUrl);

const outDir = isAbsolute(opts.out ?? '') ? opts.out : resolve(root, opts.out ?? DEFAULT_OUT);
const outFile = join(outDir, 'env-config.js');

const text = `// 生产环境注入（由 tools/inject-env.mjs --env ${opts.env} 生成，勿手工改）。
// 必须早于 <base>js/boot/Main.js 加载（env 在请求时惰性读取，但早于业务脚本更安全）。
(function () {
  var g = (typeof globalThis !== 'undefined') ? globalThis : window;
  g.__ENV__ = { apiBase: ${JSON.stringify(apiBase)}, wsUrl: ${JSON.stringify(wsUrl)} };
})();
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, text, 'utf8');

console.log(`写入 ${outFile}`);
console.log(`生效环境：env=${opts.env} apiBase=${apiBase} wsUrl=${wsUrl}`);