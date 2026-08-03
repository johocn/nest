import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CombatService } from './combat.service';
import { CombatController } from './combat.controller';
import { CombatLogProcessor } from './combat.processor';
import { CombatLog } from './entities';
import { SkillModule } from '@modules/skill/skill.module';
import { BuffModule } from '@modules/buff/buff.module';
import { QueueModule } from '@queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CombatLog]),
    SkillModule,
    BuffModule,
    QueueModule,
  ],
  controllers: [CombatController],
  providers: [CombatService, CombatLogProcessor],
  exports: [CombatService],
})
export class CombatModule {}
