import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CombatLog } from './entities';
import { QUEUE_NAMES } from '@queue/queue.constants';

@Injectable()
@Processor(QUEUE_NAMES.COMBAT_LOG)
export class CombatLogProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(CombatLogProcessor.name);

  constructor(
    @InjectRepository(CombatLog)
    private readonly combatLogRepo: Repository<CombatLog>,
  ) {
    super();
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  async process(job: Job<Partial<CombatLog>>): Promise<any> {
    this.logger.debug(`Processing combat log job ${job.id}`);
    const log = this.combatLogRepo.create(job.data);
    await this.combatLogRepo.save(log);
  }
}
