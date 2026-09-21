import { InteractComponent } from './InteractComponent';
import type { InteractContext, InteractType } from './InteractComponent';
import { Api } from '../../../net/api';
import { ApiError } from '../../../net/http';
import { Toast } from '../../../ui/Toast';
import { Hud } from '../../../ui/Hud';

/**
 * 容器组件（一次性箱子，配置包 interact.type = chest / 后端 ObjectType.CHEST）：
 * 走与采集相同的物件接口；**开启后本地标记为不可再交互**。
 *
 * ⚠️ 一次性状态必须本地记：§1.2 的本地 mock-redis 的 `SET NX` 恒返回 OK，后端的一次性校验在本地永远放行，
 * 不能依赖它来判定「已开启」。
 */
export class ContainerComponent extends InteractComponent {
  readonly kind: InteractType = 'chest';

  /** 本地一次性状态：配置包 interact.oneTime 为真且已开启过 → 不再可交互 */
  private opened = false;

  /** 与 CollectComponent 同理：后端 InteractType 枚举没有 chest，透传会 400，故按可接受值发 collect */
  private static readonly REQUEST_KIND: InteractType = 'collect';

  constructor(private readonly oneTime = true) {
    super();
  }

  canInteract(ctx: InteractContext): boolean {
    return !(this.oneTime && this.opened);
  }

  async interact(ctx: InteractContext): Promise<void> {
    try {
      const res = await Api.interactObject(
        ctx.target.templateId!,
        ContainerComponent.REQUEST_KIND,
        ctx.token,
      );
      if (this.oneTime) this.opened = true;

      const amount = res?.reward?.amount;
      Hud.toast(
        amount
          ? `开启成功，获得 ${amount} ${res.reward?.currencyType ?? ''}`
          : this.oneTime
            ? '箱子已开启（一次性）'
            : '箱子已开启',
      );
      console.log(`[S3] 开启返回 ${JSON.stringify(res)}`);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message}（code=${err.code}）` : String(err);
      Toast.error(msg);
    }
  }
}