// S4 NPC 路点插值/位移校正的零依赖断言脚本（不引入任何测试框架：只用 node + 自写 check）
// 用法：node tools/build-fallback.mjs && node scripts/smoke-s4-npc.mjs
//
// 断言对象取自**构建产物** `bin/js/entity/patrol.js`（构建输出，不入库）——该模块不 import Laya
// （类型只走 import type），故 node 可直接求值（同 S3 的 smoke-s3-components.mjs）。
// 断言失败 → exit 1。
//
// 注：`bin/js/*.js` 最近的 package.json（仓库根）没有 "type" 字段，node 会先按 CJS 解析失败、
// 再按「检测到模块语法」回退为 ES module 求值，并打印一条 MODULE_TYPELESS_PACKAGE_JSON 警告 —— 属预期噪音。
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ARTIFACT = 'bin/js/entity/patrol.js';
if (!existsSync(join(root, ARTIFACT))) {
  console.error(`缺少构建产物：${ARTIFACT}`);
  console.error('请先执行 node tools/build-fallback.mjs');
  process.exit(1);
}

const { MAX_CORRECTION_STEP_PX, initPatrolState, limitApproach, stepPatrol } = await import(
  pathToFileURL(join(root, ARTIFACT)).href
);

let total = 0;
let failed = 0;
function check(name, cond, extra = '') {
  total++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` :: ${extra}` : ''}`);
  if (!cond) failed++;
}

/** 造一个巡逻运行态（与服务端 route 同字段） */
function makeState(points, speed, loopMode, cursor = 0, x = points[0]?.x ?? 0, y = points[0]?.y ?? 0) {
  return initPatrolState({ points, speed, loopMode, cursor }, x, y);
}

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ── 1. 插值推进 ────────────────────────────────────────────────────────────
console.log('— 插值推进（沿路点直线前进）—');

{
  // 100px 路点、100px/s：走 500ms 应落在两点之间（50,0）
  const s0 = makeState([{ x: 0, y: 0 }, { x: 100, y: 0 }], 100, 'loop');
  const s1 = stepPatrol(s0, 500);
  check(
    '插值推进：dt=500ms 后位置落在两点之间且方向正确',
    near(s1.x, 50) && near(s1.y, 0) && s1.x > 0 && s1.x < 100,
    `pos=(${s1.x.toFixed(2)},${s1.y.toFixed(2)})`,
  );
  check(
    '纯函数：不修改入参状态',
    s0.x === 0 && s0.y === 0 && s0.cursor === 0,
    `入参 pos=(${s0.x},${s0.y})`,
  );
}

{
  // 到达路点后 cursor 前进、pauseSec 生效（停留期间不动）
  const s0 = makeState([{ x: 0, y: 0 }, { x: 100, y: 0, pauseSec: 1 }], 100, 'loop');
  const s1 = stepPatrol(s0, 1000); // 正好到达 100
  check(
    '到达路点：cursor 推进且进入 pauseSec 停留',
    near(s1.x, 100) && s1.cursor === 1 && s1.pauseMs > 0,
    `pos=(${s1.x},${s1.y}) cursor=${s1.cursor} pauseMs=${s1.pauseMs}`,
  );
  const s2 = stepPatrol(s1, 300); // 停留期内
  check(
    '停留期内原地不动',
    near(s2.x, 100) && near(s2.y, 0) && s2.pauseMs < s1.pauseMs,
    `pos=(${s2.x},${s2.y}) pauseMs=${s2.pauseMs}`,
  );
}

// ── 2. loopMode 分支 ───────────────────────────────────────────────────────
console.log('— loopMode（loop / pingpong / once）—');

{
  // pingpong：从 0 走到端点 1 后折返（dir 翻转），2s 正好回到 0
  const s0 = makeState([{ x: 0, y: 0 }, { x: 100, y: 0 }], 100, 'pingpong');
  const s1 = stepPatrol(s0, 2000);
  check(
    'pingpong 到端点折返：回到起点且方向翻转',
    near(s1.x, 0) && s1.cursor === 0 && s1.dir === -1,
    `pos=(${s1.x},${s1.y}) cursor=${s1.cursor} dir=${s1.dir}`,
  );
}

{
  // loop：位于末尾路点时下一步回 0（2s 走完 20px 正好落在 0）
  const s0 = makeState(
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }],
    10,
    'loop',
    2,
    20,
    0,
  );
  const s1 = stepPatrol(s0, 2000);
  check(
    'loop 到末尾回 0：cursor 归零且位置到达首路点',
    near(s1.x, 0) && s1.cursor === 0,
    `pos=(${s1.x},${s1.y}) cursor=${s1.cursor}`,
  );
}

{
  // once：位于末尾路点时不再前进
  const s0 = makeState(
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }],
    10,
    'once',
    2,
    20,
    0,
  );
  const s1 = stepPatrol(s0, 5000);
  check(
    'once 到末尾停止：位置与 cursor 均不变',
    near(s1.x, 20) && s1.cursor === 2,
    `pos=(${s1.x},${s1.y}) cursor=${s1.cursor}`,
  );
}

// ── 3. 边界：路点不足 / 非法速度 ───────────────────────────────────────────
console.log('— 边界（不崩、不产生 NaN、原地站）—');

{
  const empty = makeState([], 60, 'loop', 0, 5, 7);
  const s1 = stepPatrol(empty, 1000);
  check(
    'points 为空：原地站且无 NaN',
    s1.x === 5 && s1.y === 7 && Number.isFinite(s1.x) && Number.isFinite(s1.y),
    `pos=(${s1.x},${s1.y})`,
  );

  const single = makeState([{ x: 12, y: 34 }], 60, 'loop', 0, 12, 34);
  const s2 = stepPatrol(single, 1000);
  check(
    'points 单点：原地站且无 NaN',
    s2.x === 12 && s2.y === 34 && Number.isFinite(s2.x) && Number.isFinite(s2.y),
    `pos=(${s2.x},${s2.y})`,
  );

  const badSpeed = makeState([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0, 'loop');
  const s3 = stepPatrol(badSpeed, 1000);
  check(
    'speed<=0：原地站且无 NaN',
    s3.x === 0 && s3.y === 0 && Number.isFinite(s3.x) && Number.isFinite(s3.y),
    `pos=(${s3.x},${s3.y})`,
  );
}

// ── 4. 纠偏限速（applyCorrection 的核心） ──────────────────────────────────
console.log('— 纠偏限速（limitApproach：不瞬移）—');

check(
  '纠偏阈值常量为 8px/帧',
  MAX_CORRECTION_STEP_PX === 8,
  `MAX_CORRECTION_STEP_PX=${MAX_CORRECTION_STEP_PX}`,
);

{
  const moved = limitApproach({ x: 0, y: 0 }, { x: 100, y: 0 }, MAX_CORRECTION_STEP_PX);
  const dist = Math.hypot(moved.x - 0, moved.y - 0);
  check(
    '远距离校正：单帧位移 = 阈值（不瞬移）',
    near(dist, MAX_CORRECTION_STEP_PX) && moved.x > 0 && moved.x < 100,
    `pos=(${moved.x.toFixed(2)},${moved.y.toFixed(2)}) 位移=${dist.toFixed(2)}`,
  );

  // 连续逼近：每次都不超过阈值，且有限步内到达目标
  let cur = { x: 0, y: 0 };
  let steps = 0;
  let maxStep = 0;
  const target = { x: 30, y: 40 }; // 距离 50
  while (steps < 100) {
    const nxt = limitApproach(cur, target, MAX_CORRECTION_STEP_PX);
    maxStep = Math.max(maxStep, Math.hypot(nxt.x - cur.x, nxt.y - cur.y));
    cur = nxt;
    steps++;
    if (cur.x === target.x && cur.y === target.y) break;
  }
  check(
    '连续逼近：每帧位移 ≤ 阈值，且有限帧内精确到达目标',
    maxStep <= MAX_CORRECTION_STEP_PX + 1e-6 && cur.x === target.x && cur.y === target.y,
    `帧数=${steps} 最大单帧位移=${maxStep.toFixed(2)}`,
  );

  const snap = limitApproach({ x: 10, y: 0 }, { x: 12, y: 0 }, MAX_CORRECTION_STEP_PX);
  check(
    '近距离校正：一步落到目标（不抖动）',
    snap.x === 12 && snap.y === 0,
    `pos=(${snap.x},${snap.y})`,
  );

  const same = limitApproach({ x: 5, y: 5 }, { x: 5, y: 5 }, MAX_CORRECTION_STEP_PX);
  check(
    '已在目标点：返回自身且无 NaN',
    same.x === 5 && same.y === 5,
    `pos=(${same.x},${same.y})`,
  );
}

// ── 5. AiComponent：校正误差逐帧消费（两端相位对齐） ────────────────────────
// AiComponent 只依赖 `./Component` 与 `../patrol`（均不 import Laya），故 node 可直接求值。
console.log('— AiComponent（applyCorrection 限速逼近 + 相位对齐）—');

const { AiComponent } = await import(
  pathToFileURL(join(root, 'bin/js/entity/components/AiComponent.js')).href
);

{
  // 静止场景：权威位置领先 60px，应逐帧限速消费、有限帧内精确到达，且单帧位移 ≤ 阈值
  const route = { points: [{ x: 0, y: 0 }, { x: 600, y: 0 }], speed: 0, loopMode: 'loop', cursor: 0 };
  const ai = new AiComponent(route, 0, 0);
  ai.applyCorrection(60, 0);
  check(
    'applyCorrection 当帧不瞬移：只记录误差、位置不动',
    ai.x === 0 && ai.y === 0,
    `pos=(${ai.x},${ai.y})`,
  );

  let frames = 0;
  let maxStep = 0;
  let prev = ai.x;
  while (frames < 100) {
    ai.update(40);
    maxStep = Math.max(maxStep, ai.x - prev);
    prev = ai.x;
    frames++;
    if (ai.x >= 60) break;
  }
  check(
    '校正误差逐帧消费：有限帧内到达权威位置且单帧位移 ≤ 阈值',
    ai.x === 60 && maxStep <= MAX_CORRECTION_STEP_PX + 1e-6,
    `帧数=${frames} 最大单帧位移=${maxStep.toFixed(2)} pos=(${ai.x},${ai.y})`,
  );
}

{
  // 真实场景：两端进场景时刻不同 → 权威（ref）领先本地 60px。仅第一次收到校正，
  // 之后自由推进：误差应在数帧内被消费干净，此后与权威**同步**（残差≈0）。
  const route = { points: [{ x: 0, y: 0 }, { x: 600, y: 0 }], speed: 60, loopMode: 'loop', cursor: 0 };
  const ref = new AiComponent(route, 60, 0); // 权威（另一端）
  const ai = new AiComponent(route, 0, 0); // 本地（先进入场景，初始位置更旧）
  ai.applyCorrection(ref.x, ref.y);

  let maxStep = 0;
  let prev = ai.x;
  for (let i = 0; i < 40; i++) {
    ref.update(40);
    ai.update(40);
    maxStep = Math.max(maxStep, ai.x - prev);
    prev = ai.x;
  }
  const gap = ref.x - ai.x;
  check(
    '相位对齐：单次校正后与权威同步（残差 < 0.01px），且单帧总位移 ≤ 阈值 + 自由插值步长',
    Math.abs(gap) < 0.01 && maxStep <= MAX_CORRECTION_STEP_PX + 60 * 0.04 + 1e-6,
    `残差=${gap.toFixed(4)}px 最大单帧位移=${maxStep.toFixed(2)}`,
  );
}

console.log(
  failed === 0
    ? `\nS4 NPC 插值/纠偏断言全部通过（共 ${total} 项）`
    : `\nS4 NPC 插值/纠偏断言失败 ${failed}/${total} 项`,
);
process.exit(failed === 0 ? 0 : 1);
