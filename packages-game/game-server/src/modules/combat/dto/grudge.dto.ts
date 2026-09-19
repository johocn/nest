import { IsString } from 'class-validator';

export class GrudgeDto {
  @IsString()
  targetId: string;
}
