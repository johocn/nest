import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { MailAdminController } from './mail-admin.controller';
import { MailBatchProcessor } from './mail.processor';
import { Mail } from './entities';
import { QueueModule } from '@queue/queue.module';

@Module({
  imports: [TypeOrmModule.forFeature([Mail]), QueueModule],
  controllers: [MailController, MailAdminController],
  providers: [MailService, MailBatchProcessor],
  exports: [MailService],
})
export class MailModule {}
