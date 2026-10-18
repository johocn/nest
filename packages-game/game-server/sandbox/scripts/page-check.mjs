/**
 * 页面级冒烟：构建 → vite preview → Playwright 打开页面 → 断言 HUD/交互无报错。
 * 运行：npm run page:check
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { preview, build } from 'vite';
import pw from '../../../../../guangmingzang-server/node_modules/playwright/index.js';

const { chromium } = pw;
const ROOT = path.resolve(process.cwd());
const SHOT_DIR = path.join(ROOT, 'shots');
const LB_PORT = 8787;
const LB_DATA = path.join(ROOT, 'server', '.page-check-lb.json');

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

function waitForHealth(port, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: 'localhost', port, path: '/healthz' }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('leaderboard server timeout'));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

async function main() {
  // 启动排行榜后端（零依赖 node server），用临时数据文件保证可重复
  try { fs.rmSync(LB_DATA); } catch { /* 忽略 */ }
  const lbServer = spawn(process.execPath, ['server/leaderboard-server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(LB_PORT), DATA_FILE: LB_DATA },
    stdio: 'ignore',
  });
  try {
    await waitForHealth(LB_PORT);
  } catch (e) {
    console.error('[lb] 排行榜后端启动失败：', e);
    lbServer.kill();
    process.exit(1);
  }

  // 始终先构建，确保校验的是最新源码
  console.log('[0] 构建产物');
  await build({ root: ROOT, logLevel: 'warn' });

  const server = await preview({ root: ROOT, preview: { port: 4173, strictPort: true, proxy: { '/api': { target: `http://localhost:${LB_PORT}`, changeOrigin: true } } } });
  const url = `${server.resolvedUrls.local[0]}?seed=42&speed=10`;

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const errors = [];
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', e => errors.push(String(e)));

  console.log('[1] 打开页面');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  check('无控制台报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('加载遮罩已移除', await page.locator('#loading-screen').count() === 0);
  check('右侧操作面板存在', await page.locator('.control-panel').count() === 1);
  check('3D 画布已挂载', await page.locator('#game-container canvas').count() >= 1);

  const topBar = (await page.locator('div#top-bar').innerText().catch(() => '')) || '';
  check('顶部信息栏显示总资产', /¥/.test(topBar), topBar.replace(/\s+/g, ' ').slice(0, 60));
  check('顶部信息栏显示现金', /现金/.test(topBar));

  const assetPanel = (await page.locator('div#asset-panel').innerText().catch(() => '')) || '';
  check('资产面板含四类资产', ['存款', '现金理财', '封闭理财', '基金'].every(n => assetPanel.includes(n)));
  check('曲线图容器已渲染', await page.locator('div#equity-chart canvas').count() === 1);
  const legendText = (await page.locator('.equity-legend').innerText().catch(() => '')) || '';
  check('曲线图含策略基准图例', /实际/.test(legendText) && /全存款/.test(legendText) && /全基金/.test(legendText),
    legendText.replace(/\s+/g, ' '));

  // 首启显示新手引导：选“加长”情景后进入盘面
  const introCount = await page.locator('.intro-overlay').count();
  check('首启显示新手引导', introCount === 1, `intro=${introCount}`);
  if (introCount) {
    check('引导含行情情景选择', (await page.locator('.intro-overlay').innerText()).includes('行情情景'));
    await page.getByRole('button', { name: '加长' }).click();
    await page.getByRole('button', { name: '开始演练', exact: true }).click();
    await page.waitForTimeout(500);
  }
  check('引导关闭后进入盘面', (await page.locator('.intro-overlay').count()) === 0);
  const scenInfo = await page.evaluate(() => ({
    id: window.__sandbox.scenario().id,
    total: window.__sandbox.game.dayProgress.total,
    name: window.__sandbox.summary().scenario.name,
    url: location.search,
  }));
  check('情景选择生效（加长 120 天）', scenInfo.id === 'long' && scenInfo.total === 120
    && scenInfo.name === '加长', `${scenInfo.id} / ${scenInfo.total} 天 / ${scenInfo.name}`);
  check('情景写入 URL', scenInfo.url.includes('scenario=long'), scenInfo.url);

  console.log('[2] 买入 / 赎回交互');
  await page.getByRole('button', { name: '基金', exact: true }).click();
  const cashBefore = await page.evaluate(() => window.__sandbox.game.cash);
  await page.getByRole('button', { name: '买入', exact: true }).click();
  await page.waitForTimeout(300);
  const cashAfterBuy = await page.evaluate(() => window.__sandbox.game.cash);
  check('点买入后现金减少', cashAfterBuy < cashBefore, `¥${cashBefore} → ¥${cashAfterBuy}`);

  await page.getByRole('button', { name: '卖出', exact: true }).click();
  await page.waitForTimeout(300);
  const cashAfterSell = await page.evaluate(() => window.__sandbox.game.cash);
  check('点赎回后现金增加', cashAfterSell > cashAfterBuy, `¥${cashAfterBuy} → ¥${cashAfterSell}`);

  const records = await page.evaluate(() => window.__sandbox.game.getTradeRecords().length);
  check('交易流水已记录', records >= 2, `${records} 条`);

  console.log('[3] 暂停 / 成绩单');
  await page.getByRole('button', { name: /暂停/ }).click();
  await page.waitForTimeout(200);
  check('暂停生效', await page.evaluate(() => window.__sandbox.game.isPaused));
  await page.getByRole('button', { name: /继续/ }).click();
  check('继续生效', !(await page.evaluate(() => window.__sandbox.game.isPaused)));

  await page.getByRole('button', { name: '成绩单', exact: true }).click();
  await page.waitForTimeout(300);
  const summaryText = (await page.locator('.summary-panel').innerText().catch(() => '')) || '';
  check('成绩单浮层展示', summaryText.includes('结算成绩单'));
  check('成绩单含评级', /A ·|B ·|C ·|D ·/.test(summaryText));
  await page.getByRole('button', { name: '看看盘面', exact: true }).click();
  check('成绩单可关闭', await page.locator('.summary-panel').count() === 0);

  console.log('[4] 教学目标任务卡');
  check('任务面板存在', await page.locator('.mission-panel').count() === 1);
  const missionText = await page.locator('.mission-panel').innerText();
  check('面板显示达成进度', /教学目标/.test(missionText) && /\d+\s*\/\s*7/.test(missionText),
    missionText.split('\n')[0]);
  check('已达成项含初始三项', ['分散配置', '控制权益仓位', '留足流动性'].every(t => missionText.includes(t)));
  // 迷你曲线需 ≥2 个交易日采样：先等游戏状态就绪（确定性），再断言 DOM
  await page.waitForFunction(() => window.__sandbox.game.assetHistory.length >= 2, { timeout: 15000 });
  const histLen = await page.evaluate(() => window.__sandbox.game.assetHistory.length);
  check('分资产历史已采样（≥2 天）', histLen >= 2, `${histLen} 点`);
  const sparkCount = await page.locator('.asset-spark').count();
  check('资产面板含迷你曲线', sparkCount === 5, `${sparkCount} 条`);
  const sparkHasPts = await page.locator('.asset-spark polyline').first()
    .getAttribute('points').catch(() => '');
  check('迷你曲线已绘制折线', !!sparkHasPts && sparkHasPts.includes(','), (sparkHasPts || '').slice(0, 30));

  const header = page.locator('.mission-header');
  const list = page.locator('.mission-list');
  await header.click();
  await page.waitForTimeout(150);
  check('点击可收起', await list.evaluate(el => el.style.display) === 'none');
  await header.click();
  await page.waitForTimeout(150);
  check('再次点击可展开', await list.evaluate(el => el.style.display) === 'flex');

  await page.getByRole('button', { name: '成绩单', exact: true }).click();
  await page.waitForTimeout(200);
  const summary2 = await page.locator('.summary-panel').innerText();
  check('成绩单含教学目标统计', /教学目标达成/.test(summary2));
  await page.getByRole('button', { name: '看看盘面', exact: true }).click();

  console.log('[5] 复盘：成绩单归因 / 本地存档');
  await page.getByRole('button', { name: '成绩单', exact: true }).click();
  await page.waitForTimeout(200);
  const s3 = await page.locator('.summary-panel').innerText();
  check('成绩单含收益归因', /收益归因/.test(s3));
  check('成绩单含操作时间线', /操作时间线/.test(s3));
  await page.getByRole('button', { name: '看看盘面', exact: true }).click();

  const saved = await page.evaluate(() => {
    const sum = window.__sandbox.summary();
    window.__sandbox.store.save({ ...sum, totalReturnRate: 0.08 }, ['diversify']);
    return window.__sandbox.progress();
  });
  check('存档写入并累计局数', saved.games >= 1 && saved.bestReturnRate > 0.07,
    `第 ${saved.games} 局 / 最佳 ${(saved.bestReturnRate * 100).toFixed(2)}%`);
  await page.waitForTimeout(700);
  const missionAfter = await page.locator('.mission-panel').innerText();
  check('任务面板显示历史最佳', /历史最佳/.test(missionAfter),
    missionAfter.split('\n').find(t => t.includes('历史最佳')) || '');

  console.log('[6] 窗口缩放重排');
  const panelDesktop = await page.locator('.control-panel').boundingBox();
  check('宽屏：操作面板在右侧', panelDesktop.x > 500 && panelDesktop.width < 220,
    `x=${Math.round(panelDesktop.x)} w=${Math.round(panelDesktop.width)}`);
  await page.setViewportSize({ width: 390, height: 844 });
  // 等待防抖重排完成（面板变为贴底操作条）而非固定等待
  await page.waitForFunction(
    () => { const el = document.querySelector('.control-panel'); return el && el.getBoundingClientRect().width > 340; },
    { timeout: 5000 },
  ).catch(() => {});
  const panelNarrow = await page.locator('.control-panel').boundingBox();
  check('缩窄后重排为底部操作条', panelNarrow.width > 330 && panelNarrow.y > 420,
    `w=${Math.round(panelNarrow.width)} y=${Math.round(panelNarrow.y)}`);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(
    () => { const el = document.querySelector('.control-panel'); return el && el.getBoundingClientRect().width < 220; },
    { timeout: 5000 },
  ).catch(() => {});
  const env = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    containerW: document.getElementById('game-container').clientWidth,
  }));
  const panelBack = await page.locator('.control-panel').boundingBox();
  check('放大后恢复右侧面板', panelBack.x > 500 && panelBack.width < 220,
    `x=${Math.round(panelBack.x)} w=${Math.round(panelBack.width)} innerW=${env.innerWidth} containerW=${env.containerW}`);

  console.log('[7] 难度模式 / 环境点评');
  const lvl = await page.evaluate(() => { window.__sandbox.setLevel('aggressive'); return window.__sandbox.level(); });
  check('切换难度生效', lvl === 'aggressive');
  const env2 = await page.evaluate(() => window.__sandbox.summary().environment);
  check('结算含市场环境点评', !!env2.label && env2.advice.length > 0, env2.label);
  const urlHasLevel = await page.evaluate(() => location.search.includes('level=aggressive'));
  check('难度写入 URL', urlHasLevel);

  console.log('[8] 引导重看 / 真实 UI 巡览');
  await page.getByRole('button', { name: '玩法说明', exact: true }).click();
  await page.waitForTimeout(300);
  check('点“玩法说明”再次弹出引导', (await page.locator('.intro-overlay').count()) === 1);
  check('回顾模式含“带我逛逛”', (await page.locator('.intro-overlay').innerText()).includes('带我逛逛'));
  // 回顾卡片可关闭
  await page.getByRole('button', { name: '知道了', exact: true }).click();
  await page.waitForTimeout(200);
  check('回顾卡片可关闭', (await page.locator('.intro-overlay').count()) === 0);
  // 重新打开并进入巡览
  await page.getByRole('button', { name: '玩法说明', exact: true }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '带我逛逛' }).click();
  await page.waitForTimeout(300);
  check('巡览高亮出现', (await page.locator('.tour-overlay').count()) === 1
    && (await page.locator('.tour-spot').count()) === 1);
  const tourTip = (await page.locator('.tour-overlay').innerText().catch(() => '')) || '';
  check('巡览说明指向操作区', /操作区/.test(tourTip), tourTip.split('\n')[0] || '');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.waitForTimeout(250);
  const tourTip2 = (await page.locator('.tour-overlay').innerText().catch(() => '')) || '';
  check('下一步切换到任务卡', /任务卡/.test(tourTip2), tourTip2.split('\n')[0] || '');
  await page.getByRole('button', { name: '跳过', exact: true }).click();
  await page.waitForTimeout(200);
  check('跳过结束巡览', (await page.locator('.tour-overlay').count()) === 0
    && (await page.locator('.intro-overlay').count()) === 0);

  console.log('[10] 实时财商干预（Advisor）');
  const advIds = await page.evaluate(() => window.__sandbox.adviceTriggered().map(a => a.id));
  check('盘面自动给出均衡提示', advIds.includes('balanced'), advIds.join(','));
  const setRisky = () => page.evaluate(() => {
    const g = window.__sandbox.game;
    g.pause();
    window.__sandbox.redeem('deposit', g.portfolio.deposit.principal);
    window.__sandbox.redeem('cash_mgmt', g.portfolio.cashMgmt.currentValue);
    window.__sandbox.invest('fund', g.cash);
    return { equity: g.portfolio.fund.currentValue / g.totalAssets, cash: g.cash, canTrade: g.canTrade };
  });
  let risky = await setRisky();
  if (!risky.canTrade) { // 若恰逢停牌/封盘，先放行再暂停重试
    await page.evaluate(() => window.__sandbox.resume());
    await page.waitForTimeout(700);
    risky = await setRisky();
  }
  check('已调到高风险仓位（权益≥60%、现金≈0）',
    risky.equity >= 0.6 && risky.cash === 0,
    `权益 ${(risky.equity * 100).toFixed(0)}% / 现金 ¥${risky.cash}`);
  await page.evaluate(() => window.__sandbox.resume());
  await page.waitForTimeout(600); // 让切片 tick 触发 _refresh → advisor
  const warnIds = await page.evaluate(() => window.__sandbox.adviceTriggered().map(a => a.id));
  check('切片刷新后触发仓位/流动性告警',
    warnIds.includes('equity-heavy') && warnIds.includes('liquidity-thin'), warnIds.join(','));
  const warnLevels = await page.evaluate(() => window.__sandbox.adviceTriggered()
    .filter(a => a.id === 'equity-heavy' || a.id === 'liquidity-thin').map(a => a.level));
  check('告警等级为 warn', warnLevels.length === 2 && warnLevels.every(l => l === 'warn'), warnLevels.join(','));
  const toastText = (await page.locator('.sandbox-toast').innerText().catch(() => '')) || '';
  check('告警以 ⚠ toast 呈现', /⚠/.test(toastText) && /仓位|应急垫/.test(toastText), toastText.slice(0, 44));
  const dupAdv = await page.evaluate(() => window.__sandbox.evaluateAdvisor().length);
  check('告警不重复触发', dupAdv === 0, `${dupAdv} 条`);

  console.log('[11] 复盘报告导出（CSV）');
  const exportCsv = await page.evaluate(() => window.__sandbox.exportReplay());
  check('调试出口可生成 CSV', exportCsv.includes('# 财商沙盘复盘报告')
    && exportCsv.includes('日期,操作,资产,金额,成交净值,变动份额,描述'));
  await page.getByRole('button', { name: '成绩单', exact: true }).click();
  await page.waitForTimeout(300);
  check('成绩单含导出按钮', (await page.getByRole('button', { name: '导出复盘 CSV' }).count()) === 1);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出复盘 CSV', exact: true }).click(),
  ]);
  const dlPath = await download.path();
  const dlContent = dlPath ? fs.readFileSync(dlPath, 'utf8') : '';
  check('下载文件名含种子与情景', /sandbox-replay-s42-long\.csv/.test(download.suggestedFilename()),
    download.suggestedFilename());
  check('下载内容为复盘 CSV', dlContent.includes('财商沙盘复盘报告')
    && dlContent.includes('日期,操作,资产,金额,成交净值,变动份额,描述'));
  await page.getByRole('button', { name: '看看盘面', exact: true }).click();
  await page.waitForTimeout(200);
  check('成绩单可关闭', (await page.locator('.summary-panel').count()) === 0);

  console.log('[12] 键盘快捷键 / 全部金额 / 现金夹取');
  // 前面干预测试已把现金买光，先卖出基金回笼现金（redeem 不受停牌限制）
  await page.getByRole('button', { name: '基金', exact: true }).click();
  await page.locator('.control-panel input').fill('10000');
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: '卖出', exact: true }).click();
  await page.waitForTimeout(300);
  const cash0 = await page.evaluate(() => window.__sandbox.game.cash);
  check('卖出基金回笼现金', cash0 > 1000, `现金 ¥${cash0.toFixed(2)}`);
  // 键盘选资产：按钮标签随资产变化
  await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
  await page.keyboard.press('1');
  await page.waitForTimeout(120);
  check('按 1 选中存款（存入/取出）',
    (await page.getByRole('button', { name: '存入', exact: true }).count()) === 1
    && (await page.getByRole('button', { name: '取出', exact: true }).count()) === 1);
  await page.keyboard.press('2');
  await page.waitForTimeout(120);
  check('按 2 选中现金理财（申购/赎回）',
    (await page.getByRole('button', { name: '申购', exact: true }).count()) === 1
    && (await page.getByRole('button', { name: '赎回', exact: true }).count()) === 1);
  await page.keyboard.press(' ');
  await page.waitForTimeout(150);
  check('空格暂停', await page.evaluate(() => window.__sandbox.game.isPaused));
  await page.keyboard.press(' ');
  await page.waitForTimeout(150);
  check('空格继续', !(await page.evaluate(() => window.__sandbox.game.isPaused)));
  const cashNow = await page.evaluate(() => window.__sandbox.game.cash);
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await page.waitForTimeout(120);
  const allVal = Number(await page.locator('.control-panel input').inputValue());
  check('“全部”填入全部现金', Math.abs(allVal - cashNow) < 0.01,
    `输入 ${allVal} / 现金 ${cashNow.toFixed(2)}`);
  // 现金夹取：填入超大金额买入 → 夹取为全部现金（重试避开停牌/封盘窗口）
  const cashBeforeClamp = await page.evaluate(() => window.__sandbox.game.cash);
  let clamped = false;
  for (let i = 0; i < 6 && !clamped; i++) {
    await page.locator('.control-panel input').fill('9999999');
    await page.getByRole('button', { name: '申购', exact: true }).click();
    await page.waitForTimeout(250);
    clamped = Math.abs(await page.evaluate(() => window.__sandbox.game.cash)) < 0.01;
  }
  check('金额超现金时夹取为全部现金', clamped && cashBeforeClamp > 0,
    `¥${cashBeforeClamp.toFixed(2)} → ¥${(await page.evaluate(() => window.__sandbox.game.cash)).toFixed(2)}`);

  console.log('[13] 复盘对照（vs 历史最佳）');
  // 先存入一局历史最佳（含曲线），再打开成绩单查看对比
  await page.evaluate(() => {
    const s = window.__sandbox.summary();
    window.__sandbox.store.save(
      { ...s, totalReturnRate: 0.12, maxDrawdown: 0.05, rating: 'A', missions: { completed: 2, total: 7 } },
      ['diversify'], 'balanced',
      window.__sandbox.game.equityCurve.map(p => ({ date: p.date, total: p.total })),
    );
  });
  await page.getByRole('button', { name: '成绩单', exact: true }).click();
  await page.waitForTimeout(300);
  const vsText = (await page.locator('.vs-best').innerText().catch(() => '')) || '';
  check('成绩单含历史最佳对比',
    /对比历史最佳/.test(vsText) && /总收益率/.test(vsText) && /最大回撤/.test(vsText) && /教学目标/.test(vsText),
    (vsText.split('\n')[0] || '').slice(0, 40));
  check('对比含百分点差(pp)', /pp/.test(vsText));
  await page.getByRole('button', { name: '看看盘面', exact: true }).click();
  await page.waitForTimeout(200);

  console.log('[14] 定投计划（DCA）');
  // 回笼现金（前面测试可能已花光）
  await page.evaluate(() => window.__sandbox.redeem('fund', 8000));
  await page.waitForTimeout(150);
  const cashDca = await page.evaluate(() => window.__sandbox.game.cash);
  check('定投前有可用现金', cashDca > 1000, `现金 ¥${cashDca.toFixed(2)}`);
  await page.evaluate(() => window.__sandbox.setDca({ enabled: true, amount: 1000, intervalDays: 1 }));
  const dcaBtnText = await page.getByRole('button', { name: /定投/ }).innerText();
  check('定投按钮反映开启', /定投\s*\d+日/.test(dcaBtnText), dcaBtnText);
  await page.waitForFunction(() => window.__sandbox.game.dcaCount >= 1, { timeout: 20000 }).catch(() => {});
  const dcaCount = await page.evaluate(() => window.__sandbox.game.dcaCount);
  check('定投按日扣款', dcaCount >= 1, `${dcaCount} 次`);
  const hasDcaTrade = await page.evaluate(
    () => window.__sandbox.game.getTradeRecords().some(r => r.description.includes('定投扣款')));
  check('流水记录定投扣款', hasDcaTrade);
  // 点按钮关闭
  await page.getByRole('button', { name: /定投/ }).click();
  await page.waitForTimeout(150);
  check('点按钮可关闭定投', (await page.evaluate(() => window.__sandbox.game.dca.enabled)) === false);
  const dcaBefore = await page.evaluate(() => window.__sandbox.game.dcaCount);
  await page.waitForTimeout(4000);
  const dcaAfter = await page.evaluate(() => window.__sandbox.game.dcaCount);
  check('关闭后不再扣款', dcaAfter === dcaBefore, `${dcaBefore} → ${dcaAfter}`);

  console.log('[15] 资产百科知识卡');
  // 资产面板每 tick 重建，直接用 element.click() 冒泡到容器委托监听（避开稳定性检查）
  const clickGuide = (type) => page.evaluate((t) => {
    const cell = document.querySelector(`#asset-panel [data-guide="${t}"]`);
    if (cell) cell.click();
  }, type);
  await clickGuide('fund');
  await page.waitForTimeout(250);
  check('点资产单元格弹出知识卡', (await page.locator('.knowledge-card').count()) === 1);
  const kbText = (await page.locator('.knowledge-card').innerText().catch(() => '')) || '';
  check('知识卡含资产名与科普',
    /基金/.test(kbText) && /风险/.test(kbText) && /流动性/.test(kbText) && /财商要点/.test(kbText),
    (kbText.split('\n')[0] || '').slice(0, 30));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Esc 关闭知识卡', (await page.locator('.knowledge-card').count()) === 0);
  await clickGuide('closed_fund');
  await page.waitForTimeout(200);
  check('可打开封闭理财知识卡', /封闭理财/.test(
    (await page.locator('.knowledge-card').innerText().catch(() => '')) || ''));
  await page.locator('.knowledge-card .kb-close').click();
  await page.waitForTimeout(150);
  check('关闭按钮可关闭知识卡', (await page.locator('.knowledge-card').count()) === 0);

  console.log('[16] 行为点评 / 存款基准');
  await page.getByRole('button', { name: '成绩单', exact: true }).click();
  await page.waitForTimeout(300);
  const sumText = (await page.locator('.summary-panel').innerText().catch(() => '')) || '';
  check('成绩单含“全额存存款”基准', /全额存存款/.test(sumText));
  check('成绩单含行为点评块', (await page.locator('.behavior-review').count()) === 1 && /行为点评/.test(sumText));
  const behText = (await page.locator('.behavior-review').innerText().catch(() => '')) || '';
  check('点评至少一条结论', behText.replace('行为点评', '').trim().length > 0,
    (behText.split('\n')[1] || '').slice(0, 40));
  await page.getByRole('button', { name: '看看盘面', exact: true }).click();
  await page.waitForTimeout(200);

  console.log('[17] 交易决策标注');
  const markers = await page.evaluate(() => window.__sandbox.tradeMarkers());
  check('买卖点已映射到曲线', Array.isArray(markers) && markers.length >= 2, `${markers.length} 个`);
  check('含买入与卖出点',
    markers.some(m => m.kind === 'buy') && markers.some(m => m.kind === 'sell'),
    `buy=${markers.filter(m => m.kind === 'buy').length} sell=${markers.filter(m => m.kind === 'sell').length}`);

  console.log('[18] 多局成长轨迹');
  await page.evaluate(() => window.__sandbox.recordRun());
  await page.evaluate(() => window.__sandbox.recordRun());
  await page.waitForTimeout(300);
  const runText = (await page.locator('.run-history').innerText().catch(() => '')) || '';
  check('成绩单含多局成长轨迹', /多局成长轨迹/.test(runText));
  check('轨迹含平均与最佳收益', /平均收益/.test(runText) && /最佳一局/.test(runText),
    runText.replace(/\s+/g, ' ').slice(0, 60));
  await page.getByRole('button', { name: '看看盘面', exact: true }).click();
  await page.waitForTimeout(150);

  console.log('[19] 资产配置饼图');
  check('桌面端显示配置饼图', await page.locator('div.alloc-donut').count() === 1);
  const donut = await page.locator('div.alloc-donut').getAttribute('class');
  check('饼图为 SVG 环形', /alloc-donut/.test(donut || '') && (await page.locator('div.alloc-donut svg circle').count()) >= 1);

  console.log('[20] 复制课堂链接');
  await page.getByRole('button', { name: '复制课堂链接' }).click();
  // 等待「课堂链接」文案出现（避免读到上一轮残留 toast：定投已关闭 等）
  const shareOk = await page.waitForFunction(
    () => { const t = document.querySelector('.sandbox-toast'); return t && /课堂链接/.test(t.textContent || ''); },
    { timeout: 2000 },
  ).then(() => true).catch(() => false);
  const shareToast = page.locator('.sandbox-toast');
  const shareText = shareOk ? (await shareToast.innerText().catch(() => '')) : '';
  check('点击后提示已复制课堂链接', shareOk && /课堂链接/.test(shareText), shareText.replace(/\n/g, ' ').slice(0, 50));
  await page.waitForTimeout(200);

  console.log('[22] 排行榜后端联动');
  // 直接经前端客户端上送一局成绩，验证「提交 → 后端持久化 → 拉取」闭环
  const submitRes = await page.evaluate(() => window.__sandbox.leaderboard.submit({
    name: '冒烟测试员', seed: 42, level: 'balanced', scenario: 'standard',
    returnRate: 0.42, maxDrawdown: 0.03, rating: 'A', missions: 7, total: 7, days: 60,
  }));
  check('上送成绩成功并返回条目', submitRes.ok === true && !!submitRes.entry?.id, submitRes.ok ? `id=${submitRes.entry.id}` : submitRes.error);
  check('上送返回全量排名', submitRes.ok && typeof submitRes.rank === 'number' && submitRes.rank === 1,
    submitRes.ok ? `rank=${submitRes.rank}` : '');
  const fetchRes = await page.evaluate(() => window.__sandbox.leaderboard.fetch({ scope: 'all', limit: 50 }));
  check('拉取榜单成功', fetchRes.ok === true && Array.isArray(fetchRes.entries) && fetchRes.entries.length > 0,
    fetchRes.ok ? `${fetchRes.entries.length} 条` : fetchRes.error);
  check('榜单含我刚提交的成绩',
    fetchRes.ok && fetchRes.entries.some(e => e.name === '冒烟测试员' && Math.abs(e.returnRate - 0.42) < 1e-9),
    fetchRes.ok ? fetchRes.entries.find(e => e.name === '冒烟测试员')?.returnRate : '');
  const rankRes = await page.evaluate(() => window.__sandbox.leaderboard.myRank(
    { returnRate: 0.42, maxDrawdown: 0.03, rating: 'A' }, { scope: 'all' }));
  check('我的排名接口返回第 1 名', rankRes.ok && rankRes.rank === 1, rankRes.ok ? `rank=${rankRes.rank}` : rankRes.error);

  // 打开排行榜浮层，验证 UI 渲染与「我」高亮
  await page.getByRole('button', { name: '排行榜' }).click();
  await page.waitForTimeout(600);
  check('排行榜浮层打开', (await page.locator('.leaderboard-panel').count()) === 1);
  await page.waitForFunction(
    () => { const t = document.querySelector('.leaderboard-panel')?.innerText || ''; return t.includes('冒烟测试员'); },
    { timeout: 5000 },
  ).catch(() => {});
  const lbText = (await page.locator('.leaderboard-panel').innerText().catch(() => '')) || '';
  check('浮层含榜单标题', /财商排行榜/.test(lbText));
  check('浮层含我提交的成绩并高亮「· 我」', /冒烟测试员/.test(lbText) && /· 我/.test(lbText),
    lbText.split('\n').find(l => l.includes('冒烟测试员')) || '');
  check('浮层含范围切换标签', /全部/.test(lbText) && /按情景/.test(lbText) && /按难度/.test(lbText));
  // 关闭浮层
  await page.locator('.lb-close').click();
  await page.waitForTimeout(150);
  check('排行榜浮层可关闭', (await page.locator('.leaderboard-panel').count()) === 0);

  console.log('[23] 后端行情接口（经 /api 代理）');
  // 经 vite 代理访问 8787 的 market-data，验证端到端联通
  const mdRes = await page.evaluate(async () => {
    const r = await fetch('/api/sandbox/v1/market-data?page=1&pageSize=2');
    return r.json();
  });
  check('代理拉取行情成功并返回分页结构', Array.isArray(mdRes.items) && mdRes.items.length === 2 && mdRes.total > 0,
    `total=${mdRes.total}`);
  const mf = mdRes.items[0];
  check('行情条目字段完整', typeof mf?.date === 'string' && typeof mf.fundNav === 'number' && typeof mf.cashMgmtRate === 'number'
    && typeof mf.closedFundNav === 'number' && typeof mf.isTradingDay === 'boolean' && Array.isArray(mf.suspendedSlices),
    mf ? mf.date : 'null');

  // ?backend=1：前端改为从后端拉取行情，验证无报错且请求成功
  const beUrl = `${url.split('?')[0]}?backend=1&seed=42&speed=10`;
  const bePage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const beStatus = [];
  const beErrors = [];
  bePage.on('response', (r) => { if (r.url().includes('/market-data')) beStatus.push(r.status()); });
  bePage.on('console', (m) => { if (m.type() === 'error') beErrors.push(m.text()); });
  bePage.on('pageerror', (e) => beErrors.push(String(e)));
  await bePage.goto(beUrl, { waitUntil: 'load' });
  await bePage.waitForTimeout(3000);
  check('后端行情模式发起 market-data 请求', beStatus.length > 0, `statuses=${beStatus.join(',')}`);
  check('后端行情模式请求成功（含 200）', beStatus.includes(200), `statuses=${beStatus.join(',')}`);
  check('后端行情模式无控制台报错', beErrors.length === 0, beErrors.slice(0, 3).join(' | '));
  // 复制课堂链接：后端模式下分享链接应带 backend=1，同学点开即用同一份后端行情
  // 先关闭首启引导（否则 overlay 拦截指针事件）
  if (await bePage.locator('.intro-overlay').count()) {
    await bePage.getByRole('button', { name: '加长' }).click();
    await bePage.getByRole('button', { name: '开始演练', exact: true }).click();
    await bePage.waitForTimeout(500);
  }
  await bePage.getByRole('button', { name: '复制课堂链接' }).click();
  await bePage.waitForTimeout(300);
  const beHref = await bePage.evaluate(() => location.href);
  check('后端模式分享链接带 backend=1', /[?&]backend=1\b/.test(beHref), (beHref.split('?')[1] || ''));
  await bePage.close();

  console.log('[21] 手机竖屏 390×844');
  const mobileErrors = [];
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  mobile.on('console', m => { if (m.type() === 'error') mobileErrors.push(m.text()); });
  mobile.on('pageerror', e => mobileErrors.push(String(e)));
  await mobile.goto(url, { waitUntil: 'load' });
  await mobile.waitForTimeout(2500);

  // 竖屏同样先关闭新手引导，避免遮罩影响截图
  const mIntro = await mobile.locator('.intro-overlay').count();
  if (mIntro) {
    await mobile.getByRole('button', { name: '开始演练', exact: true }).click().catch(() => {});
    await mobile.waitForTimeout(600);
  }
  check('竖屏：引导已关闭', (await mobile.locator('.intro-overlay').count()) === 0);

  check('竖屏无控制台报错', mobileErrors.length === 0, mobileErrors.slice(0, 2).join(' | '));
  const panelBox = await mobile.locator('.control-panel').boundingBox();
  // 操作条应贴底并铺满宽度，顶部位置随按钮换行略有浮动，用合理阈值而非硬编码
  check('竖屏操作条贴底且铺满', panelBox.width > 330 && panelBox.y > 420,
    `${Math.round(panelBox.width)}px 宽 @y=${Math.round(panelBox.y)}`);
  const missionBox = await mobile.locator('.mission-panel').boundingBox();
  check('竖屏任务面板不越界', missionBox.x >= 0 && missionBox.x + missionBox.width <= 390,
    `x=${Math.round(missionBox.x)} w=${Math.round(missionBox.width)}`);
  await mobile.screenshot({ path: path.join(SHOT_DIR, 'page-check-mobile.png') });

  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, 'page-check.png') });
  console.log(`  截图：${path.join(SHOT_DIR, 'page-check.png')} / page-check-mobile.png`);

  await browser.close();
  await server.close();
  try { lbServer.kill(); } catch { /* 忽略 */ }
  try { fs.rmSync(LB_DATA); } catch { /* 忽略 */ }

  console.log(`\n页面冒烟结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async e => {
  console.error(e);
  process.exit(1);
});
