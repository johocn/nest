import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuestService } from './quest.service';
import { QuestController } from './quest.controller';
import { QuestTemplate, PlayerQuest } from './entities';

@Module({
  imports: [TypeOrmModule.forFeature([QuestTemplate, PlayerQuest])],
  controllers: [QuestController],
  providers: [QuestService],
  exports: [QuestService],
})
export class QuestModule {}
