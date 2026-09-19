import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EconomyService } from './economy.service';
import { EconomyController } from './economy.controller';
import { EconomyClientController } from './economy.client.controller';
import { Transaction } from './entities/transaction.entity';
import { PlayerModule } from '@modules/player/player.module';

@Module({
  imports: [TypeOrmModule.forFeature([Transaction]), PlayerModule],
  controllers: [EconomyController, EconomyClientController],
  providers: [EconomyService],
  exports: [EconomyService],
})
export class EconomyModule {}
