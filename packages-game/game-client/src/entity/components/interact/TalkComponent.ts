import { InteractComponent } from './InteractComponent';
import type { InteractContext, InteractType } from './InteractComponent';
import { Api } from '../../../net/api';
import { ApiError } from '../../../net/http';
import { Toast } from '../../../ui/Toast';
import { Hud } from '../../../ui/Hud';
import { normalizeTalk } from '../../../ui/DialogueView';

/**
 * NPC 对话组件（`NpcInteractType.TALK`）：`POST api/client/v1/world/npcs/{spawnId}/talk`。
 * 入参是 `scene_entity_spawns.id`（配置包 fixedNpcs[].spawnId），**不是 npc_template_id**。
 *
 * S5：talk 成功且服务端下发了对话编码（`res.code`）→ 归一化为对话视图交给控制器打开 `DialogueView`；
 * 未接入对话树的老 NPC（无 `code`，走 `attr.greeting` 兜底）保持 S1 的单句 Toast 行为。
 * 组件**不本地推进对话**：选项一律由控制器回 `POST /world/dialogue/choose`。
 *
 * `priority` 高于物件 —— 人与物重叠时人优先被选中（D3）。
 *
 * S4 限制：随机/巡逻 NPC 的 id 形如 `npcs:<ruleId>:<slot>`，**无对应 `scene_entity_spawns` 行**
 * （`spawnId` 为 null），服务端 talk 按 spawnId 寻址故暂不可对话 → 只给提示、不发请求。
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
      console.log(`[S5] 对话返回 ${JSON.stringify(res)}`);
      if (res.code) {
        ctx.onDialogue?.(normalizeTalk(res));
        return;
      }
      // 未接入对话树的兜底（S1 行为，字段与语义零变更）
      Hud.toast(`${res.name}：${res.text}`);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message}（code=${err.code}）` : String(err);
      Toast.error(msg);
    }
  }
}