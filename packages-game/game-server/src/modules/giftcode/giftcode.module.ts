import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GiftCodeService } from './giftcode.service';
import { GiftCodeController } from './giftcode.controller';
import {
  GiftCode,
  GiftCodeTemplate,
  GiftCodeRedemption,
} from './entities';
import { CacheModule } from '@cache/cache.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { PlayerModule } from '@modules/player/player.module';
import { EconomyModule } from '@modules/economy/economy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GiftCodeTemplate, GiftCode, GiftCodeRedemption]),
    CacheModule,
    InventoryModule,
    PlayerModule,
    EconomyModule,
  ],
  controllers: [GiftCodeController],
  providers: [GiftCodeService],
  exports: [GiftCodeService],
})
export class GiftCodeModule {}
