import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EconomyService } from './economy.service';
import { EconomyDashboardService } from './economy-dashboard.service';
import { EconomyController } from './economy.controller';
import { EconomyClientController } from './economy.client.controller';
import { Transaction } from './entities/transaction.entity';
import { PlayerCurrency } from '@modules/player/entities/player-currency.entity';
import { RiskRecoverRecord } from '@modules/risk/entities/risk-recover-record.entity';
import { PlayerModule } from '@modules/player/player.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, PlayerCurrency, RiskRecoverRecord]),
    PlayerModule,
  ],
  controllers: [EconomyController, EconomyClientController],
  providers: [EconomyService, EconomyDashboardService],
  exports: [EconomyService, EconomyDashboardService],
})
export class EconomyModule {}
