const fs = require('fs');
const html = fs.readFileSync('e:/code/nest/manual/index.html', 'utf8');
const OUT_MD = 'e:/code/nest/manual/游戏服务器开发手册.md';

// ---------- 基础内联标签转 MD ----------
function inline(m) {
  return m
    .replace(/<strong>/g, '**').replace(/<\/strong>/g, '**')
    .replace(/<b>/g, '**').replace(/<\/b>/g, '**')
    .replace(/<code>/g, '`').replace(/<\/code>/g, '`')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

// ---------- 表格转 MD ----------
function table2md(tbl) {
  const rows = [];
  tbl.replace(/<tr>([\s\S]*?)<\/tr>/g, (_, body) => {
    const cells = [];
    body.replace(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/g, (__, tag, c) => {
      cells.push(inline(c).replace(/\n/g, ' ').replace(/\|/g, '\\|'));
    });
    rows.push(cells);
  });
  if (!rows.length) return '';
  const widths = rows.reduce((a, r) => r.map((v, i) => Math.max((a[i] || 0), v.length)), []);
  const fmt = (r) => '| ' + widths.map((w, i) => (r[i] || '').padEnd(w, ' ')).join(' | ') + ' |';
  const sep = '| ' + widths.map(w => '-'.repeat(w)).join(' | ') + ' |';
  const head = rows.shift();
  return '\n' + fmt(head) + '\n' + sep + '\n' + rows.map(fmt).join('\n') + '\n';
}

// ---------- 列表转 MD（支持两层缩进） ----------
function list2md(ul, depth) {
  const pad = '  '.repeat(depth);
  let out = '';
  ul.replace(/<li>([\s\S]*?)<\/li>/g, (_, item) => {
    out += pad + '- ' + inline(item).split('\n').map(s => s.trim()).filter(Boolean).join(' ') + '\n';
  });
  return out;
}

// ---------- 正文块级处理 ----------
function block(sec) {
  let s = sec;
  s = s.replace(/<table>[\s\S]*?<\/table>/g, table2md);
  s = s.replace(/<ul>[\s\S]*?<\/ul>/g, (u) => list2md(u, 0));
  s = s.replace(/<h4>([^<]+)<\/h4>/g, '#### $1\n');
  s = s.replace(/<h3>([^<]+)<\/h3>/g, '### $1\n');
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, (_, t) => {
    const tt = inline(t).replace(/\s*·\s*/g, ' · ').replace(/\s+/g, ' ').trim();
    return '\n## ' + tt + '\n';
  });
  s = s.replace(/<p>([\s\S]*?)<\/p>/g, (_, p) => '\n' + inline(p).replace(/\n+/g, ' ') + '\n');
  s = s.replace(/<div class="grid3">[\s\S]*?<\/div>\s*<\/div>/g, '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.split('\n').map(l => l.trimStart()).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// ---------- 提取各 section ----------
const out = [];
out.push('# 江 湖 录\n');
out.push('> GAME SERVER · 开发与玩法设计手册（Markdown 源码备份，由 HTML 版自动生成）\n');

const secs = html.split(/<section[^>]* id="([^"]+)"/).slice(1);
for (let i = 0; i < secs.length; i += 2) {
  const id = secs[i];
  let body = secs[i + 1];
  body = body.replace(/<\/section>[\s\S]*$/, '');
  const md = block(body);
  if (md) out.push(md, '\n');
}

const final = out.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
fs.writeFileSync(OUT_MD, final, 'utf8');
console.log('MD_OK size=' + (final.length / 1024).toFixed(1) + 'KB');
console.log('h2=' + (final.match(/^## /gm) || []).length);
console.log('h3=' + (final.match(/^### /gm) || []).length);
console.log('h4=' + (final.match(/^#### /gm) || []).length);
console.log('table=' + (final.match(/\n\|/g) || []).length);
