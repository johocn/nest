import { Component } from './components/Component';
import { TransformComponent } from './components/TransformComponent';

/** `building` 为 S6 建造预留的类型占位，当前无任何实现 */
export type EntityKind = 'player' | 'npc' | 'object' | 'building';

/** Entity 构造参数：只声明身份与装配初值，能力由 EntityFactory 展开为组件 */
export interface EntityOptions {
  entityId: string;
  kind: EntityKind;
  spawnId: number | null;
  templateId: number | null;
  displayName: string;
  x: number;
  y: number;
  color: string;
  texture: Laya.Texture | null;
}

/**
 * 实体 = 身份 + 组件表（组件容器）。
 * 渲染/空间/交互能力全部下沉到组件；sprite 是实体唯一的显示节点，由 Transform/Visual 组件共同作用。
 * 构造只建显示节点、不挂组件 —— 组件清单由 EntityFactory 声明并装配（见 EntityFactory.assemble）。
 * 原点在「脚底中心」：贴图绘制在 (x-16, y-32)，与后端 spawn_x/spawn_y 直接对齐，不做坐标换算。
 */
export class Entity {
  readonly entityId: string;
  readonly kind: EntityKind;
  readonly spawnId: number | null;
  readonly templateId: number | null;
  /** 实体唯一的显示节点：位置由 TransformComponent 写，外观由 VisualComponent 画 */
  readonly sprite: Laya.Sprite;
  readonly components = new Map<string, Component>();

  constructor(opts: EntityOptions) {
    this.entityId = opts.entityId;
    this.kind = opts.kind;
    this.spawnId = opts.spawnId;
    this.templateId = opts.templateId;

    this.sprite = new Laya.Sprite();
  }

  attach(component: Component): void {
    this.components.set(component.constructor.name, component);
    component.onAttach(this);
  }

  detach(component: Component): void {
    if (this.components.get(component.constructor.name) !== component) return;
    component.onDetach();
    this.components.delete(component.constructor.name);
  }

  /** 按组件类取组件；未挂载返回 null */
  getComponent<T extends Component>(cls: new (...args: any[]) => T): T | null {
    return (this.components.get(cls.name) as T) ?? null;
  }

  private get transform(): TransformComponent {
    return this.getComponent(TransformComponent)!;
  }

  get x(): number {
    return this.transform.x;
  }

  get y(): number {
    return this.transform.y;
  }

  setPos(x: number, y: number): void {
    this.transform.moveTo(x, y);
  }

  distanceTo(other: Entity): number {
    return this.transform.distanceTo(other.transform);
  }
}