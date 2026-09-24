import { Component } from './Component';
import type { Entity } from '../Entity';
import type { InteractContext } from './interact/InteractComponent';
import type { BuildMode, BuildRuleView, BuildingState } from '../../net/api';
import { AppConfig } from '../../config/AppConfig';
import { EntityRegistry } from '../EntityRegistry';
import { BuildPanel } from '../../world/BuildPanel';
import { buildingAppearance, calcProgress, DEFAULT_GRID_SIZE } from '../../world/build-logic';

const B = AppConfig.build;

/**
 * 建造入口组件（S6 / Task 7 Step 2）。
 *
 * 语义与 `components/interact/*` 族**保持一致**（结构性契约，见 `entity/targeting.ts` 的 `InteractLike`）：
 * - `kind`：交互类型标识（本组件为 `'build'`，**不登记进 `interact/registry-map.ts`**：
 *   建造实体由 `EntityFactory.createFromBuilding` 直接装配本组件，不走配置包 kind 映射；
 *   选择器 `pickTarget` 是**结构性判定**（只看 kind/canInteract/interact 三个成员），
 *   故无需新增 kind、也无需改动选择器逻辑）；
 * - `priority`：选中优先级（0=采集族，10=NPC 对话；建造取 5，物件与 NPC 之间）；
 * - `canInteract()`：语义是「**能不能被选中**」——`mode==='forbidden'` → `false`（不可选中），
 *   solo/coop → `true`。这是计划 Step 2 所指的「BuildComponent 分支」的落点；
 * - `interact()`：打开建造面板（`BuildPanel`），面板自行按服务端规则展示模式提示与禁用入口。
 */
export class BuildComponent extends Component {
  readonly kind = 'build';

  priority = 5;

  constructor(readonly buildRule: BuildRuleView | null) {
    super();
  }

  /** 场景建造模式；无规则（未加载/接口失败）按 `forbidden` 处理，宁可禁用不可误建 */
  get mode(): BuildMode {
    return this.buildRule?.mode ?? 'forbidden';
  }

  /** 可否被选中：`forbidden` 场景的建造实体不参与选中（保持 S3 选择器语义） */
  canInteract(_ctx?: InteractContext): boolean {
    return this.mode !== 'forbidden';
  }

  async interact(_ctx: InteractContext): Promise<void> {
    await BuildPanel.open();
  }
}

/**
 * 建筑实体表现组件（S6 / Task 7 Step 3）：三态分支取自纯函数 `buildingAppearance`（可被断言脚本校验）。
 * - `building`：半透明 + 进度条（`finishAt` 与 `Date.now()` 推算，缺失时画中性条）；
 * - `built`：正常贴图 + 耐久文本（蓝图取不到 durability 则不显示）；
 * - `demolishing`：淡出 `demolishFadeMs` 后从 `EntityRegistry` 移除。
 *
 * ⚠️ 客户端**不做本地到点落成**：`state` 只由服务端广播改写（`applyState`），
 * `update()` 只在两帧广播之间做视觉插值。
 */
export class BuildingViewComponent extends Component {
  private bar: Laya.Sprite | null = null;
  private durabilityText: Laya.Text | null = null;
  private fadeElapsed = 0;
  private removed = false;

  constructor(
    private state: BuildingState,
    private finishAt: string | null,
    private readonly buildSeconds: number,
    private readonly durability: number | null,
    /** 占地高度（格数）：绘制尺寸 = 格数 × 64，进度条/耐久锚点随之整体上移（S9） */
    private readonly footprintH = 1,
  ) {
    super();
  }

  /** 相对标准实体高度（32）多出的高度：锚点按此上移，保持与低矮建筑相同的间距 */
  private get lift(): number {
    return Math.max(1, this.footprintH) * DEFAULT_GRID_SIZE - 32;
  }

  /** 进度条 y：原 `-42` 是「32 高实体顶部再上 10px」的锚点 */
  private get barY(): number {
    return B.progressBarOffsetY - this.lift;
  }

  /** 耐久文本 y：原 `-12` 的顶部相对锚点保持不变 */
  private get durabilityY(): number {
    return -12 - this.lift;
  }

  onAttach(owner: Entity): void {
    super.onAttach(owner);
    this.applyAppearance();
  }

  /** 广播驱动的状态改写（落成/拆除一律以服务端广播为准） */
  applyState(state: BuildingState, finishAt: string | null = this.finishAt): void {
    this.state = state;
    this.finishAt = finishAt;
    this.fadeElapsed = 0;
    this.removed = false;
    this.applyAppearance();
  }

  update(dtMs: number): void {
    const owner = this.owner;
    if (!owner) return;
    const look = buildingAppearance(this.state);

    if (look.progressBar) {
      const progress = calcProgress(this.finishAt, Date.now(), this.buildSeconds);
      this.drawProgress(progress);
    }

    if (look.fadeOut && !this.removed) {
      this.fadeElapsed += dtMs;
      owner.sprite.alpha = Math.max(0, 1 - this.fadeElapsed / B.demolishFadeMs);
      if (this.fadeElapsed >= B.demolishFadeMs) {
        this.removed = true;
        EntityRegistry.remove(owner.entityId);
      }
    }
  }

  /** 按状态分支一次性设置透明度/进度条/耐久（结构变更时重建节点） */
  private applyAppearance(): void {
    const owner = this.owner;
    if (!owner) return;
    const look = buildingAppearance(this.state);
    owner.sprite.alpha = look.alpha;

    if (look.progressBar) {
      if (!this.bar) {
        this.bar = new Laya.Sprite();
        this.bar.mouseEnabled = false;
        this.bar.graphics.drawRect(
          -B.progressBarWidth / 2,
          this.barY,
          B.progressBarWidth,
          B.progressBarHeight,
          B.progressBgColor,
        );
        owner.sprite.addChild(this.bar);
      }
      this.bar.visible = true;
    } else if (this.bar) {
      this.bar.visible = false;
    }

    if (look.durability && this.durability !== null) {
      if (!this.durabilityText) {
        const text = new Laya.Text();
        text.fontSize = 11;
        text.color = '#e6edf3';
        text.stroke = 2;
        text.strokeColor = '#000000';
        text.mouseEnabled = false;
        this.durabilityText = text;
        owner.sprite.addChild(text);
      }
      this.durabilityText.text = `耐久 ${this.durability}`;
      this.durabilityText.pos(-Math.round(this.durabilityText.textWidth / 2), this.durabilityY);
      this.durabilityText.visible = true;
    } else if (this.durabilityText) {
      this.durabilityText.visible = false;
    }
  }

  /** 进度条填充（`progress === null` → 不确定进度，画半宽中性条） */
  private drawProgress(progress: number | null): void {
    const bar = this.bar;
    if (!bar) return;
    const filled = progress === null ? B.progressBarWidth / 2 : B.progressBarWidth * progress;
    const color = progress === null ? B.progressUnknownColor : B.progressFgColor;
    bar.graphics.clear();
    bar.graphics.drawRect(
      -B.progressBarWidth / 2,
      this.barY,
      B.progressBarWidth,
      B.progressBarHeight,
      B.progressBgColor,
    );
    bar.graphics.drawRect(
      -B.progressBarWidth / 2,
      this.barY,
      filled,
      B.progressBarHeight,
      color,
    );
  }
}
