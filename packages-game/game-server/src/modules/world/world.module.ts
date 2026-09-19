import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorldService } from './world.service';
import { WorldController } from './world.controller';
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
    ]),
  ],
  controllers: [WorldController],
  providers: [WorldService],
  exports: [WorldService],
})
export class WorldModule {}
