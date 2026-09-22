import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorldService } from './world.service';
import { WorldController } from './world.controller';
import { WorldClientController } from './world.client.controller';
import { NpcAdminController } from './npc-admin.controller';
import { DialogueAdminController } from './dialogue-admin.controller';
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
  SceneBuildRule,
  BuildingTemplate,
  SceneLandPlot,
  BuildingInstance,
  BuildingCoopContribution,
} from './entities';
import { SceneConfigVersion } from './config/entities/scene-config-version.entity';
import { SceneConfigService } from './config/scene-config.service';
import { PlayerQuest } from '@modules/quest/entities/player-quest.entity';
import { QuestTemplate } from '@modules/quest/entities/quest-template.entity';
import { InventoryItem } from '@modules/inventory/entities/inventory-item.entity';
import { PlayerModule } from '@modules/player/player.module';
import { QuestModule } from '@modules/quest/quest.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { NpcPresenceService } from './npc/npc-presence.service';
import { NpcTickService } from './npc/npc-tick.service';
import { DialogueService } from './dialogue/dialogue.service';
import { BuildRuleService } from './building/build-rule.service';
import { BuildingService } from './building/building.service';
import { BuildingScheduler } from './building/building.scheduler';

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
      QuestTemplate,
      InventoryItem,
      Dialogue,
      SceneBuildRule,
      BuildingTemplate,
      SceneLandPlot,
      BuildingInstance,
      BuildingCoopContribution,
    ]),
    EconomyModule,
    CharacterModule,
    AdminModule,
    PlayerModule,
    QuestModule,
    InventoryModule,
  ],
  controllers: [
    WorldController,
    WorldClientController,
    NpcAdminController,
    DialogueAdminController,
  ],
  providers: [
    WorldService,
    SceneConfigService,
    NpcPresenceService,
    NpcTickService,
    DialogueService,
    BuildRuleService,
    BuildingService,
    BuildingScheduler,
  ],
  exports: [
    WorldService,
    NpcPresenceService,
    DialogueService,
    BuildRuleService,
    BuildingService,
  ],
})
export class WorldModule {}
