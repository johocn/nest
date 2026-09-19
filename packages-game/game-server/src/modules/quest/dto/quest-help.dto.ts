import { IsString } from 'class-validator';

export class QuestHelpDto {
  @IsString()
  questTemplateId: string;
}
