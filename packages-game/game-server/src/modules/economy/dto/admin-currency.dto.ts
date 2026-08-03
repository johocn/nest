import { IsEnum, IsInt, IsString, Min } from 'class-validator';
import { CurrencyType } from '@constants/enums';

export class AdminCurrencyDto {
  @IsEnum(CurrencyType)
  currencyType: CurrencyType;

  @IsInt()
  @Min(1)
  amount: number;

  @IsString()
  operation: 'add' | 'deduct';

  @IsString()
  reason: string;
}
