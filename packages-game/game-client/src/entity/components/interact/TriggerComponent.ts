import { InteractComponent } from './InteractComponent';
import type { InteractContext, InteractType } from './InteractComponent';
import { Api } from '../../../net/api';
import { ApiError } from '../../../net/http';
import { Toast } from '../../../ui/Toast';
import { Hud } from '../../../ui/Hud';

/** 后端 `world.service.activateTrigger` 仅允许机关类型：PUZZLE / GATE / TRAP */
const MANUAL_ACTIVATABLE: InteractType[] = ['puzzle', 'gate', 'trap'];

/**
 * 触发器组件：`POST api/client/v1/world/triggers/{id}/activate`（入参是 `scene_triggers.id`）。
 *
 * `transport/story/battle/activity` 后端**不允许**手动激活（会返回业务错误码），按一致性规则收口：
 * `canInteract` 返回 true（能被选中）、`priority` 取 -1、`interact()` 只提示「该区域不可手动激活」且**不发请求**，
 * 避免制造 4xx/错误码噪音。
 */
export class TriggerComponent extends InteractComponent {
  constructor(
    readonly kind: InteractType,
    /** scene_triggers.id（触发器实体装配时由配置包 triggers[].id 提供） */
    private readonly triggerId: number,
  ) {
    super();
    if (!MANUAL_ACTIVATABLE.includes(kind)) this.priority = -1;
  }

  /** 该触发器能否被玩家手动激活（决定是否真的发请求） */
  private get activatable(): boolean {
    return MANUAL_ACTIVATABLE.includes(this.kind);
  }

  async interact(ctx: InteractContext): Promise<void> {
    if (!this.activatable) {
      Hud.toast('该区域不可手动激活');
      return;
    }

    try {
      const res = await Api.activateTrigger(this.triggerId, ctx.token);
      Hud.toast(res?.unlocked ? '机关已解锁' : '机关尚未满足解锁条件');
      console.log(`[S3] 机关激活返回 ${JSON.stringify(res)}`);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message}（code=${err.code}）` : String(err);
      Toast.error(msg);
    }
  }
}