import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';
import { ActivityTemplate, PlayerActivity, SignInRecord } from './entities';
import { Player } from '@modules/player/entities/player.entity';
import { PlayerBehaviorLog } from '@modules/analytics/entities/player-behavior-log.entity';
import { PlayerQuest } from '@modules/quest/entities';
import { AdminModule } from '@modules/admin/admin.module';
import { CharacterModule } from '@modules/character/character.module';
import { SocialModule } from '@modules/social/social.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActivityTemplate,
      PlayerActivity,
      SignInRecord,
      Player,
      PlayerBehaviorLog,
      PlayerQuest,
    ]),
    AdminModule,
    CharacterModule,
    SocialModule,
  ],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
