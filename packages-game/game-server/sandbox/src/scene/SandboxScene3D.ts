import * as THREE from 'three';
import { SliceInfo } from '../config/GameConfig';
import { SandboxGame } from '../core/SandboxGame';

/** 沙盘3D场景 - 使用LayaAir引擎 */
export class SandboxScene3D {
  private _game: SandboxGame;
  private _container: HTMLElement;
  private _uiElements: Map<string, HTMLElement> = new Map();
  private _animationFrame: number = 0;
  private _threejs: any = null;
  private _scene: any = null;
  private _camera: any = null;
  private _renderer: any = null;
  private _buildings: any[] = [];
  private _sliceIndicator: any = null;

  constructor(container: HTMLElement, game: SandboxGame) {
    this._container = container;
    this._game = game;
  }

  /** 初始化3D场景 */
  async init(): Promise<void> {
    const THREE = await import('three');
    this._threejs = THREE;

    // 场景
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x1a1a2e);

    // 相机
    const aspect = this._container.clientWidth / this._container.clientHeight;
    this._camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    this._camera.position.set(15, 12, 15);
    this._camera.lookAt(0, 0, 0);

    // 渲染器
    this._renderer = new THREE.WebGLRenderer({ antialias: true });
    this._renderer.setSize(this._container.clientWidth, this._container.clientHeight);
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._container.appendChild(this._renderer.domElement);

    // 灯光
    this._setupLights(THREE);

    // 地面
    this._createGround(THREE);

    // 建筑
    this._createBuildings(THREE);

    // 切片指示器
    this._createSliceIndicator(THREE);

    // 窗口自适应
    window.addEventListener('resize', () => this._onResize());

    // 开始渲染循环
    this._animate();
  }

  /** 更新UI数据 */
  updateUI(slice: SliceInfo, snapshot: any, holdings: any[], tradeRecords?: any[]): void {
    this._updateHUD(slice, snapshot, holdings, tradeRecords);
    this._updateBuildingHeights(holdings);
    this._updateSliceIndicator(slice);
  }

  /** 销毁场景 */
  destroy(): void {
    if (this._animationFrame) {
      cancelAnimationFrame(this._animationFrame);
    }
    if (this._renderer) {
      this._renderer.dispose();
      this._container.removeChild(this._renderer.domElement);
    }
    this._uiElements.clear();
  }

  private _setupLights(THREE: any): void {
    const ambientLight = new THREE.AmbientLight(0x404060);
    this._scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(10, 20, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    this._scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-10, 10, -10);
    this._scene.add(fillLight);
  }

  private _createGround(THREE: any): void {
    const groundGeo = new THREE.PlaneGeometry(20, 20);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x16213e,
      roughness: 0.8,
      metalness: 0.2,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    this._scene.add(ground);

    // 网格辅助
    const gridHelper = new THREE.GridHelper(20, 20, 0x0f3460, 0x0f3460);
    this._scene.add(gridHelper);
  }

  private _createBuildings(THREE: any): void {
    const configs = [
      { label: '存款', x: -6, color: 0x00b894, baseHeight: 1 },
      { label: '现金理财', x: -2, color: 0x00cec9, baseHeight: 1.5 },
      { label: '封闭理财', x: 2, color: 0x6c5ce7, baseHeight: 1.2 },
      { label: '基金', x: 6, color: 0xe17055, baseHeight: 2 },
    ];

    for (const cfg of configs) {
      const group = new THREE.Group();

      // 底座
      const baseGeo = new THREE.BoxGeometry(2.5, 0.2, 2.5);
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x2d3436 });
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = -0.4;
      base.receiveShadow = true;
      group.add(base);

      // 主体（动态高度）
      const bodyGeo = new THREE.BoxGeometry(2, cfg.baseHeight, 2);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: cfg.color,
        roughness: 0.3,
        metalness: 0.5,
        emissive: cfg.color,
        emissiveIntensity: 0.1,
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = cfg.baseHeight / 2;
      body.castShadow = true;
      body.userData = { baseHeight: cfg.baseHeight, color: cfg.color };
      group.add(body);

      // 标签（用Sprite）
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(cfg.label, 128, 42);

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: texture });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.y = cfg.baseHeight + 1.5;
      sprite.scale.set(2, 0.5, 1);
      group.add(sprite);

      group.position.x = cfg.x;
      group.position.z = 0;
      this._scene.add(group);

      this._buildings.push({
        group,
        body,
        label: cfg.label,
        config: cfg,
        currentHeight: cfg.baseHeight,
      });
    }

    // 中心切片指示器平台
    const platformGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.3, 32);
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x0f3460,
      emissive: 0x0f3460,
      emissiveIntensity: 0.3,
    });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.y = -0.35;
    this._scene.add(platform);
  }

  private _createSliceIndicator(THREE: any): void {
    // 切片进度环
    const ringGeo = new THREE.TorusGeometry(1.8, 0.08, 16, 64);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x00cec9,
      emissive: 0x00cec9,
      emissiveIntensity: 0.5,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.2;
    ring.rotation.x = Math.PI / 2;
    this._scene.add(ring);
    this._sliceIndicator = ring;

    // 中心柱
    const pillarGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x00cec9,
      emissive: 0x00cec9,
      emissiveIntensity: 0.8,
    });
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.y = 0.25;
    this._scene.add(pillar);
  }

  private _updateBuildingHeights(holdings: any[]): void {
    const maxReturn = Math.max(
      ...holdings.map(h => Math.abs(h.returnRate)),
      0.01,
    );

    for (const b of this._buildings) {
      const holding = holdings.find(h => {
        const map: Record<string, string> = {
          '存款': 'deposit', '现金理财': 'cash_mgmt', '封闭理财': 'closed_fund', '基金': 'fund',
        };
        return h.type === map[b.label];
      });

      const returnRate = holding?.returnRate ?? 0;
      const heightScale = 1 + (returnRate / maxReturn) * 3;
      const newHeight = Math.max(0.3, b.config.baseHeight * heightScale);

      b.body.scale.y = newHeight / b.config.baseHeight;
      b.body.position.y = newHeight / 2;

      // 颜色随收益变化
      if (returnRate >= 0) {
        const intensity = Math.min(0.5 + returnRate * 2, 1);
        b.body.material.emissiveIntensity = intensity;
      } else {
        b.body.material.emissiveIntensity = 0.1;
        b.body.material.color.setHex(0xff6b6b);
      }
    }
  }

  private _updateSliceIndicator(slice: SliceInfo): void {
    if (!this._sliceIndicator) return;
    if (slice.index < 0) return; // 休市日不更新指示器
    const progress = slice.index / 52;
    this._sliceIndicator.rotation.z = progress * Math.PI * 2;
  }

  private _createFallbackUI(): void {
    // 3D不可用时的2D回退
    const fallback = document.createElement('div');
    fallback.style.cssText = `
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff; font-family: Arial, sans-serif;
      flex-direction: column; gap: 20px;
    `;
    fallback.innerHTML = `
      <div style="font-size: 48px; opacity: 0.6;">🏦</div>
      <div style="font-size: 18px; opacity: 0.8;">3D场景加载中...</div>
      <div style="font-size: 13px; opacity: 0.5;">请确保网络连接以加载3D引擎</div>
    `;
    this._container.appendChild(fallback);
  }

  private _updateHUD(slice: SliceInfo, snapshot: any, holdings: any[], tradeRecords?: any[]): void {
    const getOrCreate = (id: string, parent: HTMLElement): HTMLElement => {
      let el = this._uiElements.get(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        parent.appendChild(el);
        this._uiElements.set(id, el);
      }
      return el!;
    };

    const hud = this._container.querySelector('.sandbox-hud') as HTMLElement
      || (() => {
        const h = document.createElement('div');
        h.className = 'sandbox-hud';
        h.style.cssText = `
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          pointer-events: none; font-family: Arial, sans-serif;
        `;
        this._container.appendChild(h);
        return h;
      })();

    // 顶部信息栏
    const topBar = getOrCreate('top-bar', hud);
    topBar.style.cssText = `
      position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
      background: rgba(0,0,0,0.7); border-radius: 12px; padding: 10px 24px;
      color: #fff; font-size: 14px; display: flex; gap: 24px; align-items: center;
      backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
    `;
    topBar.innerHTML = `
      <span>📅 ${snapshot?.date || '-'}</span>
      <span>${slice.index === -1 ? '🔴 休市' : `🔘 ${slice.index + 1}/52`}</span>
      <span style="color: ${slice.index === -1 ? '#ff6b6b' : slice.isSuspended ? '#ff6b6b' : '#00b894'}">
        ${slice.index === -1 ? '⏹ 休市日' : slice.isSuspended ? '⏸ 停牌' : '▶ 交易中'}
      </span>
      <span>💰 ¥${this._game.portfolio.totalAssets.toFixed(2)}</span>
      <span style="color: ${this._game.portfolio.totalReturn >= 0 ? '#00b894' : '#ff6b6b'}">
        ${this._game.portfolio.totalReturn >= 0 ? '+' : ''}${this._game.portfolio.totalReturn.toFixed(2)}
        (${(this._game.portfolio.totalReturnRate * 100).toFixed(2)}%)
      </span>
    `;

    // 资产面板
    const assetPanel = getOrCreate('asset-panel', hud);
    assetPanel.style.cssText = `
      position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
      background: rgba(0,0,0,0.7); border-radius: 12px; padding: 12px 20px;
      color: #fff; font-size: 12px; display: flex; gap: 20px;
      backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
    `;
    assetPanel.innerHTML = holdings.map(h => `
      <div style="text-align:center; min-width:80px;">
        <div style="font-size:11px; opacity:0.6; margin-bottom:4px;">
          ${({ deposit: '存款', cash_mgmt: '现金理财', closed_fund: '封闭理财', fund: '基金' } as Record<string, string>)[h.type] || h.type}
        </div>
        <div style="font-size:14px; font-weight:bold;">¥${h.currentValue.toFixed(2)}</div>
        <div style="font-size:11px; color:${h.returnRate >= 0 ? '#00b894' : '#ff6b6b'}">
          ${(h.returnRate * 100).toFixed(2)}%
        </div>
      </div>
    `).join('');

    // 风险提示
    const risk = getOrCreate('risk-disclaimer', hud);
    risk.style.cssText = `
      position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
      color: rgba(255,255,255,0.4); font-size: 11px; text-align: center;
      white-space: nowrap;
    `;
    risk.textContent = '⚠ 本沙盘仅财商教育演示，历史回放数据不等于未来收益，不构成投资建议。';

    // 交易记录日志
    if (tradeRecords && tradeRecords.length > 0) {
      const logPanel = getOrCreate('trade-log', hud);
      logPanel.style.cssText = `
        position: absolute; left: 16px; bottom: 16px;
        background: rgba(0,0,0,0.6); border-radius: 8px; padding: 8px 12px;
        color: #fff; font-size: 11px; max-width: 240px;
        backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.08);
        pointer-events: auto;
      `;
      logPanel.innerHTML = `
        <div style="font-size:10px;opacity:0.5;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;">
          📋 操作记录
        </div>
        ${tradeRecords.slice(-5).reverse().map((r: any) => `
          <div style="display:flex;gap:6px;margin-bottom:3px;line-height:1.4;">
            <span style="opacity:0.5;min-width:50px;">#${r.sliceIndex}</span>
            <span style="color:${r.action === '买入' || r.action === '存入' || r.action === '申购' ? '#00b894' : '#ff6b6b'};">${r.action}</span>
            <span>${r.description}</span>
          </div>
        `).join('')}
      `;
    }
  }

  private _animate(): void {
    this._animationFrame = requestAnimationFrame(() => this._animate());

    // 建筑浮动动画
    const time = Date.now() * 0.001;
    for (const b of this._buildings) {
      b.group.position.y = Math.sin(time + b.group.position.x) * 0.05;
    }

    this._renderer?.render(this._scene, this._camera);
  }

  private _onResize(): void {
    if (!this._renderer || !this._camera) return;
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    this._renderer.setSize(w, h);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }
}