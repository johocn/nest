import { Module } from '@nestjs/common';
import { OfflineSyncService } from './offline-sync.service';
import { OfflineProcessor } from './offline.processor';
import { QueueModule } from '@queue/queue.module';

@Module({
  imports: [QueueModule],
  providers: [OfflineSyncService, OfflineProcessor],
  exports: [OfflineSyncService],
})
export class OfflineModule {}
