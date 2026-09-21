import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SceneConfigService } from './scene-config.service';
import {
  buildScenePayload,
  canonicalJson,
  sha256,
} from './scene-package.builder';
import { SceneConfigVersion } from './entities/scene-config-version.entity';
import {
  NpcTemplate,
  ObjectTemplate,
  Scene,
  SceneEntitySpawn,
  SceneTrigger,
} from '../entities';
import { AdminService } from '@modules/admin/admin.service';
import { GameException } from '@common/exceptions/game.exception';
import {
  EntityType,
  ObjectType,
  SceneConfigStatus,
  SceneStatus,
  SceneType,
  TriggerType,
} from '@constants/enums';

const MANIFEST_FILE = 'manifest.json';

type Row = Record<string, any>;

/** 行匹配（只支持等值 where，与单测用到的查询一致） */
function matches(row: Row, where?: Row): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function sortRows(rows: Row[], order?: Row): Row[] {
  if (!order) return rows;
  const [field, direction] = Object.entries(order)[0] as [string, string];
  return rows.sort((a, b) => {
    const cmp = String(a[field]).localeCompare(String(b[field]), undefined, {
      numeric: true,
    });
    return direction === 'DESC' ? -cmp : cmp;
  });
}

/** 内存版 repository mock：支持 where 过滤 / order 排序 / save 落行 / update 批量改状态 */
function createRepoMock() {
  const rows: Row[] = [];
  let autoId = 1;

  return {
    rows,
    findOne: jest.fn(
      async (opts: Row = {}) =>
        sortRows(
          rows.filter((r) => matches(r, opts.where)),
          opts.order,
        )[0] ?? null,
    ),
    find: jest.fn(async (opts: Row = {}) =>
      sortRows(
        rows.filter((r) => matches(r, opts.where)),
        opts.order,
      ),
    ),
    findAndCount: jest.fn(async (opts: Row = {}) => {
      const found = sortRows(
        rows.filter((r) => matches(r, opts.where)),
        opts.order,
      );
      const skip = opts.skip ?? 0;
      const take = opts.take ?? found.length;
      return [found.slice(skip, skip + take), found.length];
    }),
    create: jest.fn((data: Row) => ({ ...data })),
    save: jest.fn(async (entity: Row | Row[]) => {
      const list = Array.isArray(entity) ? entity : [entity];
      for (const item of list) {
        const index = item.id ? rows.findIndex((r) => r.id === item.id) : -1;
        if (index >= 0) {
          rows[index] = item;
        } else {
          if (!item.id) item.id = String(autoId++);
          rows.push(item);
        }
      }
      return Array.isArray(entity) ? list : list[0];
    }),
    update: jest.fn(async (criteria: Row, patch: Row) => {
      let affected = 0;
      for (const row of rows) {
        if (matches(row, criteria)) {
          Object.assign(row, patch);
          affected += 1;
        }
      }
      return { affected };
    }),
  };
}

function sceneFixture(overrides: Partial<Scene> = {}): Scene {
  return {
    id: '1',
    name: '新手村（Spike）',
    sceneType: SceneType.TOWN,
    mapResKey: 'map/town_spike_01',
    mapWidth: 1280,
    mapHeight: 960,
    layerConfig: {},
    refreshRule: null,
    triggerGroupIds: [],
    minLevel: 1,
    maxPlayers: 50,
    status: SceneStatus.OPEN,
    ...overrides,
  } as unknown as Scene;
}

function objectTemplateFixture(
  overrides: Partial<ObjectTemplate> = {},
): ObjectTemplate {
  return {
    id: '9',
    name: 'spike-草药丛',
    resKey: 'obj/plant_01',
    type: ObjectType.PLANT,
    interactCd: 10,
    reward: null,
    animOpen: null,
    isOneTime: false,
    ...overrides,
  } as unknown as ObjectTemplate;
}

function npcTemplateFixture(overrides: Partial<NpcTemplate> = {}): NpcTemplate {
  return {
    id: '8',
    name: 'spike-村长',
    resKey: 'npc/elder_01',
    scale: 1,
    defaultAnim: null,
    interactType: 'talk' as any,
    dialogueId: null,
    moveRange: 0,
    isAutoWander: false,
    attr: {},
    ...overrides,
  } as unknown as NpcTemplate;
}

function spawnFixture(
  overrides: Partial<SceneEntitySpawn> = {},
): SceneEntitySpawn {
  return {
    id: '11',
    sceneId: '1',
    entityType: EntityType.OBJECT,
    templateId: '9',
    spawnX: 560,
    spawnY: 480,
    spawnRotation: 0,
    spawnCount: 1,
    spawnRadius: 0,
    isActive: true,
    ...overrides,
  } as unknown as SceneEntitySpawn;
}

function triggerFixture(overrides: Partial<SceneTrigger> = {}): SceneTrigger {
  return {
    id: '3',
    sceneId: '1',
    triggerType: TriggerType.TRANSPORT,
    areaX: 0,
    areaY: 0,
    areaW: 120,
    areaH: 120,
    targetSceneId: '1',
    storyId: null,
    condition: null,
    onceOnly: false,
    ...overrides,
  } as unknown as SceneTrigger;
}

function buildInput() {
  return {
    scene: sceneFixture(),
    version: 1,
    spawns: [
      spawnFixture(),
      spawnFixture({
        id: '21',
        entityType: EntityType.NPC,
        templateId: '8',
        spawnX: 600,
        spawnY: 380,
      }),
    ],
    objectTemplates: [objectTemplateFixture()],
    npcTemplates: [npcTemplateFixture()],
    triggers: [triggerFixture()],
  };
}

describe('SceneConfigService（S2 配置包导出/发布/回滚）', () => {
  let service: SceneConfigService;
  let adminService: { logOperation: jest.Mock };
  let sceneRepo: ReturnType<typeof createRepoMock>;
  let spawnRepo: ReturnType<typeof createRepoMock>;
  let triggerRepo: ReturnType<typeof createRepoMock>;
  let objectRepo: ReturnType<typeof createRepoMock>;
  let npcRepo: ReturnType<typeof createRepoMock>;
  let versionRepo: ReturnType<typeof createRepoMock>;
  let tmpDir: string;

  const findVersionRow = (version: number) =>
    versionRepo.rows.find((row) => row.version === version);
  const readManifest = () =>
    JSON.parse(readFileSync(join(tmpDir, MANIFEST_FILE), 'utf8'));

  beforeEach(async () => {
    // 显式指向临时目录，避免污染仓库产物
    tmpDir = mkdtempSync(join(tmpdir(), 'game-server-gamedata-'));
    process.env.GAMEDATA_DIR = tmpDir;

    sceneRepo = createRepoMock();
    spawnRepo = createRepoMock();
    triggerRepo = createRepoMock();
    objectRepo = createRepoMock();
    npcRepo = createRepoMock();
    versionRepo = createRepoMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SceneConfigService,
        { provide: getRepositoryToken(Scene), useValue: sceneRepo },
        {
          provide: getRepositoryToken(SceneEntitySpawn),
          useValue: spawnRepo,
        },
        { provide: getRepositoryToken(SceneTrigger), useValue: triggerRepo },
        {
          provide: getRepositoryToken(ObjectTemplate),
          useValue: objectRepo,
        },
        { provide: getRepositoryToken(NpcTemplate), useValue: npcRepo },
        {
          provide: getRepositoryToken(SceneConfigVersion),
          useValue: versionRepo,
        },
        { provide: AdminService, useValue: { logOperation: jest.fn() } },
      ],
    }).compile();

    service = module.get(SceneConfigService);
    adminService = module.get(AdminService) as unknown as {
      logOperation: jest.Mock;
    };

    // 场景 1 + 1 个物件落位 + 1 个触发器
    await sceneRepo.save(sceneFixture());
    await objectRepo.save(objectTemplateFixture());
    await spawnRepo.save(spawnFixture());
    await triggerRepo.save(triggerFixture());
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.GAMEDATA_DIR;
  });

  describe('buildScenePayload（纯函数）', () => {
    it('同输入同 hash：连续两次构建 payloadHash 完全一致', () => {
      const first = buildScenePayload(buildInput());
      const second = buildScenePayload(buildInput());

      expect(first.payloadHash).toBe(second.payloadHash);
      expect(first.payload).toEqual(second.payload);
      expect(first.payloadHash).toBe(sha256(canonicalJson(first.payload)));
      expect(first.payloadHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(first.payload).not.toHaveProperty('hash');
    });

    it('staticEntities/fixedNpcs/triggers 字段与 S1 产物一致（bigint 已 Number 化）', () => {
      const { payload } = buildScenePayload(buildInput());

      expect(payload.staticEntities).toEqual([
        {
          kind: 'object',
          spawnId: 11,
          templateId: 9,
          resKey: 'obj/plant_01',
          x: 560,
          y: 480,
          rotation: 0,
          interact: { type: 'collect', cd: 10, oneTime: false },
        },
      ]);
      expect(payload.fixedNpcs).toEqual([
        {
          spawnId: 21,
          npcTemplateId: 8,
          resKey: 'npc/elder_01',
          x: 600,
          y: 380,
          anim: 'idle',
        },
      ]);
      expect(payload.triggers).toEqual([
        {
          id: 3,
          type: 'transport',
          area: { x: 0, y: 0, w: 120, h: 120 },
          targetSceneId: 1,
          onceOnly: false,
        },
      ]);
      expect(payload).toMatchObject({
        schemaVersion: 1,
        sceneId: 1,
        version: 1,
      });
    });

    it('landmark 映射为 read、未知类型兜底 collect', () => {
      const { payload } = buildScenePayload({
        ...buildInput(),
        objectTemplates: [
          objectTemplateFixture({ type: ObjectType.LANDMARK }),
          objectTemplateFixture({ id: '10', type: 'unknown' as any }),
        ],
        spawns: [
          spawnFixture({ id: '31', templateId: '9' }),
          spawnFixture({ id: '32', templateId: '10' }),
        ],
      });

      expect(payload.staticEntities[0].interact.type).toBe('read');
      expect(payload.staticEntities[1].interact.type).toBe('collect');
    });

    it('空场景的 staticEntities/fixedNpcs/triggers 为 [] 而非 null，entry 取地图中心', () => {
      const { payload } = buildScenePayload({
        scene: sceneFixture(),
        version: 1,
        spawns: [],
        objectTemplates: [],
        npcTemplates: [],
        triggers: [],
      });

      expect(payload.staticEntities).toEqual([]);
      expect(payload.fixedNpcs).toEqual([]);
      expect(payload.triggers).toEqual([]);
      expect(payload.layers).toEqual({});
      expect(payload.scene.entry).toEqual({ x: 640, y: 480 });
    });

    it('entry 优先取 layerConfig.entry', () => {
      const scene = sceneFixture({
        layerConfig: {
          entry: { x: 128, y: 256 },
          ground: { res: 'map/g.png' },
        },
      });

      const { payload } = buildScenePayload({
        ...buildInput(),
        scene,
      });

      expect(payload.scene.entry).toEqual({ x: 128, y: 256 });
      expect(payload.layers).toEqual(scene.layerConfig);
    });
  });

  describe('exportScene', () => {
    it('同场景已有 v1 时导出得到 v2，状态为 draft', async () => {
      const v1 = await service.exportScene('1', 'admin-1');
      expect(v1.version).toBe(1);
      expect(v1.filePath).toBe('scene-1-v1.json');

      const v2 = await service.exportScene('1', 'admin-1');

      expect(v2.version).toBe(2);
      expect(v2.status).toBe(SceneConfigStatus.DRAFT);
      expect(v2.filePath).toBe('scene-1-v2.json');
      expect(existsSync(join(tmpDir, 'scene-1-v2.json'))).toBe(true);
      expect(versionRepo.rows).toHaveLength(2);
    });

    it('写出的文件：file_path 可读回、hash = 文件文本 sha256、包内 hash = payloadHash 且为最后一个键', async () => {
      const row = await service.exportScene('1', 'admin-1');

      const fileText = readFileSync(join(tmpDir, row.filePath), 'utf8');
      expect(sha256(fileText)).toBe(row.hash);
      expect(fileText.endsWith('\n')).toBe(true);

      const fileJson = JSON.parse(fileText);
      expect(fileJson.hash).toBe(row.payloadHash);
      // 两层 hash 语义不同：文件文本 hash ≠ 包内 payload hash
      expect(fileJson.hash).not.toBe(row.hash);
      // hash 必须是文件里的最后一个键（客户端按文本 sha256 校验）
      expect(Object.keys(fileJson).pop()).toBe('hash');
    });

    it('场景不存在时抛 GameException', async () => {
      await expect(service.exportScene('999', 'admin-1')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('publishScene / rebuildManifest', () => {
    it('publish 后同场景旧版本变 archived，manifest 只含 published 版本', async () => {
      const v1 = await service.exportScene('1', 'admin-1');
      await service.publishScene('1', v1.version, 'admin-1');
      expect(findVersionRow(1)!.publishedAt).toBeInstanceOf(Date);

      // draft 版本不进 manifest
      const v2 = await service.exportScene('1', 'admin-1');
      await service.rebuildManifest();
      expect(readManifest().scenes.map((s: Row) => s.version)).toEqual([1]);

      await service.publishScene('1', v2.version, 'admin-1');

      const manifest = readManifest();
      expect(manifest.scenes).toHaveLength(1);
      expect(manifest.scenes[0]).toMatchObject({
        sceneId: 1,
        version: 2,
        hash: v2.hash,
        file: 'scene-1-v2.json',
      });
      // manifest.hash = 该文件文本的 sha256
      const fileText = readFileSync(
        join(tmpDir, manifest.scenes[0].file),
        'utf8',
      );
      expect(sha256(fileText)).toBe(manifest.scenes[0].hash);

      expect(findVersionRow(1)!.status).toBe(SceneConfigStatus.ARCHIVED);
      expect(findVersionRow(2)!.status).toBe(SceneConfigStatus.PUBLISHED);
    });

    it('只有 draft 时 manifest 的 scenes 为空数组', async () => {
      await service.exportScene('1', 'admin-1');

      const manifest = await service.rebuildManifest();

      expect(manifest.scenes).toEqual([]);
      expect(readManifest().scenes).toEqual([]);
    });

    it('发布不存在的版本抛 GameException', async () => {
      await expect(service.publishScene('1', 9, 'admin-1')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('rollbackScene', () => {
    it('回滚到旧版本后 manifest 指向旧版本，当前版本变 archived', async () => {
      const v1 = await service.exportScene('1', 'admin-1');
      await service.publishScene('1', v1.version, 'admin-1');
      const firstPublishedAt = findVersionRow(1)!.publishedAt as Date;

      const v2 = await service.exportScene('1', 'admin-1');
      await service.publishScene('1', v2.version, 'admin-1');
      expect(findVersionRow(1)!.status).toBe(SceneConfigStatus.ARCHIVED);

      const rolled = await service.rollbackScene('1', 1, 'admin-1');

      expect(rolled.version).toBe(1);
      expect(readManifest().scenes.map((s: Row) => s.version)).toEqual([1]);
      expect(findVersionRow(1)!.status).toBe(SceneConfigStatus.PUBLISHED);
      expect(findVersionRow(1)!.publishedAt).toBeInstanceOf(Date);
      // publishedAt 需要重设为 now()
      expect(
        (findVersionRow(1)!.publishedAt as Date).getTime(),
      ).toBeGreaterThanOrEqual(firstPublishedAt.getTime());
      expect(findVersionRow(2)!.status).toBe(SceneConfigStatus.ARCHIVED);
    });

    it('回滚到当前已发布版本（version >= published.version）应报错', async () => {
      const v1 = await service.exportScene('1', 'admin-1');
      await service.publishScene('1', v1.version, 'admin-1');

      await expect(service.rollbackScene('1', 1, 'admin-1')).rejects.toThrow(
        GameException,
      );
    });

    it('回滚到不存在的版本应报错', async () => {
      await expect(service.rollbackScene('1', 99, 'admin-1')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('listVersions / listScenes / 操作日志', () => {
    it('listVersions 按版本倒序分页，listScenes 带出当前 published 版本', async () => {
      await service.exportScene('1', 'admin-1');
      const v2 = await service.exportScene('1', 'admin-1');
      await service.publishScene('1', v2.version, 'admin-1');

      const versions = await service.listVersions('1', 1, 1);
      expect(versions.total).toBe(2);
      expect(versions.items.map((r) => r.version)).toEqual([2]);

      const scenes = await service.listScenes();
      expect(scenes.total).toBe(1);
      expect(scenes.items[0]).toMatchObject({
        sceneId: 1,
        name: '新手村（Spike）',
        published: { version: 2, file: 'scene-1-v2.json' },
      });
    });

    it('导出/发布/回滚均写操作日志', async () => {
      await service.exportScene('1', 'admin-1');
      const v2 = await service.exportScene('1', 'admin-1');
      await service.publishScene('1', v2.version, 'admin-1');
      await service.rollbackScene('1', 1, 'admin-1');

      expect(
        adminService.logOperation.mock.calls.map((call) => call[0].operation),
      ).toEqual([
        'scene-config.export',
        'scene-config.export',
        'scene-config.publish',
        'scene-config.rollback',
      ]);
      expect(
        adminService.logOperation.mock.calls.every(
          (call) => call[0].adminId === 'admin-1',
        ),
      ).toBe(true);
    });
  });
});
