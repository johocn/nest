import { AppConfig } from '../config/AppConfig';
import { WerewolfClient, WerewolfSync } from './WerewolfClient';
import { WerewolfView } from './WerewolfView';

let client: WerewolfClient | null = null;
let view: WerewolfView | null = null;
let lobby: Laya.Sprite | null = null;
let entryBtn: Laya.Sprite | null = null;

// 房主自定义：板子（按人数取预设）与节奏（覆盖阶段时长）
type Pace = 'normal' | 'fast' | 'slow';
const BOARD_OPTS = [6, 9, 12];
const PACE_OPTS: { label: string; value: Pace }[] = [
  { label: '普通', value: 'normal' },
  { label: '快速', value: 'fast' },
  { label: '慢速', value: 'slow' },
];
const DURATION_PRESETS: Record<Pace, Record<string, number> | undefined> = {
  normal: undefined,
  fast: {
    night_wolf: 12000,
    night_seer: 12000,
    night_witch: 12000,
    night_guard: 12000,
    day_discuss: 25000,
    day_vote: 15000,
    day_nominate: 10000,
    day_police_vote: 10000,
    day_badge_transfer: 8000,
    hunter_shoot: 8000,
  },
  slow: {
    night_wolf: 45000,
    night_seer: 45000,
    night_witch: 45000,
    night_guard: 45000,
    day_discuss: 90000,
    day_vote: 45000,
    day_nominate: 30000,
    day_police_vote: 30000,
    day_badge_transfer: 20000,
    hunter_shoot: 20000,
  },
};
let selectedBoard = 9;
let selectedPace: Pace = 'normal';

/**
 * 常驻悬浮入口按钮（右上角）。
 * 不依赖 URL 参数与快捷键——主游戏场景加载后仍可直接点击进入狼人杀。
 */
export function showWerewolfEntry(): void {
  if (entryBtn) return;
  const W = AppConfig.werewolf;
  // 用 Laya.Button（UI 组件）而非裸 Sprite：自带点击命中与按下态，最稳妥
  const b = new Laya.Button();
  b.size(120, 40);
  b.label = '狼人杀';
  b.labelSize = 16;
  b.labelBold = true;
  b.labelColors = '#ffffff,#ffffff,#ffffff';
  b.graphics.drawRect(0, 0, 120, 40, '#e5484d');
  // 按舞台实际宽度定位并夹紧，避免窗口较小时落到可视区之外
  b.pos(Math.max(8, (Laya.stage.width || AppConfig.stageWidth) - 132), 12);
  // 高于 HUD/建造面板，低于狼人杀根层
  b.zOrder = W.zOrder - 1;
  b.mouseEnabled = true;
  b.on(Laya.Event.CLICK, b, () => {
    console.log('[WW] 入口按钮被点击');
    void startWerewolf();
  });
  Laya.stage.addChild(b);
  entryBtn = b;
  console.log(
    `[WW] 悬浮入口已显示 stage=${Laya.stage.width}x${Laya.stage.height} btnX=${b.x}`,
  );
}

function hideWerewolfEntry(): void {
  if (entryBtn) {
    entryBtn.removeSelf();
    entryBtn = null;
  }
}

/** 启动狼人杀（复用 nest 游戏框架的网络/UI 基础设施） */
export async function startWerewolf(): Promise<void> {
  if (view) return; // 已在运行
  hideWerewolfEntry(); // 进入后收起悬浮入口，避免遮挡对局界面
  try {
    client = new WerewolfClient();
    view = new WerewolfView();
    view.mount();
    view.setClient(client);

    client.onSync((sync: WerewolfSync) => {
      // 进入对局后隐藏大厅
      if (sync.public.step !== 'lobby') hideLobby();
      view?.render(sync);
    });

    buildLobby();
    console.log('[WW] 狼人杀已启动，大厅已显示');
  } catch (err) {
    // 启动失败必须可见：否则表现为「点了没反应」
    view = null;
    client = null;
    console.error('[WW] 狼人杀启动失败', err);
    flash(
      `狼人杀启动失败：${err instanceof Error ? err.message : String(err)}`,
    );
    showWerewolfEntry(); // 恢复入口，方便修正后重试
  }
}

export function stopWerewolf(): void {
  view?.unmount();
  client?.leaveRoom();
  hideLobby();
  view = null;
  client = null;
  showWerewolfEntry(); // 退出后恢复入口
}

// --------------------------------------------------------------- 大厅
function buildLobby(): void {
  if (lobby) lobby.removeSelf();
  lobby = new Laya.Sprite();
  lobby.zOrder = AppConfig.werewolf.zOrder + 100;
  lobby.graphics.drawRect(
    0,
    0,
    AppConfig.stageWidth,
    AppConfig.stageHeight,
    'rgba(8,10,14,0.94)',
  );

  const title = new Laya.Text();
  title.text = '狼人杀 · Werewolf';
  title.fontSize = 36;
  title.bold = true;
  title.color = AppConfig.werewolf.bannerColor;
  title.pos(AppConfig.stageWidth / 2 - 150, 90);
  lobby.addChild(title);

  const sub = new Laya.Text();
  sub.text = '复用 nest 游戏框架 · 夜/昼转场 · 含警长竞选与狼人频道';
  sub.fontSize = 14;
  sub.color = '#8b949e';
  sub.pos(AppConfig.stageWidth / 2 - 150, 140);
  lobby.addChild(sub);

  const bl = new Laya.Text();
  bl.text = '板子（人数）';
  bl.fontSize = 14;
  bl.bold = true;
  bl.color = '#8b949e';
  bl.pos(AppConfig.stageWidth / 2 - 150, 195);
  lobby.addChild(bl);
  BOARD_OPTS.forEach((n, i) => {
    lobby.addChild(
      makeSmallButton(
        `${n}人`,
        AppConfig.stageWidth / 2 - 150 + i * 90,
        220,
        selectedBoard === n,
        () => {
          selectedBoard = n;
          buildLobby();
        },
      ),
    );
  });

  const pl = new Laya.Text();
  pl.text = '节奏';
  pl.fontSize = 14;
  pl.bold = true;
  pl.color = '#8b949e';
  pl.pos(AppConfig.stageWidth / 2 - 150, 262);
  lobby.addChild(pl);
  PACE_OPTS.forEach((o, i) => {
    lobby.addChild(
      makeSmallButton(
        o.label,
        AppConfig.stageWidth / 2 - 150 + i * 90,
        287,
        selectedPace === o.value,
        () => {
          selectedPace = o.value;
          buildLobby();
        },
      ),
    );
  });

  const quick = makeButton(
    '快速开始（含机器人）',
    '#2f81f7',
    AppConfig.stageWidth / 2 - 150,
    345,
    async () => {
      try {
        await client!.createRoom({
          name: '玩家',
          playerCount: selectedBoard,
          durations: DURATION_PRESETS[selectedPace],
        });
        await client!.devFill(selectedBoard - 1);
        await client!.startRoom();
      } catch (e: any) {
        flash((e as Error).message);
      }
    },
  );
  lobby.addChild(quick);

  const join = makeButton(
    '加入房间',
    '#3fb950',
    AppConfig.stageWidth / 2 - 150,
    405,
    async () => {
      const id = (globalThis as any).prompt?.('输入房间号 roomId：', '');
      if (!id) return;
      try {
        await client!.joinRoom(id, '玩家');
      } catch (e: any) {
        flash((e as Error).message);
      }
    },
  );
  lobby.addChild(join);

  const start = makeButton(
    '开始游戏（房主）',
    '#f0883e',
    AppConfig.stageWidth / 2 - 150,
    465,
    async () => {
      try {
        await client!.startRoom();
      } catch (e: any) {
        flash((e as Error).message);
      }
    },
  );
  lobby.addChild(start);

  Laya.stage.addChild(lobby);
}

function hideLobby(): void {
  if (lobby) {
    lobby.removeSelf();
    lobby = null;
  }
}

/** 统一用 Laya.Button：自带点击命中与按下态，避免裸 Sprite 点不动 */
function makeButton(
  label: string,
  color: string,
  x: number,
  y: number,
  onClick: () => void,
): Laya.Sprite {
  const b = new Laya.Button();
  b.size(300, 44);
  b.label = label;
  b.labelSize = 16;
  b.labelBold = true;
  b.labelColors = '#ffffff,#ffffff,#ffffff';
  b.graphics.drawRect(0, 0, 300, 44, color);
  b.mouseEnabled = true;
  b.on(Laya.Event.CLICK, b, onClick);
  b.pos(x, y);
  return b;
}

/** 小号互斥按钮（板子/节奏选择用） */
function makeSmallButton(
  label: string,
  x: number,
  y: number,
  selected: boolean,
  onClick: () => void,
): Laya.Sprite {
  const b = new Laya.Button();
  b.size(80, 32);
  b.label = label;
  b.labelSize = 13;
  b.labelBold = true;
  b.labelColors = '#ffffff,#ffffff,#ffffff';
  b.graphics.drawRect(0, 0, 80, 32, selected ? '#2f81f7' : '#30363d');
  b.mouseEnabled = true;
  b.pos(x, y);
  b.on(Laya.Event.CLICK, b, onClick);
  return b;
}

function flash(msg: string): void {
  const t = new Laya.Text();
  t.text = msg;
  t.fontSize = 14;
  t.color = '#e5484d';
  t.pos(40, AppConfig.stageHeight - 80);
  Laya.stage.addChild(t);
  Laya.timer.once(2500, null, () => t.removeSelf());
}
