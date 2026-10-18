import { MissionStatus } from '../core/MissionSystem';
import { SandboxProgress } from '../core/ProgressStore';

/** 教学目标任务卡面板 */
export class MissionPanel {
  private _root: HTMLElement;
  private _header: HTMLElement;
  private _list: HTMLElement;
  private _expanded: boolean;
  private _justDone = new Set<string>();
  private _everEl: HTMLElement | null = null;

  constructor(
    host: HTMLElement,
    opts: { compact: boolean; top: number; left: number; width: number },
  ) {
    this._expanded = !opts.compact;

    this._root = document.createElement('div');
    this._root.className = 'mission-panel';
    this._root.style.cssText = `
      position: absolute; left: ${opts.left}px; top: ${opts.top}px; width: ${opts.width}px;
      background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px; padding: 8px 10px; backdrop-filter: blur(6px); z-index: 10;
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
      max-height: ${opts.compact ? '46vh' : '52vh'}; display: flex; flex-direction: column;
    `;

    this._header = document.createElement('div');
    this._header.className = 'mission-header';
    this._header.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      color: #fff; font-size: 12px; cursor: pointer; user-select: none;
    `;
    this._header.onclick = () => {
      this._expanded = !this._expanded;
      this._render();
    };
    this._root.appendChild(this._header);

    this._list = document.createElement('div');
    this._list.className = 'mission-list';
    this._list.style.cssText =
      'margin-top:8px; overflow:auto; display:flex; flex-direction:column; gap:6px;';
    this._root.appendChild(this._list);

    host.appendChild(this._root);
  }

  /** 重新定位（窗口尺寸变化 / 横竖屏切换） */
  setLayout(opts: {
    compact: boolean;
    top: number;
    left: number;
    width: number;
  }): void {
    this._root.style.left = `${opts.left}px`;
    this._root.style.top = `${opts.top}px`;
    this._root.style.width = `${opts.width}px`;
    this._root.style.maxHeight = opts.compact ? '46vh' : '52vh';
  }

  /** 标记本次新达成（用于高亮） */
  markDone(ids: string[]): void {
    for (const id of ids) this._justDone.add(id);
  }

  update(statuses: MissionStatus[], progress?: SandboxProgress | null): void {
    this._statuses = statuses;
    if (progress !== undefined) this._progress = progress;
    this._render();
  }

  private _statuses: MissionStatus[] = [];
  private _progress: SandboxProgress | null = null;

  private _render(): void {
    const done = this._statuses.filter((s) => s.done).length;
    this._header.innerHTML = `
      <span>🎯 教学目标 <b style="color:#00b894;">${done}</b>/${this._statuses.length}</span>
      <span style="opacity:0.5;font-size:11px;">${this._expanded ? '收起' : '展开'}</span>
    `;
    const ever =
      this._progress && this._progress.games > 0
        ? `<div style="color:#fff;font-size:10px;opacity:0.55;margin-top:3px;">
           🏆 历史最佳 ${this._progress.bestReturnRate >= 0 ? '+' : ''}${(this._progress.bestReturnRate * 100).toFixed(2)}% · ${this._progress.games} 局 · 累计达成 ${this._progress.missionsEverDone.length}/${this._statuses.length}
         </div>`
        : '';
    if (!this._everEl) {
      this._everEl = document.createElement('div');
      this._root.insertBefore(this._everEl, this._list);
    }
    this._everEl.innerHTML = ever;
    this._list.style.display = this._expanded ? 'flex' : 'none';
    if (!this._expanded) return;

    this._list.innerHTML = this._statuses
      .map((s) => {
        const pct = Math.round(Math.max(0, Math.min(1, s.progress)) * 100);
        const fresh = this._justDone.has(s.def.id);
        const color = s.done ? '#00b894' : '#ffd166';
        return `
        <div style="
          background:${fresh ? 'rgba(0,184,148,0.16)' : 'rgba(255,255,255,0.05)'};
          border:1px solid ${fresh ? 'rgba(0,184,148,0.5)' : 'rgba(255,255,255,0.06)'};
          border-radius:8px; padding:6px 8px;">
          <div style="display:flex;align-items:center;gap:6px;color:#fff;font-size:12px;">
            <span style="color:${color};">${s.done ? '✔' : '○'}</span>
            <span style="font-weight:${s.done ? '600' : '400'};${s.done ? '' : 'opacity:0.85;'}">${s.def.title}</span>
            ${s.done ? '' : `<span style="margin-left:auto;font-size:10px;opacity:0.5;">${pct}%</span>`}
          </div>
          <div style="font-size:10px;opacity:0.55;margin-top:3px;line-height:1.5;">${s.def.desc}</div>
          ${
            s.done
              ? `<div style="font-size:10px;color:rgba(0,184,148,0.8);margin-top:3px;line-height:1.5;">${s.def.lesson}</div>`
              : `<div style="height:3px;background:rgba(255,255,255,0.1);border-radius:2px;margin-top:5px;">
                 <div style="width:${pct}%;height:100%;background:${color};border-radius:2px;"></div>
               </div>`
          }
        </div>
      `;
      })
      .join('');

    if (this._justDone.size) {
      setTimeout(() => {
        this._justDone.clear();
        this._render();
      }, 4000);
    }
  }
}
