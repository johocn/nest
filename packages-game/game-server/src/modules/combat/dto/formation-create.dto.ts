import { IsString } from 'class-validator';

export class CreateFormationDto {
  @IsString()
  formationId: string;
}
