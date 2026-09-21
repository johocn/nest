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

/** 采集族（collect/fish/stone/plant）统一交给 CollectComponent，kind 原样保留 */
const COLLECT_KINDS: CollectKind[] = ['collect', 'fish', 'stone', 'plant'];

/** 由 TriggerComponent 承载的 kind：3 个可手动激活的机关 + 4 个不可手动激活的触发器 */
const TRIGGER_KINDS: InteractType[] = [
  'puzzle',
  'gate',
  'trap',
  'transport',
  'story',
  'battle',
  'activity',
];

/** 本批不实现行为的 kind（后端无客户端链路，行为属 S5/S6）：解析到占位组件，可选中并提示「暂不支持」 */
const UNIMPLEMENTED_KINDS: InteractType[] = ['sit', 'lie', 'hide', 'camp', 'carve', 'play'];

/**
 * 占位交互组件：未实现 / 未知 kind 的统一收口。
 * 按一致性规则：`canInteract` 保持 true（**能被选中**）、`priority` = -1、`interact()` 只提示、不发请求、不抛异常。
 * （⚠️ 偏离计划 Task 5 Step 5/7/8 字面上的「占位组件 canInteract=false」：那样占位目标永远不会被选中，
 * 验收 A7 要求的「sit 时给出『暂不支持』提示」就永远看不到。）
 */
export class PlaceholderInteractComponent extends InteractComponent {
  constructor(readonly kind: InteractType) {
    super();
    this.priority = -1;
  }

  async interact(ctx: InteractContext): Promise<void> {
    Hud.toast(`暂不支持该交互：${this.kind}`);
  }
}

/** kind → 组件创建器（交互类型注册表：新增一种交互只改这里，不改选择器） */
const CREATORS: Record<string, (o: InteractCreateOptions) => InteractComponent> = {};

for (const kind of COLLECT_KINDS) {
  /**
   * 一次性物件（配置包 interact.oneTime 为真）按容器处理，获得「开启后本地不可再交互」的语义。
   * 依据：后端 `scene-package.builder.ts` 的 `INTERACT_BY_OBJECT_TYPE` 把 ObjectType.CHEST 归一成了 'collect'，
   * 客户端只能靠 `oneTime` 区分「一次性箱」与「花草石」；不做这一步，ContainerComponent 在真实配置包里永不生效。
   */
  CREATORS[kind] = (o) =>
    o.oneTime ? new ContainerComponent(true) : new CollectComponent(kind, o.cd ?? 0);
}
CREATORS['chest'] = (o) => new ContainerComponent(o.oneTime ?? true);
CREATORS['read'] = () => new ReadComponent();
CREATORS['talk'] = () => new TalkComponent();
CREATORS['quest'] = () => new QuestComponent();
CREATORS['mount'] = (o) => new MountComponent(o.mountId ?? null);
for (const kind of TRIGGER_KINDS) {
  CREATORS[kind] = (o) => new TriggerComponent(kind, o.triggerId ?? 0);
}
for (const kind of UNIMPLEMENTED_KINDS) {
  CREATORS[kind] = () => new PlaceholderInteractComponent(kind);
}

/**
 * 解析配置包里的交互信息 → 交互组件实例。
 * 未登记的 kind（schema 之外的取值）同样解析为占位组件，保证「不崩、有出口」。
 */
export function createInteractComponent(o: InteractCreateOptions): InteractComponent {
  const kind = String(o.kind ?? '');
  const creator = CREATORS[kind];
  if (creator) return creator(o);

  console.warn(`[S3] 未登记的交互类型 ${kind}（解析为占位组件，仅提示不请求）`);
  return new PlaceholderInteractComponent(kind as InteractType);
}