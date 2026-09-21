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
  Dialogue,
} from './entities';
import { SceneConfigVersion } from './config/entities/scene-config-version.entity';
import { SceneConfigService } from './config/scene-config.service';
import { PlayerQuest } from '@modules/quest/entities/player-quest.entity';
import { InventoryItem } from '@modules/inventory/entities/inventory-item.entity';
import { PlayerModule } from '@modules/player/player.module';
import { QuestModule } from '@modules/quest/quest.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { NpcPresenceService } from './npc/npc-presence.service';
import { NpcTickService } from './npc/npc-tick.service';
import { DialogueService } from './dialogue/dialogue.service';

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
      InventoryItem,
      Dialogue,
    ]),
    EconomyModule,
    CharacterModule,
    AdminModule,
    PlayerModule,
    QuestModule,
    InventoryModule,
  ],
  controllers: [WorldController, WorldClientController, NpcAdminController],
  providers: [
    WorldService,
    SceneConfigService,
    NpcPresenceService,
    NpcTickService,
    DialogueService,
  ],
  exports: [WorldService, NpcPresenceService, DialogueService],
})
export class WorldModule {}
