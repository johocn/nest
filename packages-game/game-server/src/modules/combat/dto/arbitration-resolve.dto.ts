import { IsString } from 'class-validator';

export class ArbitrationResolveDto {
  @IsString()
  result: string;
}
