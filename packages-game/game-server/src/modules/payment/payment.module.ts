import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { RechargeOrder, RechargeProduct } from './entities';
import { EconomyModule } from '@modules/economy/economy.module';
import { PlayerModule } from '@modules/player/player.module';
import { VipModule } from '@modules/vip/vip.module';
import { ConfigManageModule } from '@modules/config/config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RechargeOrder, RechargeProduct]),
    EconomyModule,
    PlayerModule,
    VipModule,
    ConfigManageModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
