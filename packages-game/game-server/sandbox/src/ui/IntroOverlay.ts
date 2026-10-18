import { GameLevel, LEVELS, SCENARIOS } from '../config/GameConfig';

interface IntroOptions {
  /** 强制展示（忽略已看过标记），用于“玩法说明”重看 */
  force?: boolean;
  /** 回顾模式：不重选难度、点“知道了”仅关闭不重开对局 */
  review?: boolean;
}

/** 新手引导浮层：首次进入展示；支持“带我逛逛”真实 UI 高亮巡览与“玩法说明”重看 */
export class IntroOverlay {
  static readonly SEEN_KEY = 'sandbox:intro-seen';
  private _root: HTMLElement | null = null;
  private _tour: HTMLElement | null = null;

  constructor(
    private _container: HTMLElement,
    private _initialLevel: GameLevel,
    private _initialScenario: string,
  ) {}

  /** 是否已看过引导（隐私模式下按“看过”处理，避免每次弹窗） */
  get seen(): boolean {
    try {
      return localStorage.getItem(IntroOverlay.SEEN_KEY) === '1';
    } catch {
      return true;
    }
  }

  private _markSeen(): void {
    try {
      localStorage.setItem(IntroOverlay.SEEN_KEY, '1');
    } catch {
      /* 忽略 */
    }
  }

  show(
    onStart: (level: GameLevel, scenarioId: string) => void,
    opts: IntroOptions = {},
  ): void {
    if (this._root) return;
    if (!opts.force && this.seen) return;
    let chosen: GameLevel = this._initialLevel;
    let chosenScenario = this._initialScenario;

    const root = document.createElement('div');
    root.className = 'intro-overlay';
    root.style.cssText = `
      position: fixed; inset: 0; z-index: 60; display: flex;
      align-items: center; justify-content: center; padding: 16px;
      background: rgba(8,10,22,0.82); backdrop-filter: blur(6px);
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      width: min(440px, 94vw); max-height: 90vh; overflow: auto;
      background: linear-gradient(160deg, #1b2440 0%, #131a30 100%);
      border: 1px solid rgba(255,255,255,0.12); border-radius: 18px;
      padding: 22px; color: #fff; box-shadow: 0 24px 60px rgba(0,0,0,0.5);
    `;

    const steps = [
      [
        '🎯 目标',
        '用 ¥100,000 演练 60 天资产配置。财商核心不是“赚最多”，而是“不亏、控波动、留后路”。',
      ],
      [
        '🕹 操作',
        '右侧（手机底部）选资产与金额，买入 / 赎回；可调速度、随时暂停思考。',
      ],
      [
        '📋 任务卡',
        '左上目标随操作实时达成，达成会弹提示——它们是财商考点，不是 KPI。',
      ],
      ['⚠ 提示', '回放的是真实历史行情，仅作教学演示，不构成任何投资建议。'],
    ];

    const showLevel = !opts.review;
    card.innerHTML = `
      <div style="font-size:19px;font-weight:700;letter-spacing:1px;">🏦 财商沙盘 · 新手引导</div>
      <div style="margin-top:14px;display:flex;flex-direction:column;gap:12px;">
        ${steps
          .map(
            ([h, b]) => `
          <div style="display:flex;gap:10px;font-size:13px;line-height:1.6;">
            <div style="flex:0 0 auto;font-weight:600;opacity:0.9;min-width:62px;">${h}</div>
            <div style="opacity:0.78;">${b}</div>
          </div>`,
          )
          .join('')}
      </div>
      <div class="level-block" style="display:${showLevel ? 'block' : 'none'};">
        <div style="margin-top:18px;font-size:13px;font-weight:600;">选择你的演练难度</div>
        <div class="level-row" style="margin-top:8px;display:flex;gap:8px;"></div>
        <div class="level-desc" style="margin-top:8px;font-size:11px;opacity:0.6;min-height:30px;"></div>
        <div style="margin-top:14px;font-size:13px;font-weight:600;">选择行情情景（回放起点 / 时长）</div>
        <div class="scenario-row" style="margin-top:8px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px;"></div>
        <div class="scenario-desc" style="margin-top:8px;font-size:11px;opacity:0.6;min-height:30px;"></div>
        <div class="scenario-note" style="margin-top:6px;font-size:11px;line-height:1.6;color:#cfe6ff;background:rgba(116,185,255,0.10);border-left:3px solid #74b9ff;padding:6px 8px;border-radius:6px;min-height:18px;"></div>
      </div>
    `;

    if (showLevel) {
      const row = card.querySelector('.level-row') as HTMLElement;
      const descEl = card.querySelector('.level-desc') as HTMLElement;
      const levels: GameLevel[] = ['conservative', 'balanced', 'aggressive'];
      const buttons: HTMLButtonElement[] = [];
      const paint = () => {
        descEl.textContent = LEVELS[chosen].desc;
        buttons.forEach((b) => {
          const active = b.dataset.level === chosen;
          b.style.borderColor = active ? '#00b894' : 'rgba(255,255,255,0.15)';
          b.style.background = active
            ? 'rgba(0,184,148,0.18)'
            : 'rgba(255,255,255,0.04)';
          b.style.color = active ? '#00b894' : '#fff';
        });
      };
      for (const lv of levels) {
        const b = document.createElement('button');
        b.dataset.level = lv;
        b.textContent = LEVELS[lv].name;
        b.style.cssText = `
          flex:1 1 0; padding:9px 0; border-radius:10px; cursor:pointer; font-size:13px;
          border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.04); color:#fff;
          font-family:inherit;
        `;
        b.onclick = () => {
          chosen = lv;
          paint();
        };
        buttons.push(b);
        row.appendChild(b);
      }
      paint();

      const sRow = card.querySelector('.scenario-row') as HTMLElement;
      const sDesc = card.querySelector('.scenario-desc') as HTMLElement;
      const sNote = card.querySelector('.scenario-note') as HTMLElement;
      const sButtons: HTMLButtonElement[] = [];
      const paintScenario = () => {
        const def =
          SCENARIOS.find((s) => s.id === chosenScenario) ?? SCENARIOS[0];
        sDesc.textContent = def.desc;
        sNote.textContent = def.note;
        sButtons.forEach((b) => {
          const active = b.dataset.scenario === def.id;
          b.style.borderColor = active ? '#74b9ff' : 'rgba(255,255,255,0.15)';
          b.style.background = active
            ? 'rgba(116,185,255,0.18)'
            : 'rgba(255,255,255,0.04)';
          b.style.color = active ? '#cfe6ff' : '#fff';
        });
      };
      for (const s of SCENARIOS) {
        const b = document.createElement('button');
        b.dataset.scenario = s.id;
        b.textContent = `${s.name} · ${s.days}天`;
        b.style.cssText = `
          padding:8px 0; border-radius:10px; cursor:pointer; font-size:12px;
          border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.04); color:#fff;
          font-family:inherit;
        `;
        b.onclick = () => {
          chosenScenario = s.id;
          paintScenario();
        };
        sButtons.push(b);
        sRow.appendChild(b);
      }
      paintScenario();
    }

    const startBtn = document.createElement('button');
    startBtn.textContent = opts.review ? '知道了' : '开始演练';
    startBtn.style.cssText = `
      margin-top:18px; width:100%; padding:12px 0; border:none; border-radius:12px; cursor:pointer;
      background:linear-gradient(135deg,#00b894,#00a3c4); color:#04221c; font-weight:700; font-size:15px;
      font-family:inherit;
    `;
    startBtn.onclick = () => {
      if (opts.review) {
        this.hide();
        return;
      }
      this._markSeen();
      this.hide();
      onStart(chosen, chosenScenario);
    };
    card.appendChild(startBtn);

    const tourBtn = document.createElement('button');
    tourBtn.textContent = '📍 带我逛逛';
    tourBtn.style.cssText = `
      margin-top:10px; width:100%; padding:10px 0; border:1px solid rgba(255,255,255,0.18);
      border-radius:12px; cursor:pointer; background:transparent; color:#fff; font-size:13px;
      font-family:inherit;
    `;
    tourBtn.onclick = () => {
      this.hide();
      this.startTour();
    };
    card.appendChild(tourBtn);

    root.appendChild(card);
    this._container.appendChild(root);
    this._root = root;
  }

  /** 真实 UI 高亮巡览：操作区 → 任务卡 → 资产面板 */
  private startTour(): void {
    if (this._tour) return;
    const stops: { sel: string; tip: string }[] = [
      {
        sel: '.control-panel',
        tip: '这里是操作区：选资产、填金额、买入 / 赎回，调速与暂停也在这。',
      },
      {
        sel: '.mission-panel',
        tip: '左上任务卡会随操作实时达成，是本局的财商考点，达成会弹提示。',
      },
      {
        sel: '#asset-panel',
        tip: '四类资产市值与收益率（绿涨红跌），底部还有风险提示文字。',
      },
    ];

    const overlay = document.createElement('div');
    overlay.className = 'tour-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 61; pointer-events: none;
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
    `;

    const hole = document.createElement('div');
    hole.className = 'tour-spot';
    hole.style.cssText = `
      position: fixed; border-radius: 12px; border: 2px solid #00b894;
      box-shadow: 0 0 0 9999px rgba(8,10,22,0.78); transition: all .2s ease;
      pointer-events: none;
    `;
    overlay.appendChild(hole);

    const tip = document.createElement('div');
    tip.style.cssText = `
      position: fixed; left: 50%; transform: translateX(-50%); max-width: 320px; width: 86vw;
      background: #131a30; border: 1px solid rgba(0,184,148,0.4); border-radius: 12px;
      padding: 12px 14px; color: #fff; font-size: 13px; line-height: 1.6; z-index: 62;
      box-shadow: 0 12px 30px rgba(0,0,0,0.5);
    `;
    overlay.appendChild(tip);

    const bar = document.createElement('div');
    bar.style.cssText = `
      position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
      display: flex; gap: 10px; align-items: center; z-index: 63; pointer-events: auto;
    `;
    const prev = document.createElement('button');
    const next = document.createElement('button');
    const skip = document.createElement('button');
    const styleBtn = (b: HTMLButtonElement, primary: boolean) => {
      b.style.cssText = `
        padding:8px 16px; border-radius:10px; cursor:pointer; font-size:13px; font-family:inherit;
        border:1px solid rgba(255,255,255,0.18);
        background:${primary ? 'linear-gradient(135deg,#00b894,#00a3c4)' : 'transparent'};
        color:${primary ? '#04221c' : '#fff'}; font-weight:${primary ? '700' : '400'};
      `;
    };
    styleBtn(prev, false);
    styleBtn(next, true);
    styleBtn(skip, false);
    prev.textContent = '上一步';
    next.textContent = '下一步';
    skip.textContent = '跳过';
    bar.append(prev, next, skip);
    overlay.appendChild(bar);

    this._container.appendChild(overlay);
    this._tour = overlay;

    let i = 0;
    const render = () => {
      const stop = stops[i];
      const el = document.querySelector(stop.sel) as HTMLElement | null;
      if (!el) {
        // 目标缺失则跳过该步
        if (i < stops.length - 1) {
          i++;
          render();
        } else finish();
        return;
      }
      const r = el.getBoundingClientRect();
      const pad = 6;
      hole.style.left = `${r.left - pad}px`;
      hole.style.top = `${r.top - pad}px`;
      hole.style.width = `${r.width + pad * 2}px`;
      hole.style.height = `${r.height + pad * 2}px`;
      tip.textContent = `${i + 1}/${stops.length} · ${stop.tip}`;
      const tipH = 70;
      const below = r.bottom + 12 + tipH < window.innerHeight;
      tip.style.top = below
        ? `${r.bottom + 12}px`
        : `${Math.max(12, r.top - 12 - tipH)}px`;
      prev.style.visibility = i === 0 ? 'hidden' : 'visible';
      next.textContent = i === stops.length - 1 ? '完成' : '下一步';
    };
    const finish = () => {
      this.hideTour();
    };

    prev.onclick = () => {
      if (i > 0) {
        i--;
        render();
      }
    };
    next.onclick = () => {
      if (i < stops.length - 1) {
        i++;
        render();
      } else finish();
    };
    skip.onclick = finish;
    window.requestAnimationFrame(render);
  }

  private hideTour(): void {
    this._tour?.remove();
    this._tour = null;
  }

  hide(): void {
    this._root?.remove();
    this._root = null;
    this.hideTour();
  }
}
