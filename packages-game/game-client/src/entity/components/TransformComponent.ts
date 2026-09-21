import { Component } from './Component';

/**
 * 空间组件：实体原点在「脚底中心」，与后端 spawn_x/spawn_y 直接对齐，不做坐标换算。
 * 坐标落到实体唯一的显示节点（sprite）上，故 x/y 即渲染位置。
 */
export class TransformComponent extends Component {
  constructor(
    private readonly sprite: Laya.Sprite,
    x: number,
    y: number,
  ) {
    super();
    this.sprite.pos(x, y);
  }

  get x(): number {
    return Math.round(this.sprite.x);
  }

  get y(): number {
    return Math.round(this.sprite.y);
  }

  get rotation(): number {
    return this.sprite.rotation;
  }

  set rotation(value: number) {
    this.sprite.rotation = value;
  }

  moveTo(x: number, y: number): void {
    this.sprite.pos(Math.round(x), Math.round(y));
  }

  distanceTo(other: TransformComponent): number {
    return Math.hypot(this.x - other.x, this.y - other.y);
  }
}