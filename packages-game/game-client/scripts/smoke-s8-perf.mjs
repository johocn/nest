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
  // S8 Task 4：Viewport 只 import 类型（编译后无运行时 import），node 可直接求值
  viewport: 'bin/js/world/Viewport.js',
  // S8 Task 5：interp 只 import 类型；move-step 只 import interp 的**类型** → 两者产物均无运行时依赖
  interp: 'bin/js/entity/interp.js',
  moveStep: 'bin/js/world/move-step.js',
  // S8 Task 5：RemoteInterp 组件的运行时依赖（AppConfig/Quality/interp/Component）全部 Laya-free
  // （Component 只 import 类型 Entity），故 node 内可用「假 owner」直接断言组件行为（节流/对齐/逼近）
  remoteInterp: 'bin/js/entity/components/RemoteInterp.js',
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
const VP = await load(ARTIFACTS.viewport);
const IN = await load(ARTIFACTS.interp);
const MS = await load(ARTIFACTS.moveStep);
const { RemoteInterp } = await load(ARTIFACTS.remoteInterp);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // 6.6 S8 Task 4：可见集合并入快照键（culled）→ 仅可见性变化也需重排；不带 culled 时向后兼容
  const snapC = (ids, ys, culled) => ({ ids, ys, culled });
  const three = { a: 10, b: 20, c: 30 };
  check(
    '仅可见集合变化（位移与 id 集合都不变）→ 重排',
    SL.shouldResort(
      snapC(['a', 'b', 'c'], three, []),
      snapC(['a', 'b', 'c'], three, ['b']),
      T,
    ) === true,
  );
  check(
    '可见集合相同但顺序不同 → 不重排（按集合语义比对）',
    SL.shouldResort(
      snapC(['a', 'b', 'c'], three, ['b', 'c']),
      snapC(['a', 'b', 'c'], three, ['c', 'b']),
      T,
    ) === false,
  );
  check(
    '可见集合多裁掉一个 → 重排',
    SL.shouldResort(
      snapC(['a', 'b', 'c'], three, ['b']),
      snapC(['a', 'b', 'c'], three, ['b', 'c']),
      T,
    ) === true,
  );
  check(
    '向后兼容：两侧都不带 culled（旧调用方）→ 行为与基线一致，不重排',
    SL.shouldResort(snap(['a', 'b'], { a: 10, b: 20 }), snap(['a', 'b'], { a: 10, b: 20 }), T) === false,
  );
  check(
    '向后兼容：undefined 视同空集（不带 culled ↔ culled=[] → 不重排）',
    SL.shouldResort(snap(['a'], { a: 10 }), snapC(['a'], { a: 10 }, []), T) === false,
  );
}

// ── 7. Viewport / EntityRegistry 裁剪原语（Task 4，纯逻辑）─────────────────────
console.log('— Viewport：视口矩形 / 含边界判定 / 排序键 + inRect / visibleCount（Task 4）—');

{
  // 7.1 视口矩形 = 舞台尺寸 + 两侧各扩 marginPx，以本地玩家为中心（不夹取到地图边界）
  const r200 = VP.viewportRect(640, 480, 960, 640, 200);
  check(
    '视口矩形：960x640 + 200px 边距 → 1360x1040，中心 (640,480) → x=-40 y=-40',
    r200.w === 1360 && r200.h === 1040 && r200.x === -40 && r200.y === -40,
    JSON.stringify(r200),
  );
  const r0 = VP.viewportRect(640, 480, 960, 640, 0);
  check(
    'marginPx=0 → 视口 = 舞台尺寸（x=160 y=160）',
    r0.w === 960 && r0.h === 640 && r0.x === 160 && r0.y === 160,
    JSON.stringify(r0),
  );
  const rCorner = VP.viewportRect(0, 0, 960, 640, 0);
  check(
    '玩家在地图角落 (0,0) → 视口一半落到负坐标（x=-480 y=-320，不夹取）',
    rCorner.x === -480 && rCorner.y === -320 && rCorner.w === 960 && rCorner.h === 640,
    JSON.stringify(rCorner),
  );

  // 7.2 containsPoint / shouldBeVisible：**含四条边界**
  check(
    '包含判定含边界：左上 (160,160) 与右下 (1120,800) 都在内',
    VP.containsPoint(r0, 160, 160) === true && VP.containsPoint(r0, 1120, 800) === true,
  );
  check(
    '包含判定：越界 0.1~0.5px 即不在内',
    VP.containsPoint(r0, 159.9, 400) === false &&
      VP.containsPoint(r0, 1120.1, 400) === false &&
      VP.containsPoint(r0, 400, 800.1) === false,
  );
  check(
    'shouldBeVisible：矩形外 false，但 keepVisible=true（本地玩家）恒 true',
    VP.shouldBeVisible(r0, 5000, 5000) === false && VP.shouldBeVisible(r0, 5000, 5000, true) === true,
  );
  check(
    'shouldBeVisible 与 containsPoint 同为含边界口径',
    VP.shouldBeVisible(r0, 160, 800) === true && VP.shouldBeVisible(r0, 159, 800) === false,
  );

  // 7.3 排序键：可见优先 + 同组按 y 升序（不可见实体被稳定排到末尾）
  const items = [
    { id: 'v2', y: 200, visible: true },
    { id: 'c1', y: 50, visible: false },
    { id: 'v1', y: 100, visible: true },
    { id: 'c2', y: 900, visible: false },
  ];
  items.sort((a, b) => VP.compareVisibleThenY(a.y, a.visible, b.y, b.visible));
  check(
    '排序键：可见组按 y 升序在前、不可见组在后 → v1,v2,c1,c2',
    items.map((i) => i.id).join(',') === 'v1,v2,c1,c2',
    items.map((i) => i.id).join(','),
  );
  check(
    '排序键：同组同 y 返回 0（Array.sort 稳定 → 不可见组内部序稳定）',
    VP.compareVisibleThenY(100, false, 100, false) === 0 &&
      VP.compareVisibleThenY(100, true, 100, true) === 0,
  );
  check(
    '排序键：可见实体恒排在不可见实体之前（与 y 无关）',
    VP.compareVisibleThenY(9999, true, 0, false) < 0 && VP.compareVisibleThenY(0, false, 9999, true) > 0,
  );

  // 7.4 AppConfig.viewport 段（计划默认：1 屏外扩 200px / 每 5 帧一次）
  check(
    'AppConfig.viewport：marginPx=200 / tickFrames=5',
    AppConfig.viewport.marginPx === 200 && AppConfig.viewport.tickFrames === 5,
    JSON.stringify(AppConfig.viewport),
  );

  // 7.5 EntityRegistry.inRect（含边界）/ visibleCount（与 PerfPanel 同口径）
  const fake = (id, x, y, visible = true) => {
    const e = { entityId: id, kind: 'object', x, y, sprite: { visible, parent: null } };
    EntityRegistry.add(e);
    return e;
  };
  fake('vp:inside', 160, 800); // 左上角，正好在边界上
  fake('vp:right', 1120, 400); // 右边界上
  const outX = fake('vp:outX', 1120.5, 400); // 右边界外 0.5px
  fake('vp:outY', 400, 159.5); // 上边界外 0.5px
  const ids = EntityRegistry.inRect(r0).map((e) => e.entityId);
  check(
    'inRect：含边界（(160,800) 与 (1120,400) 在内）',
    ids.includes('vp:inside') && ids.includes('vp:right'),
    ids.join(','),
  );
  check('inRect：边界外 0.5px 即排除', !ids.includes('vp:outX') && !ids.includes('vp:outY'), ids.join(','));
  check(
    'inRect：结果逐项复核都在矩形内（与 containsPoint 同口径）',
    ids.every((id) => {
      const e = EntityRegistry.get(id);
      return !!e && VP.containsPoint(r0, e.x, e.y);
    }),
  );

  const before = EntityRegistry.visibleCount();
  const hidden = fake('vp:hidden', 700, 400, false);
  check('visibleCount 不计 visible=false 的实体', EntityRegistry.visibleCount() === before, `before=${before}`);
  hidden.sprite.visible = true;
  check('visibleCount 计回可见实体（+1）', EntityRegistry.visibleCount() === before + 1);
  outX.sprite.visible = false;
  check(
    'visibleCount 随可见性变化（再 -1）',
    EntityRegistry.visibleCount() === before,
    `now=${EntityRegistry.visibleCount()}`,
  );
}

// ── 8. interp / move-step / RemoteInterp（Task 5，插值与时间基移动）────────────
console.log('— interp：平滑系数 / 逼近 / snap / 量化 + RemoteInterp 节流（Task 5）—');

{
  // 8.1 配置段（数值集中处；A9 的「H5 表现不回退」由 0.24px/ms 的等价关系保证）
  check(
    'AppConfig.moveSpeedPxPerMs = 0.24（= 4px/帧 ÷ 16.667ms，等价 240px/s）',
    AppConfig.moveSpeedPxPerMs === 0.24,
    `speed=${AppConfig.moveSpeedPxPerMs}px/ms → ${AppConfig.moveSpeedPxPerMs * 1000}px/s`,
  );
  check(
    'AppConfig.remote：interpBufferMs=120 / snapPx=96 / 松弛比例 ∈ (0,1]',
    AppConfig.remote.interpBufferMs === 120 &&
      AppConfig.remote.snapPx === 96 &&
      AppConfig.remote.throttleSlackRatio > 0 &&
      AppConfig.remote.throttleSlackRatio <= 1,
    JSON.stringify(AppConfig.remote),
  );

  // 8.2 interpAlpha：边界与单调性
  check('alpha(buffer=0) = 1（关闭插值 → 立即到位）', IN.interpAlpha(1000 / 60, 0) === 1);
  check('alpha(buffer=负) = 1（非法缓冲同样退化为立即到位）', IN.interpAlpha(1000 / 60, -5) === 1);
  check('alpha(dt=0) = 0（不前进，不产生 NaN）', IN.interpAlpha(0, 120) === 0);
  const a1 = IN.interpAlpha(1000 / 60, 120);
  check(
    'alpha(16.67ms, 120ms) ≈ 0.1297 且 ∈ (0,1)（永不越过目标）',
    a1 > 0.12 && a1 < 0.14 && a1 < 1,
    `alpha=${a1.toFixed(4)}`,
  );
  check(
    'alpha 单调：dt 越大越大、buffer 越大越小',
    IN.interpAlpha(33.33, 120) > a1 && IN.interpAlpha(1000 / 60, 240) < a1,
  );

  // 8.3 stepInterp：snap 分支 / buffer=0 退化 / 收敛 / 阈值边界
  // lim 显式传入：既覆盖真实默认（AppConfig.remote.snapPx），也用于「只看平滑数学」的收敛测试
  const snap = (cur, target, dt, buf, lim = AppConfig.remote.snapPx) =>
    IN.stepInterp(cur, target, dt, buf, lim);
  {
    const p = snap({ x: 0, y: 0 }, { x: 240, y: 0 }, 1000 / 60, 0);
    check('bufferMs=0（插值关）→ 一帧直接落到目标（等价基线）', p.x === 240 && p.y === 0);
  }
  {
    const p = snap({ x: 0, y: 0 }, { x: 500, y: 0 }, 1000 / 60, 120);
    check('距离 > snapPx → 直接对齐（冻结后重入不缓慢爬行，风险 #5）', p.x === 500 && p.y === 0);
  }
  {
    const lim = AppConfig.remote.snapPx;
    const atLimit = snap({ x: 0, y: 0 }, { x: lim, y: 0 }, 1000 / 60, 120);
    const overLimit = snap({ x: 0, y: 0 }, { x: lim + 0.5, y: 0 }, 1000 / 60, 120);
    check(
      'snap 阈值取严格大于：dist == snapPx 仍插值，超出即 snap',
      atLimit.x > 0 && atLimit.x < lim && overLimit.x === lim + 0.5,
      `at=${atLimit.x.toFixed(2)} over=${overLimit.x}`,
    );
  }
  {
    // 收敛（只看平滑数学，故 lim 取极大值以排除 snap 分支）：
    // 从 (0,0) 追 (240,0)，每帧 16.67ms buffer 120ms → 应在 1 秒内收敛到 <1px
    const target = { x: 240, y: 0 };
    let cur = { x: 0, y: 0 };
    let convergedAt = -1;
    let monotone = true;
    let overshoot = false;
    let prevDist = Math.hypot(target.x - cur.x, target.y - cur.y);
    for (let i = 0; i < 200; i++) {
      const next = snap(cur, target, 1000 / 60, 120, 1e9);
      const d = Math.hypot(target.x - next.x, target.y - next.y);
      if (d > prevDist) monotone = false;
      if (next.x > target.x) overshoot = true;
      prevDist = d;
      cur = next;
      if (convergedAt < 0 && d < 1) convergedAt = i + 1;
    }
    check('逼近收敛：≤60 帧（1s）内追到 1px 内', convergedAt > 0 && convergedAt <= 60, `frames=${convergedAt}`);
    check('逼近单调且不越过目标（alpha<1 → 无振荡）', monotone === true && overshoot === false);
  }
  check(
    'dt=0 / 目标 NaN → 原地不动（不污染位置）',
    (() => {
      const z = IN.stepInterp({ x: 10, y: 20 }, { x: 30, y: 40 }, 0, 120, 96);
      const n = IN.stepInterp({ x: 10, y: 20 }, { x: NaN, y: 40 }, 1000 / 60, 120, 96);
      return z.x === 10 && z.y === 20 && n.x === 10 && n.y === 20;
    })(),
  );
  check(
    'cur == target → 返回目标（无 NaN/无抖动）',
    (() => {
      const p = IN.stepInterp({ x: 7, y: 8 }, { x: 7, y: 8 }, 1000 / 60, 120, 96);
      return p.x === 7 && p.y === 8;
    })(),
  );

  // 8.4 quantizeTarget：full 保留亚像素 / reduced 取整（D3-④ 的消费点）
  const qf = IN.quantizeTarget(10.4, 20.6, 'full');
  const qr = IN.quantizeTarget(10.4, 20.6, 'reduced');
  const qrHalf = IN.quantizeTarget(10.5, 20.5, 'reduced');
  check('full 档保留亚像素（10.4 / 20.6 原样）', qf.x === 10.4 && qf.y === 20.6);
  check('reduced 档取整到整数像素（10.4 / 20.6 → 10 / 21）', qr.x === 10 && qr.y === 21);
  check('reduced 档用 Math.round（10.5 / 20.5 → 11 / 21）', qrHalf.x === 11 && qrHalf.y === 21);
  check(
    '量化精度取自 Quality 实档：high=full / low=reduced',
    IN.quantizeTarget(1.5, 1.5, Quality.switches().interpPrecision).x === 1.5 &&
      (() => {
        Quality.forceTier('low');
        const low = IN.quantizeTarget(1.5, 1.5, Quality.switches().interpPrecision);
        Quality.forceTier('high');
        return low.x === 2;
      })(),
    `high=${Quality.switches().interpPrecision} low=reduced`,
  );

  // 8.5 moveDelta + clampToMapBounds：时间基等价性与边界夹取
  {
    const per = MS.moveDelta(1, 0, AppConfig.moveSpeedPxPerMs, 1000 / 60);
    check(
      '60fps 单帧位移 = 4px（与基线帧基 4px 逐字等价）',
      Math.abs(per.x - 4) < 1e-9 && per.y === 0,
      `dx=${per.x}`,
    );
    const per30 = MS.moveDelta(1, 0, AppConfig.moveSpeedPxPerMs, 1000 / 30);
    check('30fps 单帧位移 = 8px（两帧追上 60fps 的两帧）', Math.abs(per30.x - 8) < 1e-9, `dx=${per30.x}`);
  }
  {
    // 同一路径：60 帧 × 16.67ms 与 30 帧 × 33.33ms 的总位移必须相等（容差 < 1px）
    const total = (frames, dt, dx, dy) => {
      let x = 0;
      let y = 0;
      for (let i = 0; i < frames; i++) {
        const s = MS.moveDelta(dx, dy, AppConfig.moveSpeedPxPerMs, dt);
        x += s.x;
        y += s.y;
      }
      return { x, y };
    };
    const straight60 = total(60, 1000 / 60, 1, 0);
    const straight30 = total(30, 1000 / 30, 1, 0);
    const diag60 = total(60, 1000 / 60, 1, 1);
    const diag30 = total(30, 1000 / 30, 1, 1);
    const dStraight = Math.hypot(straight60.x - straight30.x, straight60.y - straight30.y);
    const dDiag = Math.hypot(diag60.x - diag30.x, diag60.y - diag30.y);
    check(
      `60/30fps 等价（直线 1s）：总位移差 ${dStraight.toExponential(2)}px < 1px`,
      dStraight < 1,
      `60fps=${straight60.x.toFixed(2)} 30fps=${straight30.x.toFixed(2)}`,
    );
    check(
      `60/30fps 等价（对角 1s）：总位移差 ${dDiag.toExponential(2)}px < 1px`,
      dDiag < 1,
      `60fps=(${diag60.x.toFixed(2)},${diag60.y.toFixed(2)}) 30fps=(${diag30.x.toFixed(2)},${diag30.y.toFixed(2)})`,
    );
    check('1s 总位移 = 240px（= 4px/帧 @60fps）', Math.abs(straight60.x - 240) < 1e-9, `d=${straight60.x}`);
  }
  check(
    '对角方向按归一化前进：单帧位移长度与方向无关',
    (() => {
      const s = MS.moveDelta(1, 1, AppConfig.moveSpeedPxPerMs, 1000 / 60);
      return Math.abs(Math.hypot(s.x, s.y) - 4) < 1e-9;
    })(),
  );
  check(
    '非法入参（dt≤0 / 速度≤0 / 方向 0）→ 位移 0',
    MS.moveDelta(1, 0, 0.24, 0).x === 0 &&
      MS.moveDelta(1, 0, 0, 16.67).x === 0 &&
      MS.moveDelta(0, 0, 0.24, 16.67).x === 0,
  );
  {
    const w = 1280;
    const h = 960;
    check(
      '边界字面量 = 基线原值：x∈[8, w-8] / y∈[16, h-8]',
      MS.BOUND_LEFT === 8 && MS.BOUND_TOP === 16 && MS.BOUND_RIGHT === 8 && MS.BOUND_BOTTOM === 8,
      `left=${MS.BOUND_LEFT} top=${MS.BOUND_TOP} right=${MS.BOUND_RIGHT} bottom=${MS.BOUND_BOTTOM}`,
    );
    const inb = MS.clampToMapBounds(640, 480, w, h);
    const lo = MS.clampToMapBounds(-50, -50, w, h);
    const hi = MS.clampToMapBounds(99999, 99999, w, h);
    check('界内不变', inb.x === 640 && inb.y === 480);
    check('越左/越上 → 夹到 8 / 16', lo.x === 8 && lo.y === 16, `(${lo.x},${lo.y})`);
    check('越右/越下 → 夹到 1272 / 952', hi.x === 1272 && hi.y === 952, `(${hi.x},${hi.y})`);
    check(
      '退化地图（宽 < 16）：与基线 min(max(v,lo),hi) 同序 → 取上界（不崩）',
      MS.clampToMapBounds(50, 50, 12, 12).x === 4 && MS.clampToMapBounds(50, 50, 12, 12).y === 4,
      JSON.stringify(MS.clampToMapBounds(50, 50, 12, 12)),
    );
  }

  // 8.6 RemoteInterp 组件级（node 内用**假 owner**：组件只通过 owner.setPos 写位置，不触碰 Laya）
  const fakeOwner = () => ({
    x: null,
    y: null,
    setPos(x, y) {
      this.x = x;
      this.y = y;
    },
  });
  const attach = () => {
    const owner = fakeOwner();
    const c = new RemoteInterp();
    c.onAttach(owner);
    return { owner, c };
  };

  {
    Quality.forceTier('high');
    const { owner, c } = attach();
    c.setTarget(100, 50);
    check(
      '首包（尚未对齐）直接对齐，不从原点爬过来',
      owner.x === 100 && owner.y === 50 && c.snapshot().active === true,
      JSON.stringify(c.snapshot()),
    );
    c.setTarget(200, 50);
    check(
      '节流：同 tick 内第二包被丢弃（high 档 10Hz → 80ms 生效间隔）',
      c.snapshot().targetX === 100,
      `targetX=${c.snapshot().targetX}`,
    );
  }
  {
    // 真实一包的量级：远端满速 240px/s @10Hz 广播 → 每包 24px（< snapPx 96，故走平滑分支）
    const { owner, c } = attach();
    c.snapTo(0, 0);
    c.setTarget(24, 0);
    c.update(1000 / 60);
    check(
      'update 向目标平滑逼近：一帧只走 alpha 比例（不瞬移）',
      owner.x > 0 && owner.x < 12,
      `x=${owner.x}（目标 24 = 单包位移）`,
    );
    for (let i = 0; i < 60; i++) c.update(1000 / 60);
    check(
      '持续 update 后追到目标（<0.05px；真机上由 TransformComponent 取整到 24）',
      Math.abs(c.snapshot().x - 24) < 0.05,
      `float=${c.snapshot().x.toFixed(4)}`,
    );
  }
  {
    const saved = AppConfig.remote.interpBufferMs;
    AppConfig.remote.interpBufferMs = 0;
    try {
      const { owner, c } = attach();
      c.snapTo(0, 0);
      c.setTarget(300, 0);
      c.update(1000 / 60);
      check('interpBufferMs=0（关闭插值，A/B 对照基线）→ 一帧直接到位', owner.x === 300, `x=${owner.x}`);
    } finally {
      AppConfig.remote.interpBufferMs = saved;
    }
  }
  {
    const { owner, c } = attach();
    c.snapTo(0, 0);
    c.setTarget(500, 0); // dist 500 > snapPx 96
    c.update(1000 / 60);
    check('越界（冻结后重入）→ update 直接对齐目标', owner.x === 500, `x=${owner.x}`);
  }
  {
    const { owner, c } = attach();
    c.snapTo(0, 0);
    c.setTarget(50, 0);
    c.update(1000 / 60);
    c.snapTo(800, 600); // 池复用复位
    const after = c.snapshot();
    c.update(1000 / 60);
    check(
      'snapTo 清旧目标并立即对齐（池复用不会从上一个玩家的目标插值 = 幽灵位移防护）',
      after.x === 800 && after.y === 600 && after.targetX === 800 && after.targetY === 600 && owner.x === 800,
      JSON.stringify(after),
    );
  }
  {
    Quality.forceTier('low');
    const { c } = attach();
    c.snapTo(0, 0);
    c.setTarget(100.4, 20.6);
    check(
      'low 档：目标点取整（interpPrecision=reduced）',
      c.snapshot().targetX === 100 && c.snapshot().targetY === 21,
      JSON.stringify(c.snapshot()),
    );
    c.setTarget(200, 40);
    check('low 档 5Hz 节流：同 tick 第二包被丢弃（有效更新率降半）', c.snapshot().targetX === 100);
    await sleep(220); // > 1000/5 × 0.8 = 160ms
    c.setTarget(200.5, 40.5);
    check(
      'low 档：超过 160ms 后新包被采纳（节流不影响权威值，只降表现更新率）',
      c.snapshot().targetX === 201 && c.snapshot().targetY === 41,
      JSON.stringify(c.snapshot()),
    );
    Quality.forceTier('high');
    check('low 档断言结束后恢复 high（本脚本后续与验收不受影响）', Quality.tier() === 'high');
    Quality.forceTier(null);
  }
  check(
    'high 档节流间隔（1000/10×0.8=80ms）严格小于服务端广播间隔 100ms → 常态零丢弃',
    (1000 / 10) * AppConfig.remote.throttleSlackRatio < 100 &&
      (1000 / 5) * AppConfig.remote.throttleSlackRatio >= 100,
    `high=${(1000 / 10) * AppConfig.remote.throttleSlackRatio}ms low=${(1000 / 5) * AppConfig.remote.throttleSlackRatio}ms`,
  );
}

console.log(
  failed === 0
    ? `\nS8 性能纯逻辑断言全部通过（共 ${total} 项）`
    : `\nS8 性能纯逻辑断言失败 ${failed}/${total} 项`,
);
process.exit(failed === 0 ? 0 : 1);