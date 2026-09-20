import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocialService } from './social.service';
import { SocialController } from './social.controller';
import { SocialEconomyService } from './social-economy.service';
import { SocialEventListener } from './social-event.listener';
import {
  Friend,
  Guild,
  GuildMember,
  GuildDonate,
  GuildImpeachment,
  GuildBuilding,
  GuildFundLog,
  GuildActivity,
  GuildDiplomacy,
  Intelligence,
  GiftTemplate,
  Kinship,
  PlayerReport,
  PlayerBlock,
  SocialPointRecord,
  SocialChest,
  GuideProgress,
} from './entities';
import { Player } from '@modules/player/entities/player.entity';
import { CharacterEspionage } from '@modules/character/entities';
import { EconomyModule } from '@modules/economy/economy.module';
import { CharacterModule } from '@modules/character/character.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { PlayerModule } from '@modules/player/player.module';
import { ConfigManageModule } from '@modules/config/config.module';
import { VipModule } from '@modules/vip/vip.module';

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
      GuildActivity,
      GuildDiplomacy,
      Intelligence,
      GiftTemplate,
      Kinship,
      CharacterEspionage,
      PlayerReport,
      PlayerBlock,
      SocialPointRecord,
      SocialChest,
      GuideProgress,
      Player,
    ]),
    EconomyModule,
    CharacterModule,
    InventoryModule,
    PlayerModule,
    ConfigManageModule,
    VipModule,
  ],
  controllers: [SocialController],
  providers: [SocialService, SocialEconomyService, SocialEventListener],
  exports: [SocialService, SocialEconomyService],
})
export class SocialModule {}
