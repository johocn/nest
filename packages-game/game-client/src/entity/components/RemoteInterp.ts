import { AppConfig } from '../../config/AppConfig';
import { Quality } from '../../perf/Quality';
import { quantizeTarget, stepInterp } from '../interp';
import { Component } from './Component';

/**
 * S8 Task 5：远端实体位置插值组件（D6：**只作用于远端实体**，本地玩家保持即时）。
 *
 * 缺口：广播到达即 `setPos` → 10Hz 广播把「每 100ms 移动 ~24px」变成位置跳变。
 * 处置：广播只**覆盖插值目标**（不排队），由 `update(dt)` 每帧按 `AppConfig.remote.interpBufferMs`
 * 指数平滑逼近；距离超过 `snapPx` 直接对齐（计划风险 #5：离屏被裁剪冻结后重入不许缓慢爬行）。
 *
 * 复用的复位入口（计划 Task 5 硬要求）：`Entity.reset` **不碰 extras 组件**，池适配器
 * （`world/entity-pool-adapter.reset`）必须在 `entity.reset(...)` 之后显式调 `snapTo(spec.x, spec.y)`，
 * 否则复用的远端玩家会从上一个玩家的旧目标点插值过来（幽灵位移）。
 *
 * 降级接线（D3-④⑤，此前无人消费的两个开关）：
 * - `interpPrecision='reduced'` → 目标点取整（省亚像素状态；因 Transform 写 sprite 本就取整，视觉差异为 0）；
 * - `remoteUpdateHz` → 节流**位置更新应用频率**（low 档 5Hz）。**丢弃的更新直接忽略**：插值仍在平滑，
 *   丢一半只是目标点更新稀疏一点，不产生可见跳变；且这**只影响表现、不影响权威数据**
 *   （位置只在收到广播时被更新，权威值仍来自服务端）。
 *
 * 本组件不做预测/回滚/帧同步（计划 §1.8 明确不做），也不改任何 WS 契约字段。
 */
export class RemoteInterp extends Component {
  /** 本地表现位置（浮点；写 sprite 时由 TransformComponent 取整） */
  private curX = 0;
  private curY = 0;
  /** 当前插值目标（最近一次被采纳的广播位置） */
  private targetX = 0;
  private targetY = 0;
  /** 是否已对齐过目标：未对齐（新挂载、未经 snapTo/setTarget）时 `update` 不做任何事 */
  private active = false;
  /** 上一次**真正采纳**广播的时间戳（节流用）；0 = 无历史 */
  private lastAppliedAt = 0;

  /** 新广播：覆盖目标点（不排队）。首包（尚未对齐）直接对齐，避免从 (0,0) 爬过来 */
  setTarget(x: number, y: number): void {
    const sw = Quality.switches();
    const now = Date.now();
    const minInterval = minIntervalMs(sw.remoteUpdateHz);
    if (this.lastAppliedAt > 0 && now - this.lastAppliedAt < minInterval) return;

    this.lastAppliedAt = now;
    const p = quantizeTarget(x, y, sw.interpPrecision);
    if (!this.active) {
      this.apply(p.x, p.y);
      return;
    }
    this.targetX = p.x;
    this.targetY = p.y;
  }

  /** 立即对齐并清目标（新建 / 池复用 / 复位用）；同时清节流历史，保证下一包必被采纳 */
  snapTo(x: number, y: number): void {
    this.lastAppliedAt = 0;
    const p = quantizeTarget(x, y, Quality.switches().interpPrecision);
    this.apply(p.x, p.y);
  }

  /** 逐帧平滑逼近（由 `EntityRegistry.updateAll` 驱动；离屏被裁剪冻结时会累积距离，重入即 snap） */
  update(dtMs: number): void {
    if (!this.active) return;
    const { interpBufferMs, snapPx } = AppConfig.remote;
    const next = stepInterp(
      { x: this.curX, y: this.curY },
      { x: this.targetX, y: this.targetY },
      dtMs,
      interpBufferMs,
      snapPx,
    );
    if (next.x === this.curX && next.y === this.curY) return;
    this.curX = next.x;
    this.curY = next.y;
    this.owner?.setPos(this.curX, this.curY);
  }

  /** 状态快照（点检/断言用） */
  snapshot(): { x: number; y: number; targetX: number; targetY: number; active: boolean } {
    return {
      x: this.curX,
      y: this.curY,
      targetX: this.targetX,
      targetY: this.targetY,
      active: this.active,
    };
  }

  private apply(x: number, y: number): void {
    this.curX = x;
    this.curY = y;
    this.targetX = x;
    this.targetY = y;
    this.active = true;
    this.owner?.setPos(x, y);
  }
}

/**
 * 节流间隔：`1000/hz × 松弛比例`。
 * 零松弛会在「服务端 10Hz 广播」与「high 档 10Hz 节流」同频时因网络/帧抖动**丢掉一半更新**
 * （插值退化为 5Hz）；保留 20% 松弛后 high 档生效间隔 80ms < 100ms，常态零丢弃；
 * low 档 5Hz → 160ms，仍按预期丢弃一半（这正是 D3-⑤ 想要的效果）。
 */
function minIntervalMs(hz: number): number {
  if (!(hz > 0)) return 0;
  return (1000 / hz) * AppConfig.remote.throttleSlackRatio;
}