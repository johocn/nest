import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeOrder } from '@modules/trade/entities/trade-order.entity';
import { ConfigManageModule } from '@modules/config/config.module';
import { RiskWashService } from './risk-wash.service';
import { RiskAdminController } from './risk-admin.controller';
import { RiskWashFlow, RiskCase, RiskAccountScore, RiskWhitelist } from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RiskWashFlow,
      RiskCase,
      RiskAccountScore,
      RiskWhitelist,
      TradeOrder,
    ]),
    ConfigManageModule,
  ],
  controllers: [RiskAdminController],
  providers: [RiskWashService],
  exports: [RiskWashService],
})
export class RiskModule {}