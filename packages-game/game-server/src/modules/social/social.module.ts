import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocialService } from './social.service';
import { SocialController } from './social.controller';
import {
  Friend,
  Guild,
  GuildMember,
  GuildDonate,
  GuildImpeachment,
  GuildBuilding,
  GuildFundLog,
  Intelligence,
  GiftTemplate,
  Kinship,
} from './entities';
import { CharacterEspionage } from '@modules/character/entities';
import { EconomyModule } from '@modules/economy/economy.module';
import { CharacterModule } from '@modules/character/character.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { PlayerModule } from '@modules/player/player.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Friend,
      Guild,
      GuildMember,
      GuildDonate,
      GuildImpeachment,
      GuildBuilding,
      GuildFundLog,
      Intelligence,
      GiftTemplate,
      Kinship,
      CharacterEspionage,
    ]),
    EconomyModule,
    CharacterModule,
    InventoryModule,
    PlayerModule,
  ],
  controllers: [SocialController],
  providers: [SocialService],
  exports: [SocialService],
})
export class SocialModule {}
