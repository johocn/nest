import { IsString } from 'class-validator';

export class RescueDto {
  @IsString()
  targetId: string;
}
