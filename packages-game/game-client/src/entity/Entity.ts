import { Component } from './components/Component';
import { TransformComponent } from './components/TransformComponent';

/** `building` 为 S6 建造预留的类型占位，当前无任何实现 */
export type EntityKind = 'player' | 'npc' | 'object' | 'building';

/**
 * NPC 头顶任务标记（S5 D8 前端部分）：取值来自服务端 `talk.questMarks`，客户端不推断。
 * - `available`：有可接任务 → 黄色 `!`
 * - `submittable`：有可交任务 → 绿色 `?`
 */
export type QuestMarkType = 'available' | 'submittable';

/** 任务标记相对脚底原点的 y（贴图顶部在 -32，标记再往上） */
const QUEST_MARK_Y = -50;

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
  /** 头顶任务标记的 Text 节点（首次设置时创建，幂等复用） */
  private markText: Laya.Text | null = null;
  private questMark: QuestMarkType | null = null;

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

  /**
   * 头顶任务标记（引擎内绘制，无 DOM）：`available` 黄色 `!`、`submittable` 绿色 `?`、null 清除。
   * 标记挂在实体 sprite 上（世界空间），坐标随 TransformComponent 自动跟随；同值重复设置无副作用。
   */
  setQuestMark(mark: QuestMarkType | null): void {
    if (this.questMark === mark) return;
    this.questMark = mark;

    if (!mark) {
      if (this.markText) this.markText.visible = false;
      return;
    }

    if (!this.markText) {
      const text = new Laya.Text();
      text.fontSize = 18;
      text.stroke = 3;
      text.strokeColor = '#000000';
      text.mouseEnabled = false;
      this.markText = text;
      this.sprite.addChild(text);
    }
    this.markText.text = mark === 'submittable' ? '?' : '!';
    this.markText.color = mark === 'submittable' ? '#3fb950' : '#ffd75e';
    this.markText.pos(-Math.round(this.markText.textWidth / 2), QUEST_MARK_Y);
    this.markText.visible = true;
  }
}