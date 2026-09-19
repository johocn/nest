import { IsString } from 'class-validator';

export class IntelSpyDto {
  @IsString()
  targetId: string;
}
