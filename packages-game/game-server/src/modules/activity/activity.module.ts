import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';
import { ActivityTemplate, PlayerActivity, SignInRecord } from './entities';
import { Player } from '@modules/player/entities/player.entity';
import { PlayerBehaviorLog } from '@modules/analytics/entities/player-behavior-log.entity';
import { AdminModule } from '@modules/admin/admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActivityTemplate,
      PlayerActivity,
      SignInRecord,
      Player,
      PlayerBehaviorLog,
    ]),
    AdminModule,
  ],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
