import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { MailAdminController } from './mail-admin.controller';
import { MailBatchProcessor } from './mail.processor';
import { Mail } from './entities';
import { Player } from '@modules/player/entities/player.entity';
import { QueueModule } from '@queue/queue.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { EconomyModule } from '@modules/economy/economy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Mail, Player]),
    QueueModule,
    InventoryModule,
    EconomyModule,
  ],
  controllers: [MailController, MailAdminController],
  providers: [MailService, MailBatchProcessor],
  exports: [MailService],
})
export class MailModule {}
