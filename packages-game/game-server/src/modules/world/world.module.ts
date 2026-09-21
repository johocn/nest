import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorldService } from './world.service';
import { WorldController } from './world.controller';
import { WorldClientController } from './world.client.controller';
import { EconomyModule } from '@modules/economy/economy.module';
import { CharacterModule } from '@modules/character/character.module';
import { AdminModule } from '@modules/admin/admin.module';
import {
  Scene,
  NpcTemplate,
  MonsterTemplate,
  ObjectTemplate,
  SceneTrigger,
  SceneEntitySpawn,
  PlayerMount,
  StreetGame,
  GameSession,
  LandmarkMessage,
  TriggerUnlock,
  NpcSpawnRule,
  NpcPatrolRoute,
} from './entities';
import { SceneConfigVersion } from './config/entities/scene-config-version.entity';
import { SceneConfigService } from './config/scene-config.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Scene,
      NpcTemplate,
      MonsterTemplate,
      ObjectTemplate,
      SceneTrigger,
      SceneEntitySpawn,
      PlayerMount,
      StreetGame,
      GameSession,
      LandmarkMessage,
      TriggerUnlock,
      SceneConfigVersion,
      NpcSpawnRule,
      NpcPatrolRoute,
    ]),
    EconomyModule,
    CharacterModule,
    AdminModule,
  ],
  controllers: [WorldController, WorldClientController],
  providers: [WorldService, SceneConfigService],
  exports: [WorldService],
})
export class WorldModule {}
