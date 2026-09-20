import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class CultivateDto {
  @ApiProperty({ description: '本次投入的修为数量' })
  @IsInt()
  @Min(1)
  amount: number;
}