import { AppConfig } from '../config/AppConfig';
import type { Entity } from '../entity/Entity';

const HUD = AppConfig.hud;

/**
 * 引擎内自绘 HUD：只做 toast / hint / highlight 三件事，H5 与小游戏端一致，不依赖 DOM、不引入 laya.ui 皮肤体系。
 * 只用已验证的基元：`Laya.Sprite` + `graphics.drawRect/drawCircle` + `Laya.Text`。
 * 根节点挂 `Laya.stage` 顶层并设最大 `zOrder`（§3 风险 3）：属**屏幕空间**，不随世界层滚动。
 */
export class Hud {
  private static root: Laya.Sprite | null = null;
  private static toastBox: Laya.Sprite | null = null;
  private static toastText: Laya.Text | null = null;
  private static hintBox: Laya.Sprite | null = null;
  private static hintText: Laya.Text | null = null;
  private static highlightSprite: Laya.Sprite | null = null;
  private static highlightTarget: Entity | null = null;

  /** 必须在 Laya.init 之后（Boot.start 之后）调用；重复调用无副作用 */
  static init(): void {
    if (Hud.root) return;

    const root = new Laya.Sprite();
    root.name = 's3-hud';
    root.mouseEnabled = false;
    root.zOrder = HUD.zOrder;

    Hud.toastBox = new Laya.Sprite();
    Hud.toastText = Hud.makeText(HUD.toastFontSize, HUD.toastTextColor);
    Hud.toastBox.mouseEnabled = false;
    Hud.toastBox.visible = false;
    Hud.toastText.visible = false;

    Hud.hintBox = new Laya.Sprite();
    Hud.hintText = Hud.makeText(HUD.hintFontSize, HUD.hintTextColor);
    Hud.hintBox.mouseEnabled = false;
    Hud.hintText.wordWrap = true;
    // 固定文本域宽度 + hidden 溢出：长文本自动换行，超过 hintMaxLines 直接截断
    Hud.hintText.width = HUD.hintMaxWidth - HUD.hintPadX * 2;
    Hud.hintText.overflow = Laya.Text.HIDDEN;
    Hud.hintText.align = 'center';
    Hud.hintBox.visible = false;
    Hud.hintText.visible = false;

    root.addChild(Hud.toastBox);
    root.addChild(Hud.toastText);
    root.addChild(Hud.hintBox);
    root.addChild(Hud.hintText);
    Laya.stage.addChild(root);
    Hud.root = root;
    console.log(`[S3] Hud 就绪：挂在舞台顶层 zOrder=${HUD.zOrder}（不随世界层滚动）`);
  }

  /** 屏幕中上部短提示，ms 毫秒后自动消失（默认 AppConfig.hud.toastMs） */
  static toast(msg: string, ms: number = HUD.toastMs): void {
    if (!Hud.root) {
      // 引擎未起来时的兜底：不抛错、不阻断启动
      console.log(`[toast] ${msg}`);
      return;
    }
    const text = Hud.toastText!;
    const box = Hud.toastBox!;
    text.text = msg;
    text.visible = true;

    const w = text.textWidth;
    const h = text.textHeight;
    const x = Math.round((AppConfig.stageWidth - w) / 2);
    const y = Math.round(AppConfig.stageHeight * HUD.toastTopRatio - h / 2);
    text.pos(x, y);

    box.visible = true;
    box.graphics.clear();
    box.graphics.drawRect(
      x - HUD.toastPadX,
      y - HUD.toastPadY,
      w + HUD.toastPadX * 2,
      h + HUD.toastPadY * 2,
      HUD.toastBgColor,
    );

    // Timer.once 默认 coverBefore=true：新 toast 直接覆盖上一个的消失计时
    Laya.timer.once(ms, Hud, Hud.hideToast);
  }

  private static hideToast(): void {
    if (Hud.toastBox) Hud.toastBox.visible = false;
    if (Hud.toastText) Hud.toastText.visible = false;
  }

  /** 底部固定提示条；传 null 隐藏 */
  static hint(msg: string | null): void {
    if (!Hud.root) return;
    const text = Hud.hintText!;
    const box = Hud.hintBox!;

    if (!msg) {
      box.visible = false;
      text.visible = false;
      return;
    }

    const barWidth = Math.min(HUD.hintMaxWidth, AppConfig.stageWidth - HUD.hintBottomOffset * 2);
    text.width = barWidth - HUD.hintPadX * 2;
    text.text = msg;
    text.visible = true;

    const lineHeight = HUD.hintFontSize + 4;
    const contentHeight = Math.min(text.textHeight, lineHeight * HUD.hintMaxLines);
    text.height = contentHeight;

    const barHeight = contentHeight + HUD.hintPadY * 2;
    const x = Math.round((AppConfig.stageWidth - barWidth) / 2);
    const y = Math.round(AppConfig.stageHeight - HUD.hintBottomOffset - barHeight);
    text.pos(x + HUD.hintPadX, y + HUD.hintPadY);

    box.visible = true;
    box.graphics.clear();
    box.graphics.drawRect(x, y, barWidth, barHeight, HUD.hintBgColor);
  }

  /**
   * 选中高亮：在目标脚底画光圈（世界空间）；传 null 取消。
   * 实现取「高亮 sprite 挂为目标 sprite 的子节点」：坐标随 TransformComponent 自动跟随，无需每帧重绘，
   * 也不影响 SceneBuilder.resort 的排序键（resort 只重排实体 sprite 本身在实体层的顺序）。
   */
  static highlight(entity: Entity | null): void {
    if (Hud.highlightTarget === entity) return; // 幂等：每帧调用不会重建节点

    Hud.highlightTarget = entity;
    const ring = Hud.highlightSprite ?? (Hud.highlightSprite = new Laya.Sprite());
    if (ring.parent) ring.removeSelf();
    if (!entity) return;

    ring.mouseEnabled = false;
    ring.graphics.clear();
    ring.graphics.drawCircle(
      0,
      0,
      HUD.highlightRadius,
      null,
      HUD.highlightColor,
      HUD.highlightLineWidth,
    );
    entity.sprite.addChild(ring);
  }

  private static makeText(fontSize: number, color: string): Laya.Text {
    const text = new Laya.Text();
    text.fontSize = fontSize;
    text.color = color;
    text.stroke = 2;
    text.strokeColor = '#000000';
    return text;
  }
}