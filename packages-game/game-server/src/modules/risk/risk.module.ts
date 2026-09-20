import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeOrder } from '@modules/trade/entities/trade-order.entity';
import { ConfigManageModule } from '@modules/config/config.module';
import { EconomyModule } from '@modules/economy/economy.module';
import { AuthModule } from '@modules/auth/auth.module';
import { PlayerModule } from '@modules/player/player.module';
import { AdminModule } from '@modules/admin/admin.module';
import { AccountLoginLog } from '@modules/auth/entities/account-login-log.entity';
import { AuthAccount } from '@modules/auth/entities/auth-account.entity';
import { Player } from '@modules/player/entities/player.entity';
import { RiskWashService } from './risk-wash.service';
import { RiskGateService } from './risk-gate.service';
import { RiskReplayService } from './risk-replay.service';
import { RiskIdentityService } from './risk-identity.service';
import { RiskAdminController } from './risk-admin.controller';
import { RiskWashFlow, RiskCase, RiskAccountScore, RiskWhitelist, RiskRecoverRecord, RiskIdentityLink } from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RiskWashFlow,
      RiskCase,
      RiskAccountScore,
      RiskWhitelist,
      TradeOrder,
      RiskRecoverRecord,
      RiskIdentityLink,
      AccountLoginLog,
      AuthAccount,
      Player,
    ]),
    ConfigManageModule,
    EconomyModule,
    AuthModule,
    PlayerModule,
    AdminModule,
  ],
  controllers: [RiskAdminController],
  providers: [RiskWashService, RiskGateService, RiskReplayService, RiskIdentityService],
  exports: [RiskWashService, RiskGateService, RiskReplayService],
})
export class RiskModule {}