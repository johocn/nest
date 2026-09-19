import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CombatService } from './combat.service';
import { CombatController } from './combat.controller';
import { CombatClientController } from './combat.client.controller';
import { CombatLogProcessor } from './combat.processor';
import {
  CombatLog,
  Formation,
  FormationBinding,
  RescueLog,
  CombatLootLog,
  CombatArbitration,
} from './entities';
import { FormationService } from './formation.service';
import { RescueService } from './rescue.service';
import { FaceService } from './face.service';
import { LootService } from './loot.service';
import { ArbitrationService } from './arbitration.service';
import { SkillModule } from '@modules/skill/skill.module';
import { BuffModule } from '@modules/buff/buff.module';
import { QueueModule } from '@queue/queue.module';
import { EconomyModule } from '@modules/economy/economy.module';
import { CharacterModule } from '@modules/character/character.module';
import { SocialModule } from '@modules/social/social.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CombatLog,
      Formation,
      FormationBinding,
      RescueLog,
      CombatLootLog,
      CombatArbitration,
    ]),
    SkillModule,
    BuffModule,
    QueueModule,
    EconomyModule,
    CharacterModule,
    SocialModule,
  ],
  controllers: [CombatController, CombatClientController],
  providers: [
    CombatService,
    CombatLogProcessor,
    FormationService,
    RescueService,
    FaceService,
    LootService,
    ArbitrationService,
  ],
  exports: [CombatService],
})
export class CombatModule {}
