import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VipService } from './vip.service';
import { VipController } from './vip.controller';
import { VipEventListener } from './vip-event.listener';
import { VipConfig } from './entities/vip-config.entity';
import { Character, CharacterTitle } from '@modules/character/entities';
import { PlayerModule } from '@modules/player/player.module';
import { EconomyModule } from '@modules/economy/economy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([VipConfig, Character, CharacterTitle]),
    PlayerModule,
    EconomyModule,
  ],
  controllers: [VipController],
  providers: [VipService, VipEventListener],
  exports: [VipService],
})
export class VipModule {}
