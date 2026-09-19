import { IsString } from 'class-validator';

export class CreateEscrowDto {
  @IsString()
  sellerId: string;

  @IsString()
  tradeOrderId: string;

  @IsString()
  guarantorId: string;
}
