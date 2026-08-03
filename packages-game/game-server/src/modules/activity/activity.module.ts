import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';
import { ActivityTemplate, PlayerActivity, SignInRecord } from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([ActivityTemplate, PlayerActivity, SignInRecord]),
  ],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
