import { SliceInfo } from '../config/GameConfig';
import { SandboxGame } from '../core/SandboxGame';
import { buildBenchmarks } from '../core/Benchmarks';
import { allocationFractions } from '../core/Allocation';

/** 资产配色（饼图用）：现金/存款/现金理财/封闭理财/基金 */
const ASSET_COLORS: Record<string, string> = {
  cash: '#b2bec3',
  deposit: '#0984e3',
  cash_mgmt: '#74b9ff',
  closed_fund: '#a29bfe',
  fund: '#fdcb6e',
};

/** 生成资产迷你曲线（内联 SVG polyline，末值≥首值绿、否则红；不足 2 点返回空） */
function sparkSvg(values: number[], w: number, h: number): string {
  if (values.length < 2) return '';
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const up = values[values.length - 1] >= values[0];
  const color = up ? '#00b894' : '#ff6b6b';
  return (
    `<svg class="asset-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
    `style="display:block;margin:3px auto 0;"><polyline points="${pts}" fill="none" ` +
    `stroke="${color}" stroke-width="1.2" stroke-linejoin="round" opacity="0.9"/></svg>`
  );
}

/** 资产配置饼图（环形，各段按占比着色；全 0 时返回空） */
function donutSvg(
  segments: { value: number; color: string }[],
  size: number,
): string {
  const total = segments.reduce((a, s) => a + (s.value > 0 ? s.value : 0), 0);
  if (total <= 0) return '';
  const fracs = allocationFractions(segments.map((s) => s.value));
  const r = size / 2 - 6;
  const cx = size / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments
    .map((s, i) => {
      const f = fracs[i];
      if (f <= 0) return '';
      const dash = `${(f * C).toFixed(2)} ${(C - f * C).toFixed(2)}`;
      const off = (-offset * C).toFixed(2);
      offset += f;
      return (
        `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${s.color}" ` +
        `stroke-width="8" stroke-dasharray="${dash}" stroke-dashoffset="${off}" ` +
        `transform="rotate(-90 ${cx} ${cx})"/>`
      );
    })
    .join('');
  return `<svg class="alloc-donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs}</svg>`;
}

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
    this._renderer.setSize(
      this._container.clientWidth,
      this._container.clientHeight,
    );
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
  updateUI(
    slice: SliceInfo,
    snapshot: any,
    holdings: any[],
    tradeRecords?: readonly any[],
  ): void {
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
    // 归一基准：取持仓收益率绝对值的最大值（至少 2%，避免小幅波动被放大）
    const denom = Math.max(
      ...holdings.map((h) => Math.abs(h.returnRate)),
      0.02,
    );

    for (const b of this._buildings) {
      const holding = holdings.find((h) => {
        const map: Record<string, string> = {
          存款: 'deposit',
          现金理财: 'cash_mgmt',
          封闭理财: 'closed_fund',
          基金: 'fund',
        };
        return h.type === map[b.label];
      });

      const returnRate = holding?.returnRate ?? 0;
      // 正收益拔高、负收益压低，缩放比限制在 [-0.6, +3]
      const ratio = Math.max(-0.6, Math.min(3, returnRate / denom));
      const newHeight = Math.max(0.3, b.config.baseHeight * (1 + ratio * 1.2));

      b.body.scale.y = newHeight / b.config.baseHeight;
      b.body.position.y = newHeight / 2;

      // 颜色随收益变化（正负均可恢复）
      b.body.material.color.setHex(returnRate >= 0 ? b.config.color : 0xff6b6b);
      b.body.material.emissiveIntensity =
        returnRate >= 0 ? Math.min(0.4 + Math.abs(returnRate) * 3, 1) : 0.15;
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

  private _updateHUD(
    slice: SliceInfo,
    snapshot: any,
    holdings: any[],
    tradeRecords?: readonly any[],
  ): void {
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

    const hud =
      (this._container.querySelector('.sandbox-hud') as HTMLElement) ||
      (() => {
        const h = document.createElement('div');
        h.className = 'sandbox-hud';
        h.style.cssText = `
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          pointer-events: none; font-family: Arial, sans-serif;
        `;
        this._container.appendChild(h);
        return h;
      })();

    const nameOf = (type: string) =>
      (
        ({
          deposit: '存款',
          cash_mgmt: '现金理财',
          closed_fund: '封闭理财',
          fund: '基金',
        }) as Record<string, string>
      )[type] || type;

    const progress = this._game.dayProgress;
    const paused = this._game.isPaused;
    const compact = this._container.clientWidth < 720;

    // 顶部信息栏
    const topBar = getOrCreate('top-bar', hud);
    topBar.style.cssText = `
      position: absolute; top: ${compact ? 12 : 16}px; left: 50%; transform: translateX(-50%);
      background: rgba(0,0,0,0.7); border-radius: 12px; padding: ${compact ? '8px 12px' : '10px 24px'};
      color: #fff; font-size: ${compact ? 11 : 14}px; display: flex; gap: ${compact ? 10 : 18}px;
      align-items: center; backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
      flex-wrap: wrap; justify-content: center; max-width: ${compact ? '96%' : '92%'};
    `;
    topBar.innerHTML = `
      <span>📅 ${snapshot?.date || '-'}</span>
      <span style="opacity:0.7;font-size:12px;">D${progress.current}/${progress.total}</span>
      <span>${slice.index === -1 ? '🔴 休市' : `🔘 ${slice.index + 1}/52`}</span>
      <span style="color: ${paused ? '#ffd166' : slice.index === -1 ? '#ff6b6b' : slice.isSuspended ? '#ff6b6b' : '#00b894'}">
        ${paused ? '⏸ 已暂停' : slice.index === -1 ? '⏹ 休市日' : slice.isSuspended ? '⏸ 停牌' : '▶ 交易中'}
      </span>
      <span>💰 ¥${this._game.portfolio.totalAssets.toFixed(2)}</span>
      <span style="color: ${this._game.portfolio.totalReturn >= 0 ? '#00b894' : '#ff6b6b'}">
        ${this._game.portfolio.totalReturn >= 0 ? '+' : ''}${this._game.portfolio.totalReturn.toFixed(2)}
        (${(this._game.portfolio.totalReturnRate * 100).toFixed(2)}%)
      </span>
      <span style="opacity:0.8;font-size:12px;">💵 现金 ¥${this._game.cash.toFixed(2)}</span>
    `;

    // 总资产曲线
    this._drawEquityChart(getOrCreate('equity-chart', hud));

    // 资产面板
    const assetPanel = getOrCreate('asset-panel', hud);
    const cellMin = compact ? 62 : 80;
    const cellVal = compact ? 12 : 14;
    const sparkW = compact ? 48 : 64;
    const sparkH = 14;
    // 窄屏：资产面板抬到操作条上方（操作条高度即时量测）
    const stripEl = this._container.querySelector(
      '.control-panel',
    ) as HTMLElement | null;
    const stripH = compact && stripEl ? stripEl.offsetHeight : 0;
    assetPanel.style.cssText = `
      position: absolute; bottom: ${compact ? 104 + stripH : 16}px; left: 50%; transform: translateX(-50%);
      background: rgba(0,0,0,0.7); border-radius: 12px; padding: ${compact ? '8px 10px' : '12px 20px'};
      color: #fff; font-size: ${compact ? 11 : 12}px; display: flex; gap: ${compact ? 8 : 16}px;
      backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
      flex-wrap: wrap; justify-content: center; max-width: ${compact ? '98%' : '94%'};
    `;
    assetPanel.innerHTML = [
      ...(compact
        ? []
        : [
            `<div class="alloc-donut" title="各类资产占总资产的比例" ` +
              `style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:72px;">
          <div style="font-size:10px;opacity:0.6;margin-bottom:2px;">资产配置</div>
          ${donutSvg(
            [
              { value: this._game.cash, color: ASSET_COLORS.cash },
              ...holdings.map((h) => ({
                value: h.currentValue,
                color: ASSET_COLORS[h.type] || '#fff',
              })),
            ],
            72,
          )}
        </div>`,
          ]),
      `<div style="text-align:center; min-width:${cellMin}px;">
        <div style="font-size:${compact ? 10 : 11}px; opacity:0.6; margin-bottom:4px;">现金</div>
        <div style="font-size:${cellVal}px; font-weight:bold;">¥${this._game.cash.toFixed(2)}</div>
        ${sparkSvg(
          this._game.assetHistory.map((p) => p.cash),
          sparkW,
          sparkH,
        )}
        <div style="font-size:${compact ? 10 : 11}px; opacity:0.4;">活期待投</div>
      </div>`,
      ...holdings.map(
        (h) => `
      <div data-guide="${h.type}" title="点击了解${nameOf(h.type)}" style="text-align:center; min-width:${cellMin}px; cursor:pointer;">
        <div style="font-size:${compact ? 10 : 11}px; opacity:0.6; margin-bottom:4px;">${nameOf(h.type)} <span style="display:inline-block;width:12px;height:12px;line-height:11px;border-radius:50%;border:1px solid rgba(255,255,255,0.45);font-size:8px;text-align:center;vertical-align:middle;">?</span></div>
        <div style="font-size:${cellVal}px; font-weight:bold;">¥${h.currentValue.toFixed(2)}</div>
        ${sparkSvg(
          this._game.assetHistory.map((p) => (p as any)[h.type]),
          sparkW,
          sparkH,
        )}
        <div style="font-size:${compact ? 10 : 11}px; color:${h.returnRate >= 0 ? '#00b894' : '#ff6b6b'}">
          ${h.returnRate >= 0 ? '+' : ''}${(h.returnRate * 100).toFixed(2)}%
        </div>
      </div>`,
      ),
    ].join('');

    // 风险提示（窄屏：抬到资产面板上方；此时面板内容已写入，高度量测准确）
    const assetH = compact ? assetPanel.offsetHeight : 0;
    const risk = getOrCreate('risk-disclaimer', hud);
    risk.style.cssText = `
      position: absolute; bottom: ${compact ? 112 + stripH + assetH : 80}px; left: 50%;
      transform: translateX(-50%);
      color: rgba(255,255,255,0.4); font-size: ${compact ? 9 : 11}px; text-align: center;
      max-width: 94%; line-height: 1.5;
    `;
    risk.textContent =
      '⚠ 本沙盘仅财商教育演示，历史回放数据不等于未来收益，不构成投资建议。';

    // 交易记录日志
    if (tradeRecords && tradeRecords.length > 0) {
      const logPanel = getOrCreate('trade-log', hud);
      logPanel.style.cssText = `
        position: absolute; left: ${compact ? 12 : 16}px; bottom: ${compact ? 152 : 16}px;
        display: ${compact ? 'none' : 'block'};
        background: rgba(0,0,0,0.6); border-radius: 8px; padding: 8px 12px;
        color: #fff; font-size: ${compact ? 10 : 11}px; max-width: ${compact ? 140 : 240}px;
        backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.08);
        pointer-events: auto;
      `;
      logPanel.innerHTML = `
        <div style="font-size:10px;opacity:0.5;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;">
          📋 操作记录
        </div>
        ${tradeRecords
          .slice(-5)
          .reverse()
          .map(
            (r: any) => `
          <div style="display:flex;gap:6px;margin-bottom:3px;line-height:1.4;">
            <span style="opacity:0.5;min-width:50px;">#${r.sliceIndex}</span>
            <span style="color:${r.action === '买入' || r.action === '存入' || r.action === '申购' ? '#00b894' : '#ff6b6b'};">${r.action}</span>
            <span>${r.description}</span>
          </div>
        `,
          )
          .join('')}
      `;
    }
  }

  /** 绘制总资产曲线（左上角小图，随屏宽自适应） */
  private _drawEquityChart(host: HTMLElement): void {
    const compact = this._container.clientWidth < 720;
    const boxW = compact ? 150 : 232;
    const cssH = compact ? 56 : 75;

    host.style.cssText = `
      position: absolute; left: ${compact ? 12 : 16}px; top: ${compact ? 110 : 16}px;
      width: ${boxW}px; box-sizing: border-box; padding: 8px 10px 6px;
      background: rgba(0,0,0,0.6); border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.08); backdrop-filter: blur(6px);
    `;

    let canvas = host.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      const title = document.createElement('div');
      title.style.cssText =
        'color:#fff;font-size:11px;opacity:0.55;margin-bottom:6px;letter-spacing:0.5px;';
      title.textContent = '总资产曲线';
      host.appendChild(title);

      const legend = document.createElement('div');
      legend.className = 'equity-legend';
      legend.style.cssText =
        'display:flex;gap:8px;font-size:9px;opacity:0.75;margin-bottom:4px;color:#fff;';
      legend.innerHTML = `
        <span><span class="legend-actual" style="color:#00b894">●</span> 实际</span>
        <span><span style="color:#74b9ff">●</span> 全存款</span>
        <span><span style="color:#fdcb6e">●</span> 全基金</span>`;
      host.appendChild(legend);

      canvas = document.createElement('canvas');
      canvas.style.display = 'block';
      host.appendChild(canvas);
    }

    const cssW = boxW - 20;
    if (canvas.style.width !== `${cssW}px`) {
      canvas.width = cssW * 2; // dpr 2
      canvas.height = cssH * 2;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const curve = this._game.equityCurve;
    const principal = this._game.portfolio.initialPrincipal;
    const pts = curve.slice(-120);
    if (pts.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '20px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('积累 2 个交易日后出图', W / 2, H / 2 + 6);
      return;
    }

    // 策略基准（与实际曲线等长、对齐可见窗口）
    const bench = buildBenchmarks(curve, principal);
    const dep = bench.allDeposit.slice(-pts.length);
    const fund = bench.allFund.slice(-pts.length);

    const values = pts.map((p) => p.total).concat(principal, dep, fund);
    let min = Math.min(...values);
    let max = Math.max(...values);
    const pad = Math.max((max - min) * 0.15, Math.abs(max) * 0.002, 1);
    min -= pad;
    max += pad;

    const x = (i: number) => (i / (pts.length - 1)) * (W - 8) + 4;
    const y = (v: number) => H - 8 - ((v - min) / (max - min)) * (H - 16);

    // 本金基准线
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(4, y(principal));
    ctx.lineTo(W - 4, y(principal));
    ctx.stroke();
    ctx.setLineDash([]);

    // 策略基准线（全存款 / 全基金，淡色虚线）
    const dash = (arr: number[], color: string) => {
      if (arr.length !== pts.length) return;
      ctx.strokeStyle = color;
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      arr.forEach((v, i) => {
        const px = x(i);
        const py = y(v);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };
    dash(dep, 'rgba(116,185,255,0.55)');
    dash(fund, 'rgba(253,203,110,0.55)');

    // 实际曲线
    const last = pts[pts.length - 1].total;
    const up = last >= principal;
    const actualColor = up ? '#00b894' : '#ff6b6b';
    const legendActual = host.querySelector(
      '.legend-actual',
    ) as HTMLElement | null;
    if (legendActual) legendActual.style.color = actualColor;
    ctx.strokeStyle = actualColor;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => {
      const px = x(i);
      const py = y(p.total);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // 末端点
    ctx.fillStyle = up ? '#00b894' : '#ff6b6b';
    ctx.beginPath();
    ctx.arc(x(pts.length - 1), y(last), 6, 0, Math.PI * 2);
    ctx.fill();

    // 买卖点标注（绿▲买入在点上、红▼卖出在点下，仅在可见窗口内）
    const offset = curve.length - pts.length;
    for (const m of this._game.getTradeMarkers()) {
      const li = m.index - offset;
      if (li < 0 || li >= pts.length) continue;
      const px = x(li);
      const py = y(pts[li].total);
      ctx.fillStyle = m.kind === 'buy' ? '#00b894' : '#ff6b6b';
      ctx.beginPath();
      if (m.kind === 'buy') {
        ctx.moveTo(px, py - 7);
        ctx.lineTo(px - 4.5, py - 16);
        ctx.lineTo(px + 4.5, py - 16);
      } else {
        ctx.moveTo(px, py + 7);
        ctx.lineTo(px - 4.5, py + 16);
        ctx.lineTo(px + 4.5, py + 16);
      }
      ctx.closePath();
      ctx.fill();
    }

    // 区间文字
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '18px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(
      `¥${Math.min(...pts.map((p) => p.total)).toFixed(0)}`,
      6,
      H - 6,
    );
    ctx.textAlign = 'right';
    ctx.fillText(
      `¥${Math.max(...pts.map((p) => p.total)).toFixed(0)}`,
      W - 6,
      H - 6,
    );
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
