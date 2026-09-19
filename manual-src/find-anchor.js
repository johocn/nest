const c = require('fs').readFileSync('e:/code/nest/manual-src/main-part.html', 'utf8');
const lines = c.split('\n');
const h3 = [];
lines.forEach((l, i) => { if (/<h3>(4\.9|6\.25|11\.12|15\.7)/.test(l)) h3.push({ n: l.match(/<h3>([^<]+)</)[1], i }); });
h3.forEach(h => {
  console.log('###', h.n, '行号', h.i + 1);
  // 打印该小节开始到其后 12 行
  for (let j = h.i; j < Math.min(h.i + 14, lines.length); j++) console.log((j + 1) + '|' + lines[j].slice(0, 120));
  console.log('---');
});
