import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SkillService } from './skill.service';
import { SkillController } from './skill.controller';
import { SkillTemplate } from './entities';
import { BuffModule } from '@modules/buff/buff.module';

@Module({
  imports: [TypeOrmModule.forFeature([SkillTemplate]), BuffModule],
  controllers: [SkillController],
  providers: [SkillService],
  exports: [SkillService],
})
export class SkillModule {}
