import {
  LeaderboardEntry,
  LeaderboardQuery,
  LeaderboardScope,
} from '../core/Leaderboard';

const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
const LEVEL_NAME: Record<string, string> = {
  conservative: '保守型',
  balanced: '稳健型',
  aggressive: '进取型',
};

export interface LeaderboardPanelConfig {
  /** 当前玩家昵称（用于输入框默认值） */
  currentName: string;
  /** 上一次提交成功的条目 id（用于在榜单中高亮「我」） */
  lastId: string | null;
  /** 拉取榜单（按范围过滤），由 main 注入 */
  fetchEntries: (
    query: LeaderboardQuery,
  ) => Promise<
    | { ok: true; entries: LeaderboardEntry[]; total: number }
    | { ok: false; error: string }
  >;
  /** 提交当前成绩，由 main 注入 */
  submitCurrent: (name: string) => Promise<void>;
}

/** 排行榜浮层：范围切换 + 昵称输入 + 提交 + 榜单列表 + 「我」高亮 */
export class LeaderboardPanel {
  private _root: HTMLElement | null = null;
  private _config: LeaderboardPanelConfig | null = null;
  private _scope: LeaderboardScope = 'all';

  get isOpen(): boolean {
    return !!this._root;
  }

  show(config: LeaderboardPanelConfig): void {
    this._config = config;
    this.hide();
    const root = document.createElement('div');
    root.className = 'leaderboard-panel';
    root.style.cssText = `
      position: fixed; inset: 0; z-index: 60; display: flex;
      align-items: center; justify-content: center;
      background: rgba(10,10,20,0.72); backdrop-filter: blur(6px);
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      width: min(440px, 92vw); max-height: 86vh; overflow: auto;
      background: linear-gradient(160deg, #1b2440 0%, #131a30 100%);
      border: 1px solid rgba(255,255,255,0.12); border-radius: 18px;
      padding: 20px; color: #fff; box-shadow: 0 24px 60px rgba(0,0,0,0.5);
    `;

    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="font-size:18px;font-weight:700;letter-spacing:1px;">🏆 财商排行榜</div>
        <div class="lb-close" style="cursor:pointer;opacity:0.6;font-size:20px;line-height:1;padding:4px 8px;">×</div>
      </div>
      <div style="font-size:11px;opacity:0.5;margin-top:4px;">同行情、同难度比收益，跨设备留名</div>

      <div style="margin-top:14px;display:flex;gap:8px;align-items:center;">
        <input class="lb-name" placeholder="你的昵称" value="${escapeHtml(config.currentName)}"
          style="flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:8px;padding:8px 10px;font-size:13px;outline:none;" />
        <button class="lb-submit" style="background:#00b894;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer;">提交我的成绩</button>
      </div>

      <div class="lb-tabs" style="margin-top:14px;display:flex;gap:6px;">
        ${tab('all', '全部')}
        ${tab('scenario', '按情景')}
        ${tab('level', '按难度')}
      </div>

      <div class="lb-list" style="margin-top:12px;display:flex;flex-direction:column;gap:6px;"></div>
      <div class="lb-foot" style="margin-top:10px;font-size:11px;opacity:0.45;line-height:1.5;">
        成绩由后端 /api/sandbox/v1 持久化，可分享课堂链接让同学同台比拼。
      </div>
    `;

    root.appendChild(card);
    document.body.appendChild(root);
    this._root = root;

    card
      .querySelector('.lb-close')!
      .addEventListener('click', () => this.hide());
    root.addEventListener('click', (e) => {
      if (e.target === root) this.hide();
    });
    card.querySelector('.lb-submit')!.addEventListener('click', () => {
      const input = card.querySelector('.lb-name') as HTMLInputElement;
      const name = input.value.trim() || '匿名同学';
      void (async () => {
        await config.submitCurrent(name);
        this._config = { ...config, currentName: name };
        await this._refresh();
      })();
    });
    card.querySelectorAll('.lb-tab').forEach((el) => {
      el.addEventListener('click', () => {
        this._scope = (el as HTMLElement).dataset.scope as LeaderboardScope;
        this._paintTabs(card);
        void this._refresh();
      });
    });

    this._paintTabs(card);
    void this._refresh();
  }

  private _paintTabs(card: HTMLElement): void {
    card.querySelectorAll('.lb-tab').forEach((el) => {
      const t = el as HTMLElement;
      const active = t.dataset.scope === this._scope;
      t.style.background = active ? '#6c5ce7' : 'rgba(255,255,255,0.08)';
      t.style.color = active ? '#fff' : 'rgba(255,255,255,0.7)';
      t.style.fontWeight = active ? '600' : '400';
    });
  }

  private async _refresh(): Promise<void> {
    if (!this._root || !this._config) return;
    const card = this._root.querySelector(
      '.leaderboard-panel > div',
    ) as HTMLElement;
    const list = card.querySelector('.lb-list') as HTMLElement;
    const cfg = this._config;
    const scope = this._scope;

    list.innerHTML = `<div style="font-size:12px;opacity:0.5;text-align:center;padding:14px 0;">加载中…</div>`;

    const res = await cfg.fetchEntries({ scope, limit: 50 });
    if (!res.ok) {
      list.innerHTML = `
        <div style="text-align:center;padding:18px 0;">
          <div style="font-size:13px;opacity:0.7;">排行榜暂不可用</div>
          <div style="font-size:11px;opacity:0.45;margin-top:6px;">请确认后端服务已启动（npm run server）</div>
        </div>`;
      return;
    }

    if (res.entries.length === 0) {
      list.innerHTML = `<div style="font-size:12px;opacity:0.5;text-align:center;padding:14px 0;">暂无成绩，快来抢占榜首！</div>`;
      return;
    }

    const lastId = cfg.lastId;
    list.innerHTML = res.entries
      .map((e, i) => row(i + 1, e, e.id === lastId))
      .join('');
  }

  hide(): void {
    if (this._root) {
      this._root.remove();
      this._root = null;
    }
  }
}

function tab(scope: string, label: string): string {
  return `<div class="lb-tab" data-scope="${scope}" style="flex:1;text-align:center;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7);border:none;border-radius:6px;padding:6px 0;font-size:12px;cursor:pointer;">${label}</div>`;
}

function row(rank: number, e: LeaderboardEntry, isMe: boolean): string {
  const profitColor = e.returnRate >= 0 ? '#00b894' : '#ff6b6b';
  const medal =
    rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;
  const meTag = isMe
    ? `<span style="font-size:10px;color:#ffeaa7;margin-left:6px;">· 我</span>`
    : '';
  const scopeTag = `<span style="font-size:10px;opacity:0.45;margin-left:6px;">${LEVEL_NAME[e.level] || e.level} · ${e.scenario}</span>`;
  return `
    <div style="display:flex;align-items:center;gap:10px;background:${isMe ? 'rgba(108,92,231,0.18)' : 'rgba(255,255,255,0.05)'};border:${isMe ? '1px solid rgba(108,92,231,0.5)' : '1px solid transparent'};border-radius:10px;padding:8px 10px;">
      <span style="width:26px;text-align:center;font-size:14px;font-weight:700;">${medal}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(e.name)}${meTag}</div>
        <div style="font-size:10px;opacity:0.6;">${e.rating} 评级 · 目标 ${e.missions}/${e.total}${scopeTag}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:14px;font-weight:700;color:${profitColor};">${pct(e.returnRate)}</div>
        <div style="font-size:10px;opacity:0.5;">回撤 -${(e.maxDrawdown * 100).toFixed(1)}%</div>
      </div>
    </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string,
  );
}
