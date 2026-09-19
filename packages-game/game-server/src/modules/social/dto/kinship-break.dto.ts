import { IsString } from 'class-validator';

export class KinshipBreakDto {
  @IsString()
  kinshipId: string;
}
