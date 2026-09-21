import { InteractComponent } from './InteractComponent';
import type { InteractContext, InteractType } from './InteractComponent';
import { CollectComponent } from './CollectComponent';
import type { CollectKind } from './CollectComponent';
import { ContainerComponent } from './ContainerComponent';
import { MountComponent } from './MountComponent';
import { QuestComponent } from './QuestComponent';
import { ReadComponent } from './ReadComponent';
import { TalkComponent } from './TalkComponent';
import { TriggerComponent } from './TriggerComponent';
import { PLACEHOLDER_META, resolveStrategy } from './registry-map';
import { Hud } from '../../../ui/Hud';

/** 装配交互组件所需的参数：来自配置包 interact（type/cd/oneTime）与实体身份（triggerId/mountId） */
export interface InteractCreateOptions {
  /** 配置包 interact.type / NPC 的 talk / 触发器 type */
  kind: string;
  /** 配置包 interact.cd（秒），仅采集族使用（冷却以服务端为准） */
  cd?: number;
  /** 配置包 interact.oneTime，容器（一次性箱）使用 */
  oneTime?: boolean;
  /** scene_triggers.id（触发器实体装配时提供） */
  triggerId?: number;
  /** 坐骑 id；配置包无该字段，缺省为 null 即降级为「只注册 + 只提示」 */
  mountId?: string | null;
}

/**
 * 占位交互组件：未实现 / 未知 kind 的统一收口。
 * 按一致性规则：`canInteract` 保持 true（**能被选中**）、`priority` = -1、`interact()` 只提示、不发请求、不抛异常。
 * （⚠️ 偏离计划 Task 5 Step 5/7/8 字面上的「占位组件 canInteract=false」：那样占位目标永远不会被选中，
 * 验收 A7 要求的「sit 时给出『暂不支持』提示」就永远看不到。）
 * 语义取值读 `registry-map.ts` 的 `PLACEHOLDER_META`（断言脚本校验的同一来源）。
 */
export class PlaceholderInteractComponent extends InteractComponent {
  constructor(readonly kind: InteractType) {
    super();
    this.priority = PLACEHOLDER_META.priority;
  }

  canInteract(): boolean {
    return PLACEHOLDER_META.canInteract;
  }

  async interact(ctx: InteractContext): Promise<void> {
    Hud.toast(`暂不支持该交互：${this.kind}`);
  }
}

/**
 * 解析配置包里的交互信息 → 交互组件实例。
 * kind 取值只在 `registry-map.ts`（零引擎依赖的纯映射表）里登记：新增一种交互只改那张表，**不改选择器**。
 * 未登记的 kind（schema 之外的取值）同样解析为占位组件，保证「不崩、有出口」。
 */
export function createInteractComponent(o: InteractCreateOptions): InteractComponent {
  const kind = String(o.kind ?? '');

  switch (resolveStrategy(kind)) {
    /**
     * 采集族。一次性物件（配置包 `interact.oneTime` 为真）按容器处理，获得「开启后本地不可再交互」的语义。
     * 依据：后端 `scene-package.builder.ts` 的 `INTERACT_BY_OBJECT_TYPE` 把 ObjectType.CHEST 归一成了 'collect'，
     * 客户端只能靠 `oneTime` 区分「一次性箱」与「花草石」；不做这一步，ContainerComponent 在真实配置包里永不生效。
     */
    case 'collect':
      return o.oneTime
        ? new ContainerComponent(true)
        : new CollectComponent(kind as CollectKind, o.cd ?? 0);
    case 'container':
      return new ContainerComponent(o.oneTime ?? true);
    case 'read':
      return new ReadComponent();
    case 'talk':
      return new TalkComponent();
    case 'quest':
      return new QuestComponent();
    case 'mount':
      return new MountComponent(o.mountId ?? null);
    case 'trigger':
      return new TriggerComponent(kind as InteractType, o.triggerId ?? 0);
    case 'placeholder':
      return new PlaceholderInteractComponent(kind as InteractType);
    default:
      console.warn(`[S3] 未登记的交互类型 ${kind}（解析为占位组件，仅提示不请求）`);
      return new PlaceholderInteractComponent(kind as InteractType);
  }
}
