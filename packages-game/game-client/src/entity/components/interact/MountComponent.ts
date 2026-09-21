import { InteractComponent } from './InteractComponent';
import type { InteractContext, InteractType } from './InteractComponent';
import { Api } from '../../../net/api';
import { ApiError } from '../../../net/http';
import { Toast } from '../../../ui/Toast';
import { Hud } from '../../../ui/Hud';

/**
 * 坐骑组件：后端 `POST api/client/v1/world/mounts/ride`，DTO `MountActionDto = { mountId: string（必填）, ride?: boolean }`
 * （`mounts/equip` 是获得/切换坐骑的可选前置，同理要求 mountId）。
 *
 * ⚠️ 降级说明（§3 风险 4）：配置包 schema 的物件交互只有 `{ type, cd, oneTime }`，**没有 mountId**，
 * 故装配入口拿不到凭证 → 传入 null 时降级为「只注册 + 只提示」（可被选中、priority 最低、不发请求）。
 * 拿到 mountId 的调用方（如后续版本的坐骑栏）走真实链路。
 */
export class MountComponent extends InteractComponent {
  readonly kind: InteractType = 'mount';

  constructor(private readonly mountId: string | null = null) {
    super();
    if (!mountId) this.priority = -1;
  }

  async interact(ctx: InteractContext): Promise<void> {
    if (!this.mountId) {
      Hud.toast('坐骑交互将在后续版本开放');
      return;
    }

    try {
      const res = await Api.rideMount(this.mountId, ctx.token);
      Hud.toast(res?.ok ? `已骑乘：${this.mountId}` : '坐骑操作失败');
      console.log(`[S3] 骑乘返回 ${JSON.stringify(res)}`);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message}（code=${err.code}）` : String(err);
      Toast.error(msg);
    }
  }
}