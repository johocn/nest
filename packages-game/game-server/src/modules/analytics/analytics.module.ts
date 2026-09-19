import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { BalanceAuditService } from './balance-audit.service';
import { BalanceAuditController } from './balance-audit.controller';
import { PlayerBehaviorLog, RetentionStat } from './entities';
import { Transaction } from '@modules/economy/entities/transaction.entity';
import { Friend } from '@modules/social/entities/friend.entity';
import { Kinship } from '@modules/social/entities/kinship.entity';
import { Player } from '@modules/player/entities/player.entity';
import { PlayerCurrency } from '@modules/player/entities/player-currency.entity';
import { CombatLog } from '@modules/combat/entities/combat-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlayerBehaviorLog,
      RetentionStat,
      Transaction,
      Friend,
      Kinship,
      Player,
      PlayerCurrency,
      CombatLog,
    ]),
  ],
  controllers: [AnalyticsController, BalanceAuditController],
  providers: [AnalyticsService, BalanceAuditService],
  exports: [AnalyticsService, BalanceAuditService],
})
export class AnalyticsModule {}
