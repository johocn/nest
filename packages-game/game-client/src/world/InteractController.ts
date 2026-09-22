import { AppConfig } from '../config/AppConfig';
import type { Entity, QuestMarkType } from '../entity/Entity';
import { EntityRegistry } from '../entity/EntityRegistry';
import { pickTarget } from '../entity/targeting';
import type { PickedTarget, RadiusOf } from '../entity/targeting';
import { Api } from '../net/api';
import type { DialogueQuestMarks } from '../net/api';
import { ApiError } from '../net/http';
import { Session } from '../net/Session';
import { DialogueView, normalizeChoose } from '../ui/DialogueView';
import type { DialogueNodeView } from '../ui/DialogueView';
import { Hud } from '../ui/Hud';

/** 交互键：Laya 的 KEY_DOWN 事件只代理 nativeEvent.key（不带 keyCode），故用归一化小写 'f' 判定 */
const KEY_INTERACT = 'f';
/** 目标重选节流：每 6 帧（≈100ms）一次，跟手且无谓开销可忽略 */
const PICK_FRAME_INTERVAL = 6;

/**
 * 交互控制（D5：退化为**选择器**）：只做「就近选中 → 高亮/提示 → 把上下文交给选中组件的 interact()」。
 * 选择规则本身在纯模块 `entity/targeting.ts`（可被 node 直接断言）。
 *
 * S5 起额外承担**对话会话编排**（计划 §2 Task 6 Step 2）：talk 成功 → 打开 `DialogueView`；
 * 玩家选择 → `Api.chooseDialogue(code, nodeKey, optionIndex)` → 渲染下一节点 / `finished` 关闭。
 * 服务端权威：`optionIndex` 用服务端返回的 `optionIndexes[i]`，客户端不本地推进、不本地发奖励。
 */
export class InteractController {
  /** 互斥：一次交互未完成时不重复触发 */
  private busy = false;
  /** 上一次已提示的目标 id：提示条只在选中目标变化时重绘 */
  private lastHintId: string | null = null;
  /** 对话会话（无持久会话，随视图开关起止）：choose 需要 code + nodeKey（D7） */
  private dialogue: { code: string; nodeKey: string } | null = null;
  /** 选项请求互斥：连点/连按只发一次（服务端权威，重复请求无意义） */
  private choosing = false;
  /** 本次对话关联的 NPC：任务标记的落点（talk 后该实体头顶显示 `!`/`?`） */
  private markedEntity: Entity | null = null;

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
    // 对话打开时屏蔽交互键 F（避免连点重复请求）；移动是 W/A/S/D，不受影响
    if (DialogueView.isOpen) return;

    // 按键时按同一规则重选一次，避免用上一次节流的结果
    const picked = this.pick();
    if (!picked) {
      Hud.toast('附近没有可交互目标');
      return;
    }

    this.busy = true;
    const target = picked.entity;
    try {
      await picked.component.interact({
        me: this.me,
        target,
        token: Session.token ?? '',
        onDialogue: (view) => this.openDialogue(target, view),
      });
    } finally {
      this.busy = false;
    }
  }

  /** talk 成功 → 打开对话视图，并把服务端下发的任务标记画到该 NPC 头顶（D8） */
  private openDialogue(target: Entity, view: DialogueNodeView): void {
    this.dialogue = { code: view.code, nodeKey: view.nodeKey ?? '' };
    DialogueView.open(view, (optionIndex) => void this.choose(optionIndex));
    this.applyQuestMarks(target, view.questMarks);
  }

  /** 玩家选择 → 服务端推进（`optionIndex` 是服务端原始下标） */
  private async choose(optionIndex: number): Promise<void> {
    if (this.choosing) return;
    const session = this.dialogue;
    if (!session) return;

    this.choosing = true;
    const target = this.markedEntity;
    try {
      const res = await Api.chooseDialogue(
        session.code,
        session.nodeKey,
        optionIndex,
        Session.token ?? '',
      );
      const next = normalizeChoose(res);
      if (next.finished) {
        this.dialogue = null;
        DialogueView.close();
      } else {
        this.dialogue = { code: next.code, nodeKey: next.nodeKey ?? '' };
        DialogueView.render(next);
      }
      // 动作（如接任务）已改变玩家状态：用 talk 的权威 questMarks 刷新头顶标记
      void this.refreshQuestMarks(target);
    } catch (err) {
      // 失败不推进节点（D3）：红字提示，玩家可清包后重选
      if (err instanceof ApiError) DialogueView.showError(err.code, err.message);
      else DialogueView.showError(-1, String(err));
    } finally {
      this.choosing = false;
    }
  }

  /**
   * 刷新头顶任务标记：`talk` 是唯一权威来源（不新造接口）。
   * 进场景时拿不到 questMarks（`world.enter-scene` 无该字段），故只在 talk / choose 后更新；
   * 刷新失败只记日志，不影响对话本身。
   */
  private async refreshQuestMarks(target: Entity | null): Promise<void> {
    if (!target || target.spawnId === null) return;
    try {
      const res = await Api.talkNpc(target.spawnId, Session.token ?? '');
      this.applyQuestMarks(target, res.questMarks);
    } catch (err) {
      console.warn(`[S5] 任务标记刷新失败：${String(err)}`);
    }
  }

  /** 可交优先于可接：两类都有时显示绿色 `?`（交任务更紧急） */
  private applyQuestMarks(target: Entity, marks?: DialogueQuestMarks): void {
    if (!marks) return;
    let mark: QuestMarkType | null = null;
    if ((marks.submittable?.length ?? 0) > 0) mark = 'submittable';
    else if ((marks.available?.length ?? 0) > 0) mark = 'available';
    target.setQuestMark(mark);
    this.markedEntity = mark ? target : null;
  }
}