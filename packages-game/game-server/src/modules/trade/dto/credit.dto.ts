import { IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCreditDto {
  @IsString()
  lenderId: string;

  @IsString()
  amount: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  dueDays: number;
}
