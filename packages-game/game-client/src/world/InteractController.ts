import { AppConfig } from '../config/AppConfig';
import type { Entity } from '../entity/Entity';
import { EntityRegistry } from '../entity/EntityRegistry';
import { pickTarget } from '../entity/targeting';
import type { PickedTarget, RadiusOf } from '../entity/targeting';
import { Session } from '../net/Session';
import { Hud } from '../ui/Hud';

/** 交互键：Laya 的 KEY_DOWN 事件只代理 nativeEvent.key（不带 keyCode），故用归一化小写 'f' 判定 */
const KEY_INTERACT = 'f';
/** 目标重选节流：每 6 帧（≈100ms）一次，跟手且无谓开销可忽略 */
const PICK_FRAME_INTERVAL = 6;

/**
 * 交互控制（D5：退化为**选择器**）：只做「就近选中 → 高亮/提示 → 把上下文交给选中组件的 interact()」。
 * 本类**不含任何按 kind 的业务分支**；新增一种交互 = 加一个组件 + 在 registry 注册一行。
 * 选择规则本身在纯模块 `entity/targeting.ts`（可被 node 直接断言）。
 */
export class InteractController {
  /** 互斥：一次交互未完成时不重复触发 */
  private busy = false;
  /** 上一次已提示的目标 id：提示条只在选中目标变化时重绘 */
  private lastHintId: string | null = null;

  constructor(private readonly me: Entity) {}

  attach(): void {
    Laya.stage.on(Laya.Event.KEY_DOWN, this, this.onKeyDown);
    Laya.timer.frameLoop(PICK_FRAME_INTERVAL, this, this.pickAndHighlight);
    console.log(
      `[S3] 交互选择器就绪：半径 NPC ${AppConfig.interactRadiusNpc}px / 物件 ${AppConfig.interactRadiusObject}px，按 F 由选中组件自行派发`,
    );
  }

  /**
   * 每帧重选：高亮跟随当前目标；提示条仅在目标变化时改写。
   * （不每帧重写 hint：组件可能正用 hint 展示长文本，如 ReadComponent 的阅读文案。）
   */
  private pickAndHighlight(): void {
    const picked = this.pick();
    Hud.highlight(picked ? picked.entity : null);

    const id = picked ? picked.entity.entityId : null;
    if (id === this.lastHintId) return;
    this.lastHintId = id;
    Hud.hint(picked ? `按 F 交互：${picked.entity.entityId}` : null);
  }

  private pick(): PickedTarget | null {
    return pickTarget(EntityRegistry.all(), this.me, InteractController.radiusOf, Session.token ?? '');
  }

  /** 交互半径按目标类型取值：人（NPC）90 / 物（object）70 */
  private static radiusOf: RadiusOf = (e) =>
    e.kind === 'npc' ? AppConfig.interactRadiusNpc : AppConfig.interactRadiusObject;

  private async onKeyDown(e: Laya.Event): Promise<void> {
    const key = String((e as unknown as { key?: string }).key ?? '').toLowerCase();
    if (key !== KEY_INTERACT || this.busy) return;

    // 按键时按同一规则重选一次，避免用上一次节流的结果
    const picked = this.pick();
    if (!picked) {
      Hud.toast('附近没有可交互目标');
      return;
    }

    this.busy = true;
    try {
      await picked.component.interact({
        me: this.me,
        target: picked.entity,
        token: Session.token ?? '',
      });
    } finally {
      this.busy = false;
    }
  }
}