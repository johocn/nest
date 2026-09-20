import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class ResolveEncounterDto {
  @ApiProperty({ description: '所选选项 id' })
  @IsString()
  @IsNotEmpty()
  choice: string;
}