import { IsString } from 'class-validator';

export class AcceptQuestDto {
  @IsString()
  questTemplateId: string;
}
