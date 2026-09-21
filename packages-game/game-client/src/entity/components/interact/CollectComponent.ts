import { InteractComponent } from './InteractComponent';
import type { InteractContext, InteractType } from './InteractComponent';
import { Api } from '../../../net/api';
import { ApiError } from '../../../net/http';
import { Toast } from '../../../ui/Toast';
import { Hud } from '../../../ui/Hud';

/** 采集族：配置包 interact.type 里的 collect/fish/stone/plant（后者对应后端 ObjectType.STONE/PLANT） */
export type CollectKind = 'collect' | 'fish' | 'stone' | 'plant';

/**
 * 采集组件：`POST api/client/v1/world/objects/{templateId}/interact`，body `{ interactType }`。
 * 入参是 `object_templates.id`（即配置包 staticEntities[].templateId），**不是 spawnId**。
 */
export class CollectComponent extends InteractComponent {
  constructor(
    readonly kind: CollectKind,
    /**
     * 配置包 interact.cd（秒）。冷却由服务端裁决（后端以 redis SET NX 为准），本地不做倒计时：
     * §1.2 ⚠️ 本地 mock-redis 的 SET NX 恒返回 OK，本地校验无意义（改由服务端返回业务错误码）。
     */
    private readonly cd = 0,
  ) {
    super();
  }

  /**
   * 后端 `ObjectInteractDto.interactType` 只接受后端 `InteractType` 枚举（无 stone/plant/chest 这些 ObjectType 值，
   * 直接透传会被 ValidationPipe 判 400），故按其可接受值归一：只有 fish 保持原样，其余归为 collect。
   */
  private get requestKind(): InteractType {
    return this.kind === 'fish' ? 'fish' : 'collect';
  }

  async interact(ctx: InteractContext): Promise<void> {
    try {
      const res = await Api.interactObject(ctx.target.templateId!, this.requestKind, ctx.token);
      const amount = res?.reward?.amount;
      Hud.toast(amount ? `采集成功，获得 ${amount} ${res.reward?.currencyType ?? ''}` : '采集成功');
      console.log(`[S3] 采集返回 ${JSON.stringify(res)}`);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message}（code=${err.code}）` : String(err);
      Toast.error(msg);
    }
  }
}