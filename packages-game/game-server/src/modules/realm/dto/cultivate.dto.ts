import { ApiProperty } from '@nestjs/swagger';

export class CultivateDto {
  @ApiProperty({ description: '本次投入的修为数量' })
  amount: number;
}