/**
 * 无头冒烟：只跑核心层（config / core / entities），不依赖 DOM 与 three。
 * 运行：npm run smoke
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

import {
  GameConfig,
  LEVELS,
  resolveScenario,
  ASSET_GUIDE,
} from '../src/config/GameConfig';
import { SandboxGame } from '../src/core/SandboxGame';
import {
  MarketDataLoader,
  generateMarketData,
} from '../src/core/MarketDataLoader';
import { MissionSystem, createMissions } from '../src/core/MissionSystem';
import { Advisor } from '../src/core/Advisor';
import { ProgressStore } from '../src/core/ProgressStore';
import { compareToBest, BestRun, runsStats } from '../src/core/ProgressStore';
import { reviewBehavior, depositBaseline } from '../src/core/BehaviorReview';
import { buildBenchmarks } from '../src/core/Benchmarks';
import { mapTradesToCurve } from '../src/core/TradeMarkers';
import { allocationFractions } from '../src/core/Allocation';
import { buildShareQuery } from '../src/core/ShareLink';
import {
  sortEntries,
  rankInList,
  rankInScope,
  submissionFromSummary,
} from '../src/core/Leaderboard';
import { PlayerPortfolio } from '../src/entities/PortfolioEntities';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

async function main(): Promise<void> {
  console.log('[1] 行情种子可复现');
  const a1 = generateMarketData(20260101);
  const a2 = generateMarketData(20260101);
  const b1 = generateMarketData(777);
  check('同种子数据一致', JSON.stringify(a1) === JSON.stringify(a2));
  check('不同种子数据不同', JSON.stringify(a1) !== JSON.stringify(b1));
  check(
    '数据区间覆盖 2022-01-01 ~ 2026-07',
    a1.length > 1600 && a1[0].date === '2022-01-01',
    `${a1.length} 天`,
  );
  check(
    '含休市日（周末/节假日）',
    a1.some((d) => !d.isTradingDay),
  );

  console.log('[2] 计息口径（按日，非按切片）');
  const p = new PlayerPortfolio(0.0175, 0.038, 90, 100000);
  p.cashMgmt.subscribe(20000);
  for (let i = 0; i < 30; i++) p.cashMgmt.accrueDaily(1, 0.025);
  check(
    '现金理财 30 天 ≈ 年化 2.5%',
    near(p.cashMgmt.returnRate, (30 * 0.025) / 365, 0.0005),
    `${(p.cashMgmt.returnRate * 100).toFixed(3)}%`,
  );

  const d = new PlayerPortfolio(0.0175, 0.038, 90, 100000);
  d.deposit.deposit(20000);
  for (let i = 0; i < 365; i++) d.deposit.accrueInterest(1);
  check(
    '存款 365 天 ≈ 年化 1.75%',
    near(d.deposit.returnRate, 0.0175, 0.0005),
    `${(d.deposit.returnRate * 100).toFixed(3)}%`,
  );
  check('存款收益率不再恒为 0', d.deposit.returnRate > 0);

  console.log('[3] 买入 / 赎回 / 流水');
  const game = new SandboxGame(1234);
  await game.init();
  check(
    '初始总资产 = 本金',
    near(game.totalAssets, GameConfig.INITIAL_PRINCIPAL, 0.01),
    `¥${game.totalAssets}`,
  );
  check('初始现金 2 万', near(game.cash, 20000, 0.01));

  await game.invest('fund', 10000);
  check('买入后现金减少', near(game.cash, 10000, 0.01), `¥${game.cash}`);
  check(
    '买入后总资产不变',
    near(game.totalAssets, GameConfig.INITIAL_PRINCIPAL, 0.01),
  );
  check(
    '买入写入交易流水',
    game.getTradeRecords().length === 1 &&
      game.getTradeRecords()[0].action === '买入',
  );

  const before = game.cash;
  const back = await game.redeem('fund', 5000);
  check('赎回后现金增加', game.cash > before, `+¥${back.toFixed(2)}`);
  check(
    '赎回写入交易流水',
    game.getTradeRecords().some((r) => r.action === '卖出'),
  );
  check('赎回金额 ≈ 5000', near(back, 5000, 1));

  const bad = await game.invest('fund', 99999999);
  check('现金不足时买入失败', bad === false);

  console.log('[3.5] 卖出后成本基数同比例冲减');
  const f = new PlayerPortfolio(0.0175, 0.038, 90, 100000);
  f.fund.buy(20000);
  f.fund.updateNav(1.1);
  f.fund.sell(10000); // 卖出一半份额
  check(
    '卖出后收益率 = 净值涨幅 +10%',
    near(f.fund.returnRate, 0.1, 0.001),
    `${(f.fund.returnRate * 100).toFixed(2)}%`,
  );

  console.log('[4] 封闭理财期限约束');
  check('未到期不可赎回', game.isRedeemable('closed_fund') === false);
  const early = await game.redeem('closed_fund');
  check('强制赎回返回 0', early === 0);

  console.log('[5] 完整一局（加速）与结算成绩单');
  (GameConfig as any).SLICE_DURATION_MS = 1;
  (GameConfig as any).PLAY_DAYS = 8;

  let finished: any = null;
  const g2 = new SandboxGame(20260101);
  await g2.init();
  g2.onFinish((s) => {
    finished = s;
  });
  g2.setSpeed(10);
  await g2.start();

  check('行情走完自动结算', !!finished);
  if (finished) {
    check(
      '成绩单含日期区间',
      !!finished.startDate && !!finished.endDate,
      `${finished.startDate} → ${finished.endDate}`,
    );
    check(
      '曲线点数 = 期间交易日数',
      finished.days === g2.equityCurve.length && finished.days > 1,
      `${finished.days} 个交易日 / 共 8 个自然日`,
    );
    check('未超过本局天数上限', finished.days <= 8);
    check(
      '总资产与账面对齐',
      near(finished.totalAssets, g2.totalAssets, 0.01),
      `¥${finished.totalAssets.toFixed(2)}`,
    );
    check('年化收益为有限数', Number.isFinite(finished.annualizedReturn));
    check(
      '最大回撤在 0~1',
      finished.maxDrawdown >= 0 && finished.maxDrawdown < 1,
    );
    check('评级非空', !!finished.rating, finished.rating);
  }

  console.log('[6] 重置回到起点');
  await g2.reset();
  check(
    '重置后总资产 = 本金',
    near(g2.totalAssets, GameConfig.INITIAL_PRINCIPAL, 0.01),
  );
  check('重置后流水清空', g2.getTradeRecords().length === 0);
  check('重置后曲线清空', g2.equityCurve.length === 0);
  g2.stop();

  console.log('[7] 教学目标任务卡');
  const g3 = new SandboxGame(9);
  await g3.init();
  const statuses = (() => {
    g3.evaluateMissions();
    return g3.missions.getStatuses();
  })();
  const byId = (id: string) => statuses.find((s) => s.def.id === id)!;
  check('任务卡共 7 张', statuses.length === 7, `${statuses.length} 张`);
  check(
    '初始配置达成 分散/权益仓位/流动性 3 项',
    g3.missions.completed === 3,
    statuses
      .filter((s) => s.done)
      .map((s) => s.def.title)
      .join('/'),
  );
  check('封闭理财任务初始未达成', byId('closed-cycle').done === false);
  check('回撤任务未满 5 天不算达成', byId('drawdown-guard').done === false);
  check('停牌任务初始未达成', byId('suspended').done === false);
  check('稳健增值初始未达成', byId('steady-profit').done === false);

  const base = g3.getMissionContext();
  g3.missions.evaluate({ ...base, maturedCount: 1 });
  check(
    '兑付 1 次后 走完封闭期 达成',
    g3.missions.getStatuses().find((s) => s.def.id === 'closed-cycle')!.done,
  );

  g3.missions.evaluate({ ...base, suspendedSeen: 1 });
  check(
    '经历停牌后 认识停牌 达成',
    g3.missions.getStatuses().find((s) => s.def.id === 'suspended')!.done,
  );

  g3.missions.evaluate({ ...base, days: 6, maxDrawdown: 0.05 });
  check(
    '满 5 天且回撤 ≤8% → 守住回撤 达成',
    g3.missions.getStatuses().find((s) => s.def.id === 'drawdown-guard')!.done,
  );
  g3.missions.reset();
  g3.missions.evaluate({ ...base, days: 6, maxDrawdown: 0.2 });
  check(
    '回撤 20% 时不达成',
    !g3.missions.getStatuses().find((s) => s.def.id === 'drawdown-guard')!.done,
  );

  g3.missions.reset();
  g3.portfolio.fund.updateNav(1.2); // 基金市值 +4000 → 总收益 4%
  const up = g3.getMissionContext();
  check(
    '总收益 4% → 稳健增值 达成',
    g3.missions.evaluate(up).some((m) => m.id === 'steady-profit'),
    `${(up.portfolio.totalReturnRate * 100).toFixed(2)}%`,
  );

  console.log('[8] 复盘：收益归因 / 时间线 / 本地存档');
  const g4 = new SandboxGame(5);
  await g4.init();
  await g4.invest('fund', 10000);
  await g4.redeem('fund', 5000);
  const s4 = g4.getSummary();
  const fundAttr = s4.attribution.find((a) => a.type === 'fund')!;
  check(
    '归因含四类资产',
    s4.attribution.length === 4,
    `${s4.attribution.length} 类`,
  );
  check(
    '归因记录基金投入与回流',
    fundAttr.invested > 0 && fundAttr.redeemed > 0,
    `投入 ¥${fundAttr.invested.toFixed(0)} / 回流 ¥${fundAttr.redeemed.toFixed(0)}`,
  );
  check(
    '归因贡献 = 市值 + 回流 − 投入',
    near(
      fundAttr.contribution,
      fundAttr.currentValue + fundAttr.redeemed - fundAttr.invested,
      0.01,
    ),
    `${fundAttr.contribution.toFixed(2)}`,
  );
  check('时间线记录操作', s4.timeline.length >= 2, `${s4.timeline.length} 条`);
  check(
    '成绩单含教学目标统计',
    s4.missions.total === 7 && s4.missions.completed >= 0,
  );

  const store = new ProgressStore();
  check(
    '无 localStorage 时降级为内存存档',
    store.data.games === 0 && store.available === false,
  );
  const r1 = store.save({ ...s4, totalReturnRate: 0.05 }, [
    'diversify',
    'liquidity',
  ]);
  check('首局即新纪录', r1.isNewBest);
  check('存档局数 +1', store.data.games === 1);
  const r2 = store.save({ ...s4, totalReturnRate: -0.5 }, ['closed-cycle']);
  check(
    '更差成绩不刷新最佳',
    !r2.isNewBest && near(store.data.bestReturnRate, 0.05, 1e-9),
    `${(store.data.bestReturnRate * 100).toFixed(2)}%`,
  );
  check(
    '累计达成任务去重累加',
    store.data.missionsEverDone.length === 3,
    store.data.missionsEverDone.join(','),
  );
  store.save({ ...s4, totalReturnRate: 0.06 }, ['diversify']);
  check(
    '更好成绩刷新历史最佳',
    near(store.data.bestReturnRate, 0.06, 1e-9),
    `${(store.data.bestReturnRate * 100).toFixed(2)}%`,
  );

  const mem = new Map<string, string>();
  const fakeStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as any;
  const p1 = new ProgressStore(fakeStorage);
  p1.save(s4, ['fund-cap']);
  const p2 = new ProgressStore(fakeStorage);
  check(
    '存档可持久化并读回',
    p2.data.games === 1 && p2.data.missionsEverDone.includes('fund-cap'),
  );
  p2.reset();
  check('清空存档后归零', new ProgressStore(fakeStorage).data.games === 0);

  console.log('[9] 数据加载器边界');
  const loader = new MarketDataLoader(1);
  check('hasNext 起点为真', loader.hasNext());
  loader.seekTo(loader.totalDays - 1);
  check('末日 hasNext 为假', !loader.hasNext() && loader.isFinished);

  console.log('[10] 难度模式 / 环境点评');
  const mkCtx = (fundVal: number, total: number): any => ({
    portfolio: {
      fund: { currentValue: fundVal },
      deposit: { principal: 0 },
      cashMgmt: { currentValue: 0 },
      closedFund: { currentValue: 0 },
    },
    cash: 0,
    totalAssets: total,
    tradeCount: 0,
    maturedCount: 0,
    suspendedSeen: 0,
    days: 10,
    maxDrawdown: 0,
  });
  const cons = createMissions(LEVELS.conservative.caps);
  const aggr = createMissions(LEVELS.aggressive.caps);
  const consEq = cons.find((m) => m.id === 'equity-cap')!;
  const aggrEq = aggr.find((m) => m.id === 'equity-cap')!;
  const ctx45 = mkCtx(45000, 100000);
  check('保守型下 45% 权益未控仓', !consEq.evaluate(ctx45).done);
  check('进取型下 45% 权益已控仓', aggrEq.evaluate(ctx45).done);
  check('保守型控制仓位阈值 35%', consEq.desc.includes('35%'), consEq.desc);
  check('进取型控制仓位阈值 50%', aggrEq.desc.includes('50%'), aggrEq.desc);

  const g7 = new SandboxGame(7, 'aggressive');
  await g7.init();
  check('难度写入 GameSummary', g7.getSummary().level === 'aggressive');
  const env = g7.getSummary().environment;
  check(
    '环境点评非空（标签+建议）',
    !!env.label && env.advice.length > 0,
    env.label,
  );
  g7.setLevel('conservative');
  check(
    'setLevel 切换难度',
    g7.level === 'conservative' && g7.getSummary().level === 'conservative',
  );
  check(
    '切换后任务阈值随难度变化',
    createMissions(LEVELS.conservative.caps)
      .find((m) => m.id === 'liquidity')!
      .desc.includes('30%'),
  );

  const st = new ProgressStore();
  st.save({ ...s4, totalReturnRate: 0.04 }, ['x'], 'aggressive');
  check(
    '存档记录上次难度',
    st.data.lastLevel === 'aggressive',
    st.data.lastLevel,
  );

  console.log('[11] 实时财商干预（Advisor）');
  const mkAdvCtx = (
    fund: number,
    cash: number,
    cashMgmt: number,
    deposit: number,
    closed: number,
  ): any => ({
    portfolio: {
      fund: { currentValue: fund },
      cashMgmt: { currentValue: cashMgmt },
      deposit: { principal: deposit },
      closedFund: { currentValue: closed },
      totalReturnRate: 0,
    },
    cash,
    totalAssets: fund + cash + cashMgmt + deposit + closed,
    tradeCount: 0,
    maturedCount: 0,
    suspendedSeen: 0,
    days: 3,
    maxDrawdown: 0,
  });
  const ids = (list: any[]) => list.map((a) => a.id);

  const advA = new Advisor();
  const advR1 = advA.evaluate(mkAdvCtx(60000, 0, 0, 20000, 20000));
  check(
    '权益 60% 触发仓位过重告警',
    ids(advR1).includes('equity-heavy'),
    ids(advR1).join(','),
  );
  check('流动性 0% 触发应急垫告警', ids(advR1).includes('liquidity-thin'));
  check('无集中度告警（最高 60%）', !ids(advR1).includes('concentration'));
  check(
    '告警等级为 warn',
    advR1.every((x) => x.level === 'warn') && advR1.length === 2,
    `${advR1.length} 条`,
  );

  const advB = new Advisor();
  const advR2 = ids(advB.evaluate(mkAdvCtx(75000, 0, 0, 20000, 5000)));
  check(
    '单一资产 75% 触发集中度告警',
    advR2.includes('concentration'),
    advR2.join(','),
  );

  const advC = new Advisor();
  const advR3 = ids(advC.evaluate(mkAdvCtx(20000, 20000, 20000, 20000, 20000)));
  check(
    '均衡配置给出正向提示',
    advR3.length === 1 && advR3[0] === 'balanced',
    advR3.join(','),
  );

  const advD = new Advisor();
  const advR4 = ids(
    advD.evaluate(mkAdvCtx(20000, 20000, 20000, 20000, 20000), {
      fundNavChange: -0.05,
    } as any),
  );
  check(
    '基金大跌给出低吸知识点',
    advR4.includes('dip-opportunity'),
    advR4.join(','),
  );

  const advDup = advD.evaluate(mkAdvCtx(20000, 20000, 20000, 20000, 20000), {
    fundNavChange: -0.05,
  } as any);
  check(
    '同一条建议不重复触发',
    advDup.length === 0,
    `第二次 ${advDup.length} 条`,
  );
  check(
    '已触发清单按序记录',
    ids(advD.getTriggered()).includes('balanced') &&
      ids(advD.getTriggered()).includes('dip-opportunity'),
  );
  advD.reset();
  check('reset 后清空触发记录', advD.getTriggered().length === 0);

  const advGame = new SandboxGame(3);
  await advGame.init();
  const firstAdv = ids(advGame.evaluateAdvisor());
  check(
    '沙盘初始配置给出均衡提示',
    firstAdv.includes('balanced'),
    firstAdv.join(','),
  );
  const againAdv = ids(advGame.evaluateAdvisor());
  check('重复评估不再触发', againAdv.length === 0, `${againAdv.length} 条`);

  console.log('[12] 行情情景（回放起点 / 时长）');
  check('未知情景回落默认', resolveScenario('bogus').id === 'standard');
  const midGame = new SandboxGame(42, 'balanced', 'mid');
  check(
    '情景含起点与天数',
    midGame.scenario.start === '2023-06-01' && midGame.playDays === 60,
  );
  await midGame.init();
  const midSnap = midGame.getCurrentSnapshot();
  check(
    '回放从 2023-06 起',
    !!midSnap && midSnap.date >= '2023-06-01',
    midSnap?.date ?? '',
  );
  check('进度上限随情景', midGame.dayProgress.total === 60);
  check('成绩单记录情景', midGame.getSummary().scenario.id === 'mid');

  const longGame = new SandboxGame(42, 'balanced', 'long');
  longGame.setScenario('long');
  check(
    '加长情景 120 天',
    longGame.playDays === 120 && longGame.dayProgress.total === 120,
  );
  await longGame.init();
  check(
    '切换情景后 loader 重定位到新起点',
    longGame.dataLoader.currentIndex === longGame.dataLoader.startIndex,
  );
  check('加长情景起点仍为数据起点', longGame.dataLoader.startIndex === 0);

  const recentGame = new SandboxGame(42, 'balanced', 'recent');
  await recentGame.init();
  check(
    '近期情景仍有足够数据',
    recentGame.dataLoader.hasNext() &&
      recentGame.scenario.start === '2025-06-01',
    `${recentGame.scenario.start} / hasNext=${recentGame.dataLoader.hasNext()}`,
  );

  console.log('[13] 分资产走势采样（迷你曲线数据）');
  const histGame = new SandboxGame(20260101);
  await histGame.init();
  const histDone = new Promise<void>((res) => histGame.onFinish(() => res()));
  histGame.setSpeed(10);
  await histGame.start();
  await histDone;
  check(
    '分资产历史与总资产曲线等长',
    histGame.assetHistory.length === histGame.equityCurve.length &&
      histGame.assetHistory.length >= 2,
    `${histGame.assetHistory.length} 点`,
  );
  const lastPt = histGame.assetHistory[histGame.assetHistory.length - 1];
  const lastSum =
    lastPt.cash +
    lastPt.deposit +
    lastPt.cashMgmt +
    lastPt.closedFund +
    lastPt.fund;
  const lastTotal = histGame.equityCurve[histGame.equityCurve.length - 1].total;
  check(
    '分资产合计 = 当日总资产',
    near(lastSum, lastTotal, 0.01),
    `¥${lastSum.toFixed(2)} vs ¥${lastTotal.toFixed(2)}`,
  );
  const firstPt = histGame.assetHistory[0];
  check(
    '采样含日期',
    typeof firstPt.date === 'string' && firstPt.date.length === 10,
    firstPt.date,
  );
  await histGame.reset();
  check(
    '重置清空分资产历史',
    histGame.assetHistory.length === 0 && histGame.equityCurve.length === 0,
  );

  console.log('[14] 复盘报告导出（CSV）');
  const csvGame = new SandboxGame(20260101);
  await csvGame.init();
  const csvDone = new Promise<void>((res) => csvGame.onFinish(() => res()));
  csvGame.setSpeed(10);
  await csvGame.start();
  await csvDone;
  const csv = csvGame.exportReplayCsv();
  check('CSV 含报告标题', csv.includes('# 财商沙盘复盘报告'));
  check('CSV 含归因表头', csv.includes('资产,累计投入,累计赎回,期末市值,贡献'));
  check(
    'CSV 含流水表头',
    csv.includes('日期,操作,资产,金额,成交净值,变动份额,描述'),
  );
  check(
    'CSV 含成绩单关键字段',
    csv.includes('综合评级') &&
      csv.includes('教学目标达成') &&
      csv.includes('市场环境'),
  );
  const csvLines = csv.split('\n');
  const flowIdx = csvLines.findIndex((l) => l.startsWith('日期,操作'));
  const flowRows = csvLines
    .slice(flowIdx + 1)
    .filter((l) => l.trim() && !l.startsWith('#'));
  check(
    '流水行数 = 交易记录数',
    flowRows.length === csvGame.getTradeRecords().length,
    `${flowRows.length} 行 / ${csvGame.getTradeRecords().length} 条`,
  );
  const hasCommaDesc = csvGame
    .getTradeRecords()
    .some((r) => r.description.includes(','));
  check(
    '含逗号描述已转义加引号',
    hasCommaDesc ? csv.includes('"') : true,
    hasCommaDesc ? '已加引号' : '无逗号描述',
  );

  console.log('[15] 复盘对照（vs 历史最佳）');
  check('无历史最佳不对比', compareToBest(s4, null) === null);
  const best0: BestRun = {
    returnRate: 0.03,
    maxDrawdown: 0.1,
    rating: 'B',
    missions: 2,
    total: 7,
    days: 8,
    curve: [],
  };
  const cmp = compareToBest(
    {
      ...s4,
      totalReturnRate: 0.05,
      maxDrawdown: 0.06,
      missions: { completed: 4, total: 7 },
    } as any,
    best0,
  )!;
  check(
    '收益率差 = 本局 − 最佳',
    near(cmp.returnRateDelta, 0.02, 1e-9),
    `${cmp.returnRateDelta}`,
  );
  check('判定为更优', cmp.better === true);
  check(
    '回撤差为负（更好）',
    cmp.drawdownDelta < 0 && near(cmp.drawdownDelta, -0.04, 1e-9),
    `${cmp.drawdownDelta}`,
  );
  check('教学目标差 = 2', cmp.missionDelta === 2, `${cmp.missionDelta}`);

  const stCmp = new ProgressStore();
  const c1 = stCmp.save({ ...s4, totalReturnRate: 0.05 }, ['a'], 'balanced', [
    { date: '2022-01-04', total: 100000 },
    { date: '2022-01-05', total: 100500 },
  ]);
  check(
    '首局即新纪录并存下最佳曲线',
    c1.isNewBest &&
      stCmp.data.best?.returnRate === 0.05 &&
      stCmp.data.best?.curve.length === 2,
  );
  const c2 = stCmp.save({ ...s4, totalReturnRate: 0.02 }, ['b'], 'balanced', [
    { date: 'x', total: 1 },
  ]);
  check(
    '更差局不刷新最佳',
    !c2.isNewBest &&
      stCmp.data.best?.returnRate === 0.05 &&
      stCmp.data.best?.curve.length === 2,
  );

  const longCurve = Array.from({ length: 200 }, (_, i) => ({
    date: `d${i}`,
    total: 100000 + i,
  }));
  const stCmp2 = new ProgressStore();
  stCmp2.save({ ...s4, totalReturnRate: 0.09 }, [], 'balanced', longCurve);
  check(
    '曲线降采样至 ≤80 点',
    (stCmp2.data.best?.curve.length ?? 0) <= 80,
    `${stCmp2.data.best?.curve.length} 点`,
  );

  console.log('[16] 定投计划（DCA）');
  const dcaGame = new SandboxGame(20260101);
  dcaGame.setDca({
    enabled: true,
    amount: 1000,
    intervalDays: 2,
    asset: 'fund',
  });
  await dcaGame.init();
  const dcaDone = new Promise<void>((res) => dcaGame.onFinish(() => res()));
  dcaGame.setSpeed(10);
  await dcaGame.start();
  await dcaDone;
  check('定投按间隔扣款', dcaGame.dcaCount >= 1, `${dcaGame.dcaCount} 次`);
  const dcaTrades = dcaGame
    .getTradeRecords()
    .filter((r) => r.description.includes('定投扣款'));
  check(
    '流水记录定投扣款',
    dcaTrades.length === dcaGame.dcaCount,
    `${dcaTrades.length} 条`,
  );
  check(
    '定投金额正确',
    dcaTrades.length > 0 &&
      dcaTrades.every((r) => Math.abs(r.amount - 1000) < 0.01),
  );

  const dcaGame2 = new SandboxGame(20260101);
  dcaGame2.setDca({ enabled: true, amount: 999999, intervalDays: 1 });
  await dcaGame2.init();
  const dcaDone2 = new Promise<void>((res) => dcaGame2.onFinish(() => res()));
  dcaGame2.setSpeed(10);
  await dcaGame2.start();
  await dcaDone2;
  check(
    '现金不足时定投跳过',
    dcaGame2.dcaCount === 0,
    `${dcaGame2.dcaCount} 次`,
  );

  const dcaClamp = new SandboxGame(1);
  dcaClamp.setDca({ intervalDays: 0, amount: -5 });
  check(
    '定投参数夹取为合法值',
    dcaClamp.dca.intervalDays === 1 && dcaClamp.dca.amount === 0,
    `interval=${dcaClamp.dca.intervalDays} amount=${dcaClamp.dca.amount}`,
  );
  check(
    '成绩单记录定投次数',
    dcaGame.getSummary().dcaCount === dcaGame.dcaCount,
  );

  console.log('[17] 资产百科知识库');
  const guideTypes = ['deposit', 'cash_mgmt', 'closed_fund', 'fund'] as const;
  check(
    '四类资产均有百科且要点≥3',
    guideTypes.every(
      (t) => !!ASSET_GUIDE[t] && ASSET_GUIDE[t].points.length >= 3,
    ),
  );
  check(
    '百科含风险/收益/流动性与简介',
    guideTypes.every((t) => {
      const g = ASSET_GUIDE[t];
      return (
        !!g.risk && !!g.returnLevel && !!g.liquidity && g.summary.length > 0
      );
    }),
  );
  check(
    '基金标注高风险、存款低风险',
    ASSET_GUIDE.fund.risk === '高' &&
      ASSET_GUIDE.deposit.risk === '低' &&
      ASSET_GUIDE.closed_fund.liquidity === '低',
  );

  console.log('[18] 行为点评 / 存款基准');
  const baseSum: any = {
    ...s4,
    principal: 100000,
    days: 365,
    totalAssets: 100000,
    totalReturnRate: 0,
    maxDrawdown: 0,
    tradeCount: 1,
    dcaCount: 0,
    missions: { completed: 0, total: 7 },
  };
  const b = depositBaseline(baseSum);
  check(
    '存款基准≈年化利率',
    near(b.baselineRate, GameConfig.DEPOSIT_RATE, 1e-4),
    `${(b.baselineRate * 100).toFixed(3)}%`,
  );
  check(
    'beatBy = 本局 − 基准',
    near(
      depositBaseline({ ...baseSum, totalReturnRate: 0.05 }).beatBy,
      0.05 - GameConfig.DEPOSIT_RATE,
      1e-6,
    ),
  );

  check(
    '高频交易给出 warn',
    reviewBehavior({ ...baseSum, tradeCount: 30, days: 10 }).some(
      (o) => o.tone === 'warn' && /频繁/.test(o.text),
    ),
  );
  check(
    '极少操作给中性提示',
    reviewBehavior({ ...baseSum, tradeCount: 1 }).some((o) =>
      /操作很少/.test(o.text),
    ),
  );
  check(
    '定投给出 good',
    reviewBehavior({ ...baseSum, dcaCount: 3 }).some(
      (o) => o.tone === 'good' && /定投/.test(o.text),
    ),
  );
  check(
    '大回撤给出 warn',
    reviewBehavior({ ...baseSum, maxDrawdown: 0.2 }).some(
      (o) => o.tone === 'warn' && /回撤/.test(o.text),
    ),
  );
  check(
    '跑赢存款给 good',
    reviewBehavior({ ...baseSum, totalReturnRate: 0.1 }).some(
      (o) => o.tone === 'good' && /跑赢/.test(o.text),
    ),
  );
  check(
    '跑输存款给 info',
    reviewBehavior({ ...baseSum, totalReturnRate: -0.05 }).some((o) =>
      /未跑赢/.test(o.text),
    ),
  );
  const concSummary: any = {
    ...baseSum,
    totalAssets: 100000,
    holdings: [
      { type: 'fund', currentValue: 80000 },
      { type: 'deposit', currentValue: 5000 },
      { type: 'cash_mgmt', currentValue: 5000 },
      { type: 'closed_fund', currentValue: 10000 },
    ],
  };
  check(
    '期末过度集中给出 warn',
    reviewBehavior(concSummary).some(
      (o) => o.tone === 'warn' && /集中/.test(o.text),
    ),
  );
  check(
    '点评不超过 5 条',
    reviewBehavior({
      ...baseSum,
      tradeCount: 40,
      days: 5,
      maxDrawdown: 0.3,
      dcaCount: 5,
      totalReturnRate: -0.1,
    }).length <= 5,
  );

  console.log('[19] 策略基准曲线');
  const bcurve = [
    { date: 'd0', total: 100000, fundNav: 1.0 },
    { date: 'd1', total: 101000, fundNav: 1.1 },
    { date: 'd2', total: 99000, fundNav: 0.9 },
  ];
  const bench = buildBenchmarks(bcurve, 100000);
  check(
    '基准与实际等长',
    bench.allDeposit.length === 3 && bench.allFund.length === 3,
  );
  check(
    '全存款随天数复利增长',
    bench.allDeposit[2] > bench.allDeposit[0] &&
      near(bench.allDeposit[0], 100000, 1e-6),
    `¥${bench.allDeposit[2].toFixed(2)}`,
  );
  check(
    '全基金按净值比例',
    near(bench.allFund[1], 110000, 1e-6) && near(bench.allFund[2], 90000, 1e-6),
    `¥${bench.allFund[1].toFixed(0)} / ¥${bench.allFund[2].toFixed(0)}`,
  );
  check('空曲线不报错', buildBenchmarks([], 100000).allFund.length === 0);

  console.log('[20] 交易决策标注');
  const tcurve = [
    { date: '2022-01-04', total: 100000, fundNav: 1 },
    { date: '2022-01-05', total: 101000, fundNav: 1.01 },
    { date: '2022-01-06', total: 99000, fundNav: 0.99 },
  ];
  const mkTrade = (action: string, date: string, amount: number): any => ({
    action,
    date,
    amount,
    assetType: 'fund',
    sliceIndex: 0,
    navAtTrade: 1,
    sharesChanged: 0,
    description: '',
  });
  const markers = mapTradesToCurve(
    [
      mkTrade('买入', '2022-01-04', 1000),
      mkTrade('卖出', '2022-01-06', 2000),
      mkTrade('其他', '2022-01-05', 500),
      mkTrade('存入', '2022-01-04', 300),
    ],
    tcurve,
  );
  check('仅映射买卖类动作', markers.length === 3, `${markers.length} 个`);
  check(
    '买入映射到当日曲线点',
    markers[0].kind === 'buy' && markers[0].index === 0,
  );
  check(
    '卖出映射到对应点',
    markers.some((m) => m.kind === 'sell' && m.index === 2),
  );
  check('同日多笔都保留', markers.filter((m) => m.index === 0).length === 2);
  check(
    '早于起点归到 0',
    mapTradesToCurve([mkTrade('买入', '2021-01-01', 1)], tcurve)[0].index === 0,
  );
  check(
    '晚于末点归到末点',
    mapTradesToCurve([mkTrade('买入', '2023-01-01', 1)], tcurve)[0].index ===
      tcurve.length - 1,
  );
  check(
    '空曲线返回空',
    mapTradesToCurve([mkTrade('买入', '2022-01-04', 1)], []).length === 0,
  );

  console.log('[21] 多局成长轨迹');
  const runStore = new ProgressStore();
  check('初始无轨迹', runStore.data.runs.length === 0);
  const mkRun = (r: number): any => ({
    totalReturnRate: r,
    maxDrawdown: 0.05,
    rating: 'B',
    missions: { completed: 3, total: 7 },
    days: 60,
    level: 'balanced',
  });
  runStore.recordRun(mkRun(0.1));
  runStore.recordRun(mkRun(0.2));
  check(
    '记录近局轨迹',
    runStore.data.runs.length === 2,
    `${runStore.data.runs.length}`,
  );
  const stats = runsStats(runStore.data.runs)!;
  check(
    '轨迹统计正确',
    near(stats.avgReturn, 0.15, 1e-9) &&
      near(stats.bestReturn, 0.2, 1e-9) &&
      stats.count === 2,
    `avg=${(stats.avgReturn * 100).toFixed(1)}% best=${(stats.bestReturn * 100).toFixed(1)}%`,
  );
  for (let i = 0; i < 20; i++) runStore.recordRun(mkRun(0.01 * i));
  check(
    '轨迹上限 12 条',
    runStore.data.runs.length === 12,
    `${runStore.data.runs.length}`,
  );
  check('空轨迹统计返回 null', runsStats([]) === null);

  console.log('[22] 资产配置占比');
  const alloc = allocationFractions([1000, 3000, 0, 6000, 0]);
  check(
    '占比和为 1',
    near(
      alloc.reduce((a, b) => a + b, 0),
      1,
      1e-9,
    ),
    `${alloc.reduce((a, b) => a + b, 0)}`,
  );
  check('零值项占比为 0', alloc[2] === 0 && alloc[4] === 0);
  check('正项占比正确', near(alloc[0], 0.1, 1e-9) && near(alloc[3], 0.6, 1e-9));
  check(
    '全部为 0 返回全 0',
    allocationFractions([0, 0, 0]).every((v) => v === 0),
  );
  check(
    '含负数被当作 0',
    allocationFractions([-5, 5]).reduce((a, b) => a + b, 0) === 1 &&
      allocationFractions([-5, 5])[0] === 0,
  );

  console.log('[23] 课堂分享链接');
  check(
    '基础含难度与情景',
    buildShareQuery({ level: 'balanced', scenarioId: 'standard' }) ===
      'level=balanced&scenario=standard',
  );
  check(
    '定投开启带 dca 参数',
    buildShareQuery({
      level: 'aggressive',
      scenarioId: 'mid',
      dca: { enabled: true, amount: 500, intervalDays: 3, asset: 'fund' },
    }) === 'level=aggressive&scenario=mid&dca=500:3:fund',
  );
  check(
    '定投关闭不带 dca',
    buildShareQuery({
      level: 'conservative',
      scenarioId: 'recent',
      dca: { enabled: false, amount: 100, intervalDays: 5, asset: 'deposit' },
    }) === 'level=conservative&scenario=recent',
  );
  check(
    '定投缺省不算',
    buildShareQuery({
      level: 'balanced',
      scenarioId: 'long',
      dca: undefined,
    }) === 'level=balanced&scenario=long',
  );

  console.log('[24] 排行榜客户端（纯函数）');
  const mkEntry = (over: Partial<any> = {}): any => ({
    id: 'x',
    name: 't',
    seed: 1,
    level: 'balanced',
    scenario: 'standard',
    returnRate: 0,
    maxDrawdown: 0,
    rating: 'B',
    missions: 0,
    total: 7,
    days: 60,
    createdAt: 1,
    ...over,
  });
  const list = sortEntries([
    mkEntry({
      id: 'a',
      returnRate: 0.05,
      maxDrawdown: 0.1,
      rating: 'B',
      createdAt: 2,
    }),
    mkEntry({
      id: 'b',
      returnRate: 0.12,
      maxDrawdown: 0.2,
      rating: 'A',
      createdAt: 1,
    }),
    mkEntry({
      id: 'c',
      returnRate: 0.12,
      maxDrawdown: 0.05,
      rating: 'A',
      createdAt: 3,
    }),
    mkEntry({
      id: 'd',
      returnRate: 0.12,
      maxDrawdown: 0.05,
      rating: 'C',
      createdAt: 4,
    }),
  ]);
  check(
    '排序：收益率降序优先',
    list[0].id === 'c' && list[1].id === 'd' && list[2].id === 'b',
    list.map((e) => e.id).join(','),
  );
  check(
    '排序：同收益同回撤比评级（A 优于 C）',
    list[0].id === 'c' && list[1].id === 'd',
  );
  // 同收益、不同回撤：回撤小者靠前
  const dd = sortEntries([
    mkEntry({ id: 'x', returnRate: 0.1, maxDrawdown: 0.2, rating: 'A' }),
    mkEntry({ id: 'y', returnRate: 0.1, maxDrawdown: 0.05, rating: 'A' }),
  ]);
  check(
    '排序：同收益比回撤（小优）',
    dd[0].id === 'y' && dd[1].id === 'x',
    `${dd[0].id},${dd[1].id}`,
  );
  check(
    '排名查找（1-based）',
    rankInList(list, 'b') === 3 && rankInList(list, 'a') === 4,
  );
  check('排名未命中返回 0', rankInList(list, 'zzz') === 0);

  const scoped = [
    mkEntry({ id: 's1', scenario: 'standard', returnRate: 0.2 }),
    mkEntry({ id: 's2', scenario: 'recent', returnRate: 0.9 }),
    mkEntry({ id: 's3', scenario: 'standard', returnRate: 0.1 }),
  ];
  const myRank = rankInScope(
    scoped,
    { scope: 'scenario', scenario: 'standard' },
    mkEntry({ returnRate: 0.15 }),
  );
  check('按情景范围排名（standard 内第 2）', myRank === 2, `rank=${myRank}`);
  const myRankAll = rankInScope(
    scoped,
    { scope: 'all' },
    mkEntry({ returnRate: 0.15 }),
  );
  check('全量范围排名（第 3）', myRankAll === 3, `rank=${myRankAll}`);

  const fakeSummary: any = {
    level: 'balanced',
    scenario: { id: 'mid' },
    totalReturnRate: 0.088,
    maxDrawdown: 0.07,
    rating: 'A',
    missions: { completed: 5, total: 7 },
    days: 60,
  };
  const sub = submissionFromSummary(fakeSummary, '小明', 20260101);
  check(
    '成绩单→提交对象映射正确',
    sub.name === '小明' &&
      sub.seed === 20260101 &&
      sub.level === 'balanced' &&
      sub.scenario === 'mid' &&
      sub.returnRate === 0.088 &&
      sub.rating === 'A' &&
      sub.missions === 5 &&
      sub.total === 7 &&
      sub.days === 60,
    JSON.stringify(sub),
  );

  console.log(`\n冒烟结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
