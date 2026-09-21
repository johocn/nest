import { Component } from '../Component';
import type { Entity } from '../../Entity';

/** 交互上下文：me = 发起者（本地玩家），target = 被交互实体，token = 登录态 */
export interface InteractContext {
  me: Entity;
  target: Entity;
  token: string;
}

/**
 * 客户端交互 kind 全集（取值逐字取自后端枚举，不新造）：
 * - 后端 `InteractType`（game-server/src/constants/enums.ts）：collect/hide/camp/sit/lie/carve/read/mount/fish/play
 * - 物件 `ObjectType` 的其余取值（配置包 interact.type 的来源）：chest/stone/plant
 * - NPC `NpcInteractType`：talk/quest
 * - 场景触发器 `TriggerType`：transport/story/battle/activity/puzzle/gate/trap
 * 注：已发布的配置包（scene-1 v1）实际只出现 collect/read（物件）与 transport/story（触发器）。
 */
export type InteractType =
  | 'collect'
  | 'fish'
  | 'stone'
  | 'plant'
  | 'chest'
  | 'read'
  | 'talk'
  | 'quest'
  | 'mount'
  | 'puzzle'
  | 'gate'
  | 'trap'
  | 'transport'
  | 'story'
  | 'battle'
  | 'activity'
  | 'sit'
  | 'lie'
  | 'hide'
  | 'camp'
  | 'carve'
  | 'play';

/**
 * 交互组件契约：交互类型的唯一扩展点。
 * 新增一种交互 = 加一个组件文件 + 在 registry 里注册一行，**不改选择器**。
 *
 * ⚠️ 一致性规则（选择器与所有实现共同遵守）：
 * - `canInteract` 的语义是「**能不能被选中**」，不是「调用会不会成功」。
 *   选择器在交互半径内先比 `priority` 再比距离，`canInteract() === false` 的目标**不参与选中**。
 * - 「未实现类型 / 不可手动激活的触发器 / Quest 注册位 / 无凭证的坐骑」这几类必须**能被选中并给出提示**，
 *   故其 `canInteract` 返回 **true**、`priority` 取最低值 **-1**、`interact()` 只 `Hud.toast/hint` 提示、
 *   不发请求、不抛异常（否则玩家永远看不到「暂不支持」这类出口）。
 * - 只有「真正不可操作」的情况（如已开启的一次性箱子）才 `canInteract` 返回 false。
 */
export abstract class InteractComponent extends Component {
  /** 交互类型：选择器据此派发（也用于注册表的 kind 对齐） */
  abstract readonly kind: InteractType;

  /** 选中优先级：越大越优先（同屏重叠时先比它再比距离）；占位/收口类固定 -1 */
  priority = 0;

  canInteract(ctx: InteractContext): boolean {
    return true;
  }

  abstract interact(ctx: InteractContext): Promise<void>;
}