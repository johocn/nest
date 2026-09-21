import { Component } from './Component';
import type { EntityKind } from '../Entity';

/**
 * 视觉组件：承接原来写在 Entity 构造里的绘制（底色矩形 + 可选贴图 + 名字标签）。
 * 尺寸规则与绘制偏移**必须与 S1 逐字一致**：原点在脚底中心，贴图画在 (-size/2, -size)。
 */
export class VisualComponent extends Component {
  constructor(
    private readonly sprite: Laya.Sprite,
    kind: EntityKind,
    displayName: string,
    color: string,
    texture: Laya.Texture | null,
  ) {
    super();

    const size = kind === 'player' ? 36 : 32;
    this.sprite.graphics.drawRect(-size / 2, -size, size, size, color);
    if (texture) this.sprite.graphics.drawTexture(texture, -size / 2, -size, size, size);

    const text = new Laya.Text();
    text.text = displayName;
    text.fontSize = 12;
    text.color = '#ffffff';
    text.stroke = 2;
    text.strokeColor = '#000000';
    text.pos(-size, 2);
    this.sprite.addChild(text);
  }

  /** 伪 3D 遮挡的排序键：以脚底 y 为准（resort 用） */
  get zOrderKey(): number {
    return this.owner ? this.owner.y : 0;
  }
}