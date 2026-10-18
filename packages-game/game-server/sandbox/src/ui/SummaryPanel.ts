import {
  GameSummary,
  AssetAttribution,
  LEVELS,
  SCENARIOS,
} from '../config/GameConfig';
import {
  SandboxProgress,
  BestRun,
  RunRecord,
  compareToBest,
  runsStats,
} from '../core/ProgressStore';
import { reviewBehavior, depositBaseline } from '../core/BehaviorReview';

const ASSET_NAME: Record<string, string> = {
  deposit: '存款',
  cash_mgmt: '现金理财',
  closed_fund: '封闭理财',
  fund: '基金',
};

const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

/** 行情情景科普：复盘时告诉学员这段行情的历史背景 */
function scenarioNote(summary: GameSummary): string {
  const def = SCENARIOS.find((s) => s.id === summary.scenario.id);
  if (!def || !def.note) return '';
  return `
    <div style="font-size:11px;opacity:0.62;margin-top:6px;line-height:1.6;color:#cfe6ff;background:rgba(116,185,255,0.10);border-left:3px solid #74b9ff;padding:6px 8px;border-radius:6px;">
      <b style="opacity:0.9;">行情背景</b> · ${def.note}
    </div>`;
}

/** 结算成绩单浮层 */
export class SummaryPanel {
  private _root: HTMLElement | null = null;

  get isOpen(): boolean {
    return !!this._root;
  }

  /** 展示成绩单 */
  show(
    summary: GameSummary,
    onRestart: () => void,
    progress: SandboxProgress | null = null,
    onExport: (() => void) | null = null,
    best: BestRun | null = null,
    runs: RunRecord[] | null = null,
  ): void {
    this.hide();

    const root = document.createElement('div');
    root.className = 'summary-panel';
    root.style.cssText = `
      position: fixed; inset: 0; z-index: 50; display: flex;
      align-items: center; justify-content: center;
      background: rgba(10,10,20,0.72); backdrop-filter: blur(6px);
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      width: min(430px, 92vw); max-height: 88vh; overflow: auto;
      background: linear-gradient(160deg, #1b2440 0%, #131a30 100%);
      border: 1px solid rgba(255,255,255,0.12); border-radius: 18px;
      padding: 22px 22px 18px; color: #fff; box-shadow: 0 24px 60px rgba(0,0,0,0.5);
    `;

    const profitColor = summary.totalReturn >= 0 ? '#00b894' : '#ff6b6b';

    card.innerHTML = `
      <div style="font-size:19px;font-weight:700;letter-spacing:1px;">🏦 财商沙盘 · 结算成绩单</div>
      <div style="font-size:12px;opacity:0.55;margin-top:6px;">
        ${summary.startDate} → ${summary.endDate} · 共 ${summary.days} 个自然日 · ${summary.tradeCount} 次操作 · ${summary.scenario.name} · ${LEVELS[summary.level].name}
      </div>

      <div style="margin-top:14px;font-size:12px;opacity:0.85;">🧭 市场环境：${summary.environment.label}</div>
      <div style="font-size:11px;opacity:0.62;margin-top:3px;line-height:1.6;">${summary.environment.advice}</div>
      ${scenarioNote(summary)}

      <div style="margin-top:16px;display:flex;align-items:baseline;gap:10px;">
        <span style="font-size:30px;font-weight:800;">¥${summary.totalAssets.toFixed(2)}</span>
        <span style="font-size:14px;color:${profitColor};font-weight:600;">
          ${summary.totalReturn >= 0 ? '+' : ''}¥${summary.totalReturn.toFixed(2)}（${pct(summary.totalReturnRate)}）
        </span>
      </div>
      <div style="font-size:11px;opacity:0.5;margin-top:2px;">期初本金 ¥${summary.principal.toFixed(2)}</div>

      <div style="margin-top:16px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
        ${metric('年化收益', pct(summary.annualizedReturn), summary.annualizedReturn >= 0 ? '#00b894' : '#ff6b6b')}
        ${metric('最大回撤', `-${(summary.maxDrawdown * 100).toFixed(2)}%`, '#ffd166')}
        ${metric('综合评级', summary.rating, '#6c5ce7')}
      </div>

      <div style="margin-top:12px;font-size:12px;opacity:0.7;line-height:1.6;">
        ${summary.ratingReason}
      </div>

      <div style="margin-top:10px;font-size:12px;opacity:0.8;">
        🎯 教学目标达成 <b style="color:#00b894;">${summary.missions.completed}</b> / ${summary.missions.total}
      </div>
      ${
        summary.dcaCount > 0
          ? `
      <div style="margin-top:5px;font-size:11px;opacity:0.6;">
        定投扣款 ${summary.dcaCount} 次（定期定额，平滑波动）
      </div>`
          : ''
      }

      <div style="margin-top:6px;font-size:11px;opacity:0.6;">
        🏦 若全额存存款：¥${depositBaseline(summary).baselineAssets.toFixed(2)}
        （${pct(depositBaseline(summary).baselineRate)}）
      </div>
      ${behaviorSection(reviewBehavior(summary))}

      ${vsBestSection(summary, best)}
      ${historySection(runs)}

      <div style="margin-top:16px;border-top:1px solid rgba(255,255,255,0.1);padding-top:12px;">
        <div style="font-size:12px;opacity:0.55;margin-bottom:8px;">期末资产明细</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="opacity:0.5;text-align:left;">
              <th style="padding:4px 0;font-weight:500;">资产</th>
              <th style="padding:4px 0;font-weight:500;text-align:right;">市值</th>
              <th style="padding:4px 0;font-weight:500;text-align:right;">收益率</th>
            </tr>
          </thead>
          <tbody>
            ${summary.holdings
              .map(
                (h) => `
              <tr>
                <td style="padding:4px 0;">${ASSET_NAME[h.type] || h.type}</td>
                <td style="padding:4px 0;text-align:right;">¥${h.currentValue.toFixed(2)}</td>
                <td style="padding:4px 0;text-align:right;color:${h.returnRate >= 0 ? '#00b894' : '#ff6b6b'};">
                  ${pct(h.returnRate)}
                </td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      </div>

      ${attributionSection(summary.attribution)}
      ${timelineSection(summary.timeline)}
      ${
        progress && progress.games > 0
          ? `
      <div style="margin-top:12px;font-size:11px;opacity:0.6;">
        🏆 历史最佳 ${progress.bestReturnRate >= 0 ? '+' : ''}${(progress.bestReturnRate * 100).toFixed(2)}%
        （${progress.bestRating}） · 已完成 ${progress.games} 局
      </div>`
          : ''
      }

      <div style="margin-top:14px;font-size:11px;opacity:0.4;line-height:1.6;">
        ⚠ 本沙盘仅财商教育演示，历史回放数据不等于未来收益，不构成投资建议。
      </div>
    `;

    const actions = document.createElement('div');
    actions.style.cssText =
      'margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;';
    actions.appendChild(
      button('再来一局', '#00b894', () => {
        this.hide();
        onRestart();
      }),
    );
    if (onExport) {
      actions.appendChild(button('导出复盘 CSV', '#6c5ce7', () => onExport()));
    }
    actions.appendChild(button('看看盘面', '#2d3436', () => this.hide()));
    card.appendChild(actions);

    root.appendChild(card);
    document.body.appendChild(root);
    this._root = root;
  }

  hide(): void {
    if (this._root) {
      this._root.remove();
      this._root = null;
    }
  }
}

const money = (v: number) => `${v >= 0 ? '+' : '-'}¥${Math.abs(v).toFixed(2)}`;

/** 行为点评列表 */
function behaviorSection(obs: { tone: string; text: string }[]): string {
  if (!obs || obs.length === 0) return '';
  const color: Record<string, string> = {
    good: '#00b894',
    warn: '#ff9f43',
    info: '#74b9ff',
  };
  const mark: Record<string, string> = { good: '✓', warn: '!', info: '·' };
  return `
    <div class="behavior-review" style="margin-top:12px;border-top:1px solid rgba(255,255,255,0.1);padding-top:12px;">
      <div style="font-size:12px;opacity:0.55;margin-bottom:8px;">🧭 行为点评</div>
      ${obs
        .map(
          (o) => `
        <div style="display:flex;gap:8px;font-size:12px;line-height:1.6;margin-bottom:5px;">
          <span style="color:${color[o.tone] || '#fff'};font-weight:700;">${mark[o.tone] || '·'}</span>
          <span style="opacity:0.82;">${o.text}</span>
        </div>`,
        )
        .join('')}
    </div>
  `;
}

/** 本局 vs 历史最佳对比（无历史最佳时返回空） */
function vsBestSection(summary: GameSummary, best: BestRun | null): string {
  const cmp = compareToBest(summary, best);
  if (!cmp || !best) return '';
  const dColor = (v: number, higherBetter: boolean): string => {
    if (v === 0) return 'rgba(255,255,255,0.55)';
    return (higherBetter ? v > 0 : v < 0) ? '#00b894' : '#ff6b6b';
  };
  const pp = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}pp`;
  const line = (
    label: string,
    cur: string,
    base: string,
    delta: string,
    color: string,
  ) => `
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;">
      <span style="opacity:0.7;">${label}</span>
      <span>本局 <b>${cur}</b> · 最佳 ${base}
        <b style="color:${color};margin-left:6px;">${delta}</b></span>
    </div>`;
  return `
    <div class="vs-best" style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.1);padding-top:12px;">
      <div style="font-size:12px;opacity:0.55;margin-bottom:8px;">
        📊 对比历史最佳（${pct(best.returnRate)} · ${best.rating} · 目标 ${best.missions}/${best.total}）
      </div>
      ${line('总收益率', pct(summary.totalReturnRate), pct(best.returnRate), pp(cmp.returnRateDelta), dColor(cmp.returnRateDelta, true))}
      ${line(
        '最大回撤',
        `-${(summary.maxDrawdown * 100).toFixed(2)}%`,
        `-${(best.maxDrawdown * 100).toFixed(2)}%`,
        pp(-cmp.drawdownDelta),
        dColor(cmp.drawdownDelta, false),
      )}
      ${line(
        '教学目标',
        `${summary.missions.completed}/${summary.missions.total}`,
        `${best.missions}/${best.total}`,
        `${cmp.missionDelta >= 0 ? '+' : ''}${cmp.missionDelta}`,
        dColor(cmp.missionDelta, true),
      )}
    </div>
  `;
}

/** 多局成长轨迹（跨局留存，看自己是否在进步） */
function historySection(runs: RunRecord[] | null): string {
  if (!runs || runs.length === 0) return '';
  const stats = runsStats(runs);
  if (!stats) return '';
  const spark = runsSpark(runs.map((r) => r.returnRate));
  const hint =
    runs.length < 2
      ? '<div style="font-size:11px;opacity:0.5;margin-top:4px;">至少 2 局才能对比走势</div>'
      : '';
  return `
    <div class="run-history" style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.1);padding-top:12px;">
      <div style="font-size:12px;opacity:0.55;margin-bottom:8px;">
        <span style="color:#74b9ff;">●</span> 多局成长轨迹（共 ${stats.count} 局）
      </div>
      <div style="display:flex;gap:16px;font-size:11px;opacity:0.8;margin-bottom:6px;">
        <span>平均收益 <b style="color:${stats.avgReturn >= 0 ? '#00b894' : '#ff6b6b'}">${pct(stats.avgReturn)}</b></span>
        <span>最佳一局 <b style="color:${stats.bestReturn >= 0 ? '#00b894' : '#ff6b6b'}">${pct(stats.bestReturn)}</b></span>
      </div>
      ${spark ? `<div style="margin-top:4px;">${spark}</div>` : ''}
      ${hint}
    </div>
  `;
}

/** 多局收益率迷你折线（末值≥首值绿、否则红，<2 点返回空） */
function runsSpark(values: number[]): string {
  if (values.length < 2) return '';
  const w = 200,
    h = 32,
    pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2);
  const up = values[values.length - 1] >= values[0];
  const color = up ? '#00b894' : '#ff6b6b';
  const pts = values
    .map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

/** 收益归因条形图 */
function attributionSection(items: AssetAttribution[]): string {
  if (!items || items.length === 0) return '';
  const max = Math.max(...items.map((i) => Math.abs(i.contribution)), 1);
  return `
    <div style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.1);padding-top:12px;">
      <div style="font-size:12px;opacity:0.55;margin-bottom:8px;">收益归因（贡献 = 期末市值 + 赎回回流 − 累计投入）</div>
      ${items
        .map((i) => {
          const w = Math.round((Math.abs(i.contribution) / max) * 100);
          const color = i.contribution >= 0 ? '#00b894' : '#ff6b6b';
          return `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11px;">
          <span style="width:56px;opacity:0.7;">${i.name}</span>
          <span style="flex:1;height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;">
            <span style="display:block;width:${w}%;height:100%;background:${color};border-radius:4px;"></span>
          </span>
          <span style="width:82px;text-align:right;color:${color};">${money(i.contribution)}</span>
        </div>`;
        })
        .join('')}
    </div>
  `;
}

/** 关键操作时间线 */
function timelineSection(
  items: {
    date: string;
    action: string;
    amount: number;
    description: string;
  }[],
): string {
  if (!items || items.length === 0) return '';
  return `
    <div style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.1);padding-top:12px;">
      <div style="font-size:12px;opacity:0.55;margin-bottom:8px;">操作时间线（最近 ${items.length} 条）</div>
      ${items
        .map(
          (t) => `
        <div style="display:flex;gap:8px;font-size:11px;line-height:1.7;">
          <span style="opacity:0.45;min-width:74px;">${t.date || '—'}</span>
          <span style="color:${t.action === '买入' || t.action === '存入' || t.action === '申购' ? '#00b894' : '#ff6b6b'};min-width:44px;">${t.action}</span>
          <span style="opacity:0.8;">${t.description}</span>
        </div>
      `,
        )
        .join('')}
    </div>
  `;
}

function metric(label: string, value: string, color: string): string {
  return `
    <div style="background:rgba(255,255,255,0.06);border-radius:10px;padding:10px 12px;">
      <div style="font-size:11px;opacity:0.5;">${label}</div>
      <div style="font-size:15px;font-weight:700;color:${color};margin-top:4px;">${value}</div>
    </div>
  `;
}

function button(
  text: string,
  color: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = `
    flex: 1; background: ${color}; color: #fff; border: none; border-radius: 10px;
    padding: 11px 0; font-size: 14px; font-weight: 600; cursor: pointer;
  `;
  btn.onclick = onClick;
  return btn;
}
