import { AppConfig } from './AppConfig';
import { Platform } from '../platform/Platform';
import type { ManifestScene, SceneConfig, SceneManifest } from './schema';
import { validateSceneConfig } from './validate';

export class ConfigLoader {
  /** 小游戏端读包内文件（config/xxx.json），H5 端走 HTTP */
  private static async readText(file: string): Promise<string> {
    if (Platform.isMiniGame()) {
      const text = Platform.readLocalText(`config/${file}`);
      if (text === null) {
        throw new Error(`小游戏包内缺少 config/${file}（请把 assets/config 复制进导出目录）`);
      }
      return text;
    }
    const res = await fetch(`${AppConfig.configBase}/${file}`);
    if (!res.ok) throw new Error(`配置加载失败 HTTP ${res.status}（${file}）`);
    return res.text();
  }

  static async loadManifest(): Promise<SceneManifest> {
    const manifest = JSON.parse(await ConfigLoader.readText('manifest.json')) as SceneManifest;
    if (!manifest || !Array.isArray(manifest.scenes) || manifest.scenes.length === 0) {
      throw new Error('配置清单为空（请先执行 npm run seed:scene-spike）');
    }
    return manifest;
  }

  /** 按 sceneId 取配置；sceneId 缺省时取清单第一项（S1 只有一个场景） */
  static async loadScene(sceneId?: number): Promise<SceneConfig> {
    const manifest = await ConfigLoader.loadManifest();
    const item: ManifestScene =
      manifest.scenes.find((s) => s.sceneId === sceneId) ?? manifest.scenes[0];

    const text = await ConfigLoader.readText(item.file);

    await ConfigLoader.verifyHash(text, item.hash, item.file);

    const cfg = validateSceneConfig(JSON.parse(text), item.file);
    console.log(
      `[S1] 配置包就绪 ${item.file} sceneId=${cfg.sceneId} v${cfg.version} 静态物件=${cfg.staticEntities.length} NPC=${cfg.fixedNpcs.length} 触发器=${cfg.triggers.length}`,
    );
    return cfg;
  }

  /** manifest.hash = 场景文件原始文本的 sha256（与 seeds/scene-spike.seed.ts 的算法一致） */
  private static async verifyHash(text: string, expected: string, file: string): Promise<void> {
    const subtle = (globalThis.crypto as any)?.subtle;
    if (!subtle || typeof TextEncoder === 'undefined') {
      console.warn(`[S1] 当前环境无 crypto.subtle，跳过 ${file} 哈希校验`);
      return;
    }
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const actual = `sha256:${hex}`;
    if (actual !== expected) {
      throw new Error(`配置包哈希校验失败 ${file}：实际 ${actual.slice(0, 20)}… 期望 ${expected.slice(0, 20)}…`);
    }
    console.log(`[S1] 配置包哈希校验通过 ${file}`);
  }
}