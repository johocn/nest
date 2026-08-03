import { IsString } from 'class-validator';

export class CastSkillDto {
  @IsString()
  skillId: string;

  @IsString()
  targetId: string;
}
