import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SkillService } from './skill.service';
import { SkillController } from './skill-admin.controller';
import { SkillClientController } from './skill.client.controller';
import { SkillTemplate } from './entities';
import { BuffModule } from '@modules/buff/buff.module';
import { CharacterModule } from '@modules/character/character.module';

@Module({
  imports: [TypeOrmModule.forFeature([SkillTemplate]), BuffModule, CharacterModule],
  controllers: [SkillController, SkillClientController],
  providers: [SkillService],
  exports: [SkillService],
})
export class SkillModule {}
