import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LadderService } from './ladder.service';
import { LadderController } from './ladder.controller';
import { LadderRecord } from './entities';
import { PlayerModule } from '@modules/player/player.module';
import { ConfigManageModule } from '@modules/config/config.module';
import { AdminModule } from '@modules/admin/admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LadderRecord]),
    PlayerModule,
    ConfigManageModule,
    AdminModule,
  ],
  controllers: [LadderController],
  providers: [LadderService],
  exports: [LadderService],
})
export class LadderModule {}
