import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Scene,
  NpcTemplate,
  MonsterTemplate,
  ObjectTemplate,
  SceneTrigger,
  SceneEntitySpawn,
} from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { GameEvents } from '@event-bus/game-events';
import { SceneStatus } from '@constants/enums';

export interface SceneEnterResult {
  scene: Scene;
  spawns: SceneEntitySpawn[];
  triggers: SceneTrigger[];
}

@Injectable()
export class WorldService {
  constructor(
    @InjectRepository(Scene) private readonly sceneRepo: Repository<Scene>,
    @InjectRepository(NpcTemplate)
    private readonly npcRepo: Repository<NpcTemplate>,
    @InjectRepository(MonsterTemplate)
    private readonly monsterRepo: Repository<MonsterTemplate>,
    @InjectRepository(ObjectTemplate)
    private readonly objRepo: Repository<ObjectTemplate>,
    @InjectRepository(SceneTrigger)
    private readonly triggerRepo: Repository<SceneTrigger>,
    @InjectRepository(SceneEntitySpawn)
    private readonly spawnRepo: Repository<SceneEntitySpawn>,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
  ) {}

  async getScene(id: string): Promise<Scene> {
    const scene = await this.sceneRepo.findOne({ where: { id } });
    if (!scene) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '场景不存在');
    }
    return scene;
  }

  async getScenes(
    page: number,
    limit: number,
  ): Promise<{ items: Scene[]; total: number }> {
    const [items, total] = await this.sceneRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async createScene(data: Partial<Scene>): Promise<Scene> {
    const scene = this.sceneRepo.create(data);
    return this.sceneRepo.save(scene);
  }

  async updateScene(id: string, data: Partial<Scene>): Promise<Scene> {
    const scene = await this.sceneRepo.findOne({ where: { id } });
    if (!scene) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '场景不存在');
    }
    Object.assign(scene, data);
    return this.sceneRepo.save(scene);
  }

  async getSceneSpawns(sceneId: string): Promise<SceneEntitySpawn[]> {
    return this.spawnRepo.find({ where: { sceneId, isActive: true } });
  }

  async getSceneTriggers(sceneId: string): Promise<SceneTrigger[]> {
    return this.triggerRepo.find({});
  }

  async checkEnterRequirement(
    sceneId: string,
    playerLevel: number,
  ): Promise<void> {
    const scene = await this.getScene(sceneId);
    if (scene.status === SceneStatus.MAINTENANCE) {
      throw new GameException(
        ErrorCodes.PARAM_INVALID,
        '场景维护中，暂不可进入',
      );
    }
    if (playerLevel < scene.minLevel) {
      throw new GameException(
        ErrorCodes.LEVEL_NOT_ENOUGH,
        '等级不足，无法进入该场景',
        {
          required: scene.minLevel,
          current: playerLevel,
        },
      );
    }
  }

  async enterScene(
    playerId: string,
    sceneId: string,
  ): Promise<SceneEnterResult> {
    const scene = await this.getScene(sceneId);
    const spawns = await this.getSceneSpawns(sceneId);
    const triggers = await this.getSceneTriggers(sceneId);
    await this.cacheService.sAdd(`scene:${sceneId}:players`, playerId);
    this.eventBus.emit(GameEvents.PLAYER_ENTER_SCENE, { playerId, sceneId });
    return { scene, spawns, triggers };
  }

  async leaveScene(playerId: string, sceneId: string): Promise<void> {
    await this.cacheService.sRem(`scene:${sceneId}:players`, playerId);
    this.eventBus.emit(GameEvents.PLAYER_LEAVE_SCENE, { playerId, sceneId });
  }

  async getScenePlayers(sceneId: string): Promise<string[]> {
    return this.cacheService.sMembers(`scene:${sceneId}:players`);
  }

  async getNpcTemplate(id: string): Promise<NpcTemplate | null> {
    return this.npcRepo.findOne({ where: { id } });
  }

  async getMonsterTemplate(id: string): Promise<MonsterTemplate | null> {
    return this.monsterRepo.findOne({ where: { id } });
  }

  async getObjectTemplate(id: string): Promise<ObjectTemplate | null> {
    return this.objRepo.findOne({ where: { id } });
  }
}
