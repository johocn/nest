import { AppConfig } from './AppConfig';
import { Platform } from '../platform/Platform';
import type { ManifestScene, SceneConfig, SceneManifest } from './schema';
import { validateSceneConfig } from './validate';

export class ConfigLoader {
  /** 本地版本缓存前缀：key = `${前缀}scene-<id>-v<n>:<hash>`（hash 变化即视为未命中） */
  private static readonly CACHE_PREFIX = 's2:scene-config:';

  /** 小游戏端读包内文件（config/xxx.json），H5 端走 HTTP */
  private static async readText(file: string): Promise<string> {
    if (Platform.isMiniGame()) {
      const text = Platform.readLocalText(`config/${file}`);
      if (text === null) {
        throw new Error(`小游戏包内缺少 config/${file}（请把服务端 gamedata 产物复制进导出目录 config/）`);
      }
      return text;
    }
    return ConfigLoader.fetchText(file);
  }

  /** H5 端从服务端 /gamedata 拉取单个文件 */
  private static async fetchText(file: string): Promise<string> {
    const res = await fetch(`${AppConfig.configBase}/${file}`);
    if (!res.ok) throw new Error(`配置加载失败 HTTP ${res.status}（${file}）`);
    return res.text();
  }

  /**
   * 取场景配置文本：H5 端先按 `scene-<id>-v<n>`（key 含 manifest 的 version+hash）读本地缓存，
   * 命中且 hash 校验通过即跳过拉取；未命中/不符则从 /gamedata 拉取并写缓存。
   * 小游戏端仍读包内 config/，不经过缓存。
   */
  private static async readSceneText(item: ManifestScene): Promise<string> {
    if (Platform.isMiniGame()) return ConfigLoader.readText(item.file);

    const key = `${ConfigLoader.CACHE_PREFIX}scene-${item.sceneId}-v${item.version}:${item.hash}`;
    const cached = Platform.storageGet(key);
    if (cached !== null && (await ConfigLoader.sha256(cached)) === item.hash) {
      console.log(`[S2] 配置包缓存命中 ${item.file}（${key}）`);
      return cached;
    }

    const text = await ConfigLoader.fetchText(item.file);
    Platform.storageSet(key, text);
    console.log(`[S2] 配置包已拉取并写入缓存 ${item.file}（${key}）`);
    return text;
  }

  static async loadManifest(): Promise<SceneManifest> {
    const manifest = JSON.parse(await ConfigLoader.readText('manifest.json')) as SceneManifest;
    if (!manifest || !Array.isArray(manifest.scenes) || manifest.scenes.length === 0) {
      throw new Error('配置清单为空（请先执行 npm run config:export && npm run config:publish）');
    }
    return manifest;
  }

  /** 按 sceneId 取配置；sceneId 缺省时取清单第一项（S1 只有一个场景） */
  static async loadScene(sceneId?: number): Promise<SceneConfig> {
    const manifest = await ConfigLoader.loadManifest();
    const item: ManifestScene =
      manifest.scenes.find((s) => s.sceneId === sceneId) ?? manifest.scenes[0];

    const text = await ConfigLoader.readSceneText(item);

    await ConfigLoader.verifyHash(text, item.hash, item.file);

    const cfg = validateSceneConfig(JSON.parse(text), item.file);
    console.log(
      `[S2] 配置包就绪 ${item.file} sceneId=${cfg.sceneId} v${cfg.version} 静态物件=${cfg.staticEntities.length} NPC=${cfg.fixedNpcs.length} 触发器=${cfg.triggers.length}`,
    );
    return cfg;
  }

  /** 返回 `sha256:<hex>`；环境无 crypto.subtle 时返回 null，由调用方决定降级策略 */
  private static async sha256(text: string): Promise<string | null> {
    const subtle = (globalThis.crypto as any)?.subtle;
    if (!subtle || typeof TextEncoder === 'undefined') return null;
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `sha256:${hex}`;
  }

  /** manifest.hash = 场景文件原始文本的 sha256（与 game-server 侧导出算法逐字一致） */
  private static async verifyHash(text: string, expected: string, file: string): Promise<void> {
    const actual = await ConfigLoader.sha256(text);
    if (actual === null) {
      console.warn(`[S2] 当前环境无 crypto.subtle，跳过 ${file} 哈希校验`);
      return;
    }
    if (actual !== expected) {
      throw new Error(`配置包哈希校验失败 ${file}：实际 ${actual.slice(0, 20)}… 期望 ${expected.slice(0, 20)}…`);
    }
    console.log(`[S2] 配置包哈希校验通过 ${file}`);
  }
}