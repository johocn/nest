import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, Min } from 'class-validator';
import { CurrencyType } from '@constants/enums';

export class ExchangeDto {
  @ApiProperty({ enum: CurrencyType })
  @IsEnum(CurrencyType)
  from: CurrencyType;

  @ApiProperty({ enum: CurrencyType })
  @IsEnum(CurrencyType)
  to: CurrencyType;

  @ApiProperty()
  @IsInt()
  @Min(1)
  amount: number;
}
