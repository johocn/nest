const fs = require('fs');
const path = require('path');
const base = 'e:/code/nest/manual-src';

// ---------- 1. 数据字典 ----------
const desc = new Map();
for (const line of fs.readFileSync(path.join(base, 'fields-desc.txt'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^|]+)\|([^|]+)\|(.+)$/);
  if (m) desc.set(m[1] + '|' + m[2], m[3]);
}
const rows = new Map();
for (const line of fs.readFileSync(path.join(base, 'dict.txt'), 'utf8').split(/\r?\n/)) {
  const clean = line.replace(/^\uFEFF/, '');
  const m = clean.match(/^([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|(.*)$/);
  if (!m) continue;
  const [, t, c, type, udt, nn, def] = m;
  if (!rows.has(t)) rows.set(t, []);
  rows.get(t).push({ c, type, udt, nn, def });
}
const typeMap = {
  'character varying': 'varchar', 'integer': 'int', 'timestamp without time zone': 'timestamp',
  'double precision': 'float8', 'bigint': 'bigint', 'boolean': 'bool', 'jsonb': 'jsonb',
  'numeric': 'numeric', 'text': 'text', 'date': 'date'
};
function ftype(r) {
  if (r.type === 'USER-DEFINED') return r.udt.replace(/^.*?_/, '').replace(/_enum$/, '') + ' 枚举';
  if (r.type === 'ARRAY') return 'int[]';
  return typeMap[r.type] || r.type;
}
function fdef(r) {
  let d = r.def;
  if (!d) return '';
  d = d.replace(/^'/, '').replace(/'$/, '');
  if (/nextval/.test(d)) return '自增';
  if (/^now\(\)/.test(d)) return 'now()';
  if (d.length > 40) d = d.slice(0, 40) + '…';
  return d;
}
const tables = [...rows.keys()].sort();
let dict = [];
dict.push('<section class="dict-chapter" id="chapter16">');
dict.push('<h2 class="ch-title">第 16 章 · 数据字典全集</h2>');
dict.push('<p class="ch-desc">共 ' + tables.length + ' 张表、' + [...rows.values()].reduce((s, a) => s + a.length, 0) + ' 个字段。字段类型与默认值取自生产库 <code>game_server</code> 实际结构；说明按源码实体语义整理。枚举类型取值详见<b>附录 B 枚举全集</b>。</p>');
dict.push('<div class="dict-toc">');
for (const t of tables) dict.push(`<a href="#dict-${t}">${t} (${rows.get(t).length})</a>`);
dict.push('</div>');
for (const t of tables) {
  const cols = rows.get(t);
  dict.push(`<div class="dict-table" id="dict-${t}">`);
  dict.push(`<h3>📄 ${t} <span class="tbl-meta">${cols.length} 字段</span></h3>`);
  dict.push('<table><thead><tr><th>列名</th><th>类型</th><th>可空</th><th>默认值</th><th>说明</th></tr></thead><tbody>');
  for (const r of cols) {
    const d = desc.get(t + '|' + r.c) || '';
    dict.push(`<tr><td><code>${r.c}</code></td><td>${ftype(r)}</td><td>${r.nn === 'YES' ? '是' : '否'}</td><td>${fdef(r)}</td><td>${d}</td></tr>`);
  }
  dict.push('</tbody></table></div>');
}
dict.push('</section>');
fs.writeFileSync(path.join(base, 'dict-part.html'), dict.join('\n'), 'utf8');
console.log('DICT_OK tables=' + tables.length);

// ---------- 2. 接口索引 ----------
const routes = new Map();
for (const line of fs.readFileSync(path.join(base, 'routes.txt'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^MODULE\|(.+?)\|(.+?)\|(.+)$/);
  if (!m) continue;
  let mod = m[1].replace(/^E:\/code\/nest\/packages-game\/game-server\/src\/modules\//, '');
  mod = mod.split('/')[0];
  if (!routes.has(mod)) routes.set(mod, []);
  routes.get(mod).push({ method: m[2], path: m[3] });
}
let api = [];
api.push('<section class="appendix-chapter" id="appendix-a">');
api.push('<h2 class="ch-title">附录 A · 接口路径索引</h2>');
api.push('<p class="ch-desc">全部接口按模块分组（共 ' + [...routes.values()].reduce((s, a) => s + a.length, 0) + ' 条），前缀统一为 <code>/api</code>，例如 <code>GET /api/client/v1/player/profile</code>。客户端接口 <code>/api/client</code>，运营后台接口 <code>/api/admin</code>。</p>');
for (const mod of [...routes.keys()].sort()) {
  const arr = routes.get(mod);
  api.push(`<div class="dict-table"><h3>⚙️ ${mod} <span class="tbl-meta">${arr.length} 接口</span></h3>`);
  api.push('<table><thead><tr><th>方法</th><th>路径</th></tr></thead><tbody>');
  for (const r of arr) {
    const cls = r.method === 'GET' ? 'm-get' : r.method === 'POST' ? 'm-post' : r.method === 'PUT' ? 'm-put' : 'm-del';
    api.push(`<tr><td><span class="badge ${cls}">${r.method}</span></td><td><code>${r.path.replace(/^api\//, '/api/')}</code></td></tr>`);
  }
  api.push('</tbody></table></div>');
}
api.push('</section>');
fs.writeFileSync(path.join(base, 'api-part.html'), api.join('\n'), 'utf8');
console.log('API_OK routes=' + [...routes.values()].reduce((s, a) => s + a.length, 0));

// ---------- 3. 枚举全集 ----------
let enums = [];
const enumLines = fs.readFileSync(path.join(base, 'enums.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
enums.push('<section class="appendix-chapter" id="appendix-b">');
enums.push('<h2 class="ch-title">附录 B · 枚举全集</h2>');
enums.push('<p class="ch-desc">共 ' + enumLines.length + ' 个枚举，取值即数据库枚举列可写入的值（代码枚举名=库值）。</p>');
for (const line of enumLines) {
  const [name, pairs] = line.split('|');
  const items = pairs.split(',').map(p => p.split('='));
  enums.push(`<div class="dict-table"><h3>🔖 ${name} <span class="tbl-meta">${items.length} 取值</span></h3>`);
  enums.push('<table><thead><tr><th>代码枚举名</th><th>数据库值</th></tr></thead><tbody>');
  for (const [k, v] of items) enums.push(`<tr><td><code>${k}</code></td><td>${v}</td></tr>`);
  enums.push('</tbody></table></div>');
}
enums.push('</section>');
fs.writeFileSync(path.join(base, 'enums-part.html'), enums.join('\n'), 'utf8');
console.log('ENUM_OK count=' + enumLines.length);
