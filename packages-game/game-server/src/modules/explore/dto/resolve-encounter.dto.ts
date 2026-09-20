import { ApiProperty } from '@nestjs/swagger';

export class ResolveEncounterDto {
  @ApiProperty({ description: '所选选项 id' })
  choice: string;
}