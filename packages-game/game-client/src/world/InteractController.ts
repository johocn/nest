import { AppConfig } from '../config/AppConfig';
import type { Entity } from '../entity/Entity';
import { EntityRegistry } from '../entity/EntityRegistry';
import { Api } from '../net/api';
import { ApiError } from '../net/http';
import { Session } from '../net/Session';
import { Toast } from '../ui/Toast';

/** 交互键：Laya 的 KEY_DOWN 事件只代理 nativeEvent.key，故用小写 'f' 判定 */
const KEY_INTERACT = 'f';

export class InteractController {
  private busy = false;
  private lastHintId: string | null = null;

  constructor(private readonly me: Entity) {}

  attach(): void {
    Laya.stage.on(Laya.Event.KEY_DOWN, this, this.onKeyDown);
    Laya.timer.frameLoop(6, this, this.updateHint);
    console.log(
      `[S1] 交互控制就绪：靠近 ${AppConfig.interactRadius}px 内按 F（NPC → npcs/:spawnId/talk；物件 → objects/:id/interact）`,
    );
  }

  nearest(): Entity | null {
    let best: Entity | null = null;
    let bestDist = AppConfig.interactRadius;
    for (const e of EntityRegistry.all()) {
      if (e.kind === 'player') continue;
      const d = this.me.distanceTo(e);
      if (d <= bestDist) {
        best = e;
        bestDist = d;
      }
    }
    return best;
  }

  private updateHint(): void {
    const target = this.nearest();
    const id = target ? target.entityId : null;
    if (id !== this.lastHintId) {
      this.lastHintId = id;
      if (target) Toast.info(`按 F 交互：${target.entityId}`);
    }
  }

  private async onKeyDown(e: Laya.Event): Promise<void> {
    const key = String((e as unknown as { key?: string }).key ?? '').toLowerCase();
    if (key !== KEY_INTERACT || this.busy) return;

    const target = this.nearest();
    if (!target) {
      Toast.info('附近没有可交互目标');
      return;
    }

    this.busy = true;
    try {
      if (target.kind === 'npc') {
        const res = await Api.talkNpc(target.spawnId!, Session.token);
        Toast.info(`${res.name}：${res.text}`);
        console.log(`[S1] 对话返回 ${JSON.stringify(res)}`);
      } else {
        // S3 Task 1：Entity.interactType 已删除，物件交互类型暂以 'collect' 兜底；
        // 真正的 kind 派发在 Task 4/5 由 InteractComponent 承载（本 Task 不改派发逻辑）。
        const res = await Api.interactObject(target.templateId!, 'collect', Session.token);
        const amount = res?.reward?.amount;
        Toast.info(
          amount ? `采集成功，获得 ${amount} ${res.reward?.currencyType ?? ''}` : '交互成功',
        );
        console.log(`[S1] 采集返回 ${JSON.stringify(res)}`);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message}（code=${err.code}）` : String(err);
      Toast.error(msg);
    } finally {
      this.busy = false;
    }
  }
}