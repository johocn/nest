import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MailService } from './mail.service';
import { QUEUE_NAMES } from '@queue/queue.constants';

@Injectable()
@Processor(QUEUE_NAMES.MAIL_BATCH)
export class MailBatchProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(MailBatchProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  async process(
    job: Job<{
      recipientIds: string[];
      title: string;
      content: string;
      senderType: string;
      attachmentJson?: Record<string, any>;
    }>,
  ): Promise<any> {
    this.logger.log(
      `Processing mail batch job ${job.id}: ${job.data.recipientIds.length} recipients`,
    );
    for (const recipientId of job.data.recipientIds) {
      await this.mailService.sendMail({
        recipientId,
        senderType: job.data.senderType as any,
        title: job.data.title,
        content: job.data.content,
        attachmentJson: job.data.attachmentJson,
      });
    }
    this.logger.log(`Mail batch job ${job.id} completed`);
  }
}
