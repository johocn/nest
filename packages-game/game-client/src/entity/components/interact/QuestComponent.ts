import { InteractComponent } from './InteractComponent';
import type { InteractContext, InteractType } from './InteractComponent';
import { Hud } from '../../../ui/Hud';

/**
 * 任务组件：S3 只做**注册位**（任务系统属 S5，后端无双端契约）。
 *
 * 按一致性规则：`canInteract` 保持 true（占位目标要能被选中）、`priority` 取最低值 -1、
 * `interact()` 只给提示、不发请求、不抛异常 —— 否则「任务交互将在后续版本开放」这个出口永远看不到。
 */
export class QuestComponent extends InteractComponent {
  readonly kind: InteractType = 'quest';

  constructor() {
    super();
    this.priority = -1;
  }

  async interact(ctx: InteractContext): Promise<void> {
    Hud.toast('任务交互将在后续版本开放');
  }
}