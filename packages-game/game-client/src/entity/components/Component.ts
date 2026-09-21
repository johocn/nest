import type { Entity } from '../Entity';

/**
 * 组件基类：组件只负责自己的数据与行为，通过 owner 访问所属实体。
 * 组件不直接读写兄弟组件，实体负责装配与生命周期。
 */
export abstract class Component {
  /** 所属实体；未挂载时为 null */
  owner: Entity | null = null;

  onAttach(owner: Entity): void {
    this.owner = owner;
  }

  onDetach(): void {
    this.owner = null;
  }

  /** 需要按帧推进的组件覆写此方法（基类默认无行为） */
  update(dtMs: number): void {
    // 基类无行为
  }
}