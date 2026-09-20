import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlayerService } from './player.service';
import { PlayerController } from './player.controller';
import { PlayerAdminController } from './player-admin.controller';
import { Player } from './entities/player.entity';
import { PlayerCurrency } from './entities/player-currency.entity';
import { ConfigManageModule } from '@modules/config/config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Player, PlayerCurrency]),
    ConfigManageModule,
  ],
  controllers: [PlayerController, PlayerAdminController],
  providers: [PlayerService],
  exports: [PlayerService],
})
export class PlayerModule {}
