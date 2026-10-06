import { AppConfig } from '../config/AppConfig';
import type { MatchedPayload, MatchModeValue, RoomDestroyedPayload, RoomPlayerView, RoomView } from '../net/matchmaking';
import { MATCH_MODES } from '../net/matchmaking';
import { Session } from '../net/Session';
import { ChatPanel } from './ChatPanel';
import { Toast } from './Toast';

/** 匹配面板常量：与 ChatPanel/BuildPanel 同风格集中在此 */
const MP = {
  /** 高于 Hud(9999) 与聊天/建造面板(10004) */
  zOrder: 10005,
  margin: 12,
  panelWidth: 340,
  padX: 10,
  padY: 8,
  lineHeight: 20,
  buttonHeight: 30,
  fontSize: 13,
  bgColor: 'rgba(0,0,0,0.72)',
  borderColor: '#2f81f7',
  borderWidth: 1,
  titleColor: '#e6edf3',
  lineColor: '#c9d1d9',
  dimColor: '#8b949e',
  okColor: '#3fb950',
  warnColor: '#f0883e',
  selectedBgColor: 'rgba(47,129,247,0.22)',
  buttonBgColor: 'rgba(47,129,247,0.35)',
};

export interface MatchRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 面板几何（纯函数）：贴左上角，高度由内容高度决定 */
export function matchPanelRect(stageWidth: number, stageHeight: number, contentHeight: number): MatchRect {
  return {
    x: MP.margin,
    y: MP.margin,
    w: Math.min(MP.panelWidth, stageWidth - MP.margin * 2),
    h: Math.min(MP.padY * 2 + contentHeight, stageHeight - MP.margin * 2),
  };
}

/** 模式文案（纯函数） */
export function matchModeLabel(mode: string): string {
  if (mode === 'ranked') return '排位';
  if (mode === 'casual') return '休闲';
  if (mode === 'practice') return '练习';
  return mode;
}

/** 房间状态文案（纯函数） */
export function matchRoomStatusLabel(status: string): string {
  if (status === 'forming') return '组建中';
  if (status === 'ready') return '已就绪';
  if (status === 'in_progress') return '对战开始';
  if (status === 'finished') return '已结束';
  if (status === 'timeout') return '已超时';
  return status;
}

/** 成员行文案（纯函数）：`▸ {playerId}(我)　{role}　{ready}` */
export function formatMatchMemberLine(p: RoomPlayerView, meId: string): string {
  const me = String(p.playerId) === String(meId) ? '（我）' : '';
  const role = p.role ? p.role : '-';
  return `${me ? '▸' : '　'} ${p.playerId}${me}　${role}　${p.ready ? '✔ 已准备' : '未准备'}`;
}

/** 上行动作（由 Main 在 WS 连接后注入；全部走 net/matchmaking） */
export interface MatchActions {
  join: (mode: MatchModeValue) => Promise<unknown>;
  cancel: (mode: MatchModeValue) => Promise<unknown>;
  ready: (roomId: string, ready: boolean) => Promise<RoomView>;
  leave: (roomId: string, reason?: string) => Promise<unknown>;
}

interface MatchRow {
  text: string;
  color: string;
  bg?: string;
  onClick?: () => void;
  button?: boolean;
}

/**
 * 匹配面板（引擎内自绘，禁 DOM，照 ChatPanel/BuildPanel 惯例）。
 * 三态：idle（列模式，点击/1·2·3 加入）→ matching（等待秒数，Esc 取消）→ matched（房间+成员 ready 态，
 * R/1 准备、Esc 离开）。状态推进全部由裸广播驱动（matchmaking:matched / room:update / room:destroyed），
 * 面板不做本地状态推进；双方 ready 后服务端自动置 in_progress（如实展示）。M 开关面板。
 */
export class MatchPanel {
  private static root: Laya.Sprite | null = null;
  private static opened = false;
  private static phase: 'idle' | 'matching' | 'matched' = 'idle';
  private static mode: MatchModeValue | null = null;
  private static matchedAt = 0;
  private static room: RoomView | null = null;
  private static actions: MatchActions | null = null;
  private static busy = false;

  /** 必须在 Laya.init 之后调用；幂等 */
  static init(): void {
    if (typeof Laya === 'undefined' || !Laya.stage) return;
    if (MatchPanel.root) return;
    const root = new Laya.Sprite();
    root.name = 'match-panel';
    root.zOrder = MP.zOrder;
    // 不设 mouseEnabled / 不设 size：根节点不参与命中，行命中区作为子节点照常接收点击（照 BuildPanel）
    Laya.stage.addChild(root);
    MatchPanel.root = root;
    Laya.stage.on(Laya.Event.KEY_DOWN, MatchPanel, MatchPanel.onKeyDown);
    // 匹配等待秒数 ticker：先 clear 再 loop，防重复叠加（与心跳同幂等模式）
    Laya.timer.clear(MatchPanel, MatchPanel.onTick);
    Laya.timer.loop(1000, MatchPanel, MatchPanel.onTick);
    console.log(`[Match] MatchPanel 就绪：zOrder=${MP.zOrder}（M 开关面板）`);
  }

  static get isOpen(): boolean {
    return MatchPanel.opened;
  }

  /** 上行动作注入（Main 在 WS 连接后调用） */
  static setActions(actions: MatchActions): void {
    MatchPanel.actions = actions;
  }

  /** 彻底销毁（照 ChatPanel/BuildPanel 清理方式） */
  static destroy(): void {
    if (typeof Laya !== 'undefined' && Laya.stage) {
      Laya.stage.off(Laya.Event.KEY_DOWN, MatchPanel, MatchPanel.onKeyDown);
      Laya.timer.clear(MatchPanel, MatchPanel.onTick);
    }
    if (MatchPanel.root && MatchPanel.root.parent) {
      MatchPanel.root.parent.removeChild(MatchPanel.root);
    }
    MatchPanel.root = null;
    MatchPanel.opened = false;
    MatchPanel.phase = 'idle';
    MatchPanel.mode = null;
    MatchPanel.matchedAt = 0;
    MatchPanel.room = null;
    MatchPanel.actions = null;
    MatchPanel.busy = false;
  }

  // ── 裸事件回喂（Main 接线） ─────────────────────────────────────────────

  static onMatched(p: MatchedPayload): void {
    if (!p || !p.roomId) return;
    MatchPanel.phase = 'matched';
    MatchPanel.mode = p.mode as MatchModeValue;
    MatchPanel.matchedAt = Date.now();
    // 首份成员视图由 matched payload 构造（role 未知先置空），ready/role 细节等第一条 room:update 校正
    MatchPanel.room = {
      id: p.roomId,
      mode: p.mode,
      status: 'forming',
      players: (p.players ?? []).map((playerId) => ({
        playerId: String(playerId),
        role: '',
        ready: false,
        joinedAt: '',
      })),
      maxPlayers: (p.players ?? []).length,
      minPlayers: (p.players ?? []).length,
      createdAt: '',
    };
    console.log(`[Match] 匹配成功 roomId=${p.roomId} players=${(p.players ?? []).join(',')}`);
    Toast.info('匹配成功！');
    if (MatchPanel.opened) MatchPanel.rebuild();
  }

  static onRoomUpdate(room: RoomView): void {
    if (!room || MatchPanel.phase !== 'matched') return;
    if (String(room.id) !== String(MatchPanel.room?.id)) return;
    MatchPanel.room = room;
    if (MatchPanel.opened) MatchPanel.rebuild();
  }

  static onRoomDestroyed(p: RoomDestroyedPayload): void {
    if (!p || MatchPanel.phase !== 'matched') return;
    if (String(p.roomId) !== String(MatchPanel.room?.id)) return;
    console.log(`[Match] 房间解散 roomId=${p.roomId} reason=${p.reason ?? ''}`);
    MatchPanel.resetToIdle();
    Toast.info(`房间已解散：${p.reason ?? '未知原因'}`);
  }

  // ── 交互 ───────────────────────────────────────────────────────────────

  static toggle(): void {
    if (MatchPanel.opened) {
      MatchPanel.opened = false;
      MatchPanel.root?.removeChildren();
    } else {
      MatchPanel.opened = true;
      MatchPanel.rebuild();
    }
  }

  private static onKeyDown(e: Laya.Event): void {
    if (ChatPanel.isOpen) return; // 聊天输入打开时忽略（防打字误触匹配操作）
    const key = String((e as unknown as { key?: string }).key ?? '').toLowerCase();
    if (key === 'm') {
      MatchPanel.toggle();
      return;
    }
    if (!MatchPanel.opened) return;
    if (MatchPanel.phase === 'idle') {
      const idx = ['1', '2', '3'].indexOf(key);
      if (idx >= 0) void MatchPanel.doJoin(MATCH_MODES[idx]);
      return;
    }
    if (MatchPanel.phase === 'matching') {
      if (key === 'escape') void MatchPanel.doCancel();
      return;
    }
    if (key === 'escape') void MatchPanel.doLeave();
    else if (key === 'r' || key === '1') void MatchPanel.doReady();
  }

  private static async doJoin(mode: MatchModeValue): Promise<void> {
    if (MatchPanel.busy || MatchPanel.phase !== 'idle') return;
    const join = MatchPanel.actions?.join;
    if (!join) {
      Toast.error('匹配服务未接线');
      return;
    }
    MatchPanel.busy = true;
    try {
      await join(mode);
      MatchPanel.phase = 'matching';
      MatchPanel.mode = mode;
      MatchPanel.matchedAt = Date.now();
      MatchPanel.rebuild();
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      MatchPanel.busy = false;
    }
  }

  private static async doCancel(): Promise<void> {
    if (MatchPanel.busy || MatchPanel.phase !== 'matching' || !MatchPanel.mode) return;
    const cancel = MatchPanel.actions?.cancel;
    if (!cancel) return;
    MatchPanel.busy = true;
    try {
      await cancel(MatchPanel.mode);
      MatchPanel.resetToIdle();
      Toast.info('已取消匹配');
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      MatchPanel.busy = false;
    }
  }

  private static async doReady(): Promise<void> {
    if (MatchPanel.busy || MatchPanel.phase !== 'matched' || !MatchPanel.room) return;
    const room = MatchPanel.room;
    const me = room.players.find((p) => String(p.playerId) === String(Session.playerId ?? ''));
    if (me?.ready) return;
    const ready = MatchPanel.actions?.ready;
    if (!ready) return;
    MatchPanel.busy = true;
    try {
      MatchPanel.onRoomUpdate(await ready(room.id, true));
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      MatchPanel.busy = false;
    }
  }

  private static async doLeave(): Promise<void> {
    if (MatchPanel.busy || MatchPanel.phase !== 'matched' || !MatchPanel.room) return;
    const roomId = MatchPanel.room.id;
    const leave = MatchPanel.actions?.leave;
    if (!leave) return;
    MatchPanel.busy = true;
    try {
      await leave(roomId, 'leave');
      MatchPanel.resetToIdle();
      Toast.info('已离开房间');
    } catch (err) {
      // 房间已不存在（如对方先离开已解散）时同样回 idle
      Toast.error(err instanceof Error ? err.message : String(err));
      if (MatchPanel.phase === 'matched' && String(MatchPanel.room?.id) === String(roomId)) {
        MatchPanel.resetToIdle();
      }
    } finally {
      MatchPanel.busy = false;
    }
  }

  private static resetToIdle(): void {
    MatchPanel.phase = 'idle';
    MatchPanel.mode = null;
    MatchPanel.matchedAt = 0;
    MatchPanel.room = null;
    if (MatchPanel.opened) MatchPanel.rebuild();
  }

  private static onTick(): void {
    if (MatchPanel.opened && MatchPanel.phase === 'matching') MatchPanel.rebuild();
  }

  // ── 渲染 ───────────────────────────────────────────────────────────────

  private static rows(): MatchRow[] {
    const rows: MatchRow[] = [];
    rows.push({ text: '匹配（M 开关面板）', color: MP.titleColor });
    if (MatchPanel.phase === 'idle') {
      rows.push({ text: '—— 选择模式开始匹配 ——', color: MP.dimColor });
      MATCH_MODES.forEach((m, i) => {
        rows.push({
          text: `▸ ${matchModeLabel(m)}（${m}）　点击或按 ${i + 1}`,
          color: MP.lineColor,
          button: true,
          onClick: () => void MatchPanel.doJoin(m),
        });
      });
      return rows;
    }
    if (MatchPanel.phase === 'matching') {
      const secs = Math.max(0, Math.floor((Date.now() - MatchPanel.matchedAt) / 1000));
      rows.push({ text: `匹配中：${matchModeLabel(MatchPanel.mode ?? '')}（${MatchPanel.mode ?? ''}）`, color: MP.titleColor });
      rows.push({ text: `已等待 ${secs} 秒（同战力 ±20% 内配对）`, color: MP.warnColor });
      rows.push({ text: 'Esc 取消匹配', color: MP.dimColor });
      rows.push({
        text: '取消匹配（Esc）',
        color: MP.lineColor,
        button: true,
        onClick: () => void MatchPanel.doCancel(),
      });
      return rows;
    }
    const room = MatchPanel.room;
    if (!room) return rows;
    const myId = Session.playerId ?? '';
    rows.push({ text: `房间 ${room.id}`, color: MP.titleColor });
    rows.push({
      text: `模式：${matchModeLabel(room.mode)}　状态：${matchRoomStatusLabel(room.status)}`,
      color: room.status === 'in_progress' ? MP.okColor : MP.lineColor,
    });
    rows.push({ text: '—— 成员（R/1 准备，Esc 离开）——', color: MP.dimColor });
    for (const p of room.players) {
      const me = String(p.playerId) === String(myId);
      rows.push({
        text: formatMatchMemberLine(p, myId),
        color: me ? MP.titleColor : p.ready ? MP.okColor : MP.lineColor,
        bg: me ? MP.selectedBgColor : undefined,
      });
    }
    const meReady = room.players.some((p) => String(p.playerId) === String(myId) && p.ready);
    if (room.status !== 'in_progress') {
      rows.push(
        meReady
          ? { text: '✔ 已准备，等待其他玩家…', color: MP.okColor }
          : { text: '准备（R）', color: MP.okColor, button: true, onClick: () => void MatchPanel.doReady() },
      );
    }
    rows.push({
      text: '离开房间（Esc）',
      color: MP.warnColor,
      button: true,
      onClick: () => void MatchPanel.doLeave(),
    });
    return rows;
  }

  private static rebuild(): void {
    const root = MatchPanel.root;
    if (!root || !MatchPanel.opened) return;
    root.removeChildren();

    const rows = MatchPanel.rows();
    let contentH = 0;
    for (const row of rows) contentH += row.button ? MP.buttonHeight + 4 : MP.lineHeight;
    const rect = matchPanelRect(AppConfig.stageWidth, AppConfig.stageHeight, contentH);

    const bg = new Laya.Sprite();
    bg.mouseEnabled = false;
    bg.graphics.drawRect(rect.x, rect.y, rect.w, rect.h, MP.bgColor);
    bg.graphics.drawRect(rect.x, rect.y, rect.w, MP.borderWidth, MP.borderColor);
    root.addChild(bg);

    const contentX = rect.x + MP.padX;
    const contentW = rect.w - MP.padX * 2;
    let y = rect.y + MP.padY;
    for (const row of rows) {
      const h = row.button ? MP.buttonHeight : MP.lineHeight;
      if (row.bg) {
        const hl = new Laya.Sprite();
        hl.mouseEnabled = false;
        hl.graphics.drawRect(contentX, y, contentW, h, row.bg);
        root.addChild(hl);
      }
      if (row.button) {
        const btn = new Laya.Sprite();
        btn.mouseEnabled = false;
        btn.graphics.drawRect(contentX, y, contentW, h, MP.buttonBgColor);
        root.addChild(btn);
      }
      const textTop = row.button ? y + Math.round((h - MP.fontSize) / 2) : y + 3;
      root.addChild(MatchPanel.makeText(row.text, contentX, textTop, row.color));
      if (row.onClick) {
        // 命中区在视觉之后 addChild（引擎逆序命中，后加的盖过同行视觉，照 BuildPanel）；按下即响应
        const hit = new Laya.Sprite();
        hit.name = 'match-hit';
        hit.pos(contentX, y);
        hit.size(contentW, h);
        hit.mouseEnabled = true;
        hit.on(Laya.Event.MOUSE_DOWN, null, row.onClick);
        root.addChild(hit);
      }
      y += h + (row.button ? 4 : 0);
    }
  }

  private static makeText(content: string, x: number, y: number, color: string): Laya.Text {
    const text = new Laya.Text();
    text.text = content;
    text.fontSize = MP.fontSize;
    text.color = color;
    text.stroke = 2;
    text.strokeColor = '#000000';
    text.mouseEnabled = false;
    text.pos(x, y);
    return text;
  }
}
