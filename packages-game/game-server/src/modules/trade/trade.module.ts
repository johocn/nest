import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeService } from './trade.service';
import { TradeController } from './trade.controller';
import {
  TradeOrder,
  AuctionItem,
  Negotiation,
  EscrowAgreement,
  Bounty,
  CreditDebt,
  BarterDeal,
} from './entities';
import { EconomyModule } from '@modules/economy/economy.module';
import { SocialModule } from '@modules/social/social.module';
import { CharacterModule } from '@modules/character/character.module';
import { CombatModule } from '@modules/combat/combat.module';
import { VipModule } from '@modules/vip/vip.module';
import { RiskModule } from '@modules/risk/risk.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { ConfigManageModule } from '@modules/config/config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TradeOrder,
      AuctionItem,
      Negotiation,
      EscrowAgreement,
      Bounty,
      CreditDebt,
      BarterDeal,
    ]),
    EconomyModule,
    SocialModule,
    CharacterModule,
    CombatModule,
    VipModule,
    RiskModule,
    InventoryModule,
    ConfigManageModule,
  ],
  controllers: [TradeController],
  providers: [TradeService],
  exports: [TradeService],
})
export class TradeModule {}
