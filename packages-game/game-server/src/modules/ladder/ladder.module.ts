import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LadderService } from './ladder.service';
import { LadderController } from './ladder.controller';
import { LadderAdminController } from './ladder-admin.controller';
import { LadderRecord } from './entities';
import { PlayerModule } from '@modules/player/player.module';
import { ConfigManageModule } from '@modules/config/config.module';
import { AdminModule } from '@modules/admin/admin.module';
import { CacheModule } from '@cache/cache.module';
import { EconomyModule } from '@modules/economy/economy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LadderRecord]),
    PlayerModule,
    ConfigManageModule,
    AdminModule,
    CacheModule,
    EconomyModule,
  ],
  controllers: [LadderController, LadderAdminController],
  providers: [LadderService],
  exports: [LadderService],
})
export class LadderModule {}
