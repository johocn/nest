import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReconcileService } from './reconcile.service';
import { ReconcileAdminController } from './reconcile-admin.controller';
import { ReconcileResult } from './entities/reconcile-result.entity';
import { Transaction } from '@modules/economy/entities/transaction.entity';
import { TradeOrder } from '@modules/trade/entities/trade-order.entity';
import { AuctionItem } from '@modules/trade/entities/auction-item.entity';
import { EscrowAgreement } from '@modules/trade/entities/escrow-agreement.entity';
import { Bounty } from '@modules/trade/entities/bounty.entity';
import { AdminModule } from '@modules/admin/admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReconcileResult,
      Transaction,
      TradeOrder,
      AuctionItem,
      EscrowAgreement,
      Bounty,
    ]),
    AdminModule,
  ],
  controllers: [ReconcileAdminController],
  providers: [ReconcileService],
  exports: [ReconcileService],
})
export class ReconcileModule {}