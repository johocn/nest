// S8 性能纯逻辑零依赖断言脚本（不引入任何测试框架：只用 node + 自写 check）
// 用法：node tools/build-fallback.mjs ; node scripts/smoke-s8-perf.mjs
//
// 断言对象取自**构建产物** `bin/js/perf/*.js`（构建输出，不入库）——这两个模块顶层不触碰 Laya
// （Quality 只 import 常量与 Platform，counters 零依赖），故 node 可直接求值（同 S3-S6 的 smoke 脚本）：
//   - perf/Quality.js    档位解析优先级 / 降级项开关 / 自动降级判定（纯逻辑）
//   - perf/counters.js   上行计数的 1 秒滑窗语义
//   - entity/EntityPool.js（Task 2）kind 分桶 / 复用 / **无条件 reset** / 幂等 / 桶上限丢弃
//     —— 池是 Laya-free 纯逻辑，node 内用「假实体」断言（不 import Entity，它会 new Laya.Sprite）；
//        真正的 reset 字段复位由浏览器脚本 `scripts/pool-sample.mjs` 断言（node 里没有 Laya）。
// 这是 S8 新增的回归门禁：计划 §1.7 说「客户端无单测框架、以面板数据代替」，本脚本把
// Task 2-5 将要消费的开关与阈值钉成可自动断言的契约（偏离项，已在 Task 1 报告中说明）。
// 断言失败 → exit 1。
//
// 注：`bin/js/*.js` 最近的 package.json（仓库根）没有 "type" 字段，node 会先按 CJS 解析失败、
// 再按「检测到模块语法」回退为 ES module 求值，并打印一条 MODULE_TYPELESS_PACKAGE_JSON 警告 —— 属预期噪音。
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 需要存在的构建产物：缺任一则提示先构建，不静默失败 */
const ARTIFACTS = {
  quality: 'bin/js/perf/Quality.js',
  counters: 'bin/js/perf/counters.js',
  appConfig: 'bin/js/config/AppConfig.js',
  // S8 Task 2 池：EntityPool 运行时只 import AppConfig 与 EntityRegistry（皆 Laya-free），故 node 可直接求值
  entityPool: 'bin/js/entity/EntityPool.js',
  entityRegistry: 'bin/js/entity/EntityRegistry.js',
  // S8 Task 3：static-layer 只 import 类型（编译后无运行时 import），node 可直接求值
  staticLayer: 'bin/js/world/static-layer.js',
};

const missing = Object.values(ARTIFACTS).filter((p) => !existsSync(join(root, p)));
if (missing.length > 0) {
  console.error(`缺少构建产物：${missing.join('、')}`);
  console.error('请先执行 node tools/build-fallback.mjs');
  process.exit(1);
}

const load = (rel) => import(pathToFileURL(join(root, rel)).href);
const { Quality, createFpsWatcher, resolveTier } = await load(ARTIFACTS.quality);
const { bumpUp, upPerSec, reset, snapshot, UP_WINDOW_MS } = await load(ARTIFACTS.counters);
const { AppConfig } = await load(ARTIFACTS.appConfig);
const Pool = await load(ARTIFACTS.entityPool);
const { EntityRegistry } = await load(ARTIFACTS.entityRegistry);
const SL = await load(ARTIFACTS.staticLayer);

let total = 0;
let failed = 0;
function check(name, cond, extra = '') {
  total++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` :: ${extra}` : ''}`);
  if (!cond) failed++;
}

// ── 1. resolveTier 优先级（URL > ENV > config 非 auto > 平台默认）──────────────
console.log('— resolveTier：覆盖优先级（纯函数）—');

{
  check(
    'URL 覆盖优先于 ENV/config/平台（url=low 胜出）',
    resolveTier({ platform: 'h5', config: 'high', urlOverride: 'low', envOverride: 'high' }) === 'low',
    `tier=${resolveTier({ platform: 'h5', config: 'high', urlOverride: 'low', envOverride: 'high' })}`,
  );
  check(
    'ENV 覆盖优先于 config/平台（env=low 胜出）',
    resolveTier({ platform: 'h5', config: 'high', urlOverride: null, envOverride: 'low' }) === 'low',
  );
  check(
    'config 非 auto 优先于平台默（minigame + high → high）',
    resolveTier({ platform: 'minigame', config: 'high', urlOverride: null, envOverride: null }) === 'high',
  );
  check(
    'config=auto → 取平台默认（H5 high）',
    resolveTier({ platform: 'h5', config: 'auto', urlOverride: null, envOverride: null }) === 'high',
  );
  check(
    'config=auto → 取平台默认（小游戏 low）',
    resolveTier({ platform: 'minigame', config: 'auto', urlOverride: null, envOverride: null }) === 'low',
  );
  check(
    'config 缺省（undefined）→ 等同 auto，取平台默认',
    resolveTier({ platform: 'minigame' }) === 'low' && resolveTier({ platform: 'h5' }) === 'high',
  );
  check(
    '非法覆盖值被忽略（url=weird → 落到 ENV）',
    resolveTier({ platform: 'h5', urlOverride: 'weird', envOverride: 'low' }) === 'low',
  );
  check(
    '非法覆盖值被忽略（env=WOW → 落到 config 非 auto）',
    resolveTier({ platform: 'h5', config: 'low', envOverride: 'WOW' }) === 'low',
  );
  check(
    'AppConfig.quality 默认 auto（解析交 Quality.init 按平台）',
    AppConfig.quality === 'auto',
    `quality=${AppConfig.quality}`,
  );
}

// ── 2. low 档五个降级项与 high 不同（D3 五项，只在开关层）─────────────────────
console.log('— 降级项开关：high / low 两档取值表 —');

{
  const high = Quality.switches();
  check('未 init 时 tier() 有缺省值且 switches() 可取（不抛错）', typeof Quality.tier() === 'string' && !!high);

  Quality.forceTier('high');
  const h = Quality.switches();
  Quality.setTier('low');
  const l = Quality.switches();
  Quality.setTier('high');

  // 五项逐项比对
  check(
    'D3-① 名标签：high 开 / low 关',
    h.nameLabels === true && l.nameLabels === false,
    `high=${h.nameLabels} low=${l.nameLabels}`,
  );
  check(
    'D3-② 网格线：high 开 / low 关',
    h.gridLines === true && l.gridLines === false,
    `high=${h.gridLines} low=${l.gridLines}`,
  );
  check(
    'D3-③ 触发区描边：high 开 / low 关',
    h.triggerOutline === true && l.triggerOutline === false,
    `high=${h.triggerOutline} low=${l.triggerOutline}`,
  );
  check(
    'D3-④ 插值精度：high=full / low=reduced',
    h.interpPrecision === 'full' && l.interpPrecision === 'reduced',
    `high=${h.interpPrecision} low=${l.interpPrecision}`,
  );
  check(
    'D3-⑤ 远端更新频率：low 低于 high 且均为正数',
    typeof h.remoteUpdateHz === 'number' && typeof l.remoteUpdateHz === 'number' && l.remoteUpdateHz < h.remoteUpdateHz && l.remoteUpdateHz > 0,
    `high=${h.remoteUpdateHz}Hz low=${l.remoteUpdateHz}Hz`,
  );
  check(
    'switches() 返回副本（外部改动不回写内部表）',
    (() => {
      const s = Quality.switches();
      s.gridLines = false;
      return Quality.switches().gridLines === true;
    })(),
  );

  // onChange / forceTier / override 语义
  let notified = 0;
  const off = Quality.onChange(() => notified++);
  Quality.setTier('low');
  check('setTier 变化触发 onChange 一次', notified === 1 && Quality.tier() === 'low', `notified=${notified}`);
  Quality.setTier('low');
  check('setTier 同值不触发 onChange（幂等）', notified === 1, `notified=${notified}`);
  off();
  Quality.forceTier('high');
  check('forceTier 直接改档且 onChange 已注销后不再通知', Quality.tier() === 'high' && notified === 1, `notified=${notified}`);
  check('override() 反映强制档位（自动降级前须检查）', Quality.override() === 'high', `override=${Quality.override()}`);
  Quality.forceTier(null);
  check('forceTier(null) 解除覆盖但保留当前档', Quality.override() === null && Quality.tier() === 'high');
}

// ── 3. 自动降级判定（连续 3 秒低帧才降；单次抖动不触发；只降不升）────────────
console.log('— createFpsWatcher：抖动 / 连续低帧 / 不重复降 —');

{
  const w = createFpsWatcher({ targetFps: 60, ratio: 0.8, sustainMs: 3000 });
  // 单次抖动：一帧低、立刻恢复 → 永远不触发
  let fired = false;
  fired = w.push(10, 0) || fired;
  fired = w.push(60, 1000) || fired;
  fired = w.push(60, 2000) || fired;
  fired = w.push(59, 3000) || fired;
  fired = w.push(61, 4000) || fired;
  check('单次抖动（低一帧后恢复）不触发降级', fired === false && w.degraded() === false, `fired=${fired}`);
  check('阈值取严格小于：fps 恰等于 target×ratio 不算低帧', w.push(48, 5000) === false && w.degraded() === false);
}

{
  const w = createFpsWatcher({ targetFps: 60, ratio: 0.8, sustainMs: 3000 });
  const seq = [];
  seq.push(w.push(30, 0)); // 低帧起点
  seq.push(w.push(30, 1000));
  seq.push(w.push(30, 2000));
  check('连续低帧不足 3 秒 → 暂不降级', seq.every((v) => v === false), `seq=${seq.join(',')}`);
  check('连续低帧满 3 秒 → 触发降级一次', w.push(30, 3000) === true && w.degraded() === true);
  check(
    '降级后持续低帧不再重复降（本 Task 只降不升）',
    w.push(20, 4000) === false && w.push(5, 9000) === false && w.push(1, 60000) === false,
  );
}

{
  // 中间恢复一帧必须重置计时：否则「断续低帧」会误降（风险 #8）
  const w = createFpsWatcher({ targetFps: 60, ratio: 0.8, sustainMs: 3000 });
  w.push(30, 0);
  w.push(30, 2000);
  w.push(60, 2500); // 恢复 → 计时重置（若未重置，3000ms 就该降级）
  const a = w.push(30, 4000); // 重置后重新起算
  check('低帧中途恢复一帧 → 计时重置（4000ms 未降级）', a === false, `a=${a}`);
  check('重置后重新连续 3 秒（4000→7000）才降级', w.push(30, 6000) === false && w.push(30, 7000) === true);
}

// ── 4. counters：1 秒滑窗语义（含静止 → 0）──────────────────────────────────
console.log('— counters：bumpUp / upPerSec 滑窗 —');

{
  check('滑窗常量 = 1000ms（口径：本秒上行次数）', UP_WINDOW_MS === 1000, `window=${UP_WINDOW_MS}`);

  reset();
  check('静止（无上行）→ upPerSec 为 0', upPerSec('world.move', 10_000) === 0);
  check('未计数过的 cmd → 0', upPerSec('never.sent', 10_000) === 0);

  bumpUp('world.move', 0);
  bumpUp('world.move', 0);
  bumpUp('world.move', 0);
  check('同秒 3 次上行 → 3', upPerSec('world.move', 500) === 3, `n=${upPerSec('world.move', 500)}`);
  check('滑窗右边界：窗口内仍计 3', upPerSec('world.move', 999) === 3);
  check('滑窗右边界：超出 1 秒 → 归零', upPerSec('world.move', 1001) === 0);

  reset('world.move');
  bumpUp('world.move', 0);
  bumpUp('world.move', 2000);
  check('只有窗口内的那 1 次被计入（旧时间戳被裁掉）', upPerSec('world.move', 2000) === 1, `n=${upPerSec('world.move', 2000)}`);

  reset();
  bumpUp('world.move', 0);
  bumpUp('world.enter-scene', 0);
  const snap = snapshot(0);
  check(
    'snapshot 按 cmd 分别计数',
    snap['world.move'] === 1 && snap['world.enter-scene'] === 1,
    JSON.stringify(snap),
  );
  reset();
  check('reset() 清空全部计数', JSON.stringify(snapshot(0)) === '{}', JSON.stringify(snapshot(0)));

  // 默认时间参数（不传 nowMs）走 Date.now()，不抛错
  let defOk = true;
  try {
    bumpUp('world.move');
    upPerSec('world.move');
    snapshot();
  } catch {
    defOk = false;
  }
  check('缺省时间参数（Date.now）路径不抛错', defOk);
  reset();
}

// ── 5. EntityPool：分桶 / 复用 / 无条件 reset / 幂等 / 上限（假实体）──────────────
// 假实体形状兼容池与 EntityRegistry.remove 所需的最小字段；**不 import Entity**（它会 new Laya.Sprite）。
console.log('— EntityPool：acquire/release 纯逻辑（假实体，node 内无 Laya）—');

{
  function fakeEntity(kind, id) {
    const removed = [];
    const entity = {
      entityId: id,
      kind,
      sprite: { parent: { removeChild: (s) => removed.push(s) }, visible: true },
      __removed: removed,
    };
    EntityRegistry.add(entity);
    return entity;
  }

  function makeAdapter() {
    const calls = { create: 0, reset: 0 };
    return {
      calls,
      create(spec) {
        calls.create++;
        return fakeEntity(spec.kind, spec.id);
      },
      reset(entity, spec) {
        calls.reset++;
        entity.__spec = spec;
      },
    };
  }

  check(
    'AppConfig.pool.maxPerKind 为正整数',
    Number.isInteger(AppConfig.pool.maxPerKind) && AppConfig.pool.maxPerKind > 0,
    `maxPerKind=${AppConfig.pool.maxPerKind}`,
  );

  // 5.1 同 kind 复用；新建也走 reset；release 摘除/隐藏/入桶
  Pool.clear();
  Pool.resetStats();
  {
    const a = makeAdapter();
    const e1 = Pool.acquire('player', { id: 'p1', kind: 'player' }, a);
    check('新建实体同样调用 reset（幽灵状态结构性防护）', a.calls.create === 1 && a.calls.reset === 1, `create=${a.calls.create} reset=${a.calls.reset}`);
    check('acquire 把 spec 原样交给 reset', !!e1.__spec && e1.__spec.id === 'p1');
    check('acquire 后计入 live（live=1）', Pool.stats().player.live === 1, JSON.stringify(Pool.stats().player));

    Pool.release(e1);
    check('release 后从注册表摘除', EntityRegistry.get('p1') === undefined);
    check('release 后 sprite.visible=false（不销毁）', e1.sprite.visible === false);
    check('release 后从父节点摘除（removeChild 调用 1 次）', e1.__removed.length === 1, `n=${e1.__removed.length}`);
    check('release 后进入桶（pooled=1 / live=0）', Pool.stats().player.pooled === 1 && Pool.stats().player.live === 0, JSON.stringify(Pool.stats().player));

    const e2 = Pool.acquire('player', { id: 'p2', kind: 'player' }, a);
    check('同 kind 复用同一实例（含同一 sprite 引用）', e2 === e1 && e2.sprite === e1.sprite);
    check('复用不再新建（create 仍 1 次）', a.calls.create === 1, `create=${a.calls.create}`);
    check('复用也走 reset（reset 共 2 次）', a.calls.reset === 2, `reset=${a.calls.reset}`);
    check('复用后 reset 收到的是本次 spec（id=p2）', e1.__spec.id === 'p2', `id=${e1.__spec.id}`);
    const s = Pool.stats().player;
    check(
      'stats: created=1 reused=1 pooled=0 live=1 discarded=0',
      s.created === 1 && s.reused === 1 && s.pooled === 0 && s.live === 1 && s.discarded === 0,
      JSON.stringify(s),
    );
    Pool.release(e2);
  }

  // 5.2 100 次往返 → created=1 / reused=99 / pooled=1
  Pool.clear();
  Pool.resetStats();
  {
    const a = makeAdapter();
    const spec = { id: 'loop', kind: 'player' };
    let firstSprite = null;
    let sameSprite = true;
    for (let i = 0; i < 100; i++) {
      const e = Pool.acquire('player', spec, a);
      if (i === 0) firstSprite = e.sprite;
      else if (e.sprite !== firstSprite) sameSprite = false;
      Pool.release(e);
    }
    const s = Pool.stats().player;
    check(
      '100 次往返：created=1 / reused=99 / pooled=1 / live=0 / discarded=0',
      s.created === 1 && s.reused === 99 && s.pooled === 1 && s.live === 0 && s.discarded === 0,
      JSON.stringify(s),
    );
    check('100 次往返始终复用同一 sprite 引用', sameSprite === true);
    check('created 计数不随复用增长（恒为 1）', s.created === 1, `created=${s.created}`);
    check('create 仅调用 1 次', a.calls.create === 1, `create=${a.calls.create}`);
    check('reset 调用次数 = acquire 次数（100）', a.calls.reset === 100, `reset=${a.calls.reset}`);
  }

  // 5.3 跨 kind 不混用；stats 形状稳定
  Pool.clear();
  Pool.resetStats();
  {
    const a = makeAdapter();
    const p = Pool.acquire('player', { id: 'p', kind: 'player' }, a);
    Pool.release(p);
    const n = Pool.acquire('npc', { id: 'n', kind: 'npc' }, a);
    check('跨 kind 不复用（npc 为新建实例）', n !== p && a.calls.create === 2, `create=${a.calls.create}`);
    check('分桶计数独立（player.pooled=1 / npc.live=1）', Pool.stats().player.pooled === 1 && Pool.stats().npc.live === 1, JSON.stringify(Pool.stats()));
    check(
      'stats() 覆盖四个 kind（形状稳定）',
      ['player', 'npc', 'object', 'building'].every((k) => typeof Pool.stats()[k]?.created === 'number'),
    );
    Pool.release(n);
  }

  // 5.4 桶上限：超限丢弃并计入 discarded
  Pool.clear();
  Pool.resetStats();
  {
    const max = AppConfig.pool.maxPerKind;
    AppConfig.pool.maxPerKind = 2;
    try {
      const a = makeAdapter();
      const ents = [0, 1, 2].map((i) => Pool.acquire('object', { id: `o${i}`, kind: 'object' }, a));
      for (const e of ents) Pool.release(e);
      const s = Pool.stats().object;
      check('桶上限 2 → 第 3 个 release 被丢弃（pooled=2 / discarded=1）', s.pooled === 2 && s.discarded === 1, JSON.stringify(s));
      check('丢弃不影响 live（3 acquire / 3 release → live=0）', s.live === 0, `live=${s.live}`);
    } finally {
      AppConfig.pool.maxPerKind = max;
    }
  }

  // 5.5 重复 release 幂等
  Pool.clear();
  Pool.resetStats();
  {
    const a = makeAdapter();
    const e = Pool.acquire('player', { id: 'idem', kind: 'player' }, a);
    Pool.release(e);
    Pool.release(e);
    Pool.release(e);
    const s = Pool.stats().player;
    check('重复 release 幂等（桶内仍 1 个 / discarded=0）', s.pooled === 1 && s.discarded === 0, JSON.stringify(s));
    check('重复 release 不重复摘除（removeChild 仅 1 次）', e.__removed.length === 1, `n=${e.__removed.length}`);
    check('重复 release 不污染 live（live=0）', s.live === 0, `live=${s.live}`);
  }

  // 5.6 「同 kind 必然复用」是池的核心契约：跨 kind 建、跨 kind 归，桶内 shape 一致
  Pool.clear();
  Pool.resetStats();
  {
    const a = makeAdapter();
    const e = Pool.acquire('player', { id: 'x', kind: 'player' }, a);
    Pool.release(e);
    const back = Pool.acquire('player', { id: 'y', kind: 'player' }, a);
    check('release 以 entity.kind 入桶（同 kind 必然复用同一实例）', back === e);
  }

  Pool.clear();
  Pool.resetStats();
}

// ── 6. static-layer：网格坐标 / 档位开关 / resort 增量（纯函数，Task 3）──────────
console.log('— static-layer：背景常量 / 网格坐标 / 名标签 / resort 增量 —');

{
  const bg = AppConfig.sceneBg;

  // 6.1 背景常量 = 优化前字面量原值（high 档「表现逐字一致」的可断言锚点，风险 #1）
  check(
    '背景常量原值：地块 #2f6b3a / 网格 #3d7a4a / 1px / 100px / 描边 #f5c542 / 2px',
    bg.groundColor === '#2f6b3a' &&
      bg.gridColor === '#3d7a4a' &&
      bg.gridInterval === 100 &&
      bg.gridLineWidth === 1 &&
      bg.triggerOutlineColor === '#f5c542' &&
      bg.triggerOutlineWidth === 2,
    `ground=${bg.groundColor} grid=${bg.gridColor}@${bg.gridInterval}px/${bg.gridLineWidth}px outline=${bg.triggerOutlineColor}/${bg.triggerOutlineWidth}px`,
  );
  check(
    'resort 阈值与合图开关有初值（阈值 > 0，cacheAs 为布尔）',
    typeof bg.resortMoveThreshold === 'number' &&
      bg.resortMoveThreshold > 0 &&
      typeof bg.cacheAsBitmap === 'boolean',
    `threshold=${bg.resortMoveThreshold} cacheAsBitmap=${bg.cacheAsBitmap}`,
  );

  // 6.2 网格坐标与基线循环逐字等价（1280x960 / 100px → 13 竖 + 10 横 = 基线 23 条 drawLine）
  const g = SL.gridLinePositions(1280, 960, 100);
  check(
    '网格坐标：1280x960/100px → 13 竖 + 10 横（= 基线 23 条 drawLine）',
    g.verticals.length === 13 && g.horizontals.length === 10,
    `v=${g.verticals.length} h=${g.horizontals.length}`,
  );
  check(
    '网格坐标含边界点：v[0]=0 v[12]=1200 / h[0]=0 h[9]=900',
    g.verticals[0] === 0 && g.verticals[12] === 1200 && g.horizontals[0] === 0 && g.horizontals[9] === 900,
  );
  const g2 = SL.gridLinePositions(2000, 2000, 100);
  check(
    '网格坐标随尺寸缩放：2000x2000/100px → 21 竖 + 21 横',
    g2.verticals.length === 21 && g2.horizontals.length === 21,
    `v=${g2.verticals.length} h=${g2.horizontals.length}`,
  );
  const gBad = SL.gridLinePositions(1280, 960, 0);
  check(
    '非法间隔（0）返回空集而非死循环',
    gBad.verticals.length === 0 && gBad.horizontals.length === 0,
  );

  // 6.3 开关判定：high 全开 / low 关网格与描边（D3-②③）
  const hi = Quality.switches();
  Quality.setTier('low');
  const lo = Quality.switches();
  check(
    'low 档不画网格（shouldDrawGrid）',
    SL.shouldDrawGrid(hi) === true && SL.shouldDrawGrid(lo) === false,
    `high=${SL.shouldDrawGrid(hi)} low=${SL.shouldDrawGrid(lo)}`,
  );
  check(
    'low 档不画触发区描边（shouldDrawTriggerOutline）',
    SL.shouldDrawTriggerOutline(hi) === true && SL.shouldDrawTriggerOutline(lo) === false,
    `high=${SL.shouldDrawTriggerOutline(hi)} low=${SL.shouldDrawTriggerOutline(lo)}`,
  );

  // 6.4 名标签：high 全显（=基线）/ low 只留 player+npc（D3-①）
  const kinds = ['player', 'npc', 'object', 'building'];
  check(
    'high 档全部名标签显示（与基线表现一致）',
    kinds.every((k) => SL.shouldShowNameLabel(k, hi) === true),
  );
  check(
    'low 档玩家/NPC 名保留、物件/建筑名关闭',
    SL.shouldShowNameLabel('player', lo) === true &&
      SL.shouldShowNameLabel('npc', lo) === true &&
      SL.shouldShowNameLabel('object', lo) === false &&
      SL.shouldShowNameLabel('building', lo) === false,
    `player=${SL.shouldShowNameLabel('player', lo)} npc=${SL.shouldShowNameLabel('npc', lo)} object=${SL.shouldShowNameLabel('object', lo)} building=${SL.shouldShowNameLabel('building', lo)}`,
  );
  check(
    '名标签判定走 Quality 实档：low 档物件名关、恢复 high 后开',
    (() => {
      const lowOff = SL.shouldShowNameLabel('object', Quality.switches()) === false;
      Quality.setTier('high');
      return lowOff && SL.shouldShowNameLabel('object', Quality.switches()) === true;
    })(),
  );

  // 6.5 shouldResort 增量化（D8）：集合不变 + 未超阈值 → 不排；超阈值/集合变化 → 排
  const T = bg.resortMoveThreshold;
  const snap = (ids, ys) => ({ ids, ys });
  check(
    '静止（集合与坐标都不变）→ 不重排',
    SL.shouldResort(snap(['a', 'b'], { a: 10, b: 20 }), snap(['a', 'b'], { a: 10, b: 20 }), T) === false,
  );
  check(
    `位移不足阈值（<${T}px）→ 不重排`,
    SL.shouldResort(snap(['a', 'b'], { a: 10, b: 20 }), snap(['a', 'b'], { a: 10 + T - 1, b: 20 }), T) === false,
  );
  check(
    `位移恰达阈值（=${T}px）→ 重排`,
    SL.shouldResort(snap(['a', 'b'], { a: 10, b: 20 }), snap(['a', 'b'], { a: 10 + T, b: 20 }), T) === true,
  );
  check(
    '集合变化（新增实体）→ 重排',
    SL.shouldResort(snap(['a'], { a: 10 }), snap(['a', 'b'], { a: 10, b: 20 }), T) === true,
  );
  check(
    '集合变化（等长换人：移除 a 新增 c）→ 重排',
    SL.shouldResort(snap(['a', 'b'], { a: 10, b: 20 }), snap(['b', 'c'], { b: 20, c: 30 }), T) === true,
  );
  check(
    '集合变化（移除实体，长度缩短）→ 重排',
    SL.shouldResort(snap(['a', 'b'], { a: 10, b: 20 }), snap(['a'], { a: 10 }), T) === true,
  );
}

console.log(
  failed === 0
    ? `\nS8 性能纯逻辑断言全部通过（共 ${total} 项）`
    : `\nS8 性能纯逻辑断言失败 ${failed}/${total} 项`,
);
process.exit(failed === 0 ? 0 : 1);