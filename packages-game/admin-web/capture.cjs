// admin-web capture: login + screenshot ALL pages (17)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOT_DIR = path.join(__dirname, 'shots');
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

const PAGES = [
  { n: '01', name: 'login',         url: 'http://localhost:5174/login' },
  // 运维
  { n: '02', name: 'gm-commands',   url: 'http://localhost:5174/gm' },
  { n: '03', name: 'trace',         url: 'http://localhost:5174/trace' },
  { n: '04', name: 'ladder',        url: 'http://localhost:5174/ladder' },
  { n: '05', name: 'room',          url: 'http://localhost:5174/room' },
  { n: '06', name: 'config',        url: 'http://localhost:5174/config' },
  { n: '07', name: 'player',        url: 'http://localhost:5174/player' },
  { n: '08', name: 'risk',          url: 'http://localhost:5174/risk' },
  // 世界运营
  { n: '09', name: 'scene',         url: 'http://localhost:5174/world/scene' },
  { n: '10', name: 'npc',           url: 'http://localhost:5174/world/npc' },
  { n: '11', name: 'building',      url: 'http://localhost:5174/world/building' },
  // 社区运营
  { n: '12', name: 'feedback',      url: 'http://localhost:5174/community/feedback' },
  { n: '13', name: 'reports',       url: 'http://localhost:5174/community/reports' },
  // 数据分析
  { n: '14', name: 'dashboard',     url: 'http://localhost:5174/analytics/dashboard' },
  { n: '15', name: 'balance-audit', url: 'http://localhost:5174/balance/audit' },
  // 游戏配置
  { n: '16', name: 'realm',         url: 'http://localhost:5174/realm' },
  { n: '17', name: 'inventory',     url: 'http://localhost:5174/inventory' },
];

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Phase 1: Login
  console.log('[1] Login page...');
  await page.goto('http://localhost:5174/login', { waitUntil: 'networkidle', timeout: 15000 });
  await page.screenshot({ path: path.join(SHOT_DIR, '01-login.png'), fullPage: true });
  const inputs = page.locator('input');
  await inputs.nth(0).fill('admin');
  await inputs.nth(1).fill('admin123');
  await page.locator('button[type="submit"]').click();
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  await page.waitForTimeout(800);
  console.log('  logged in, URL:', page.url());

  // Phase 2: All pages
  for (const p of PAGES.slice(1)) {
    console.log(`[${p.n}] ${p.name}...`);
    try {
      await page.goto(p.url, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(SHOT_DIR, `${p.n}-${p.name}.png`), fullPage: true });
      console.log('  saved.');
    } catch (e) {
      console.log(`  FAIL: ${e.message}`);
      try { await page.screenshot({ path: path.join(SHOT_DIR, `${p.n}-${p.name}.png`), fullPage: true }); } catch {}
    }
  }

  await browser.close();
  console.log('\nALL DONE. Dir:', SHOT_DIR);
  fs.readdirSync(SHOT_DIR).sort().forEach(f => console.log(' ', f));
}

capture().catch((e) => { console.error('FAIL:', e?.message || e); process.exit(1); });
