import { AppConfig } from '../config/AppConfig';

/**
 * 实体/背景贴图注册表（S9 Task 3 Step 3）。
 *
 * 口径（零映射表）：贴图路径 = `${AppConfig.assetBase}resources/<resKey>.png`，
 * `resKey` 原文即相对路径 —— `npc/elder_01` → `/assets/resources/npc/elder_01.png`。
 *
 * 素材未交付时 `get()` 一律返回 `null`，由调用方回退占位贴图：缺图不抛错、不阻塞启动或进场景。
 * 实测（LayaAir 3.4.1）：404 时 `Laya.loader.load()` **resolve(null)**（不 reject，也不会挂起），
 * 但仍 `try/catch` 兜住其它异常路径。
 *
 * ⚠️ `Laya.loader` 在 `Laya.init` 之前为 undefined，故只可在 boot 之后调用。
 */
export class TextureRegistry {
  /** resKey → 已加载真图 */
  private static readonly cache = new Map<string, Laya.Texture>();
  /** 已确认缺失的 resKey：避免场景重建时对同一缺图反复 404 重试 */
  private static readonly missing = new Set<string>();

  /** resKey → 资源 URL */
  static urlOf(resKey: string): string {
    return `${AppConfig.assetBase}resources/${resKey}.png`;
  }

  /** 命中缓存返回真图；未加载/无 key/曾缺失 → null（同步路径，供表现层安全调用） */
  static get(resKey: string): Laya.Texture | null {
    if (!resKey) return null;
    return TextureRegistry.cache.get(resKey) ?? null;
  }

  /** 加载并缓存单张；缺图归一为 null */
  static async load(resKey: string): Promise<Laya.Texture | null> {
    if (!resKey || TextureRegistry.missing.has(resKey)) return null;
    const cached = TextureRegistry.cache.get(resKey);
    if (cached) return cached;

    const url = TextureRegistry.urlOf(resKey);
    try {
      await Laya.loader.load(url);
    } catch {
      TextureRegistry.missing.add(resKey);
      return null;
    }
    const tex = (Laya.Loader.getRes(url) as Laya.Texture) ?? null;
    if (tex) TextureRegistry.cache.set(resKey, tex);
    else TextureRegistry.missing.add(resKey);
    return tex;
  }

  /** 批量预加载（进场景前调用）：逐个容错，任一缺失不影响其余资源 */
  static async preload(resKeys: readonly string[]): Promise<void> {
    const keys = [...new Set(resKeys.filter((k) => !!k))];
    const loaded = await Promise.all(keys.map((k) => TextureRegistry.load(k)));
    const hit = loaded.filter((t) => !!t).length;
    console.log(
      `[S9] 贴图预加载 ${hit}/${keys.length} 命中${hit < keys.length ? '（未命中者回退占位贴图）' : ''}`,
    );
  }
}