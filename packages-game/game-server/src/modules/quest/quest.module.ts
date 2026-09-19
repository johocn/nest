import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuestService } from './quest.service';
import { QuestController } from './quest.controller';
import { QuestEventListener } from './quest-event.listener';
import { QuestTemplate, PlayerQuest, QuestHelpRequest } from './entities';
import { EconomyModule } from '@modules/economy/economy.module';
import { CharacterModule } from '@modules/character/character.module';
import { SocialModule } from '@modules/social/social.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([QuestTemplate, PlayerQuest, QuestHelpRequest]),
    EconomyModule,
    CharacterModule,
    SocialModule,
  ],
  controllers: [QuestController],
  providers: [QuestService, QuestEventListener],
  exports: [QuestService],
})
export class QuestModule {}
