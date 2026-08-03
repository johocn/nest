import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Job } from 'bullmq';
import { OfflineSyncService } from './offline-sync.service';
import { QUEUE_NAMES } from '@queue/queue.constants';

@Injectable()
@Processor(QUEUE_NAMES.OFFLINE_PUSH)
export class OfflineProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(OfflineProcessor.name);

  constructor(private readonly offlineSyncService: OfflineSyncService) {
    super();
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  async process(job: Job<{ playerId: string; message: any }>): Promise<any> {
    this.logger.debug(
      `Processing offline push for player ${job.data.playerId}`,
    );
    await this.offlineSyncService.pushOfflineMessage(
      job.data.playerId,
      job.data.message,
    );
  }
}
