import { Component } from './Component';
import type { Entity } from '../Entity';
import type { EntityKind } from '../Entity';
import { Quality } from '../../perf/Quality';
import { shouldShowNameLabel } from '../../world/static-layer';

/**
 * 视觉组件：承接原来写在 Entity 构造里的绘制（底色矩形 + 可选贴图 + 名字标签）。
 * 尺寸规则与绘制偏移**必须与 S1 逐字一致**：原点在脚底中心，贴图画在 (-size/2, -size)。
 *
 * S8 Task 2：绘制规则抽到 `apply`，构造与 `reset` 共用 —— 池化复用只重画、不重建组件，
 * 名字标签 Text 节点也只在构造时创建一次（否则每次复用都会多一个子节点 = 幽灵实体）。
 *
 * S8 Task 3：名标签显隐由 `Quality.switches().nameLabels` 决定（low 档只留 player/npc 的名字），
 * 订阅 `Quality.onChange` 让切档**当场生效**；订阅在 `onDetach` 注销（不得泄漏监听器）。
 */
export class VisualComponent extends Component {
  private readonly sprite: Laya.Sprite;
  /** 名字标签：构造时建一次，reset 复用（池化下不得重复 addChild） */
  private readonly text: Laya.Text;
  /** 最近一次 apply 的入参：切档时原地重放（否则要调用方再传一遍） */
  private kind: EntityKind;
  private displayName: string;
  private color: string;
  private texture: Laya.Texture | null;
  private offQuality: (() => void) | null = null;

  constructor(
    sprite: Laya.Sprite,
    kind: EntityKind,
    displayName: string,
    color: string,
    texture: Laya.Texture | null,
  ) {
    super();
    this.sprite = sprite;
    this.kind = kind;
    this.displayName = displayName;
    this.color = color;
    this.texture = texture;
    this.text = new Laya.Text();
    this.apply(kind, displayName, color, texture);
    this.sprite.addChild(this.text);
  }

  onAttach(owner: Entity): void {
    super.onAttach(owner);
    // 切档当场生效（A10）：开关变化时按最近一次入参重放绘制（含名标签显隐）
    this.offQuality?.();
    this.offQuality = Quality.onChange(() =>
      this.apply(this.kind, this.displayName, this.color, this.texture),
    );
  }

  /** 必须在 detach 时注销：池化下组件实例长期存活，不注销会持续堆积回调 */
  onDetach(): void {
    this.offQuality?.();
    this.offQuality = null;
    super.onDetach();
  }

  /** 对象池复用（S8 Task 2）：清掉旧绘制命令后按同一规则重画，并复用名字文本节点 */
  reset(kind: EntityKind, displayName: string, color: string, texture: Laya.Texture | null): void {
    this.apply(kind, displayName, color, texture);
  }

  /**
   * 绘制规则（构造与 reset 的唯一来源）：`size = kind === 'player' ? 36 : 32`，
   * 底色矩形与贴图都画在 (-size/2, -size, size, size)，名字文本 fontSize 12 / 白色 / stroke 2 / pos(-size, 2)。
   * 复用前必须 `graphics.clear()`，否则旧绘制命令会叠加（幽灵实体的图形侧）。
   *
   * 名标签显隐（D3-①）走纯函数 `shouldShowNameLabel`：只切 `visible`，**不改**字号/位置/内容 ——
   * high 档与基线逐字一致，low 档只隐藏物件/建筑的名字。
   */
  private apply(kind: EntityKind, displayName: string, color: string, texture: Laya.Texture | null): void {
    this.kind = kind;
    this.displayName = displayName;
    this.color = color;
    this.texture = texture;

    const size = kind === 'player' ? 36 : 32;
    this.sprite.graphics.clear();
    this.sprite.graphics.drawRect(-size / 2, -size, size, size, color);
    if (texture) this.sprite.graphics.drawTexture(texture, -size / 2, -size, size, size);

    this.text.text = displayName;
    this.text.fontSize = 12;
    this.text.color = '#ffffff';
    this.text.stroke = 2;
    this.text.strokeColor = '#000000';
    this.text.pos(-size, 2);
    this.text.visible = shouldShowNameLabel(kind, Quality.switches());
  }

  /** 伪 3D 遮挡的排序键：以脚底 y 为准（resort 用） */
  get zOrderKey(): number {
    return this.owner ? this.owner.y : 0;
  }
}