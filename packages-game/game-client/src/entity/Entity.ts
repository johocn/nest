export type EntityKind = 'player' | 'npc' | 'object';

/**
 * 实体 = 唯一可寻址的逻辑单元。
 * 原点在「脚底中心」：贴图绘制在 (x-16, y-32)，与后端 spawn_x/spawn_y 直接对齐，不做坐标换算。
 */
export class Entity {
  readonly sprite: Laya.Sprite;

  constructor(
    readonly entityId: string,
    readonly kind: EntityKind,
    readonly spawnId: number | null,
    readonly templateId: number | null,
    readonly interactType: string | null,
    displayName: string,
    x: number,
    y: number,
    color: string,
    texture: Laya.Texture | null,
  ) {
    this.sprite = new Laya.Sprite();
    this.sprite.pos(x, y);

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

  get x(): number {
    return Math.round(this.sprite.x);
  }

  get y(): number {
    return Math.round(this.sprite.y);
  }

  setPos(x: number, y: number): void {
    this.sprite.pos(Math.round(x), Math.round(y));
  }

  distanceTo(other: Entity): number {
    return Math.hypot(this.x - other.x, this.y - other.y);
  }
}