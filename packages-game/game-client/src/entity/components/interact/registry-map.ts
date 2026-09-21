import type { InteractType } from './InteractComponent';

/**
 * 交互注册表的**纯映射表**（kind → 装配策略）。
 *
 * ⚠️ 本文件**不 import 任何 UI/引擎模块（不牵连 Laya）**：类型只走 `import type`（编译期即被擦除），
 * 故产物 `bin/js/entity/components/interact/registry-map.js` 里没有任何引擎符号，可被 `node` 直接 import，
 * 供 `scripts/smoke-s3-components.mjs` 断言「kind 映射完整性」与「未实现类型的占位语义」（§3 风险 6）。
 * 组件实例化（会 import Hud / api）留在 `registry.ts`。
 */

/** 组件装配策略：注册表据此选择组件类；比「直接放组件类」更纯，可在 node 里断言 */
export type InteractStrategy =
  | 'collect'
  | 'container'
  | 'read'
  | 'talk'
  | 'quest'
  | 'mount'
  | 'trigger'
  | 'placeholder';

/**
 * kind → 装配策略（唯一映射表）。
 * `satisfies Record<InteractType, InteractStrategy>` 是**编译期契约**：`InteractType` 联合里任一取值漏登记、
 * 或多登记联合之外的取值，都会编译失败 —— 即「客户端全部交互类型都必须能解析到组件」由类型系统保证。
 * - 采集族 collect/fish/stone/plant：一次性物件（配置包 `interact.oneTime`）在 registry 里改走容器语义
 * - chest：容器（一次性箱）
 * - puzzle/gate/trap/transport/story/battle/activity：触发器
 * - sit/lie/hide/camp/carve/play：后端无客户端链路，本批只注册（占位组件，只提示不发请求）
 */
export const INTERACT_STRATEGY = {
  collect: 'collect',
  fish: 'collect',
  stone: 'collect',
  plant: 'collect',
  chest: 'container',
  read: 'read',
  talk: 'talk',
  quest: 'quest',
  mount: 'mount',
  puzzle: 'trigger',
  gate: 'trigger',
  trap: 'trigger',
  transport: 'trigger',
  story: 'trigger',
  battle: 'trigger',
  activity: 'trigger',
  sit: 'placeholder',
  lie: 'placeholder',
  hide: 'placeholder',
  camp: 'placeholder',
  carve: 'placeholder',
  play: 'placeholder',
} satisfies Record<InteractType, InteractStrategy>;

/** 运行时 kind 列表（TS 联合类型在运行时被擦除，断言脚本需要真实数组）＝映射表的键全集 */
export const INTERACT_KINDS = Object.keys(INTERACT_STRATEGY) as readonly InteractType[];

/** 未登记的 kind（schema 之外的取值）解析为 null，由 registry 统一收口到占位组件 */
export function resolveStrategy(kind: string): InteractStrategy | null {
  const table: Record<string, InteractStrategy> = INTERACT_STRATEGY;
  return table[kind] ?? null;
}

/**
 * 占位/收口类的统一语义（A7：目标仍**能被选中**、优先级最低、`interact()` 只提示不发请求）。
 * 单一来源：占位组件与断言脚本都读这里，避免「声明与实现漂移」。
 */
export const PLACEHOLDER_META = { canInteract: true, priority: -1 } as const;
