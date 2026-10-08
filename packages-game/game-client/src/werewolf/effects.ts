import { AppConfig } from '../config/AppConfig';

const WW = AppConfig.werewolf;

/**
 * 狼人杀特效集合：全部基于 Laya.Sprite / Graphics / Text 自绘 + Laya.Tween，
 * 不依赖 DOM，与框架既有 UI（Hud/Dialogue）风格一致。无外部依赖，可独立复用。
 */

type Sprite = Laya.Sprite;
type Graphics = Laya.Graphics;
type Text = Laya.Text;

export function tween(
  target: any,
  props: Record<string, number>,
  duration: number,
  onComplete?: () => void,
): void {
  // Laya 3.x 的 Tween.to 完成回调类型为 Handler，需用 Handler.create 包装
  Laya.Tween.to(
    target,
    props,
    duration,
    Laya.Ease.cubicOut,
    onComplete ? Laya.Handler.create(null, onComplete) : null,
  );
}

/** 全屏转场覆盖层：夜=深蓝、昼=暖蓝，叠加月亮/太阳升起，对标主流狼人杀昼夜切换 */
export function playPhaseTransition(
  overlay: Sprite,
  kind: 'night' | 'day',
): void {
  const color = kind === 'night' ? WW.nightColor : WW.dayColor;
  overlay.graphics.clear();
  overlay.graphics.drawRect(
    0,
    0,
    AppConfig.stageWidth,
    AppConfig.stageHeight,
    color,
  );
  overlay.alpha = 0;
  overlay.visible = true;

  // 天体：夜=月、昼=日
  let body = overlay.getChildByName('celestial') as Sprite | null;
  if (!body) {
    body = new Laya.Sprite();
    body.name = 'celestial';
    overlay.addChild(body);
  }
  body.graphics.clear();
  const cx = AppConfig.stageWidth / 2;
  const r = 46;
  body.graphics.drawCircle(0, 0, r, kind === 'night' ? '#e8eefc' : '#ffd75e');
  if (kind === 'night') {
    // 月牙：盖一个偏移圆做出缺口
    body.graphics.drawCircle(16, -8, r, WW.nightColor);
  }
  body.pos(cx, AppConfig.stageHeight + 80);

  tween(overlay, { alpha: 0.92 }, WW.transitionMs);
  tween(body, { y: AppConfig.stageHeight * 0.32 }, WW.transitionMs, () => {
    // 停留后淡出，露出桌面
    Laya.timer.once(420, null, () => {
      tween(
        overlay,
        { alpha: 0 },
        WW.transitionMs,
        () => (overlay.visible = false),
      );
    });
  });
}

/** 死亡特效：抖动 → 灰幕 + 骷髅闪 → 降至半透明（标亡） */
export function playDeath(card: Sprite, onMid?: () => void): void {
  const ox = card.x;
  let n = 0;
  const shake = () => {
    if (n++ > 6) {
      card.x = ox;
      applyGrayVeil(card);
      return;
    }
    card.x = ox + (n % 2 === 0 ? 6 : -6);
    Laya.timer.once(40, null, shake);
  };
  shake();

  const skull = new Laya.Text();
  skull.text = '☠';
  skull.fontSize = 40;
  skull.color = WW.deathSkullColor;
  skull.pos(card.width / 2 - 20, card.height / 2 - 24);
  skull.alpha = 0;
  card.addChild(skull);
  tween(skull, { alpha: 1 }, 180, () => {
    Laya.timer.once(360, null, () =>
      tween(skull, { alpha: 0 }, 240, () => skull.removeSelf()),
    );
  });
  onMid?.();
}

function applyGrayVeil(card: Sprite): void {
  let veil = card.getChildByName('veil') as Sprite | null;
  if (!veil) {
    veil = new Laya.Sprite();
    veil.name = 'veil';
    card.addChild(veil);
  }
  veil.graphics.clear();
  veil.graphics.drawRect(0, 0, card.width, card.height, 'rgba(20,22,28,0.62)');
  card.alpha = WW.deathFadeAlpha;
}

/** 角色翻牌：横向缩放翻面，翻面瞬间换色/换名，对标主流身份揭示动画 */
export function revealCard(card: Sprite, applyVisuals: () => void): void {
  tween(card, { scaleX: 0 }, WW.revealMs / 2, () => {
    applyVisuals();
    tween(card, { scaleX: 1 }, WW.revealMs / 2);
  });
}

/** 倒计时环：用 drawPie 画剩余比例扇形（frac=1 满环，0 空） */
export function drawCountdownRing(g: Sprite, frac: number): void {
  const r = WW.ringRadius;
  g.graphics.clear();
  g.graphics.drawCircle(0, 0, r, WW.ringBgColor);
  const f = Math.max(0, Math.min(1, frac));
  const start = -90;
  const end = -90 + 360 * f;
  const color = f < 0.25 ? WW.ringDangerColor : WW.ringFgColor;
  if (f > 0) g.graphics.drawPie(0, 0, r, start, end, color);
}

/** 票数/进度条：按 frac 横向增长 */
export function drawBar(
  g: Sprite,
  w: number,
  h: number,
  frac: number,
  color: string,
): void {
  g.graphics.clear();
  g.graphics.drawRect(0, 0, w, h, 'rgba(255,255,255,0.12)');
  const fw = Math.max(0, Math.min(1, frac)) * w;
  if (fw > 0) g.graphics.drawRect(0, 0, fw, h, color);
}

/** 横幅弹出：缩放回弹 + 高亮扫光 */
export function bannerPop(banner: Sprite): void {
  banner.scaleX = 0.6;
  banner.scaleY = 0.6;
  banner.alpha = 0;
  tween(banner, { scaleX: 1, scaleY: 1, alpha: 1 }, 280);
  const sweep = banner.getChildByName('sweep') as Sprite | null;
  if (sweep) {
    sweep.x = -banner.width;
    tween(sweep, { x: banner.width }, 420);
  }
}
