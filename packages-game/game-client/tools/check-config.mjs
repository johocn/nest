// 校验 seed 生成的配置包：manifest 结构、文件存在性、manifest.hash 与文件字节一致、场景必填字段
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = join(root, 'assets', 'config');
const issues = [];

function sha256(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

const manifestPath = join(dir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('缺少 manifest.json，请先执行 npm run seed:scene-spike');
  process.exit(1);
}
const manifestText = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText);
if (!Array.isArray(manifest.scenes) || manifest.scenes.length === 0) issues.push('manifest.scenes 为空');

for (const item of manifest.scenes ?? []) {
  const file = join(dir, item.file);
  if (!existsSync(file)) {
    issues.push(`缺少配置文件 ${item.file}`);
    continue;
  }
  const text = readFileSync(file, 'utf8');
  if (sha256(text) !== item.hash) issues.push(`${item.file} 的 manifest.hash 与文件字节不一致`);
  const cfg = JSON.parse(text);
  for (const key of ['schemaVersion', 'sceneId', 'version', 'scene', 'staticEntities', 'fixedNpcs', 'triggers']) {
    if (cfg[key] === undefined) issues.push(`${item.file} 缺少字段 ${key}`);
  }
  if (cfg.sceneId !== item.sceneId) issues.push(`${item.file} 的 sceneId 与 manifest 不一致`);
  if (cfg.version !== item.version) issues.push(`${item.file} 的 version 与 manifest 不一致`);
  if (!cfg.scene?.entry) issues.push(`${item.file} 缺少 scene.entry`);
  if ((cfg.staticEntities?.length ?? 0) < 1) issues.push(`${item.file} 静态物件为空`);
  if ((cfg.fixedNpcs?.length ?? 0) < 1) issues.push(`${item.file} 固定 NPC 为空`);
  for (const e of cfg.staticEntities ?? []) {
    if (!Number.isInteger(e.x) || !Number.isInteger(e.y)) issues.push(`staticEntities[${e.spawnId}] 坐标不是整数`);
  }
  for (const n of cfg.fixedNpcs ?? []) {
    if (!Number.isInteger(n.x) || !Number.isInteger(n.y)) issues.push(`fixedNpcs[${n.spawnId}] 坐标不是整数`);
  }
  console.log(`${item.file}: sceneId=${cfg.sceneId} v${cfg.version} 静态物件=${cfg.staticEntities.length} NPC=${cfg.fixedNpcs.length} 触发器=${cfg.triggers.length}`);
}

if (issues.length) {
  console.error('配置包校验失败：');
  for (const i of issues) console.error(` - ${i}`);
  process.exit(1);
}
console.log('配置包校验通过');