import { InteractComponent } from './InteractComponent';
import type { InteractContext, InteractType } from './InteractComponent';
import { Api } from '../../../net/api';
import { ApiError } from '../../../net/http';
import { Toast } from '../../../ui/Toast';
import { Hud } from '../../../ui/Hud';

/** 阅读文案在底部提示条的停留时长（毫秒），到点自动收起，避免长期占位 */
const READ_HINT_MS = 8000;

/**
 * 阅读组件（配置包 interact.type = read，对应后端 ObjectType.LANDMARK 路牌/地标）：
 * `POST api/client/v1/world/objects/{templateId}/interact`，用 `Hud.hint` 展示返回文本。
 *
 * 后端 `interactObject` 目前对 reward=null 的物件只返回 `{ ok: true }`（无文本字段），
 * 故此处兼容 `text`/`message` 字段：有则展示，无则给出占位文案（地标留言属 S5，接口为 landmarks/:id/messages）。
 */
export class ReadComponent extends InteractComponent {
  readonly kind: InteractType = 'read';

  async interact(ctx: InteractContext): Promise<void> {
    try {
      const res = await Api.interactObject(ctx.target.templateId!, 'read', ctx.token);
      const raw = res as unknown as { text?: unknown; message?: unknown };
      const text = typeof raw?.text === 'string' ? raw.text : raw?.message;
      Hud.hint(typeof text === 'string' && text.trim() ? text : '已阅读（该物件暂无文本内容）');
      Laya.timer.once(READ_HINT_MS, null, () => Hud.hint(null));
      console.log(`[S3] 阅读返回 ${JSON.stringify(res)}`);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message}（code=${err.code}）` : String(err);
      Toast.error(msg);
    }
  }
}