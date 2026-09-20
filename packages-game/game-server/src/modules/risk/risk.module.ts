import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeOrder } from '@modules/trade/entities/trade-order.entity';
import { ConfigManageModule } from '@modules/config/config.module';
import { EconomyModule } from '@modules/economy/economy.module';
import { AuthModule } from '@modules/auth/auth.module';
import { PlayerModule } from '@modules/player/player.module';
import { AdminModule } from '@modules/admin/admin.module';
import { RiskWashService } from './risk-wash.service';
import { RiskGateService } from './risk-gate.service';
import { RiskAdminController } from './risk-admin.controller';
import { RiskWashFlow, RiskCase, RiskAccountScore, RiskWhitelist, RiskRecoverRecord } from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RiskWashFlow,
      RiskCase,
      RiskAccountScore,
      RiskWhitelist,
      TradeOrder,
      RiskRecoverRecord,
    ]),
    ConfigManageModule,
    EconomyModule,
    AuthModule,
    PlayerModule,
    AdminModule,
  ],
  controllers: [RiskAdminController],
  providers: [RiskWashService, RiskGateService],
  exports: [RiskWashService, RiskGateService],
})
export class RiskModule {}