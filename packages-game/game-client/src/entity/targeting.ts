import type { Entity } from './Entity';
import type { InteractComponent, InteractContext } from './components/interact/InteractComponent';

/**
 * 交互目标选择（纯逻辑模块）。
 *
 * ⚠️ 本文件**不 import Laya、不 import 任何引擎模块**：类型只走 `import type`（编译期即被擦除），
 * 组件能力用结构性判定，故产物 `bin/js/entity/targeting.js` 里没有任何引擎符号，
 * 可被 `node` 直接 import 做断言（见 Task 6 的零依赖断言脚本）。
 *
 * 选择规则（D5：新增一种交互只加组件，**不改选择器**）：
 *  1. 排除玩家实体（`kind === 'player'`，含自己）；
 *  2. 须挂有交互组件，且 `canInteract(ctx) === true`（语义 = 「能不能被选中」）；
 *  3. 须在**该目标自身的交互半径**内（半径由调用方注入：人 90 / 物 70）；
 *  4. 先比 `priority`（大者优先），`priority` 相同再比距离（近者优先）。
 */

/** 交互半径取值函数：按目标实体给出其可交互半径（纯模块不读 AppConfig，由调用方注入） */
export type RadiusOf = (entity: Entity) => number;

/** 选中结果：目标实体 + 承载交互能力的组件（选择器只把它交回给组件自己的 `interact()`） */
export interface PickedTarget {
  entity: Entity;
  component: InteractComponent;
}

/** 交互组件的最小契约视图（结构性判定用，避免本模块 import 组件实现） */
interface InteractLike {
  readonly kind: string;
  readonly priority: number;
  canInteract(ctx: InteractContext): boolean;
  interact(ctx: InteractContext): Promise<void>;
}

/**
 * 从实体组件表里取出交互组件。
 * 组件表按 `constructor.name` 建键（`getComponent(InteractComponent)` 取不到子类键），故按契约做结构性判定。
 */
function findInteract(entity: Entity): InteractComponent | null {
  for (const component of entity.components.values()) {
    const like = component as unknown as InteractLike;
    if (
      typeof like.kind === 'string' &&
      typeof like.canInteract === 'function' &&
      typeof like.interact === 'function'
    ) {
      return component as unknown as InteractComponent;
    }
  }
  return null;
}

/** 就近选中：返回优先级最高、其次距离最近的可交互目标；没有则返回 null */
export function pickTarget(
  candidates: readonly Entity[],
  me: Entity,
  radiusOf: RadiusOf,
  token = '',
): PickedTarget | null {
  let best: PickedTarget | null = null;
  let bestPriority = Number.NEGATIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entity of candidates) {
    if (entity.kind === 'player') continue;

    const component = findInteract(entity);
    if (!component) continue;

    const distance = me.distanceTo(entity);
    if (distance > radiusOf(entity)) continue;
    if (!component.canInteract({ me, target: entity, token })) continue;

    const priority = component.priority;
    if (priority > bestPriority || (priority === bestPriority && distance < bestDistance)) {
      best = { entity, component };
      bestPriority = priority;
      bestDistance = distance;
    }
  }

  return best;
}