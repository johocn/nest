import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_NAMES } from '@queue/queue.constants';

export interface ItemChangeLogData {
  playerId: string;
  itemTemplateId: string;
  changeType: string;
  quantity: number;
  source: string;
}

@Injectable()
@Processor(QUEUE_NAMES.ITEM_CHANGE_LOG)
export class ItemChangeLogProcessor
  extends WorkerHost
  implements OnModuleDestroy
{
  private readonly logger = new Logger(ItemChangeLogProcessor.name);

  async onModuleDestroy() {
    await this.worker?.close();
  }

  async process(job: Job<ItemChangeLogData>): Promise<any> {
    this.logger.debug(
      `Processing item change log: ${JSON.stringify(job.data)}`,
    );
    // In production, save to a dedicated log table or send to analytics
  }
}
