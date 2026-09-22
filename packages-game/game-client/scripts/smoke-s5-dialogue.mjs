// S5 对话视图纯逻辑零依赖断言脚本（不引入任何测试框架：只用 node + 自写 check）
// 用法：node tools/build-fallback.mjs && node scripts/smoke-s5-dialogue.mjs
//
// 断言对象取自**构建产物** `bin/js/ui/DialogueView.js`（构建输出，不入库）——
// 该模块只在方法体内引用 Laya（顶层不 new 任何引擎对象、类型只走 import type），
// 故 node 可直接求值（同 S3 的 smoke-s3-components.mjs / S4 的 smoke-s4-npc.mjs）。
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
  dialogueView: 'bin/js/ui/DialogueView.js',
  appConfig: 'bin/js/config/AppConfig.js',
};

const missing = Object.values(ARTIFACTS).filter((p) => !existsSync(join(root, p)));
if (missing.length > 0) {
  console.error(`缺少构建产物：${missing.join('、')}`);
  console.error('请先执行 node tools/build-fallback.mjs');
  process.exit(1);
}

const load = (rel) => import(pathToFileURL(join(root, rel)).href);
const {
  wrapText,
  layoutDialogue,
  mapDialogueError,
  normalizeTalk,
  normalizeChoose,
} = await load(ARTIFACTS.dialogueView);
const { AppConfig } = await load(ARTIFACTS.appConfig);

const D = AppConfig.dialogue;
const STAGE_W = AppConfig.stageWidth;
const STAGE_H = AppConfig.stageHeight;
/** 注入式测量：每个字符 10px（与字号无关，便于断言精确宽度） */
const measure10 = (text) => String(text).length * 10;
const measureWithFont = (text) => String(text).length * 10;

let total = 0;
let failed = 0;
function check(name, cond, extra = '') {
  total++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` :: ${extra}` : ''}`);
  if (!cond) failed++;
}

// ── 1. wrapText：按宽度自动换行 ────────────────────────────────────────────
console.log('— wrapText（长文本换行，每行不超宽度）—');

{
  const text = '江湖路远刀光剑影'.repeat(20); // 160 字，远超一行
  const maxWidth = 200; // = 20 字/行
  const lines = wrapText(text, maxWidth, measure10);
  check(
    '长文本被切成多行（>1 行）',
    lines.length > 1,
    `行数=${lines.length}`,
  );
  const widths = lines.map(measure10);
  check(
    '每行宽度都不超过 maxWidth',
    widths.every((w) => w <= maxWidth),
    `最大行宽=${Math.max(...widths)} <= ${maxWidth}`,
  );
  check(
    '换行不丢字符：各行拼接等于原文',
    lines.join('') === text,
    `拼接长度=${lines.join('').length} 原文长度=${text.length}`,
  );
}

{
  const lines = wrapText('第一行\n第二行', 200, measure10);
  check(
    '保留显式换行符（\\n 分段）',
    lines.length === 2 && lines[0] === '第一行' && lines[1] === '第二行',
    JSON.stringify(lines),
  );
  check('空文本返回单个空行', JSON.stringify(wrapText('', 200, measure10)) === '[""]');
}

// ── 2. 选项下标映射：optionIndexes 与本地列表错位 ──────────────────────────
console.log('— 选项下标映射（服务端原始下标 vs 本地列表位置）—');

{
  // 服务端隐藏了原始下标 1（条件过滤），可见选项原始下标 = [0,2,3]
  const res = {
    spawnId: '12',
    npcTemplateId: '3',
    name: '铁匠',
    talkType: 'talk',
    dialogueId: 1,
    text: '客官要点什么？',
    options: [{ text: '接任务' }, { text: '要矿石' }, { text: '闲聊' }],
    code: 'npc_blacksmith_main',
    nodeKey: 'root',
    optionIndexes: [0, 2, 3],
    questMarks: { available: ['7'], submittable: [] },
  };
  const view = normalizeTalk(res);
  check(
    'normalizeTalk：选项 index 取自 optionIndexes（非本地下标）',
    view.options.map((o) => o.index).join(',') === '0,2,3',
    `indexes=[${view.options.map((o) => o.index).join(',')}]`,
  );
  check(
    '错位场景：本地第 2 项（下标 1）对应服务端原始下标 2',
    view.options[1].index === 2 && view.options[1].text === '要矿石',
    `local[1]=${view.options[1].text} → serverIndex=${view.options[1].index}`,
  );
  check(
    'normalizeTalk：code/nodeKey/speaker/文本与 questMarks 透传',
    view.code === 'npc_blacksmith_main' &&
      view.nodeKey === 'root' &&
      view.speaker === '铁匠' &&
      view.text === '客官要点什么？' &&
      view.finished === false &&
      view.questMarks?.available?.[0] === '7',
  );
}

{
  // 老 NPC 无 optionIndexes：退化为本地下标，不崩
  const view = normalizeTalk({ text: '你好', options: [{ text: 'A' }], name: '路人' });
  check(
    'normalizeTalk：缺 optionIndexes 时退化为本地下标',
    view.options[0].index === 0 && view.code === '' && view.nodeKey === null,
    `index=${view.options[0].index} code="${view.code}"`,
  );
}

// ── 3. layoutDialogue：布局与换行 ─────────────────────────────────────────
console.log('— layoutDialogue（底部面板 / 说话人 / 正文 / 选项行）—');

{
  const view = {
    code: 'c',
    nodeKey: 'root',
    speaker: '铁匠',
    text: '这条大街上的铁匠铺就我一家，客官要打什么兵器？'.repeat(4),
    options: [
      { index: 0, text: '接任务' },
      { index: 2, text: '要矿石' },
      { index: 3, text: '闲聊' },
    ],
    finished: false,
    error: null,
  };
  const layout = layoutDialogue({
    view,
    stageWidth: STAGE_W,
    stageHeight: STAGE_H,
    measure: measureWithFont,
  });

  const contentWidth = layout.panel.width - D.padX * 2;
  check(
    '内容宽度 = 面板宽度 - 左右内边距',
    layout.contentWidth === contentWidth,
    `contentWidth=${layout.contentWidth} panelWidth=${layout.panel.width}`,
  );
  check(
    '正文每行宽度不超过内容宽度',
    layout.lines.every((l) => measureWithFont(l) <= contentWidth),
    `行数=${layout.lines.length} 最大=${Math.max(...layout.lines.map(measureWithFont))} <= ${contentWidth}`,
  );
  check(
    '说话人为服务端返回内容且位于正文之上',
    layout.speaker !== null &&
      layout.speaker.text === '铁匠' &&
      layout.speaker.y < layout.bodyY,
    `speakerY=${layout.speaker?.y} bodyY=${layout.bodyY}`,
  );
  check(
    '选项行保留服务端原始下标（0,2,3）且带数字键序号',
    layout.options.map((o) => o.index).join(',') === '0,2,3' &&
      layout.options[0].label === '1. 接任务' &&
      layout.options[1].label === '2. 要矿石',
    `labels=[${layout.options.map((o) => o.label).join(' | ')}]`,
  );
  check(
    '选项行自上而下不重叠（y 严格递增）',
    layout.options.every((o, i) => i === 0 || o.y > layout.options[i - 1].y),
    `y=[${layout.options.map((o) => o.y).join(',')}]`,
  );
  check(
    '面板完整落在舞台内（底部对话框）',
    layout.panel.x >= 0 &&
      layout.panel.y >= 0 &&
      layout.panel.x + layout.panel.width <= STAGE_W &&
      layout.panel.y + layout.panel.height <= STAGE_H,
    `panel=(${layout.panel.x},${layout.panel.y},${layout.panel.width},${layout.panel.height})`,
  );
  check(
    '最后一个选项行不超出面板底边',
    layout.options[layout.options.length - 1].y + D.optionHeight <=
      layout.panel.y + layout.panel.height,
  );
}

{
  // 选项数超过 9：只布 9 行（数字键 1-9 上限）
  const view = {
    code: 'c',
    nodeKey: 'n',
    text: '选吧',
    options: Array.from({ length: 12 }, (_, i) => ({ index: i, text: `选项${i + 1}` })),
    finished: false,
  };
  const layout = layoutDialogue({
    view,
    stageWidth: STAGE_W,
    stageHeight: STAGE_H,
    measure: measureWithFont,
  });
  check(
    '选项数超过 maxOptions 时只布 maxOptions 行',
    layout.options.length === D.maxOptions && D.maxOptions === 9,
    `options=${layout.options.length} maxOptions=${D.maxOptions}`,
  );
}

{
  // 错误行：红字内容进布局，且 error 行在选项之下
  const view = {
    code: 'c',
    nodeKey: 'n',
    text: '给不了你',
    options: [{ index: 0, text: '继续' }],
    finished: false,
    error: mapDialogueError(20002),
  };
  const layout = layoutDialogue({
    view,
    stageWidth: STAGE_W,
    stageHeight: STAGE_H,
    measure: measureWithFont,
  });
  check(
    '错误红字进布局且位于选项行下方',
    layout.error?.text === '道具不足' && layout.error.y > layout.options[0].y,
    `error=(${layout.error?.x},${layout.error?.y}) "${layout.error?.text}"`,
  );
}

// ── 4. mapDialogueError：业务码 → 中文文案 ─────────────────────────────────
console.log('— mapDialogueError（服务端业务码映射）—');

const ERROR_CASES = [
  [20002, '道具不足'],
  [20007, '货币不足'],
  [43001, '对话不存在'],
  [43002, '条件不满足'],
  [43003, '对话数据异常'],
];
for (const [code, text] of ERROR_CASES) {
  check(`code ${code} → 「${text}」`, mapDialogueError(code) === text, `实际=「${mapDialogueError(code)}」`);
}
check(
  '未知码给通用兜底（含 code，不抛错）',
  typeof mapDialogueError(99999) === 'string' && mapDialogueError(99999).includes('99999'),
  `实际=「${mapDialogueError(99999)}」`,
);

// ── 5. finished：对话结束（视图应关闭）─────────────────────────────────────
console.log('— finished（结束即关闭视图）—');

{
  const ended = normalizeChoose({ code: 'c', nodeKey: null, node: null, finished: true });
  check(
    'finished 响应 → finished=true 且无可选项（控制器据此关闭视图）',
    ended.finished === true && ended.options.length === 0 && ended.nodeKey === null,
    `finished=${ended.finished} options=${ended.options.length} nodeKey=${ended.nodeKey}`,
  );
  // 防御：node 为空但 finished 缺失，同样按结束处理
  const defensive = normalizeChoose({ code: 'c', nodeKey: null, node: null, finished: false });
  check('node 为空时按结束处理（防御配置异常）', defensive.finished === true, `finished=${defensive.finished}`);
}

{
  const res = {
    code: 'c',
    nodeKey: 'next',
    node: {
      key: 'next',
      speaker: '铁匠',
      text: '任务已给你',
      options: [{ index: 1, text: '谢谢' }],
    },
    finished: false,
  };
  const view = normalizeChoose(res);
  check(
    'choose 未结束 → 渲染下一节点且下标取服务端 index',
    view.finished === false &&
      view.nodeKey === 'next' &&
      view.text === '任务已给你' &&
      view.options[0].index === 1,
    `nodeKey=${view.nodeKey} index=${view.options[0].index}`,
  );
}

console.log(
  failed === 0
    ? `\nS5 对话视图断言全部通过（共 ${total} 项）`
    : `\nS5 对话视图断言失败 ${failed}/${total} 项`,
);
process.exit(failed === 0 ? 0 : 1);