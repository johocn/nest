import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

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

/** 共建投料单项（S6 / Task 4；形状与 building_templates.build_cost 元素一致） */
export class ContributeCostEntryDto {
  @ApiPropertyOptional({ description: '道具模板 ID（与 currencyType 二选一）' })
  @IsOptional()
  @IsString()
  itemTemplateId?: string;

  @ApiPropertyOptional({ description: '货币类型（与 itemTemplateId 二选一）' })
  @IsOptional()
  @IsString()
  currencyType?: string;

  @ApiProperty({ description: '数量（正整数）' })
  @IsInt()
  @Min(1)
  amount: number;
}

/** 共建投料请求（S6 / Task 4） */
export class ContributeDto {
  @ApiProperty({ description: '投料列表', type: [ContributeCostEntryDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ContributeCostEntryDto)
  items: ContributeCostEntryDto[];
}