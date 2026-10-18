import { AssetType, ASSET_GUIDE } from '../config/GameConfig';

const RISK_COLOR: Record<string, string> = {
  低: '#00b894',
  中低: '#55efc4',
  中: '#fdcb6e',
  高: '#ff6b6b',
};

const level = (label: string, value: string) => `
  <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
    <span style="opacity:0.65;">${label}</span>
    <b style="color:${RISK_COLOR[value] || '#fff'};">${value}</b>
  </div>`;

/** 资产百科知识卡：解释某类资产是什么、风险/收益/流动性如何 */
export class KnowledgeCard {
  private _root: HTMLElement | null = null;

  get isOpen(): boolean {
    return !!this._root;
  }

  show(type: AssetType): void {
    const guide = ASSET_GUIDE[type];
    if (!guide) return;
    this.hide();

    const root = document.createElement('div');
    root.className = 'knowledge-card';
    root.style.cssText = `
      position: fixed; inset: 0; z-index: 55; display: flex;
      align-items: center; justify-content: center; padding: 16px;
      background: rgba(8,10,22,0.6); backdrop-filter: blur(3px);
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      width: min(380px, 92vw); background: linear-gradient(160deg,#1b2440 0%,#131a30 100%);
      border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 20px;
      color: #fff; box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    `;
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:17px;font-weight:700;">📖 ${guide.name} · 是什么</div>
        <button class="kb-close" style="background:transparent;border:none;color:#fff;opacity:0.6;
          font-size:20px;cursor:pointer;line-height:1;">×</button>
      </div>
      <div style="margin-top:12px;font-size:13px;line-height:1.7;opacity:0.85;">${guide.summary}</div>
      <div style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.1);padding-top:12px;">
        ${level('风险', guide.risk)}
        ${level('预期收益', guide.returnLevel)}
        ${level('流动性', guide.liquidity)}
      </div>
      <div style="margin-top:12px;border-top:1px solid rgba(255,255,255,0.1);padding-top:12px;">
        <div style="font-size:12px;opacity:0.55;margin-bottom:6px;">财商要点</div>
        <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.8;opacity:0.8;">
          ${guide.points.map((p) => `<li>${p}</li>`).join('')}
        </ul>
      </div>
    `;
    card
      .querySelector('.kb-close')!
      .addEventListener('click', () => this.hide());
    // 点遮罩空白处关闭
    root.addEventListener('click', (e) => {
      if (e.target === root) this.hide();
    });

    root.appendChild(card);
    document.body.appendChild(root);
    this._root = root;
  }

  hide(): void {
    this._root?.remove();
    this._root = null;
  }
}
