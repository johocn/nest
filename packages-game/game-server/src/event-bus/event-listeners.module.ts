import { Module } from '@nestjs/common';
import { GameEventListeners } from './event-listeners.service';
import { QuestModule } from '@modules/quest/quest.module';
import { PlayerModule } from '@modules/player/player.module';
import { RankingModule } from '@modules/ranking/ranking.module';
import { CharacterModule } from '@modules/character/character.module';
import { WorldModule } from '@modules/world/world.module';
import { ItemDropModule } from '@modules/item-drop/item-drop.module';
import { AchievementModule } from '@modules/achievement/achievement.module';

@Module({
  imports: [
    QuestModule,
    PlayerModule,
    RankingModule,
    CharacterModule,
    WorldModule,
    ItemDropModule,
    AchievementModule,
  ],
  providers: [GameEventListeners],
})
export class EventListenersModule {}