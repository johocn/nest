import { IsString } from 'class-validator';

export class RollDropDto {
  @IsString()
  dropTemplateId: string;

  @IsString()
  playerId: string;
}
