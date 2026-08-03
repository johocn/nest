import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VipService } from './vip.service';
import { VipController } from './vip.controller';
import { VipConfig } from './entities/vip-config.entity';
import { PlayerModule } from '@modules/player/player.module';
import { EconomyModule } from '@modules/economy/economy.module';

@Module({
  imports: [TypeOrmModule.forFeature([VipConfig]), PlayerModule, EconomyModule],
  controllers: [VipController],
  providers: [VipService],
  exports: [VipService],
})
export class VipModule {}
