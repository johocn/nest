import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeService } from './trade.service';
import { TradeController } from './trade.controller';
import { TradeOrder, AuctionItem } from './entities';

@Module({
  imports: [TypeOrmModule.forFeature([TradeOrder, AuctionItem])],
  controllers: [TradeController],
  providers: [TradeService],
  exports: [TradeService],
})
export class TradeModule {}
