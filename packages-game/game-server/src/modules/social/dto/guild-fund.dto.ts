import { IsInt, IsString, Min, Max } from 'class-validator';

export class AdjustGuildFundDto {
  @IsString()
  guildId: string;

  @IsInt()
  @Min(-100000000)
  @Max(100000000)
  amount: number;

  @IsString()
  reason: string;
}
