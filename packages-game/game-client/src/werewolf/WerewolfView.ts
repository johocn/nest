import { AppConfig } from '../config/AppConfig';
import { Session } from '../net/Session';
import {
  WerewolfSync,
  PublicPlayerView,
  PrivatePlayerView,
  RoomMessage,
  RoomSnapshot,
} from './WerewolfClient';
import {
  playPhaseTransition,
  playDeath,
  revealCard,
  drawCountdownRing,
  drawBar,
  bannerPop,
  tween,
} from './effects';

const WW = AppConfig.werewolf;

/** 阶段总时长（与服务端 STEP_DURATION_MS 对应，仅用于倒计时环比例） */
const STEP_DURATION: Record<string, number> = {
  night_begin: 2500,
  night_wolf: 30000,
  night_seer: 30000,
  night_witch: 30000,
  night_guard: 30000,
  night_end: 3500,
  day_begin: 3500,
  day_discuss: 60000,
  day_vote: 30000,
  day_result: 4000,
  day_nominate: 20000,
  day_police_vote: 20000,
  day_badge_transfer: 15000,
  hunter_shoot: 15000,
};

interface SeatCard {
  root: Laya.Sprite;
  nameText: Laya.Text;
  roleText: Laya.Text;
  badge: Laya.Text;
  barG: Laya.Sprite;
}

/**
 * 狼人杀对局视图：环形座位桌 + 阶段横幅 + 倒计时环 + 行动面板。
 * 纯引擎内自绘（Laya.Sprite/Graphics/Text），复用 effects 的特效，对标主流狼人杀 App 的昼夜切换/死亡/翻牌表现。
 */
export class WerewolfView {
  private root = new Laya.Sprite();
  private bg = new Laya.Sprite();
  private seatsLayer = new Laya.Sprite();
  private banner = new Laya.Sprite();
  private bannerText = new Laya.Text();
  private ringG = new Laya.Sprite();
  private actionLayer = new Laya.Sprite();
  private transitionOverlay = new Laya.Sprite();
  private hint = new Laya.Text();
  private chatLayer = new Laya.Sprite();
  private chatTexts: Laya.Text[] = [];
  private input = new Laya.TextInput();
  private sendBtn = new Laya.Button();
  /** 已渲染过的最后一条发言序号（用于判断新消息、触发气泡） */
  private lastMsgSeq = 0;

  private cards = new Map<number, SeatCard>();
  private prevAlive = new Map<number, boolean>();
  private revealedRole = new Map<number, string>();
  private prevStep = '';
  private prevBannerStep = '';
  private wolfMode = false;
  private countdownRunning = false;
  private countdownEndsAt: number | null = null;
  private countdownTotal = 0;
  private sync: WerewolfSync | null = null;
  private client: {
    action: (p: Record<string, unknown>) => Promise<void>;
    say?: (text: string) => Promise<void>;
    wolfSay?: (text: string) => Promise<void>;
  } | null = null;

  mount(): void {
    this.root.name = 'werewolf-root';
    this.root.zOrder = WW.zOrder;

    // 桌面背景：暗色椭圆 + 中央"狼人杀"桌面感
    this.bg.graphics.drawRect(
      0,
      0,
      AppConfig.stageWidth,
      AppConfig.stageHeight,
      '#0e1116',
    );
    // drawEllipse 的 lineColor / lineWidth 为必填参数
    this.bg.graphics.drawEllipse(
      WW.tableCenterX - WW.tableRadiusX,
      WW.tableCenterY - WW.tableRadiusY,
      WW.tableRadiusX * 2,
      WW.tableRadiusY * 2,
      'rgba(30,36,48,0.6)',
      null,
      0,
    );
    this.root.addChild(this.bg);
    this.root.addChild(this.seatsLayer);

    // 顶部横幅
    this.bannerText.fontSize = WW.bannerFontSize;
    this.bannerText.color = WW.bannerColor;
    this.bannerText.bold = true;
    this.bannerText.pos(20, 14);
    this.banner.graphics.drawRect(0, 0, AppConfig.stageWidth, 56, WW.bannerBg);
    this.banner.addChild(this.bannerText);
    this.ringG.pos(AppConfig.stageWidth - 44, 28);
    this.banner.addChild(this.ringG);
    this.banner.zOrder = WW.bannerZOrder;
    this.root.addChild(this.banner);

    // 底部提示 + 行动面板
    this.hint.fontSize = 13;
    this.hint.color = '#8b949e';
    this.hint.pos(16, AppConfig.stageHeight - 40);
    this.root.addChild(this.hint);
    this.root.addChild(this.actionLayer);

    // 左侧发言面板 + 输入框
    this.chatLayer.pos(WW.chatX, WW.chatY);
    this.chatLayer.graphics.drawRect(0, 0, WW.chatW, WW.chatH, WW.chatBg);
    this.root.addChild(this.chatLayer);

    this.input.size(WW.chatW - 60, 30);
    this.input.pos(WW.chatX, WW.chatY + WW.chatH + 8);
    this.input.prompt = '输入发言…';
    this.input.fontSize = 13;
    this.input.color = '#e6edf3';
    this.input.on(Laya.Event.ENTER, this, () => this.sendSay());
    this.root.addChild(this.input);

    this.sendBtn.size(56, 30);
    this.sendBtn.pos(WW.chatX + WW.chatW - 56, WW.chatY + WW.chatH + 8);
    this.sendBtn.label = '发送';
    this.sendBtn.labelSize = 13;
    this.sendBtn.labelColors = '#ffffff,#ffffff,#ffffff';
    this.sendBtn.graphics.drawRect(0, 0, 56, 30, '#2f81f7');
    this.sendBtn.mouseEnabled = true;
    this.sendBtn.on(Laya.Event.CLICK, this, () => this.sendSay());
    this.root.addChild(this.sendBtn);

    // 转场覆盖层（最上，但默认透明）
    this.transitionOverlay.visible = false;
    this.transitionOverlay.zOrder = WW.zOrder + 50;
    this.root.addChild(this.transitionOverlay);

    Laya.stage.addChild(this.root);
  }

  unmount(): void {
    this.stopCountdown();
    this.root.removeSelf();
    this.cards.clear();
    this.prevAlive.clear();
    this.revealedRole.clear();
    this.chatTexts = [];
    this.lastMsgSeq = 0;
  }

  render(sync: WerewolfSync): void {
    this.sync = sync;
    const pub = sync.public;
    const priv = sync.private;
    const selfId = String(Session.playerId);

    // 座位数量变化 → 重建
    if (this.cards.size !== pub.players.length) this.buildSeats(pub.players);

    // 昼夜转场
    const newIsNight = pub.step.startsWith('night');
    const prevIsNight = this.prevStep.startsWith('night');
    if (this.prevStep && newIsNight !== prevIsNight) {
      playPhaseTransition(this.transitionOverlay, newIsNight ? 'night' : 'day');
    }
    this.prevStep = pub.step;

    // 更新每个座位
    for (const p of pub.players) {
      const card = this.cards.get(p.seat);
      if (!card) continue;
      card.nameText.text =
        p.name + (p.isHost ? ' (房主)' : '') + (p.police ? ' ★' : '');

      // 死亡触发特效（仅当状态刚翻转）
      const wasAlive = this.prevAlive.get(p.seat);
      if (wasAlive === true && !p.alive) {
        playDeath(card.root, () => this.revealedRole.set(p.seat, p.role ?? ''));
      }
      this.prevAlive.set(p.seat, p.alive);

      // 身份揭示：自己始终可见；死亡或终局公开
      const knownRole =
        String(p.seat) === this.selfSeat(priv) || this.revealedRole.has(p.seat)
          ? p.role
          : null;
      if (knownRole) {
        const color = (WW.roleColors as any)[knownRole] ?? '#ffffff';
        card.roleText.text = roleName(knownRole);
        card.roleText.color = color;
      } else {
        card.roleText.text = p.alive ? '？' : '出局';
        card.roleText.color = p.alive ? '#8b949e' : '#5b636e';
      }

      // 票数/行动进度徽标
      const votes = pub.tally[p.seat] ?? 0;
      card.badge.text = votes > 0 ? `票 ${votes}` : '';
      drawBar(
        card.barG,
        WW.seatCardW - 16,
        5,
        votes / Math.max(1, maxTally(pub.tally)),
        '#e5484d',
      );

      // 自己高亮描边
      card.root.graphics.clear();
      const border =
        String(p.seat) === this.selfSeat(priv)
          ? '#ffd75e'
          : 'rgba(255,255,255,0.18)';
      card.root.graphics.drawRect(
        0,
        0,
        WW.seatCardW,
        WW.seatCardH,
        'rgba(18,22,30,0.92)',
      );
      card.root.graphics.drawRect(
        0,
        0,
        WW.seatCardW,
        WW.seatCardH,
        null,
        border,
        2,
      );
    }

    // 横幅（仅在阶段切换时弹出）
    this.bannerText.text = `第 ${pub.cycle} 夜 · ${stepLabel(pub.step)}`;
    if (this.prevBannerStep !== pub.step) {
      this.prevBannerStep = pub.step;
      bannerPop(this.banner);
    }

    // 提示
    const sayHint = priv.canSpeak
      ? '（可发言）'
      : priv.canLastWords
        ? '（可留遗言）'
        : '';
    this.hint.text =
      pub.message + sayHint + (priv.lastError ? `  ⚠ ${priv.lastError}` : '');

    // 行动面板
    this.renderActions(priv);

    // 狼人频道模式：狼人且处于夜晚（或有狼频道消息）时，聊天面板与输入框走狼频道
    const isWolf = priv.role === 'werewolf';
    this.wolfMode =
      isWolf &&
      (pub.step.startsWith('night') || (priv.wolfMessages?.length ?? 0) > 0);
    this.input.prompt = this.wolfMode ? '狼人频道：输入…' : '输入发言…';

    // 发言面板与输入框可用状态
    this.renderChat(pub);
    const canSay = this.wolfMode
      ? !!priv.canWolfSpeak
      : !!priv.canSpeak || !!priv.canLastWords;
    this.input.editable = canSay;
    this.sendBtn.alpha = canSay ? 1 : 0.4;

    // 倒计时环
    this.startCountdown(pub.phaseEndsAt, STEP_DURATION[pub.step] ?? 0);

    // 终局：揭示全部身份
    if (pub.step === 'game_over') {
      for (const p of pub.players) this.revealedRole.set(p.seat, p.role ?? '');
    }
  }

  private selfSeat(priv: PrivatePlayerView): string {
    return String(priv.seat);
  }

  private buildSeats(players: PublicPlayerView[]): void {
    this.seatsLayer.removeChildren();
    this.cards.clear();
    const n = players.length;
    players.forEach((p, i) => {
      const ang = (-90 + (360 / n) * i) * (Math.PI / 180);
      const x = WW.tableCenterX + WW.tableRadiusX * Math.cos(ang);
      const y = WW.tableCenterY + WW.tableRadiusY * Math.sin(ang);

      const root = new Laya.Sprite();
      root.size(WW.seatCardW, WW.seatCardH);
      root.pos(x - WW.seatCardW / 2, y - WW.seatCardH / 2);

      const nameText = new Laya.Text();
      nameText.fontSize = 13;
      nameText.color = '#e6edf3';
      nameText.pos(8, 6);
      root.addChild(nameText);

      const roleText = new Laya.Text();
      roleText.fontSize = 16;
      roleText.bold = true;
      roleText.pos(8, 28);
      root.addChild(roleText);

      const badge = new Laya.Text();
      badge.fontSize = 12;
      badge.color = '#ffd75e';
      badge.pos(8, WW.seatCardH - 22);
      root.addChild(badge);

      const barG = new Laya.Sprite();
      barG.pos(8, WW.seatCardH - 8);
      root.addChild(barG);

      this.seatsLayer.addChild(root);
      this.cards.set(p.seat, { root, nameText, roleText, badge, barG });
    });
  }

  private renderActions(priv: PrivatePlayerView): void {
    this.actionLayer.removeChildren();
    if (
      !priv.canAct &&
      !(priv.witchTonightKill != null && priv.role === 'witch')
    ) {
      return;
    }
    const y = AppConfig.stageHeight - 96;
    // 同样用 Laya.Button，保证行动按钮（狼刀/投票/毒药/开枪）点得动
    const mkBtn = (
      label: string,
      color: string,
      onClick: () => void,
    ): Laya.Sprite => {
      const b = new Laya.Button();
      b.size(88, 34);
      b.label = label;
      b.labelSize = 13;
      b.labelBold = true;
      b.labelColors = '#ffffff,#ffffff,#ffffff';
      b.graphics.drawRect(0, 0, 88, 34, color);
      b.mouseEnabled = true;
      b.on(Laya.Event.CLICK, b, onClick);
      return b;
    };

    const sync = this.sync!;
    const names = (seat: number) =>
      sync.public.players.find(p => p.seat === seat)?.name ?? `#${seat}`;
    let x = 16;
    const place = (b: Laya.Sprite) => {
      b.pos(x, y);
      this.actionLayer.addChild(b);
      x += 96;
    };

    // 警长竞选 / 选警长 / 移交警徽
    const step = (sync.public as any).step as string;
    if (step === 'day_nominate') {
      place(mkBtn('上警', '#2f81f7', () => this.act({ claimPolice: true })));
      place(
        mkBtn('不上警', 'rgba(255,255,255,0.12)', () =>
          this.act({ claimPolice: false }),
        ),
      );
      return;
    }
    if (step === 'day_police_vote') {
      for (const seat of priv.legalTargets) {
        place(
          mkBtn(names(seat), '#2f81f7', () => this.act({ votePolice: seat })),
        );
      }
      place(
        mkBtn('弃票', 'rgba(255,255,255,0.12)', () =>
          this.act({ votePolice: -1 }),
        ),
      );
      return;
    }
    if (step === 'day_badge_transfer') {
      for (const seat of priv.legalTargets) {
        place(
          mkBtn(names(seat), '#ffd75e', () => this.act({ badgeTarget: seat })),
        );
      }
      place(
        mkBtn('撕徽', 'rgba(255,255,255,0.12)', () =>
          this.act({ badgeTarget: -1 }),
        ),
      );
      return;
    }

    if (priv.role === 'witch' && priv.witchTonightKill != null) {
      // 女巫：先用解药救狼刀目标，或选毒药目标
      if (priv.witchHasAntidote) {
        place(
          mkBtn(`解药救${names(priv.witchTonightKill)}`, '#3fb950', () =>
            this.act({ useAntidote: true }),
          ),
        );
      }
      if (priv.witchHasPoison) {
        for (const seat of priv.legalTargets) {
          place(
            mkBtn(`毒${names(seat)}`, '#a371f7', () =>
              this.act({ usePoison: true, targetSeat: seat }),
            ),
          );
        }
      }
      place(mkBtn('跳过', 'rgba(255,255,255,0.12)', () => this.act({})));
      return;
    }

    // 目标型行动（狼刀/查验/守卫/投票/猎人）
    const targets = priv.hunterMayShoot
      ? priv.hunterTargets
      : priv.legalTargets;
    for (const seat of targets) {
      place(
        mkBtn(names(seat), '#2f81f7', () => this.act({ targetSeat: seat })),
      );
    }
  }

  setClient(client: {
    action: (p: Record<string, unknown>) => Promise<void>;
  }): void {
    this.client = client;
  }

  private act(payload: Record<string, unknown>): void {
    if (!this.sync || !this.client) return;
    this.client.action(payload);
  }

  /** 渲染左侧发言面板，并为新消息在座位上方弹气泡 */
  private renderChat(pub: RoomSnapshot): void {
    const wolfMsgs = this.sync?.private.wolfMessages ?? [];
    const msgs: RoomMessage[] = this.wolfMode ? wolfMsgs : (pub.messages ?? []);
    for (const m of msgs) {
      if (m.seq > this.lastMsgSeq) {
        this.lastMsgSeq = m.seq;
        if (m.kind !== 'system') this.showBubble(m.seat, m.text);
      }
    }

    const lines = msgs.slice(-WW.chatMaxLines);
    while (this.chatTexts.length < lines.length) {
      const t = new Laya.Text();
      t.fontSize = 12;
      t.width = WW.chatW - 16;
      this.chatTexts.push(t);
      this.chatLayer.addChild(t);
    }
    this.chatTexts.forEach((t, i) => {
      const m = lines[i];
      if (!m) {
        t.visible = false;
        return;
      }
      t.visible = true;
      t.pos(8, 8 + i * 22);
      const body = m.text.length > 22 ? `${m.text.slice(0, 22)}…` : m.text;
      const prefix = m.kind === 'system' ? '' : `${m.seat + 1}号 `;
      const wolfTag = this.wolfMode ? '【狼】' : '';
      t.text =
        m.kind === 'system'
          ? `${m.name} ${body}`
          : `${wolfTag}${prefix}${m.name}：${body}`;
      t.color =
        m.kind === 'system'
          ? '#8b949e'
          : m.kind === 'lastwords'
            ? '#f0883e'
            : '#c9d1d9';
    });
  }

  /** 座位上方的发言气泡：淡入 → 停留 → 淡出移除 */
  private showBubble(seat: number, text: string): void {
    const card = this.cards.get(seat);
    if (!card) return;
    const body = text.length > 16 ? `${text.slice(0, 16)}…` : text;
    const bubble = new Laya.Sprite();
    const t = new Laya.Text();
    t.text = body;
    t.fontSize = 12;
    t.color = '#0b0e13';
    t.pos(6, 5);
    bubble.addChild(t);
    // 按字数估算宽度，避免依赖 Text 自动测量的返回值
    const w = Math.max(44, body.length * 12 + 12);
    bubble.graphics.drawRect(0, 0, w, 24, '#ffd75e');
    bubble.pos(card.root.x, card.root.y - 26);
    bubble.alpha = 0;
    this.seatsLayer.addChild(bubble);
    tween(bubble, { alpha: 1 }, 160);
    Laya.timer.once(WW.bubbleMs, null, () => {
      tween(bubble, { alpha: 0 }, 240, () => bubble.removeSelf());
    });
  }

  private sendSay(): void {
    const text = (this.input.text ?? '').trim();
    if (!text || !this.client) return;
    this.input.text = '';
    if (this.wolfMode && this.client.wolfSay) {
      this.client.wolfSay(text).catch(() => undefined);
    } else if (this.client.say) {
      this.client.say(text).catch(() => undefined);
    }
  }

  private startCountdown(endsAt: number | null, total: number): void {
    this.stopCountdown();
    if (!endsAt || !total) {
      drawCountdownRing(this.ringG, 0);
      return;
    }
    this.countdownEndsAt = endsAt;
    this.countdownTotal = total;
    this.countdownRunning = true;
    this.onCountdownTick();
    // Laya Timer 只能按 caller+method 清除，不返回数字 id
    Laya.timer.loop(200, this, this.onCountdownTick);
  }

  private stopCountdown(): void {
    if (!this.countdownRunning) return;
    Laya.timer.clear(this, this.onCountdownTick);
    this.countdownRunning = false;
  }

  private onCountdownTick(): void {
    const endsAt = this.countdownEndsAt;
    const total = this.countdownTotal;
    if (!endsAt || !total) return;
    const left = endsAt - Date.now();
    drawCountdownRing(this.ringG, total > 0 ? left / total : 0);
    if (left <= 0) this.stopCountdown();
  }
}

function roleName(role: string): string {
  return (
    (
      {
        werewolf: '狼人',
        seer: '预言家',
        witch: '女巫',
        hunter: '猎人',
        guard: '守卫',
        villager: '平民',
      } as Record<string, string>
    )[role] ?? role
  );
}

function stepLabel(step: string): string {
  return (
    (
      {
        lobby: '等待开局',
        night_begin: '夜幕降临',
        night_wolf: '狼人行动',
        night_seer: '预言家查验',
        night_witch: '女巫用药',
        night_guard: '守卫守护',
        night_end: '天亮了',
        day_begin: '白天公布',
        day_discuss: '自由发言',
        day_nominate: '警长竞选',
        day_police_vote: '选举警长',
        day_vote: '投票放逐',
        day_result: '结果揭晓',
        day_badge_transfer: '移交警徽',
        hunter_shoot: '猎人开枪',
        game_over: '游戏结束',
      } as Record<string, string>
    )[step] ?? step
  );
}

function maxTally(tally: Record<number, number>): number {
  let m = 0;
  for (const v of Object.values(tally)) m = Math.max(m, v);
  return m;
}
