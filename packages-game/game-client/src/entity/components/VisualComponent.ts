import { Component } from './Component';
import type { EntityKind } from '../Entity';

/**
 * 视觉组件：承接原来写在 Entity 构造里的绘制（底色矩形 + 可选贴图 + 名字标签）。
 * 尺寸规则与绘制偏移**必须与 S1 逐字一致**：原点在脚底中心，贴图画在 (-size/2, -size)。
 *
 * S8 Task 2：绘制规则抽到 `apply`，构造与 `reset` 共用 —— 池化复用只重画、不重建组件，
 * 名字标签 Text 节点也只在构造时创建一次（否则每次复用都会多一个子节点 = 幽灵实体）。
 */
export class VisualComponent extends Component {
  private readonly sprite: Laya.Sprite;
  /** 名字标签：构造时建一次，reset 复用（池化下不得重复 addChild） */
  private readonly text: Laya.Text;

  constructor(
    sprite: Laya.Sprite,
    kind: EntityKind,
    displayName: string,
    color: string,
    texture: Laya.Texture | null,
  ) {
    super();
    this.sprite = sprite;
    this.text = new Laya.Text();
    this.apply(kind, displayName, color, texture);
    this.sprite.addChild(this.text);
  }

  /** 对象池复用（S8 Task 2）：清掉旧绘制命令后按同一规则重画，并复用名字文本节点 */
  reset(kind: EntityKind, displayName: string, color: string, texture: Laya.Texture | null): void {
    this.apply(kind, displayName, color, texture);
  }

  /**
   * 绘制规则（构造与 reset 的唯一来源）：`size = kind === 'player' ? 36 : 32`，
   * 底色矩形与贴图都画在 (-size/2, -size, size, size)，名字文本 fontSize 12 / 白色 / stroke 2 / pos(-size, 2)。
   * 复用前必须 `graphics.clear()`，否则旧绘制命令会叠加（幽灵实体的图形侧）。
   */
  private apply(kind: EntityKind, displayName: string, color: string, texture: Laya.Texture | null): void {
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
  }

  /** 伪 3D 遮挡的排序键：以脚底 y 为准（resort 用） */
  get zOrderKey(): number {
    return this.owner ? this.owner.y : 0;
  }
}