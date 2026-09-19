import { IsString } from 'class-validator';

export class IntelBuyDto {
  @IsString()
  intelId: string;
}
