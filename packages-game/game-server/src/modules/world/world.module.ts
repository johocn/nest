import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorldService } from './world.service';
import { WorldController } from './world.controller';
import { WorldClientController } from './world.client.controller';
import { NpcAdminController } from './npc-admin.controller';
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
import { PlayerQuest } from '@modules/quest/entities/player-quest.entity';
import { PlayerModule } from '@modules/player/player.module';
import { NpcPresenceService } from './npc/npc-presence.service';
import { NpcTickService } from './npc/npc-tick.service';

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
      PlayerQuest,
    ]),
    EconomyModule,
    CharacterModule,
    AdminModule,
    PlayerModule,
  ],
  controllers: [WorldController, WorldClientController, NpcAdminController],
  providers: [
    WorldService,
    SceneConfigService,
    NpcPresenceService,
    NpcTickService,
  ],
  exports: [WorldService, NpcPresenceService],
})
export class WorldModule {}
