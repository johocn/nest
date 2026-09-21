// 场景配置包 CLI：登录 → list / export / publish / rollback（全部走 admin 接口，零依赖）
// 用法：node scripts/scene-config-cli.mjs <list|export|publish|rollback> [--scene 1] [--version 2] [--base http://localhost:3000]
// 凭据取环境变量 ADMIN_USERNAME / ADMIN_PASSWORD，缺省 admin / admin123
const DEFAULT_BASE = 'http://localhost:3000';
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'admin123';

const USAGE = `场景配置包 CLI（调用 game-server admin 接口）

用法：
  node scripts/scene-config-cli.mjs <子命令> [选项]

子命令：
  list                              列出场景与各自当前已发布版本
  export  --scene <id>               导出配置包（生成 draft 版本）
  publish --scene <id> --version <n> 发布指定版本（重建 manifest）
  rollback --scene <id> --version <n> 回滚到更早版本（重建 manifest）

选项：
  --base <url>   后端地址，默认 ${DEFAULT_BASE}（线上可传 https://game.joho.cn）
  --scene <id>   场景 ID
  --version <n>  配置版本号
  -h, --help     显示本帮助

环境变量：
  ADMIN_USERNAME  管理员账号，默认 ${DEFAULT_USERNAME}
  ADMIN_PASSWORD  管理员密码，默认 ${DEFAULT_PASSWORD}

示例：
  npm run config:list
  npm run config:export -- --scene 1
  npm run config:publish -- --scene 1 --version 2
  npm run config:rollback -- --scene 1 --version 1 --base https://game.joho.cn`;

function parseArgs(argv) {
  const args = { command: null, base: DEFAULT_BASE };
  const rest = argv.slice();
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === '-h' || token === '--help') {
      args.help = true;
      continue;
    }
    if (!token.startsWith('-')) {
      if (args.command === null) {
        args.command = token;
        continue;
      }
      throw new Error(`未知参数：${token}`);
    }
    const next = () => {
      const v = rest[++i];
      if (v === undefined || v.startsWith('--')) {
        throw new Error(`选项 ${token} 缺少取值`);
      }
      return v;
    };
    if (token === '--base') args.base = next().replace(/\/+$/, '');
    else if (token === '--scene') args.scene = toPositiveInt(next(), '--scene');
    else if (token === '--version') args.version = toPositiveInt(next(), '--version');
    else throw new Error(`未知选项：${token}`);
  }
  return args;
}

function toPositiveInt(text, flag) {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} 需要正整数，收到：${text}`);
  return n;
}

/** 统一请求：返回 { status, payload }；非 JSON 响应也给出可读错误 */
async function call(method, path, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, payload: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, payload: { code: -1, msg: `非 JSON 响应: ${text.slice(0, 120)}` } };
  }
}

/** 打印信封的 code/msg，返回是否成功 */
function report(label, payload) {
  const code = payload?.code;
  console.log(`[${label}] code=${code} msg=${payload?.msg}`);
  return code === 0;
}

/** 打印静态 manifest 中该场景的指向（best effort，不参与退出码判定） */
async function printManifestPointer(base, sceneId) {
  const { payload } = await call('GET', `${base}/gamedata/manifest.json`);
  if (!payload || !Array.isArray(payload.scenes)) {
    console.log(`  manifest: 暂不可读（${base}/gamedata/manifest.json）`);
    return;
  }
  const scenes = sceneId === undefined ? payload.scenes : payload.scenes.filter((s) => s.sceneId === sceneId);
  if (scenes.length === 0) {
    console.log(`  manifest: ${sceneId === undefined ? '无' : `场景 ${sceneId}`} 无已发布版本`);
    return;
  }
  for (const s of scenes) {
    console.log(`  manifest: scene=${s.sceneId} → v${s.version} file=${s.file} hash=${s.hash}`);
  }
}

async function login(base) {
  const username = process.env.ADMIN_USERNAME || DEFAULT_USERNAME;
  const password = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
  const { payload } = await call('POST', `${base}/api/admin/v1/login`, {
    body: { username, password },
  });
  if (!report('login', payload)) throw new Error(`管理员登录失败：${payload?.msg ?? '响应为空'}`);
  const token = payload?.data?.token;
  if (!token) throw new Error('管理员登录响应缺少 data.token');
  return token;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.help) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  const { command, base } = args;
  console.log(`后端：${base}`);

  if (command === 'list') {
    const token = await login(base);
    const { payload } = await call('GET', `${base}/api/admin/v1/world/scene-config/list`, { token });
    if (!report('list', payload)) process.exit(1);
    const items = payload?.data?.items ?? [];
    for (const it of items) {
      const pub = it.published
        ? `v${it.published.version} (${it.published.file})`
        : '未发布';
      console.log(`  scene=${it.sceneId} name=${it.name} status=${it.status} published=${pub}`);
    }
    return;
  }

  if (args.scene === undefined) throw new Error(`${command} 需要 --scene <id>`);

  const token = await login(base);

  if (command === 'export') {
    const { payload } = await call('POST', `${base}/api/admin/v1/world/scene-config/${args.scene}/export`, { token });
    if (!report('export', payload)) process.exit(1);
    const d = payload.data;
    console.log(`  scene=${args.scene} version=${d.version} status=${d.status}`);
    console.log(`  hash=${d.hash}`);
    console.log(`  file=${d.filePath ?? d.file}`);
    await printManifestPointer(base, args.scene);
    return;
  }

  if (command === 'publish' || command === 'rollback') {
    if (args.version === undefined) throw new Error(`${command} 需要 --version <n>`);
    const { payload } = await call(
      'POST',
      `${base}/api/admin/v1/world/scene-config/${args.scene}/${command}`,
      { token, body: { version: args.version } },
    );
    if (!report(command, payload)) process.exit(1);
    const d = payload.data;
    console.log(`  scene=${args.scene} version=${d.version} status=${d.status} publishedAt=${d.publishedAt}`);
    console.log(`  hash=${d.hash}`);
    console.log(`  file=${d.filePath ?? d.file}`);
    await printManifestPointer(base, args.scene);
    return;
  }

  throw new Error(`未知子命令：${command}\n\n${USAGE}`);
}

main().catch((err) => {
  console.error(`执行失败：${err.message}`);
  process.exit(1);
});