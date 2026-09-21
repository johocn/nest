import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorldService } from './world.service';
import { WorldController } from './world.controller';
import { WorldClientController } from './world.client.controller';
import { EconomyModule } from '@modules/economy/economy.module';
import { CharacterModule } from '@modules/character/character.module';
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
} from './entities';
import { SceneConfigVersion } from './config/entities/scene-config-version.entity';

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
    ]),
    EconomyModule,
    CharacterModule,
  ],
  controllers: [WorldController, WorldClientController],
  providers: [WorldService],
  exports: [WorldService],
})
export class WorldModule {}
