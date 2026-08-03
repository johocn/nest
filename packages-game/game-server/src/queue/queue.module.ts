import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from './queue.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.MAIL_BATCH },
      { name: QUEUE_NAMES.COMBAT_LOG },
      { name: QUEUE_NAMES.ITEM_CHANGE_LOG },
      { name: QUEUE_NAMES.OFFLINE_PUSH },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
