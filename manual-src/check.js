const fs = require('fs');
const html = fs.readFileSync('e:/code/nest/manual/index.html', 'utf8');
const issues = [];
const warn = (t, m) => issues.push(`[${t}] ${m}`);

// ---------- 1. 章节标题编号连续性 ----------
const chs = [...html.matchAll(/<h2 class="ch-title">(?:(第\s*([0-9]+)\s*章\s*·?\s*)|)([^<]*?)<\/h2>/g)]
  .map(m => ({ n: m[2] ? +m[2] : null, t: (m[1] ? m[3] : (m[3] || '')).trim() }));
console.log('=== 章节列表 ===');
chs.forEach(c => console.log(`  ${c.n !== null ? '第' + c.n + '章' : '（无编号）'} ${c.t}`));
const numbered = chs.filter(c => c.n !== null).map(c => c.n);
for (let i = 1; i < numbered.length; i++) {
  if (numbered[i] !== numbered[i - 1] + 1) warn('章编号', `第${numbered[i - 1]}章 → 第${numbered[i]}章 不连续`);
}
if (numbered.length && numbered[0] !== 1) warn('章编号', `首个编号章为${numbered[0]}，期望 1（第 0 章为无编号世界观总纲）`);

// ---------- 2. 小节编号连续性（按 section） ----------
const secs = html.split(/<section class="(?:chapter|dict-chapter|appendix-chapter)" id="/).slice(1);
console.log('\n=== 小节编号（数字型 / 中文型 / 附录型） ===');
const allNum = new Set();
const allCjk = new Set();
const allApp = new Set();
secs.forEach(sec => {
  const id = (sec.match(/^([^"]+)/) || [])[1];
  const h3s = [...sec.matchAll(/<h3>([^<]+)<\/h3>/g)].map(m => m[1].trim());
  const nums = [];
  const cjks = [];
  const apps = [];
  h3s.forEach(h => {
    let m = h.match(/^([0-9]+\.[0-9]+)(?=\s)/);
    if (m) { nums.push(+m[1].split('.')[1]); allNum.add(m[1]); return; }
    m = h.match(/^([一二三四五六七八九十]+)、/);
    if (m) { cjks.push(m[1]); allCjk.add(h); return; }
    m = h.match(/^([A-Z]\.)([0-9]+)/);
    if (m) { apps.push(+m[2]); allApp.add(m[0].replace(/\.$/, '')); return; }
  });
  const uniq = (a) => [...new Set(a)].sort((x, y) => x - y);
  console.log(`  #${id}: 数字[${uniq(nums).join(',')}] 中文[${uniq(cjks).join(',')}] 附录[${uniq(apps).join(',')}]`);
  // 连续性检查（数字型）
  const un = uniq(nums);
  for (let i = 1; i < un.length; i++) {
    if (un[i] !== un[i - 1] + 1) warn('小节编号', `#${id} 数字编号 ...${un[i - 1]} → ${un[i]} 不连续`);
  }
});

// ---------- 3. 跨章节引用目标校验 ----------
console.log('\n=== 引用目标校验 ===');
const refs = [...html.matchAll(/见\s*([0-9]{1,2})(?:\.([0-9]{1,2}))?/g)]
  .map(m => ({ ch: +m[1], sec: m[2] ? m[1] + '.' + m[2] : null }));
const chNums = new Set(chs.map(c => c.n));
const refCh = new Set(refs.map(r => r.ch));
const missingCh = [...refCh].filter(n => !chNums.has(n)).sort((a, b) => a - b);
if (missingCh.length) warn('引用-章', `引用不存在的章号: ${missingCh.join(',')}`);
else console.log('  所有引用章号均存在');

const refSecs = new Set(refs.map(r => r.sec).filter(Boolean));
const missingSec = [...refSecs].filter(s => !allNum.has(s)).sort();
if (missingSec.length) {
  warn('引用-小节', `引用不存在的 X.Y 小节: ${missingSec.join(', ')}`);
  missingSec.forEach(s => console.log(`    MISSING: 见 ${s}`));
} else console.log('  所有 X.Y 引用目标均存在');

// ---------- 4. 导航锚点 vs section id ----------
console.log('\n=== 导航锚点校验 ===');
const navs = [...html.matchAll(/<a class="nav-item" href="#([^"]+)">([^<]*)<\/a>/g)].map(m => ({ id: m[1], t: m[2] }));
const secIds = new Set(secs.map(s => (s.match(/^([^"]+)/) || [])[1]));
navs.forEach(n => {
  if (!secIds.has(n.id)) warn('导航', `导航 ${n.t} → #${n.id} 无对应 section`);
});
const navIds = new Set(navs.map(n => n.id));
secs.forEach(s => {
  const id = (s.match(/^([^"]+)/) || [])[1];
  if (id !== 'cover' && !navIds.has(id)) warn('导航', `section #${id} 无导航项`);
});
if (navs.length !== secs.length - 1) warn('导航', `导航 ${navs.length} 项 vs section ${secs.length} 个（期望差 1 = cover 封面无导航）`);
console.log(`  导航 ${navs.length} 项 / section ${secs.length} 个（cover 封面无导航）`);

// ---------- 5. 占位符 / 残留检查 ----------
// 枚举值（如 GuideTaskStatus.TODO）会以 <code>TODO</code> 形式出现，属合法内容，剔除 <code> 块后计数
console.log('\n=== 占位符检查 ===');
const textNoCode = html.replace(/<code>[\s\S]*?<\/code>/g, '');
['TODO', 'TBD', 'XXX', 'FIXME', '占位符', '待补充', '此处待', 'Lorem', '<!--DICT_PART-->', '<!--API_PART-->', '<!--ENUM_PART-->']
  .forEach(k => { const c = textNoCode.split(k).length - 1; if (c > 0) warn('占位符', `"${k}" 出现 ${c} 次`); });
if (!issues.some(i => i.startsWith('[占位符]'))) console.log('  无占位符残留');

// ---------- 6. 空链接 / 外链检查 ----------
const brokenLinks = [...html.matchAll(/href="([^"#][^"]*)"/g)]
  .map(m => m[1]).filter(h => !h.startsWith('http'));
if (brokenLinks.length) warn('链接', `非锚点非外链 href: ${brokenLinks.join(', ')}`);

console.log('\n====================');
if (issues.length) {
  console.log(`发现问题 ${issues.length} 条:`);
  issues.forEach(i => console.log('  ' + i));
  process.exit(1);
}
console.log('全部检查通过');
process.exit(0);
