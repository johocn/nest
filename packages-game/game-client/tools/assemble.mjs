// 从 LayaAir IDE 安装目录装配工程壳：模板文件 + 引擎类型声明 + vendored socket.io
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const IDE = process.env.LAYA_IDE_DIR || 'D:\\Program Files\\LayaAirIDE';
const TPL = join(IDE, 'resources', 'template', 'project');
const SERVER = join(root, '..', 'game-server');

function ensure(p) {
  mkdirSync(p, { recursive: true });
}
function must(src) {
  if (!existsSync(src)) throw new Error(`缺少源文件: ${src}`);
}
function copy(src, dst) {
  must(src);
  ensure(dirname(dst));
  copyFileSync(src, dst);
  console.log(`copy ${src} -> ${dst}`);
}

ensure(join(root, 'assets', 'config'));
ensure(join(root, 'assets', 'resources'));
ensure(join(root, 'vendor'));
ensure(join(root, 'settings'));
ensure(join(root, 'bin'));
ensure(join(root, 'src', 'types'));
ensure(join(root, 'tools', 'src', 'editor'));

// 1. IDE 模板壳
copy(join(TPL, 'common', '.gitignore'), join(root, '.gitignore'));
copy(join(TPL, 'common', 'settings', 'PlayerSettings.json'), join(root, 'settings', 'PlayerSettings.json'));
copy(join(TPL, 'common', 'settings', 'EditorSettings.json'), join(root, 'settings', 'EditorSettings.json'));
copy(join(TPL, '2D-emptyProject', 'assets', 'Scene.ls'), join(root, 'assets', 'Scene.ls'));
copy(join(TPL, '2D-emptyProject', 'assets', 'Scene.ls.meta'), join(root, 'assets', 'Scene.ls.meta'));
copy(join(TPL, 'common', 'assets', 'resources', 'layaAir.png'), join(root, 'assets', 'resources', 'placeholder.png'));
copy(join(TPL, 'common', 'assets', 'resources', 'layaAir.png.meta'), join(root, 'assets', 'resources', 'placeholder.png.meta'));

// 2. BuildSettings：启动场景指向模板 Scene.ls 的 uuid
const sceneMeta = JSON.parse(readFileSync(join(root, 'assets', 'Scene.ls.meta'), 'utf8'));
writeFileSync(
  join(root, 'settings', 'BuildSettings.json'),
  JSON.stringify({ name: 'LayaGame2D', startupScene: `res://${sceneMeta.uuid}` }, null, 4),
  'utf8',
);
console.log(`write settings/BuildSettings.json (startupScene=res://${sceneMeta.uuid})`);

// 3. 引擎类型声明（客户端零依赖，直接引用 IDE 自带 d.ts）
writeFileSync(
  join(root, 'src', 'types', 'laya.d.ts'),
  `/// <reference path="${join(IDE, 'resources', 'engine', 'types', 'LayaAir.d.ts').replace(/\\/g, '/')}" />\n`,
  'utf8',
);
console.log('write src/types/laya.d.ts');

// 4. vendored socket.io（浏览器 UMD，全局 io）
copy(join(SERVER, 'node_modules', 'socket.io-client', 'dist', 'socket.io.min.js'), join(root, 'vendor', 'socket.io.min.js'));

// 5. 工程描述文件：IDE 靠根目录的 <工程名>.laya 识别工程根，缺失则该目录无法被「打开项目」
writeFileSync(join(root, 'game-client.laya'), `${JSON.stringify({ version: '3.4.1' }, null, 2)}\n`, 'utf8');
console.log('write game-client.laya');

console.log('assemble done');