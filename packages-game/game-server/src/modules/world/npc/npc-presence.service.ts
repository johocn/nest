import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EntityType,
  NpcPatrolLoopMode,
  NpcSpawnRuleType,
  QuestStatus,
} from '@constants/enums';
import { PlayerQuest } from '@modules/quest/entities/player-quest.entity';
import { PlayerService } from '@modules/player/player.service';
import { NpcPatrolRoute } from '../entities/npc-patrol-route.entity';
import { NpcSpawnRule } from '../entities/npc-spawn-rule.entity';
import { NpcTemplate } from '../entities/npc-template.entity';
import { SceneEntitySpawn } from '../entities/scene-entity-spawn.entity';

/** 巡逻路点（与 npc_patrol_routes.points 元素一一对应） */
export interface NpcPatrolPoint {
  x: number;
  y: number;
  pauseSec?: number;
}

/** 下发/推进用的巡逻路径配置 */
export interface NpcPatrolRouteConfig {
  points: NpcPatrolPoint[];
  speed: number; // 像素/秒
  loopMode: NpcPatrolLoopMode; // loop / pingpong / once
  cursor: number; // 当前所在路点索引
}

/** 单个 NPC 实例（进场景下发与位置校正共用） */
export interface NpcInstance {
  npcId: string; // npc:<spawnId> 或 npcs:<ruleId>:<slot>
  npcTemplateId: string;
  resKey: string;
  name: string;
  scale: number;
  anim: string; // 取模板 defaultAnim ?? ''
  x: number;
  y: number;
  route?: NpcPatrolRouteConfig; // 仅 patrol 有
}

/** 场景级实例：位置/巡逻由服务端统一推进；condition 仅用于按玩家过滤可见性 */
interface SceneNpcInstance extends NpcInstance {
  condition: Record<string, any> | null;
  ruleId: string;
  isFixed: boolean;
}

/** 默认 tick 间隔（毫秒），可由环境变量 NPC_TICK_MS 覆盖 */
const DEFAULT_TICK_MS = 2000;

/**
 * NPC 在场计算与场景级位置推进服务（S4）。
 *
 * - 位置/巡逻是「场景级」（D1）：实例缓存在内存中，由 advanceTick 统一推进；
 * - 存在性是「玩家级」（D1）：condition 在 listNpcsForPlayer 时按玩家过滤；
 * - random 只随机一次并保持稳定（D6）；
 * - 已知限制：规则/生成点变更后不失效缓存（需重启进程），本批不做。
 */
@Injectable()
export class NpcPresenceService {
  private readonly logger = new Logger(NpcPresenceService.name);

  /** 场景级实例缓存：sceneId -> 实例集合（含巡逻运行态） */
  private readonly sceneInstances = new Map<string, SceneNpcInstance[]>();

  /** random 点位缓存：`sceneId:ruleId` -> 已生成的点位（D6，进程内稳定） */
  private readonly randomPoints = new Map<
    string,
    Array<{ x: number; y: number }>
  >();

  /** pingpong 方向：`sceneId:npcId` -> 1 正向 / -1 反向 */
  private readonly patrolDir = new Map<string, 1 | -1>();

  /** 路点停留剩余时间：`sceneId:npcId` -> 毫秒 */
  private readonly patrolPause = new Map<string, number>();

  constructor(
    @InjectRepository(NpcSpawnRule)
    private readonly spawnRuleRepo: Repository<NpcSpawnRule>,
    @InjectRepository(NpcPatrolRoute)
    private readonly patrolRouteRepo: Repository<NpcPatrolRoute>,
    @InjectRepository(SceneEntitySpawn)
    private readonly spawnRepo: Repository<SceneEntitySpawn>,
    @InjectRepository(NpcTemplate)
    private readonly npcRepo: Repository<NpcTemplate>,
    @InjectRepository(PlayerQuest)
    private readonly playerQuestRepo: Repository<PlayerQuest>,
    private readonly playerService: PlayerService,
  ) {}

  /**
   * 按玩家计算某场景内在场的 NPC 实例（场景级实例 + 玩家级 condition 过滤）。
   */
  async listNpcsForPlayer(
    sceneId: string,
    playerId: string,
  ): Promise<NpcInstance[]> {
    const instances = await this.ensureSceneInstances(sceneId);
    const level = await this.getPlayerLevel(playerId);

    const result: NpcInstance[] = [];
    for (const inst of instances) {
      if (!(await this.isVisible(inst.condition, playerId, level))) continue;
      result.push(this.toNpcInstance(inst));
    }
    return result;
  }

  /**
   * 推进指定场景的 NPC 位置（仅 patrol 会移动），只更新内存态、不落库、不发事件。
   * 返回本次确实发生位置变化的实例（无变化时 npcs 为空数组）。
   */
  async advanceTick(
    sceneIds: string[],
    tickMs?: number,
  ): Promise<Array<{ sceneId: string; npcs: NpcInstance[] }>> {
    const dt = this.resolveTickMs(tickMs);
    const result: Array<{ sceneId: string; npcs: NpcInstance[] }> = [];

    for (const sceneId of sceneIds) {
      const instances = await this.ensureSceneInstances(sceneId);
      const moved: NpcInstance[] = [];
      for (const inst of instances) {
        // fixed/random 位置恒定，无副作用
        if (inst.isFixed || !inst.route) continue;
        if (this.advancePatrol(sceneId, inst, dt)) {
          moved.push(this.toNpcInstance(inst));
        }
      }
      result.push({ sceneId, npcs: moved });
    }
    return result;
  }

  // ===== 场景级实例构建 =====

  private async ensureSceneInstances(
    sceneId: string,
  ): Promise<SceneNpcInstance[]> {
    const cached = this.sceneInstances.get(sceneId);
    if (cached) return cached;

    const rules = await this.spawnRuleRepo.find({
      where: { sceneId, isActive: true },
    });

    const instances: SceneNpcInstance[] = [];
    const templateCache = new Map<string, NpcTemplate | null>();

    // fixed：不从规则生成实例，位置仍以 scene_entity_spawns 为准（D3）
    const fixedConditions = new Map<string, Record<string, any> | null>();
    for (const rule of rules) {
      if (rule.ruleType === NpcSpawnRuleType.FIXED) {
        fixedConditions.set(String(rule.npcTemplateId), rule.condition ?? null);
      }
    }
    const spawns = await this.spawnRepo.find({
      where: { sceneId, entityType: EntityType.NPC, isActive: true },
    });
    for (const spawn of spawns) {
      const template = await this.loadTemplate(
        String(spawn.templateId),
        templateCache,
      );
      const count = spawn.spawnCount > 0 ? spawn.spawnCount : 1;
      // spawn_count > 1 时同坐标产生多个实例（寻址沿用 npc:<spawnId>，见 D2）
      for (let slot = 0; slot < count; slot++) {
        instances.push({
          npcId: `npc:${spawn.id}`,
          npcTemplateId: String(spawn.templateId),
          resKey: template?.resKey ?? '',
          name: template?.name ?? '',
          scale: template?.scale ?? 1,
          anim: template?.defaultAnim ?? '',
          x: spawn.spawnX,
          y: spawn.spawnY,
          condition:
            fixedConditions.get(String(spawn.templateId)) ?? null,
          ruleId: `spawn:${spawn.id}`,
          isFixed: true,
        });
      }
    }

    // random / patrol：由规则生成实例
    for (const rule of rules) {
      if (rule.ruleType === NpcSpawnRuleType.RANDOM) {
        instances.push(
          ...(await this.buildRandomInstances(
            sceneId,
            rule,
            templateCache,
          )),
        );
      } else if (rule.ruleType === NpcSpawnRuleType.PATROL) {
        instances.push(
          ...(await this.buildPatrolInstances(
            sceneId,
            rule,
            templateCache,
          )),
        );
      }
    }

    this.sceneInstances.set(sceneId, instances);
    return instances;
  }

  private async buildRandomInstances(
    sceneId: string,
    rule: NpcSpawnRule,
    templateCache: Map<string, NpcTemplate | null>,
  ): Promise<SceneNpcInstance[]> {
    const count = rule.spawnCount > 0 ? rule.spawnCount : 1;
    const cacheKey = `${sceneId}:${rule.id}`;
    // D6：同一场景同一规则只随机一次，之后保持稳定
    let points = this.randomPoints.get(cacheKey);
    if (!points) {
      points = [];
      for (let slot = 0; slot < count; slot++) {
        points.push({
          x: rule.spawnX + (Math.random() * 2 - 1) * rule.spawnRadius,
          y: rule.spawnY + (Math.random() * 2 - 1) * rule.spawnRadius,
        });
      }
      this.randomPoints.set(cacheKey, points);
    }

    const template = await this.loadTemplate(
      String(rule.npcTemplateId),
      templateCache,
    );
    const instances: SceneNpcInstance[] = [];
    for (let slot = 0; slot < count; slot++) {
      instances.push({
        npcId: `npcs:${rule.id}:${slot}`,
        npcTemplateId: String(rule.npcTemplateId),
        resKey: template?.resKey ?? '',
        name: template?.name ?? '',
        scale: template?.scale ?? 1,
        anim: template?.defaultAnim ?? '',
        x: points[slot].x,
        y: points[slot].y,
        condition: rule.condition ?? null,
        ruleId: String(rule.id),
        isFixed: false,
      });
    }
    return instances;
  }

  private async buildPatrolInstances(
    sceneId: string,
    rule: NpcSpawnRule,
    templateCache: Map<string, NpcTemplate | null>,
  ): Promise<SceneNpcInstance[]> {
    const routeRow = rule.patrolRouteId
      ? await this.patrolRouteRepo.findOne({
          where: { id: rule.patrolRouteId },
        })
      : null;
    if (!routeRow) {
      this.logger.debug(
        `巡逻规则 ${rule.id} 未关联有效路径（patrolRouteId=${rule.patrolRouteId}），已跳过`,
      );
      return [];
    }

    const points = this.normalizePoints(routeRow.points);
    const start = points[0] ?? { x: rule.spawnX, y: rule.spawnY };
    const template = await this.loadTemplate(
      String(rule.npcTemplateId),
      templateCache,
    );
    const count = rule.spawnCount > 0 ? rule.spawnCount : 1;

    const instances: SceneNpcInstance[] = [];
    for (let slot = 0; slot < count; slot++) {
      instances.push({
        npcId: `npcs:${rule.id}:${slot}`,
        npcTemplateId: String(rule.npcTemplateId),
        resKey: template?.resKey ?? '',
        name: template?.name ?? '',
        scale: template?.scale ?? 1,
        anim: template?.defaultAnim ?? '',
        x: start.x,
        y: start.y,
        // 共享同一份路点定义，但 cursor 是各实例独立运行态
        route: {
          points,
          speed: routeRow.speed,
          loopMode: routeRow.loopMode,
          cursor: 0,
        },
        condition: rule.condition ?? null,
        ruleId: String(rule.id),
        isFixed: false,
      });
    }
    return instances;
  }

  private normalizePoints(raw: unknown): NpcPatrolPoint[] {
    if (!Array.isArray(raw)) return [];
    const points: NpcPatrolPoint[] = [];
    for (const item of raw) {
      const x = Number((item as any)?.x);
      const y = Number((item as any)?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const pauseRaw = Number((item as any)?.pauseSec);
      points.push({
        x,
        y,
        pauseSec: Number.isFinite(pauseRaw) ? pauseRaw : undefined,
      });
    }
    return points;
  }

  private async loadTemplate(
    templateId: string,
    cache: Map<string, NpcTemplate | null>,
  ): Promise<NpcTemplate | null> {
    if (cache.has(templateId)) return cache.get(templateId) ?? null;
    const template = await this.npcRepo.findOne({
      where: { id: templateId },
    });
    cache.set(templateId, template);
    return template;
  }

  // ===== 玩家级 condition 过滤 =====

  private async getPlayerLevel(playerId: string): Promise<number> {
    try {
      const player = await this.playerService.getById(playerId);
      // 玩家不存在时按「无等级」处理
      return player && Number.isFinite(player.level) ? player.level : 0;
    } catch (err) {
      this.logger.warn(`读取玩家 ${playerId} 等级失败：${String(err)}`);
      return 0;
    }
  }

  private async isVisible(
    condition: Record<string, any> | null,
    playerId: string,
    playerLevel: number,
  ): Promise<boolean> {
    if (!condition || Object.keys(condition).length === 0) return true;

    for (const [key, value] of Object.entries(condition)) {
      if (key === 'minLevel') {
        const minLevel = Number(value);
        if (!Number.isFinite(minLevel)) {
          this.logger.debug(`condition.minLevel 非法（${String(value)}），已忽略`);
          continue;
        }
        if (playerLevel < minLevel) return false;
      } else if (key === 'questId') {
        if (!(await this.hasQuestProgress(playerId, String(value)))) {
          return false;
        }
      } else {
        // 未识别的键：忽略并记录，不抛错
        this.logger.debug(`未识别的 condition 键「${key}」，已忽略`);
      }
    }
    return true;
  }

  private async hasQuestProgress(
    playerId: string,
    questTemplateId: string,
  ): Promise<boolean> {
    const quest = await this.playerQuestRepo.findOne({
      where: { playerId, questTemplateId },
    });
    return !!quest && quest.status !== QuestStatus.NOT_STARTED;
  }

  // ===== 巡逻推进 =====

  /**
   * 推进单个巡逻实例，返回本次是否发生位置变化。
   * 路点不足 2 个时原地静止（风险 #5，避免除零/NaN）。
   */
  private advancePatrol(
    sceneId: string,
    inst: SceneNpcInstance,
    dtMs: number,
  ): boolean {
    const route = inst.route;
    if (!route || dtMs <= 0) return false;
    const points = route.points;
    if (!Array.isArray(points) || points.length < 2) return false;
    if (!(route.speed > 0)) return false;

    const key = `${sceneId}:${inst.npcId}`;
    if (!Number.isFinite(route.cursor)) route.cursor = 0;
    route.cursor = Math.min(Math.max(route.cursor, 0), points.length - 1);

    let remaining = dtMs;
    let moved = false;

    // 先消费上一轮遗留的路点停留时间（停留期间不移动）
    const pendingPause = this.patrolPause.get(key) ?? 0;
    if (pendingPause > 0) {
      if (pendingPause >= remaining) {
        this.patrolPause.set(key, pendingPause - remaining);
        return false;
      }
      remaining -= pendingPause;
      this.patrolPause.delete(key);
    }

    // 硬上限，避免重合路点导致的死循环
    let guard = points.length * 2 + 4;
    while (remaining > 0 && guard-- > 0) {
      const nextIdx = this.nextWaypoint(route, key);
      if (nextIdx === null) break; // once 模式已到末尾：保持最后一点
      const to = points[nextIdx];
      if (!to) break;

      const dist = Math.hypot(to.x - inst.x, to.y - inst.y);
      if (dist <= 0) {
        // 与目标路点重合：直接推进索引
        route.cursor = nextIdx;
        const pauseMs = Math.max(0, (to.pauseSec ?? 0) * 1000);
        if (pauseMs <= 0) break; // 无耗时，跳出避免死循环
        if (pauseMs >= remaining) {
          this.patrolPause.set(key, pauseMs - remaining);
          break;
        }
        remaining -= pauseMs;
        continue;
      }

      const needMs = (dist / route.speed) * 1000;
      if (needMs > remaining) {
        // 未到达：沿直线插值前进
        const ratio = (remaining * route.speed) / 1000 / dist;
        inst.x += (to.x - inst.x) * ratio;
        inst.y += (to.y - inst.y) * ratio;
        moved = true;
        remaining = 0;
        break;
      }

      // 到达路点
      inst.x = to.x;
      inst.y = to.y;
      moved = true;
      remaining -= needMs;
      route.cursor = nextIdx;

      // 到达后的原地停留
      const pauseMs = Math.max(0, (to.pauseSec ?? 0) * 1000);
      if (pauseMs > 0) {
        if (pauseMs >= remaining) {
          this.patrolPause.set(key, pauseMs - remaining);
          break;
        }
        remaining -= pauseMs;
      }
    }

    return moved;
  }

  /** 按 loopMode 计算下一个路点索引（once 到末尾返回 null） */
  private nextWaypoint(
    route: NpcPatrolRouteConfig,
    key: string,
  ): number | null {
    const n = route.points.length;
    const cursor = Math.min(Math.max(route.cursor, 0), n - 1);

    if (route.loopMode === NpcPatrolLoopMode.PINGPONG) {
      let dir = this.patrolDir.get(key) ?? 1;
      let next = cursor + dir;
      if (next >= n) {
        dir = -1;
        next = cursor - 1;
      } else if (next < 0) {
        dir = 1;
        next = cursor + 1;
      }
      this.patrolDir.set(key, dir);
      return next;
    }

    if (route.loopMode === NpcPatrolLoopMode.ONCE) {
      return cursor >= n - 1 ? null : cursor + 1;
    }

    return (cursor + 1) % n; // loop（默认）
  }

  // ===== 工具 =====

  /** 转为对外实例：剥离 condition/ruleId/isFixed 等内部字段 */
  private toNpcInstance(inst: SceneNpcInstance): NpcInstance {
    const npc: NpcInstance = {
      npcId: inst.npcId,
      npcTemplateId: inst.npcTemplateId,
      resKey: inst.resKey,
      name: inst.name,
      scale: inst.scale,
      anim: inst.anim,
      x: inst.x,
      y: inst.y,
    };
    if (inst.route) {
      npc.route = {
        points: inst.route.points,
        speed: inst.route.speed,
        loopMode: inst.route.loopMode,
        cursor: inst.route.cursor,
      };
    }
    return npc;
  }

  private resolveTickMs(tickMs?: number): number {
    if (typeof tickMs === 'number' && Number.isFinite(tickMs) && tickMs > 0) {
      return tickMs;
    }
    const env = Number(process.env.NPC_TICK_MS);
    return Number.isFinite(env) && env > 0 ? env : DEFAULT_TICK_MS;
  }
}
