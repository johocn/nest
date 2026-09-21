import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NpcTemplate,
  ObjectTemplate,
  Scene,
  SceneEntitySpawn,
  SceneTrigger,
} from '../entities';
import { SceneConfigVersion } from './entities/scene-config-version.entity';
import { buildScenePayload, sha256 } from './scene-package.builder';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { SceneConfigStatus } from '@constants/enums';
import { AdminService } from '@modules/admin/admin.service';

const MANIFEST_FILE = 'manifest.json';

/** manifest.json 结构：客户端只按它拉取并校验 hash */
export interface SceneManifest {
  generatedAt: string;
  scenes: Array<{
    sceneId: number;
    version: number;
    /** 配置文件文本的 sha256 */
    hash: string;
    /** 产物文件名（相对 gamedata 目录） */
    file: string;
  }>;
}

export interface SceneConfigListItem {
  sceneId: number;
  name: string;
  sceneType: string;
  status: string;
  published: {
    version: number;
    hash: string;
    file: string;
    publishedAt: Date | null;
  } | null;
}

/**
 * 配置包产物目录：GAMEDATA_DIR 优先，否则 <cwd>/gamedata。
 * 不用 __dirname 推导层级：dev(dist) 与 jest(src) 下层级不同；cwd 在 nest 与 systemd 下都是 game-server 根。
 */
export function resolveGamedataDir(): string {
  return process.env.GAMEDATA_DIR || join(process.cwd(), 'gamedata');
}

@Injectable()
export class SceneConfigService {
  private readonly gamedataDir = resolveGamedataDir();

  constructor(
    @InjectRepository(Scene)
    private readonly sceneRepo: Repository<Scene>,
    @InjectRepository(SceneEntitySpawn)
    private readonly spawnRepo: Repository<SceneEntitySpawn>,
    @InjectRepository(SceneTrigger)
    private readonly triggerRepo: Repository<SceneTrigger>,
    @InjectRepository(ObjectTemplate)
    private readonly objectRepo: Repository<ObjectTemplate>,
    @InjectRepository(NpcTemplate)
    private readonly npcRepo: Repository<NpcTemplate>,
    @InjectRepository(SceneConfigVersion)
    private readonly versionRepo: Repository<SceneConfigVersion>,
    private readonly adminService: AdminService,
  ) {
    console.log(`[scene-config] 配置包目录: ${this.gamedataDir}`);
  }

  /** 导出配置包：写产物文件 + 落库 draft（版本号 = 同场景 max(version)+1） */
  async exportScene(
    sceneId: string,
    adminId: string,
  ): Promise<SceneConfigVersion> {
    const scene = await this.sceneRepo.findOne({ where: { id: sceneId } });
    if (!scene) {
      throw new GameException(
        ErrorCodes.PARAM_INVALID,
        `场景不存在: ${sceneId}`,
      );
    }

    const latest = await this.versionRepo.findOne({
      where: { sceneId: scene.id },
      order: { version: 'DESC' },
    });
    const version = (latest?.version ?? 0) + 1;

    const [spawns, triggers, objectTemplates, npcTemplates] = await Promise.all(
      [
        this.spawnRepo.find({
          where: { sceneId: scene.id, isActive: true },
          order: { id: 'ASC' },
        }),
        this.triggerRepo.find({
          where: { sceneId: scene.id },
          order: { id: 'ASC' },
        }),
        this.objectRepo.find(),
        this.npcRepo.find(),
      ],
    );

    const { payload, payloadHash } = buildScenePayload({
      scene,
      version,
      spawns,
      objectTemplates,
      npcTemplates,
      triggers,
    });

    const fileName = `scene-${Number(scene.id)}-v${version}.json`;
    // hash 必须是文件里的最后一个键（客户端按文本 sha256 校验，格式与 S1 产物一致）
    const fileText = `${JSON.stringify({ ...payload, hash: payloadHash }, null, 2)}\n`;
    this.writeGamedataFile(fileName, fileText);

    const saved = await this.versionRepo.save(
      this.versionRepo.create({
        sceneId: scene.id,
        version,
        hash: sha256(fileText),
        filePath: fileName,
        status: SceneConfigStatus.DRAFT,
        publishedAt: null,
        payloadHash,
        createdBy: adminId,
      }),
    );

    await this.adminService.logOperation({
      adminId,
      operation: 'scene-config.export',
      changeBefore: {},
      changeAfter: {
        sceneId: Number(scene.id),
        version: saved.version,
        hash: saved.hash,
        file: fileName,
      },
    });

    return saved;
  }

  /** 发布指定版本：同场景其他 published 置 archived，并重建 manifest */
  async publishScene(
    sceneId: string,
    version: number,
    adminId: string,
  ): Promise<SceneConfigVersion> {
    const target = await this.findVersion(sceneId, version);

    await this.versionRepo.update(
      { sceneId: String(sceneId), status: SceneConfigStatus.PUBLISHED },
      { status: SceneConfigStatus.ARCHIVED },
    );

    target.status = SceneConfigStatus.PUBLISHED;
    target.publishedAt = new Date();
    const saved = await this.versionRepo.save(target);

    await this.rebuildManifest();

    await this.adminService.logOperation({
      adminId,
      operation: 'scene-config.publish',
      changeBefore: { sceneId: Number(sceneId), version },
      changeAfter: {
        sceneId: Number(sceneId),
        version: saved.version,
        hash: saved.hash,
        file: saved.filePath,
      },
    });

    return saved;
  }

  /** 回滚：目标版本置 published、当前 published 置 archived，并重建 manifest */
  async rollbackScene(
    sceneId: string,
    version: number,
    adminId: string,
  ): Promise<SceneConfigVersion> {
    const target = await this.findVersion(sceneId, version);

    const current = await this.versionRepo.findOne({
      where: { sceneId: String(sceneId), status: SceneConfigStatus.PUBLISHED },
    });
    if (!current) {
      throw new GameException(
        ErrorCodes.CONFIG_ROLLBACK_FAILED,
        `场景 ${sceneId} 当前没有已发布版本，无法回滚`,
      );
    }
    if (version >= current.version) {
      throw new GameException(
        ErrorCodes.CONFIG_ROLLBACK_FAILED,
        `只能回滚到更早版本（当前已发布 v${current.version}）`,
      );
    }

    const changeBefore = {
      sceneId: Number(sceneId),
      version: current.version,
      publishedAt: current.publishedAt,
    };

    current.status = SceneConfigStatus.ARCHIVED;
    await this.versionRepo.save(current);

    target.status = SceneConfigStatus.PUBLISHED;
    target.publishedAt = new Date();
    const saved = await this.versionRepo.save(target);

    await this.rebuildManifest();

    await this.adminService.logOperation({
      adminId,
      operation: 'scene-config.rollback',
      changeBefore,
      changeAfter: {
        sceneId: Number(sceneId),
        version: saved.version,
        hash: saved.hash,
        file: saved.filePath,
      },
    });

    return saved;
  }

  /** 重建 manifest：每个场景只列当前 published 版本（draft 不对外） */
  async rebuildManifest(): Promise<SceneManifest> {
    const published = await this.versionRepo.find({
      where: { status: SceneConfigStatus.PUBLISHED },
      order: { sceneId: 'ASC' },
    });

    const manifest: SceneManifest = {
      generatedAt: new Date().toISOString(),
      scenes: published.map((row) => ({
        sceneId: Number(row.sceneId),
        version: row.version,
        hash: row.hash,
        file: row.filePath,
      })),
    };

    this.writeGamedataFile(
      MANIFEST_FILE,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    return manifest;
  }

  /** 版本历史（按版本倒序分页） */
  async listVersions(
    sceneId: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: SceneConfigVersion[]; total: number }> {
    const [items, total] = await this.versionRepo.findAndCount({
      where: { sceneId: String(sceneId) },
      skip: (page - 1) * limit,
      take: limit,
      order: { version: 'DESC' },
    });
    return { items, total };
  }

  /** 场景列表 + 各自当前 published 版本 */
  async listScenes(): Promise<{
    items: SceneConfigListItem[];
    total: number;
  }> {
    const scenes = await this.sceneRepo.find({ order: { id: 'ASC' } });
    const published = await this.versionRepo.find({
      where: { status: SceneConfigStatus.PUBLISHED },
    });
    const publishedByScene = new Map(
      published.map((row) => [String(row.sceneId), row]),
    );

    const items = scenes.map((scene) => {
      const row = publishedByScene.get(scene.id);
      return {
        sceneId: Number(scene.id),
        name: scene.name,
        sceneType: scene.sceneType,
        status: scene.status,
        published: row
          ? {
              version: row.version,
              hash: row.hash,
              file: row.filePath,
              publishedAt: row.publishedAt,
            }
          : null,
      };
    });

    return { items, total: items.length };
  }

  private async findVersion(
    sceneId: string | number,
    version: number,
  ): Promise<SceneConfigVersion> {
    const row = await this.versionRepo.findOne({
      where: { sceneId: String(sceneId), version },
    });
    if (!row) {
      throw new GameException(
        ErrorCodes.CONFIG_VERSION_NOT_FOUND,
        `配置版本不存在: scene=${sceneId}@v${version}`,
      );
    }
    return row;
  }

  /** 产物文件只增不删 */
  private writeGamedataFile(fileName: string, text: string): void {
    mkdirSync(this.gamedataDir, { recursive: true });
    writeFileSync(join(this.gamedataDir, fileName), text, 'utf8');
  }
}
