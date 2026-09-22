import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

/** 单独建造请求（S6 / Task 3） */
export class CreateBuildingDto {
  @ApiProperty({ description: '建筑蓝图 ID' })
  @IsString()
  templateId: string;

  @ApiProperty({ description: '锚点格 X（左上角）' })
  @IsInt()
  @Min(0)
  gx: number;

  @ApiProperty({ description: '锚点格 Y（左上角）' })
  @IsInt()
  @Min(0)
  gy: number;
}