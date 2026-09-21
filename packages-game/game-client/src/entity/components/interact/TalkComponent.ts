import { InteractComponent } from './InteractComponent';
import type { InteractContext, InteractType } from './InteractComponent';
import { Api } from '../../../net/api';
import { ApiError } from '../../../net/http';
import { Toast } from '../../../ui/Toast';
import { Hud } from '../../../ui/Hud';

/**
 * NPC 对话组件（`NpcInteractType.TALK`）：`POST api/client/v1/world/npcs/{spawnId}/talk`。
 * 入参是 `scene_entity_spawns.id`（配置包 fixedNpcs[].spawnId），**不是 npc_template_id**。
 *
 * 沿用 S1 的单轮文案（对话树属 S5）；`priority` 高于物件 —— 人与物重叠时人优先被选中（D3）。
 *
 * S4 限制：随机/巡逻 NPC 的 id 形如 `npcs:<ruleId>:<slot>`，**无对应 `scene_entity_spawns` 行**
 * （`spawnId` 为 null），服务端 talk 按 spawnId 寻址故暂不可对话 → 只给提示、不发请求（扩展留 S5）。
 */
export class TalkComponent extends InteractComponent {
  readonly kind: InteractType = 'talk';

  priority = 10;

  async interact(ctx: InteractContext): Promise<void> {
    if (ctx.target.spawnId === null) {
      Hud.toast('该 NPC 暂不可对话');
      return;
    }
    try {
      const res = await Api.talkNpc(ctx.target.spawnId, ctx.token);
      Hud.toast(`${res.name}：${res.text}`);
      console.log(`[S3] 对话返回 ${JSON.stringify(res)}`);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message}（code=${err.code}）` : String(err);
      Toast.error(msg);
    }
  }
}