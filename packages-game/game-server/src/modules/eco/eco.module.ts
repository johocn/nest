import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthAccount } from '@modules/auth/entities/auth-account.entity';
import { Player } from '@modules/player/entities/player.entity';
import { EcoEventsService } from './eco-events.service';
import { EcoEventsController } from './eco-events.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AuthAccount, Player])],
  controllers: [EcoEventsController],
  providers: [EcoEventsService],
  exports: [EcoEventsService],
})
export class EcoModule {}
