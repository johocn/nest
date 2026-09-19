import { SandboxGame } from './core/SandboxGame';
import { SandboxScene3D } from './scene/SandboxScene3D';
import { GameConfig } from './config/GameConfig';

/** 沙盘游戏入口 */
class SandboxApp {
  private _game: SandboxGame;
  private _scene: SandboxScene3D | null = null;
  private _container: HTMLElement;

  constructor() {
    this._game = new SandboxGame();
    this._container = document.getElementById('game-container')!;
    this._initUI();
  }

  private async _initUI(): Promise<void> {
    // 创建场景
    this._scene = new SandboxScene3D(this._container, this._game);
    await this._scene.init();

    // 挂载投资操作按钮
    this._mountActionButtons();

    // 启动游戏
    this._game.stateMachine.subscribe(t => {
      console.log(`[状态] ${t.from} → ${t.to}: ${t.reason}`);
    });

    this._game.sliceEngine.onSliceTick((slice, progress) => {
      const snapshot = this._game.getCurrentSnapshot();
      const holdings = this._game.getHoldings();
      const tradeRecords = this._game.getTradeRecords();
      if (snapshot) {
        this._scene?.updateUI(slice, snapshot, holdings, tradeRecords);
      }
    });

    // 休市时更新 UI
    this._game.sliceEngine.onHoliday(date => {
      const holdings = this._game.getHoldings();
      const tradeRecords = this._game.getTradeRecords();
      this._scene?.updateUI(
        { index: -1, status: 'completed', timestamp: 0, isSuspended: false },
        this._game.getCurrentSnapshot(),
        holdings,
        tradeRecords,
      );
    });

    await this._game.start();
  }

  private _mountActionButtons(): void {
    const panel = document.createElement('div');
    panel.className = 'action-panel';
    panel.style.cssText = `
      position: absolute; right: 16px; top: 50%; transform: translateY(-50%);
      display: flex; flex-direction: column; gap: 8px; z-index: 10;
    `;

    const actions = [
      { label: '存款', type: 'deposit', color: '#00b894' },
      { label: '现金理财', type: 'cash_mgmt', color: '#00cec9' },
      { label: '封闭理财', type: 'closed_fund', color: '#6c5ce7' },
      { label: '基金', type: 'fund', color: '#e17055' },
    ];

    for (const a of actions) {
      const btn = document.createElement('button');
      btn.textContent = `买入 ${a.label}`;
      btn.style.cssText = `
        background: ${a.color}; color: #fff; border: none; border-radius: 8px;
        padding: 10px 16px; font-size: 13px; cursor: pointer; opacity: 0.8;
        transition: opacity 0.2s; font-weight: 500;
      `;
      btn.onmouseenter = () => { btn.style.opacity = '1'; };
      btn.onmouseleave = () => { btn.style.opacity = '0.8'; };
      btn.onclick = () => this._invest(a.type, 10000);
      panel.appendChild(btn);
    }

    // 速度控制
    const speedCtrl = document.createElement('div');
    speedCtrl.style.cssText = `
      position: absolute; right: 16px; bottom: 80px; z-index: 10;
      display: flex; gap: 4px; align-items: center;
    `;
    speedCtrl.innerHTML = `
      <span style="color:#fff;font-size:11px;opacity:0.6;">速度</span>
      <button class="speed-btn" data-speed="1" style="background:#00b894;color:#fff;border:none;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;">1x</button>
      <button class="speed-btn" data-speed="3" style="background:#0f3460;color:#fff;border:none;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;">3x</button>
      <button class="speed-btn" data-speed="5" style="background:#0f3460;color:#fff;border:none;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;">5x</button>
    `;
    speedCtrl.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const speed = parseInt((btn as HTMLElement).dataset.speed || '1');
        this._game.setSpeed(speed);
        speedCtrl.querySelectorAll('.speed-btn').forEach(b =>
          (b as HTMLElement).style.background = b === btn ? '#00b894' : '#0f3460'
        );
      });
    });

    this._container.appendChild(panel);
    this._container.appendChild(speedCtrl);
  }

  private async _invest(type: string, amount: number): Promise<void> {
    const success = await this._game.invest(type, amount);
    if (success) {
      console.log(`[投资] ${type}: ¥${amount}`);
    }
  }
}

// 启动
document.addEventListener('DOMContentLoaded', () => {
  new SandboxApp();
});