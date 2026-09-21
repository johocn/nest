// 兜底构建：tsc（借用 game-server 的 typescript）→ 重写产物导入扩展名 → 生成 bin/index.html
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsc = join(root, '..', 'game-server', 'node_modules', 'typescript', 'bin', 'tsc');

execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.json')], { stdio: 'inherit' });

const outRoot = join(root, 'bin', 'js');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

let rewritten = 0;
for (const file of walk(outRoot).filter((f) => f.endsWith('.js'))) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(
    /(from\s+|import\s+)(["'])(\.{1,2}\/[^"']+)(["'])/g,
    (m, head, q1, spec, q2) => (spec.endsWith('.js') ? m : `${head}${q1}${spec}.js${q2}`),
  );
  if (after !== before) {
    writeFileSync(file, after, 'utf8');
    rewritten++;
  }
}

const BUILD_ID = Date.now().toString(36);

// 发布期 PlayerConfig：IDE 发布器由工程设置生成（见 release/web/js/index.js），兜底构建须自行补齐。
// 两点必须注意：
//  1) ui2 的 UIPackage._init 会无条件读 PlayerConfig.UI.alwaysIncludeDefaultSkin，缺失即 Laya.init 报错；
//  2) 皮肤路径（popupMenu/tooltipsWidget/ScrollBar*）一旦写进 UIConfig2，_init 就会去 basePath 下加载这些 .lh，
//     我们的资源不提供它们，加载永不 resolve 会让 Laya.init 挂起 —— 故此处不放皮肤路径（ui2 自身默认即 null）。
const playerConfig = {
  addons: { 'laya.ui': 'ui2' },
  UI: { alwaysIncludeDefaultSkin: false },
  '2D': { FPS: 60, isAntialias: true, useRetinalCanvas: false, defaultFont: 'Arial', defaultFontSize: 20 },
};
const cfg = JSON.stringify(playerConfig);
mkdirSync(join(root, 'bin', 'js'), { recursive: true });
writeFileSync(
  join(root, 'bin', 'js', 'player-config.js'),
  `(function () {\n  var cfg = ${cfg};\n  Object.assign(Laya.PlayerConfig, cfg);\n  Object.assign(Laya.Config, cfg['2D']);\n  if (Laya.UIConfig2) Object.assign(Laya.UIConfig2, cfg.UI);\n})();\n`,
  'utf8',
);
console.log('write bin/js/player-config.js');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>江湖录 · S1 Spike</title>
<style>
  html, body { margin: 0; padding: 0; background: #101418; overflow: hidden; font-family: "Microsoft YaHei", sans-serif; }
  #s1-login { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 10;
    background: #1b2129; padding: 24px 28px; border-radius: 8px; color: #e6edf3; min-width: 280px; }
  #s1-login h2 { margin: 0 0 16px; font-size: 18px; }
  #s1-login label { display: block; font-size: 12px; color: #9aa7b4; margin: 10px 0 4px; }
  #s1-login input { width: 100%; box-sizing: border-box; padding: 8px; border-radius: 4px; border: 1px solid #2c3540; background: #0d1117; color: #e6edf3; }
  #s1-login button { margin-top: 16px; width: 100%; padding: 10px; border: 0; border-radius: 4px; background: #2f81f7; color: #fff; cursor: pointer; }
  #s1-login .err { color: #ff7b72; font-size: 12px; margin-top: 10px; min-height: 16px; }
</style>
</head>
<body>
<script src="/libs/laya.core.js?v=${BUILD_ID}"></script>
<script src="/libs/laya.webgl_2D.js?v=${BUILD_ID}"></script>
<script src="/libs/laya.ui2.js?v=${BUILD_ID}"></script>
<script src="/js/player-config.js?v=${BUILD_ID}"></script>
<script src="/vendor/socket.io.min.js?v=${BUILD_ID}"></script>
<script>
  // 引擎脚本是否真的求值成功：beforeInit 回调数由各引擎库在加载时注册（core+webgl_2D+ui2 应为 3）
  var n = window.Laya && Laya.Laya && Laya.Laya._beforeInitCallbacks ? Laya.Laya._beforeInitCallbacks.length : -1;
  var msg = '[S1] engine scripts: Laya=' + typeof window.Laya + ' beforeInitCallbacks=' + n;
  console.log(msg);
  if (n < 1) document.title = '[S1] 引擎脚本未加载 n=' + n;
  window.addEventListener('error', function (e) { document.title = '[S1] 运行时错误 ' + e.message; });
</script>
<script type="module" src="/js/boot/Main.js?v=${BUILD_ID}"></script>
</body>
</html>
`;

mkdirSync(join(root, 'bin'), { recursive: true });
writeFileSync(join(root, 'bin', 'index.html'), html, 'utf8');
console.log(`fallback build done: ${rewritten} 个产物文件重写了导入扩展名`);