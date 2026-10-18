import { SandboxGame } from './core/SandboxGame';
import { MarketDataLoader } from './core/MarketDataLoader';
import { SandboxScene3D } from './scene/SandboxScene3D';
import {
  GameConfig,
  SliceInfo,
  AssetType,
  GameLevel,
  GameSummary,
  DEFAULT_LEVEL,
  SCENARIOS,
  DEFAULT_SCENARIO,
  DcaPlan,
} from './config/GameConfig';
import { SummaryPanel } from './ui/SummaryPanel';
import { MissionPanel } from './ui/MissionPanel';
import { ProgressStore } from './core/ProgressStore';
import { IntroOverlay } from './ui/IntroOverlay';
import { KnowledgeCard } from './ui/KnowledgeCard';
import { buildShareQuery } from './core/ShareLink';
import {
  LeaderboardClient,
  submissionFromSummary,
  LeaderboardQuery,
  ScoreSubmission,
  SubmitResponse,
} from './core/Leaderboard';
import { LeaderboardPanel } from './ui/LeaderboardPanel';

/** 沙盘游戏入口 */
class SandboxApp {
  private _game: SandboxGame;
  private _scene: SandboxScene3D | null = null;
  private _container: HTMLElement;
  private _summary = new SummaryPanel();
  private _knowledge = new KnowledgeCard();
  private _selected: AssetType = 'fund';
  private _amount = 10000;
  private _toastEl: HTMLElement | null = null;
  private _assetButtons = new Map<AssetType, HTMLButtonElement>();
  /** 资产配置（含买入/赎回动词，供按钮标签与快捷键用） */
  private _assetCfg: {
    type: AssetType;
    label: string;
    color: string;
    buy: string;
    sell: string;
  }[] = [];
  private _pauseBtn: HTMLButtonElement | null = null;
  private _dcaBtn: HTMLButtonElement | null = null;
  private _shareBtn: HTMLButtonElement | null = null;
  private _leaderboardBtn: HTMLButtonElement | null = null;
  private _missionPanel: MissionPanel | null = null;
  /** 排行榜客户端与浮层 */
  private _leaderboard = new LeaderboardClient();
  private _leaderboardPanel = new LeaderboardPanel();
  /** 最近一次提交成功的条目 id（用于在榜单中高亮「我」） */
  private _lastEntryId: string | null = null;
  /** 玩家昵称（localStorage 记忆，用于排行榜留名） */
  private get _playerName(): string {
    try {
      return localStorage.getItem('financial-sandbox/player-name') || '同学';
    } catch {
      return '同学';
    }
  }
  private set _playerName(v: string) {
    try {
      localStorage.setItem('financial-sandbox/player-name', v);
    } catch {
      /* 忽略 */
    }
  }
  private _intro!: IntroOverlay;
  private _store = new ProgressStore();
  private _controlPanel: HTMLElement | null = null;
  private _panelChildren: {
    labels: HTMLElement[];
    assetRow: HTMLElement;
    amountInput: HTMLInputElement;
    quickRow: HTMLElement;
    actionRow: HTMLElement;
    speedRow: HTMLElement;
    ctrlRow: HTMLElement;
    actions: HTMLElement[];
    buyBtn: HTMLButtonElement;
    sellBtn: HTMLButtonElement;
  } | null = null;
  /** 窄屏（手机竖屏）布局标记 */
  private _compact = false;
  /** 当前是否走后端行情（?backend=1），分享链接需带上以便同学复现同一份行情 */
  private _useBackend = false;

  constructor(
    seed: number,
    presetData?: import('./config/GameConfig').MarketDataItem[],
    useBackend = false,
  ) {
    this._useBackend = useBackend;
    const level = this._readLevel();
    const scenario = this._readScenario();
    this._game = new SandboxGame(seed, level, scenario, presetData);
    const dca = this._readDca();
    if (dca) this._game.setDca(dca);
    this._container = document.getElementById('game-container')!;
    this._compact = window.innerWidth < 720;
    this._intro = new IntroOverlay(this._container, level, scenario);
    this._initUI();
    // 窗口尺寸变化（横竖屏切换 / 桌面缩放）→ 重排布局
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => this._applyLayout(), 180);
    });
    // 键盘快捷键（输入框/按钮聚焦或浮层打开时不拦截）
    window.addEventListener('keydown', (e) => this._onKey(e));
    // 点击资产单元格（data-guide）打开百科知识卡
    this._container.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement | null)?.closest(
        '[data-guide]',
      ) as HTMLElement | null;
      const type = t?.getAttribute('data-guide') as AssetType | null;
      if (type) this._knowledge.show(type);
    });
  }

  /** 键盘快捷键：1-4 选资产 / B 买入 / S 赎回 / 空格 暂停继续 / Esc 关成绩单 / ? 玩法说明 */
  private _onKey(e: KeyboardEvent): void {
    // Esc 始终用于关闭浮层（不受焦点守卫影响）
    if (e.key === 'Escape') {
      if (this._knowledge.isOpen) this._knowledge.hide();
      else if (this._summary.isOpen) this._summary.hide();
      return;
    }
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'BUTTON')
    )
      return;
    const overlayOpen = !!document.querySelector(
      '.intro-overlay, .tour-overlay, .knowledge-card',
    );
    if (overlayOpen) return;
    if (e.key === ' ') {
      e.preventDefault();
      this._togglePause();
      return;
    }
    if (e.key === '?' || e.key === '/') {
      this._intro.show(() => {}, { force: true, review: true });
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'b') {
      void this._buy();
      return;
    }
    if (k === 's') {
      void this._sell();
      return;
    }
    const idx = ['1', '2', '3', '4'].indexOf(e.key);
    if (idx >= 0 && this._assetCfg[idx])
      this._selectAsset(this._assetCfg[idx].type);
  }

  /** 切换暂停 / 继续 */
  private _togglePause(): void {
    if (this._game.isPaused) {
      this._game.resume();
      if (this._pauseBtn) this._pauseBtn.textContent = '⏸ 暂停';
    } else {
      this._game.pause();
      if (this._pauseBtn) this._pauseBtn.textContent = '▶ 继续';
    }
  }

  /** 切换定投计划开关 */
  private _toggleDca(): void {
    this.setDca({ enabled: !this._game.dca.enabled });
    this._syncUrl();
    const d = this._game.dca;
    this._toast(
      d.enabled
        ? `定投已开启：每 ${d.intervalDays} 个交易日 ${this._verbOf(d.asset, 'buy')}${this._nameOf(d.asset)} ¥${d.amount}`
        : '定投已关闭',
    );
  }

  /** 设置定投计划并刷新按钮 */
  private setDca(partial: Partial<DcaPlan>): void {
    this._game.setDca(partial);
    this._paintDcaBtn();
  }

  private _paintDcaBtn(): void {
    if (!this._dcaBtn) return;
    const d = this._game.dca;
    this._dcaBtn.textContent = d.enabled ? `定投 ${d.intervalDays}日` : '定投';
    this._dcaBtn.style.cssText = this._chipCss('#fdcb6e', d.enabled);
  }

  /** 从 URL ?level= 或存档读取难度档位 */
  private _readLevel(): GameLevel {
    try {
      const p = new URLSearchParams(location.search).get('level');
      if (p === 'conservative' || p === 'balanced' || p === 'aggressive')
        return p;
      return this._store.data.lastLevel || DEFAULT_LEVEL;
    } catch {
      return DEFAULT_LEVEL;
    }
  }

  /** 从 URL ?scenario= 读取行情情景 id */
  private _readScenario(): string {
    try {
      const p = new URLSearchParams(location.search).get('scenario');
      return p && SCENARIOS.some((s) => s.id === p) ? p : DEFAULT_SCENARIO;
    } catch {
      return DEFAULT_SCENARIO;
    }
  }

  /** 从 URL ?dca= 读取定投计划：`on`（默认参数）或 `amount:interval:asset` */
  private _readDca(): Partial<DcaPlan> | null {
    try {
      const raw = new URLSearchParams(location.search).get('dca');
      if (!raw) return null;
      if (raw === 'on' || raw === '1') return { enabled: true };
      const [amount, interval, asset] = raw.split(':');
      const plan: Partial<DcaPlan> = { enabled: true };
      const a = Number(amount);
      if (Number.isFinite(a) && a > 0) plan.amount = a;
      const iv = Number(interval);
      if (Number.isFinite(iv) && iv >= 1) plan.intervalDays = Math.floor(iv);
      if (
        asset === 'deposit' ||
        asset === 'cash_mgmt' ||
        asset === 'closed_fund' ||
        asset === 'fund'
      ) {
        plan.asset = asset;
      }
      return plan;
    } catch {
      return null;
    }
  }

  private async _initUI(): Promise<void> {
    // 创建场景（WebGL 不可用时降级提示，不白屏）
    try {
      this._scene = new SandboxScene3D(this._container, this._game);
      await this._scene.init();
    } catch (e) {
      console.error('[场景] 3D 初始化失败：', e);
      this._showFatalError('3D 场景初始化失败，请确认浏览器已启用 WebGL');
      return;
    }

    this._hideLoadingScreen();
    this._mountControlPanel();
    this._mountMissionPanel();
    this._mountToast();

    // 状态变化日志
    this._game.stateMachine.subscribe((t) => {
      console.log(`[状态] ${t.from} → ${t.to}: ${t.reason}`);
    });

    // 切片推进 → 刷新 HUD
    this._game.sliceEngine.onSliceTick(() => this._refresh());

    // 休市日 → 刷新 HUD
    this._game.onHoliday((date) => {
      console.log(`[休市] ${date}`);
      this._refresh();
    });

    // 行情回放走完 → 存档 + 结算成绩单
    this._game.onFinish((summary) => {
      console.log('[结算]', summary);
      const doneIds = this._game.missions
        .getStatuses()
        .filter((s) => s.done)
        .map((s) => s.def.id);
      const curve = this._game.equityCurve.map((p) => ({
        date: p.date,
        total: p.total,
      }));
      const prevBest = this._store.data.best; // 上一局最佳（本局对比基准）
      const { isNewBest } = this._store.save(
        summary,
        doneIds,
        summary.level,
        curve,
      );
      this._store.recordRun(summary); // 记录近局轨迹（成长对比）
      // 自动上传成绩到后端排行榜（失败仅静默降级，不影响结算）
      void this._submitScoreFromSummary(summary);
      if (isNewBest) {
        this._toast(
          `🏆 新纪录：${(summary.totalReturnRate * 100).toFixed(2)}%（${summary.rating}）`,
        );
      }
      this._refresh();
      this._summary.show(
        summary,
        () => {
          void this._restart();
        },
        this._store.data,
        () => this._exportReplay(),
        prevBest,
        this._store.data.runs,
      );
    });

    this._game.setSpeed(this._readSpeed());

    this._refresh();
    this._maybeStart();
  }

  /** 首启展示新手引导；否则直接进入盘面 */
  private _maybeStart(): void {
    if (!this._intro.seen) {
      this._intro.show((level: GameLevel, scenarioId: string) => {
        this._game.setLevel(level);
        this._game.setScenario(scenarioId);
        this._syncUrl();
        void this._game.start();
      });
    } else {
      void this._game.start();
    }
    this._toastScenarioNote();
  }

  /** 开局弹出当前行情情景的科普背景 */
  private _toastScenarioNote(): void {
    try {
      const def = this._game.scenario;
      if (def && def.note) {
        this._toast(`行情背景 · ${def.name}：${def.note}`);
      }
    } catch {
      /* 忽略 */
    }
  }

  /** 把当前难度/情景/定投/后端行情开关写回 URL（便于分享/复现同一局行情） */
  private _syncUrl(): void {
    try {
      const d = this._game.dca;
      const q = buildShareQuery({
        level: this._game.level,
        scenarioId: this._game.scenario.id,
        dca: d.enabled ? d : undefined,
        useBackend: this._useBackend,
      });
      const u = new URL(location.href);
      u.search = q ? `?${q}` : '';
      history.replaceState(null, '', u.toString());
    } catch {
      /* 忽略 */
    }
  }

  /** 复制课堂链接：把当前难度/情景/定投同步到 URL 并复制到剪贴板 */
  private async _copyClassroomLink(): Promise<void> {
    this._syncUrl();
    const url = location.href;
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        ok = true;
      } catch {
        ok = false;
      }
    }
    this._toast(
      ok ? '已复制课堂链接，发给同学一起玩同一局行情' : `课堂链接：\n${url}`,
    );
  }

  /** 打开排行榜浮层（按范围拉取榜单） */
  private _showLeaderboard(): void {
    this._leaderboardPanel.show({
      currentName: this._playerName,
      lastId: this._lastEntryId,
      fetchEntries: (q: LeaderboardQuery) => this._fetchEntries(q),
      submitCurrent: (name: string) => this._submitCurrent(name),
    });
  }

  /** 拉取榜单：按范围自动带入当前情景 / 难度 */
  private async _fetchEntries(q: LeaderboardQuery) {
    const query: LeaderboardQuery = { ...q };
    if (q.scope === 'scenario') query.scenario = this._game.scenario.id;
    if (q.scope === 'level') query.level = this._game.level;
    return this._leaderboard.fetchLeaderboard(query);
  }

  /** 用昵称提交当前成绩单（面板「提交我的成绩」） */
  private async _submitCurrent(name: string): Promise<void> {
    this._playerName = name;
    const sub = submissionFromSummary(
      this._game.getSummary(),
      name,
      this._game.dataLoader.seed,
    );
    await this._submitScore(sub);
  }

  /** 结算时自动上传（用已记忆昵称） */
  private async _submitScoreFromSummary(summary: GameSummary): Promise<void> {
    const sub = submissionFromSummary(
      summary,
      this._playerName,
      this._game.dataLoader.seed,
    );
    await this._submitScore(sub);
  }

  /** 提交一局成绩到后端，成功记住 id 并提示排名；失败静默降级。返回后端响应供调试出口使用 */
  private async _submitScore(sub: ScoreSubmission): Promise<SubmitResponse> {
    const res = await this._leaderboard.submitScore(sub);
    if (res.ok) {
      this._lastEntryId = res.entry.id;
      const sign = sub.returnRate >= 0 ? '+' : '';
      this._toast(
        `成绩已上榜：全量第 ${res.rank} 名（${sign}${(sub.returnRate * 100).toFixed(2)}%）`,
      );
    }
    // 网络/后端不可用时静默降级，不打扰结算体验
    return res;
  }

  /** 隐藏加载遮罩 */
  private _hideLoadingScreen(): void {
    const loading = document.getElementById('loading-screen');
    if (!loading) return;
    loading.style.opacity = '0';
    setTimeout(() => loading.remove(), 500);
  }

  /** 致命错误提示（替代加载遮罩） */
  private _showFatalError(msg: string): void {
    this._hideLoadingScreen();
    const box = document.createElement('div');
    box.style.cssText = `
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 10px; text-align: center;
      color: #fff; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    `;
    box.innerHTML = `
      <div style="font-size:40px;opacity:0.6;">🏦</div>
      <div style="font-size:15px;">${msg}</div>
      <div style="font-size:12px;opacity:0.5;">核心行情与资产计算仍可通过 window.__sandbox 访问</div>
    `;
    this._container.appendChild(box);
  }

  private _mountToast(): void {
    const toast = document.createElement('div');
    toast.className = 'sandbox-toast';
    toast.style.cssText = `
      position: absolute; top: ${this._compact ? 150 : 110}px; left: 50%;
      transform: translateX(-50%) translateY(-8px);
      background: rgba(0,0,0,0.78); color: #fff; font-size: 12px; padding: 8px 16px;
      border-radius: 8px; border: 1px solid rgba(255,255,255,0.12);
      opacity: 0; transition: opacity .25s, transform .25s; pointer-events: none; z-index: 20;
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
    `;
    this._container.appendChild(toast);
    this._toastEl = toast;
  }

  /** 导出复盘报告 CSV（触发浏览器下载） */
  private _exportReplay(): void {
    const csv = this._game.exportReplayCsv();
    const name = `sandbox-replay-s${this._game.dataLoader.seed}-${this._game.scenario.id}.csv`;
    this._download(name, csv);
    this._toast('已导出复盘 CSV');
  }

  /** 通用文件下载（加 BOM 便于 Excel 识别中文） */
  private _download(filename: string, content: string): void {
    const blob = new Blob([`\ufeff${content}`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private _toast(msg: string, warn = false): void {
    if (!this._toastEl) return;
    this._toastEl.textContent = msg;
    this._toastEl.style.borderColor = warn
      ? 'rgba(255,107,107,0.7)'
      : 'rgba(255,255,255,0.12)';
    this._toastEl.style.color = warn ? '#ffd3d3' : '#fff';
    this._toastEl.style.opacity = '1';
    this._toastEl.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout((this._toastEl as any)._timer);
    (this._toastEl as any)._timer = setTimeout(() => {
      if (!this._toastEl) return;
      this._toastEl.style.opacity = '0';
      this._toastEl.style.transform = 'translateX(-50%) translateY(-8px)';
    }, 1800);
  }

  /** 右侧操作面板 */
  private _mountControlPanel(): void {
    const panel = document.createElement('div');
    panel.className = 'control-panel';
    const font =
      'font-family: -apple-system, "PingFang SC", "Microsoft YaHei", Arial, sans-serif;';
    // 手机竖屏：改为底部横向操作条；桌面：右侧纵向面板
    panel.style.cssText = this._compact
      ? `
      position: absolute; left: 8px; right: 8px; bottom: 96px; top: auto; transform: none;
      display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; z-index: 12;
      background: rgba(0,0,0,0.62); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px; padding: 10px; backdrop-filter: blur(8px); ${font}
    `
      : `
      position: absolute; right: 16px; top: 50%; transform: translateY(-50%);
      width: 190px; display: flex; flex-direction: column; gap: 10px; z-index: 10;
      background: rgba(0,0,0,0.62); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 14px; padding: 12px; backdrop-filter: blur(8px); ${font}
    `;

    const assets: {
      type: AssetType;
      label: string;
      color: string;
      buy: string;
      sell: string;
    }[] = [
      {
        type: 'deposit',
        label: '存款',
        color: '#00b894',
        buy: '存入',
        sell: '取出',
      },
      {
        type: 'cash_mgmt',
        label: '现金理财',
        color: '#00cec9',
        buy: '申购',
        sell: '赎回',
      },
      {
        type: 'closed_fund',
        label: '封闭理财',
        color: '#6c5ce7',
        buy: '申购',
        sell: '赎回',
      },
      {
        type: 'fund',
        label: '基金',
        color: '#e17055',
        buy: '买入',
        sell: '卖出',
      },
    ];
    this._assetCfg = assets;

    // 资产选择
    const assetRow = document.createElement('div');
    assetRow.style.cssText =
      'display:grid;grid-template-columns:1fr 1fr;gap:6px;';
    for (const a of assets) {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.dataset.asset = a.type;
      btn.style.cssText = this._chipCss(a.color, this._selected === a.type);
      btn.onclick = () => this._selectAsset(a.type);
      this._assetButtons.set(a.type, btn);
      assetRow.appendChild(btn);
    }

    // 金额输入
    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.min = '0';
    amountInput.step = '1000';
    amountInput.value = String(this._amount);
    amountInput.style.cssText = `
      width: 100%; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
      color: #fff; border-radius: 8px; padding: 7px 9px; font-size: 13px; outline: none;
    `;
    amountInput.oninput = () => {
      const v = Number(amountInput.value);
      this._amount = Number.isFinite(v) ? Math.max(0, v) : 0;
    };

    const quickRow = document.createElement('div');
    quickRow.style.cssText = 'display:flex;gap:5px;';
    for (const v of [5000, 10000, 50000]) {
      const q = document.createElement('button');
      q.textContent = v >= 10000 ? `${v / 10000}万` : `${v / 1000}千`;
      q.style.cssText = `
        flex:1; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.75);
        border: none; border-radius: 6px; padding: 5px 0; font-size: 11px; cursor: pointer;
      `;
      q.onclick = () => this._setAmount(v);
      quickRow.appendChild(q);
    }
    // 全部（按可投入现金填入）
    const allBtn = document.createElement('button');
    allBtn.textContent = '全部';
    allBtn.dataset.quick = 'all';
    allBtn.style.cssText = `
      flex:1; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.75);
      border: none; border-radius: 6px; padding: 5px 0; font-size: 11px; cursor: pointer;
    `;
    allBtn.onclick = () => this._setAmount(this._game.cash);
    quickRow.appendChild(allBtn);

    // 买入 / 赎回
    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display:flex;gap:6px;';

    const buyBtn = document.createElement('button');
    buyBtn.textContent = '买入';
    buyBtn.style.cssText = this._primaryCss('#00b894');
    buyBtn.onclick = () => this._buy();

    const sellBtn = document.createElement('button');
    sellBtn.textContent = '赎回';
    sellBtn.style.cssText = this._primaryCss('#ff6b6b');
    sellBtn.onclick = () => this._sell();

    actionRow.appendChild(buyBtn);
    actionRow.appendChild(sellBtn);

    // 速度 / 暂停 / 重置
    const speedRow = document.createElement('div');
    speedRow.style.cssText = 'display:flex;gap:5px;align-items:center;';
    speedRow.appendChild(this._label('速度'));
    for (const s of [1, 3, 5]) {
      const btn = document.createElement('button');
      btn.textContent = `${s}x`;
      btn.dataset.speed = String(s);
      btn.style.cssText = this._chipCss('#00b894', s === this._readSpeed());
      btn.onclick = () => {
        this._game.setSpeed(s);
        speedRow.querySelectorAll('[data-speed]').forEach((b) => {
          (b as HTMLElement).style.cssText = this._chipCss(
            '#00b894',
            b === btn,
          );
        });
      };
      speedRow.appendChild(btn);
    }

    const ctrlRow = document.createElement('div');
    ctrlRow.style.cssText = 'display:flex;gap:5px;';

    const pauseBtn = document.createElement('button');
    pauseBtn.textContent = '⏸ 暂停';
    pauseBtn.style.cssText = this._chipCss('#ffd166', false);
    pauseBtn.onclick = () => this._togglePause();
    this._pauseBtn = pauseBtn;

    const resetBtn = document.createElement('button');
    resetBtn.textContent = '重置';
    resetBtn.style.cssText = this._chipCss('#8395a7', false);
    resetBtn.onclick = () => void this._restart();

    const summaryBtn = document.createElement('button');
    summaryBtn.textContent = '成绩单';
    summaryBtn.style.cssText = this._chipCss('#6c5ce7', false);
    summaryBtn.onclick = () =>
      this._summary.show(
        this._game.getSummary(),
        () => void this._restart(),
        this._store.data,
        () => this._exportReplay(),
        this._store.data.best,
        this._store.data.runs,
      );

    const helpBtn = document.createElement('button');
    helpBtn.textContent = '玩法说明';
    helpBtn.style.cssText = this._chipCss('#74b9ff', false);
    helpBtn.onclick = () =>
      this._intro.show(() => {}, { force: true, review: true });

    const dcaBtn = document.createElement('button');
    dcaBtn.style.cssText = this._chipCss('#fdcb6e', this._game.dca.enabled);
    dcaBtn.onclick = () => this._toggleDca();
    this._dcaBtn = dcaBtn;

    const shareBtn = document.createElement('button');
    shareBtn.textContent = '复制课堂链接';
    shareBtn.style.cssText = this._chipCss('#00cec9', false);
    shareBtn.onclick = () => void this._copyClassroomLink();
    this._shareBtn = shareBtn;

    const leaderboardBtn = document.createElement('button');
    leaderboardBtn.textContent = '排行榜';
    leaderboardBtn.style.cssText = this._chipCss('#a29bfe', false);
    leaderboardBtn.onclick = () => this._showLeaderboard();
    this._leaderboardBtn = leaderboardBtn;

    ctrlRow.appendChild(pauseBtn);
    ctrlRow.appendChild(resetBtn);
    ctrlRow.appendChild(helpBtn);
    ctrlRow.appendChild(dcaBtn);
    ctrlRow.appendChild(summaryBtn);
    ctrlRow.appendChild(shareBtn);
    ctrlRow.appendChild(leaderboardBtn);

    const labelAssets = this._label('选择资产');
    const labelAmount = this._label('金额（元）');
    panel.appendChild(labelAssets);
    panel.appendChild(assetRow);
    panel.appendChild(labelAmount);
    panel.appendChild(amountInput);
    panel.appendChild(quickRow);
    panel.appendChild(actionRow);
    panel.appendChild(speedRow);
    panel.appendChild(ctrlRow);

    this._container.appendChild(panel);
    this._controlPanel = panel;
    this._panelChildren = {
      labels: [labelAssets, labelAmount],
      assetRow,
      amountInput,
      quickRow,
      actionRow,
      speedRow,
      ctrlRow,
      actions: [buyBtn, sellBtn],
      buyBtn,
      sellBtn,
    };
    this._updateActionButtons();
    this._paintDcaBtn();
    this._applyLayout();

    // 调试出口
    (window as any).__sandbox = {
      game: this._game,
      invest: (t: string, a: number) => this._game.invest(t, a),
      redeem: (t: string, a?: number) => this._game.redeem(t, a),
      setSpeed: (s: number) => this._game.setSpeed(s),
      pause: () => this._game.pause(),
      resume: () => this._game.resume(),
      summary: () => this._game.getSummary(),
      level: () => this._game.level,
      scenario: () => this._game.scenario,
      dca: () => this._game.dca,
      setDca: (p: Partial<DcaPlan>) => this.setDca(p),
      exportReplay: () => this._game.exportReplayCsv(),
      tradeMarkers: () => this._game.getTradeMarkers(),
      evaluateAdvisor: () => this._game.evaluateAdvisor(),
      adviceTriggered: () => this._game.advisor.getTriggered(),
      setLevel: (l: GameLevel) => {
        this._game.setLevel(l);
        this._syncUrl();
        this._refresh();
      },
      store: this._store,
      progress: () => this._store.data,
      recordRun: () => {
        this._store.recordRun(this._game.getSummary());
        this._summary.show(
          this._game.getSummary(),
          () => void this._restart(),
          this._store.data,
          () => this._exportReplay(),
          this._store.data.best,
          this._store.data.runs,
        );
      },
      copyClassroomLink: () => this._copyClassroomLink(),
      leaderboard: {
        submit: (s: ScoreSubmission) => this._submitScore(s),
        fetch: (q?: LeaderboardQuery) => this._leaderboard.fetchLeaderboard(q),
        myRank: (
          probe: { returnRate: number; maxDrawdown: number; rating: string },
          q?: LeaderboardQuery,
        ) => this._leaderboard.fetchMyRank(probe, q),
        show: () => this._showLeaderboard(),
        autoSubmit: () => this._submitScoreFromSummary(this._game.getSummary()),
      },
    };
  }

  /** 按当前屏宽重排：操作条/任务面板/HUD（横竖屏切换与窗口缩放均会触发） */
  private _applyLayout(): void {
    const compact = window.innerWidth < 720;
    this._compact = compact;
    const font =
      'font-family: -apple-system, "PingFang SC", "Microsoft YaHei", Arial, sans-serif;';

    if (this._controlPanel) {
      this._controlPanel.style.cssText = compact
        ? `
        position: absolute; left: 8px; right: 8px; bottom: 96px; top: auto; transform: none;
        display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; z-index: 12;
        background: rgba(0,0,0,0.62); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px; padding: 10px; backdrop-filter: blur(8px); ${font}
      `
        : `
        position: absolute; right: 16px; top: 50%; transform: translateY(-50%);
        width: 190px; display: flex; flex-direction: column; gap: 10px; z-index: 10;
        background: rgba(0,0,0,0.62); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 14px; padding: 12px; backdrop-filter: blur(8px); ${font}
      `;
    }

    const c = this._panelChildren;
    if (c) {
      if (compact) {
        for (const l of c.labels) l.style.display = 'none';
        c.assetRow.style.flex = '1 1 100%';
        c.amountInput.style.flex = '1 1 84px';
        c.amountInput.style.width = 'auto';
        c.quickRow.style.flex = '1 1 100%';
        c.actionRow.style.flex = '1 1 100%';
        c.speedRow.style.flex = '1 1 auto';
        c.ctrlRow.style.flex = '1 1 auto';
        for (const b of c.actions) b.style.padding = '10px 0';
      } else {
        for (const l of c.labels) l.style.display = 'block';
        for (const el of [
          c.assetRow,
          c.amountInput,
          c.quickRow,
          c.actionRow,
          c.speedRow,
          c.ctrlRow,
        ]) {
          el.style.flex = '';
        }
        c.amountInput.style.width = '100%';
        for (const b of c.actions) b.style.padding = '9px 0';
      }
    }

    this._missionPanel?.setLayout({
      compact,
      top: compact ? 206 : 132,
      left: compact ? 12 : 16,
      width: compact ? 150 : 232,
    });

    if (this._toastEl) {
      this._toastEl.style.top = compact ? '150px' : '110px';
    }

    this._refresh();
  }

  /** 教学目标任务卡面板（先静默评估一次，初始达成不弹 toast） */
  private _mountMissionPanel(): void {
    this._missionPanel = new MissionPanel(this._container, {
      compact: this._compact,
      top: this._compact ? 206 : 132,
      left: this._compact ? 12 : 16,
      width: this._compact ? 150 : 232,
    });
    const initial = this._game.evaluateMissions();
    this._missionPanel.markDone(initial.map((m) => m.id));
    this._missionPanel.update(this._game.missions.getStatuses());
  }

  /** 选择资产（按钮点击与键盘快捷键共用） */
  private _selectAsset(type: AssetType): void {
    this._selected = type;
    for (const [t, b] of this._assetButtons) {
      const cfg = this._assetCfg.find((x) => x.type === t)!;
      b.style.cssText = this._chipCss(cfg.color, t === this._selected);
    }
    this._updateActionButtons();
  }

  /** 设置金额并同步输入框 */
  private _setAmount(v: number): void {
    this._amount = Math.max(0, Number.isFinite(v) ? v : 0);
    const input = this._panelChildren?.amountInput;
    if (input) input.value = String(this._amount);
  }

  private async _buy(): Promise<void> {
    let amount = this._amount;
    // 现金不足时夹取为全部现金，避免“点了没反应”
    if (amount > this._game.cash) {
      if (this._game.cash <= 0) {
        this._toast('现金不足，可先赎回其他资产');
        this._refresh();
        return;
      }
      amount = this._game.cash;
      this._setAmount(amount);
      this._toast(`现金不足，已按全部现金 ¥${amount.toFixed(2)} 买入`);
    }
    const ok = await this._game.invest(this._selected, amount);
    if (ok) {
      this._toast(
        `✅ ${this._nameOf(this._selected)}${this._verbOf(this._selected, 'buy')} ¥${amount.toFixed(2)}`,
      );
    } else if (amount <= 0) {
      this._toast('请输入大于 0 的金额');
    } else if (this._game.stateMachine.isHoliday) {
      this._toast('休市日不可交易');
    } else if (!this._game.canTrade) {
      this._toast('当前时段不可交易（停牌 / 封盘清算）');
    }
    this._refresh();
  }

  private async _sell(): Promise<void> {
    if (!this._game.isRedeemable(this._selected)) {
      this._toast(`${this._nameOf(this._selected)}未到期，暂不可赎回`);
      return;
    }
    const back = await this._game.redeem(
      this._selected,
      this._amount || undefined,
    );
    if (back > 0) {
      this._toast(
        `✅ ${this._nameOf(this._selected)}${this._verbOf(this._selected, 'sell')} ¥${back.toFixed(2)}`,
      );
    } else {
      this._toast('无可赎回份额');
    }
    this._refresh();
  }

  /** 选中资产的买入/赎回动词 */
  private _verbOf(type: AssetType, kind: 'buy' | 'sell'): string {
    const cfg = this._assetCfg.find((x) => x.type === type);
    return cfg ? cfg[kind] : kind === 'buy' ? '买入' : '赎回';
  }

  private _updateActionButtons(): void {
    const children = this._panelChildren;
    if (!children) return;
    // 按钮标签随选中资产变化（存款=存入/取出，理财=申购/赎回，基金=买入/卖出）
    children.buyBtn.textContent = this._verbOf(this._selected, 'buy');
    children.sellBtn.textContent = this._verbOf(this._selected, 'sell');
    // 封闭期内禁用赎回
    const redeemable = this._game.isRedeemable(this._selected);
    children.sellBtn.disabled = !redeemable;
    children.sellBtn.style.opacity = redeemable ? '1' : '0.45';
    children.sellBtn.style.cursor = redeemable ? 'pointer' : 'not-allowed';
  }

  private async _restart(): Promise<void> {
    await this._game.reset();
    if (this._pauseBtn) this._pauseBtn.textContent = '⏸ 暂停';
    this._toast('已重置到起点');
    this._refresh();
    await this._game.start();
  }

  private _refresh(): void {
    if (!this._scene) return;
    const currentSlice = this._game.sliceEngine.getCurrentSlice();
    const slice: SliceInfo = currentSlice ?? {
      // 未开盘 / 休市日：用 -1 让 HUD 显示「休市日」
      index:
        this._game.stateMachine.isHoliday ||
        this._game.getCurrentSnapshot() === null ||
        !this._game.dataLoader.getCurrentDay()?.isTradingDay
          ? -1
          : 0,
      status: 'completed',
      timestamp: 0,
      isSuspended: false,
    };
    this._scene.updateUI(
      slice,
      this._game.getCurrentSnapshot(),
      this._game.getHoldings(),
      this._game.getTradeRecords(),
    );

    // 教学目标评估
    const newly = this._game.evaluateMissions();
    if (newly.length) {
      this._missionPanel?.markDone(newly.map((m) => m.id));
      const first = newly[0];
      this._toast(
        `🎯 达成「${first.title}」${newly.length > 1 ? ` 等 ${newly.length} 项` : ''}`,
      );
    }

    // 实时财商干预（每条一局只提示一次）
    const advices = this._game.evaluateAdvisor();
    const warn = advices.find((a) => a.level === 'warn');
    if (warn) this._toast(`⚠ ${warn.text} ${warn.lesson}`, true);
    else if (advices.length)
      this._toast(`🧠 ${advices[0].text} ${advices[0].lesson}`);
    this._missionPanel?.update(
      this._game.missions.getStatuses(),
      this._store.data,
    );
    // 保持买入/赎回按钮标签与可赎回状态最新（封闭理财到期后自动解禁）
    this._updateActionButtons();
  }

  private _nameOf(type: AssetType): string {
    return (
      (
        {
          deposit: '存款',
          cash_mgmt: '现金理财',
          closed_fund: '封闭理财',
          fund: '基金',
        } as Record<string, string>
      )[type] || type
    );
  }

  private _label(text: string): HTMLElement {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'color:rgba(255,255,255,0.5);font-size:11px;';
    return el;
  }

  private _chipCss(color: string, active: boolean): string {
    return `
      background: ${active ? color : 'rgba(255,255,255,0.08)'};
      color: ${active ? '#fff' : 'rgba(255,255,255,0.7)'};
      border: none; border-radius: 6px; padding: 6px 0; font-size: 12px;
      cursor: pointer; flex: 1; font-weight: ${active ? '600' : '400'};
    `;
  }

  private _primaryCss(color: string): string {
    return `
      flex: 1; background: ${color}; color: #fff; border: none; border-radius: 8px;
      padding: 9px 0; font-size: 13px; font-weight: 600; cursor: pointer;
    `;
  }

  /** 默认 3x：一个交易日 52 切片约 7 秒走完 */
  private _readSpeed(): number {
    return Math.max(
      GameConfig.MIN_SPEED,
      Math.min(GameConfig.MAX_SPEED, this._readNumberParam('speed', 3)),
    );
  }

  private _readNumberParam(key: string, fallback: number): number {
    const v = new URLSearchParams(location.search).get(key);
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
}

// 启动
document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get('seed') ?? GameConfig.DEFAULT_SEED);
  const useBackend = params.get('backend') === '1';
  let presetData: import('./config/GameConfig').MarketDataItem[] | undefined;
  if (useBackend) {
    try {
      presetData = await MarketDataLoader.fetchMarketData(GameConfig.API_BASE);
    } catch (e) {
      console.warn('[market] 后端行情拉取失败，回退到内置行情', e);
    }
  }
  new SandboxApp(
    Number.isFinite(seed) ? seed : GameConfig.DEFAULT_SEED,
    presetData,
    useBackend,
  );
});
