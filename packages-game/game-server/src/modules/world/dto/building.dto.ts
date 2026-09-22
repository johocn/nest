import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { BuildMode } from '@constants/enums';

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

/**
 * 建造请求（S6 / Task 6）：计划路由 `POST buildings` 无 :sceneId 路径参数，
 * 故 sceneId 随 body 下发；其余字段与 CreateBuildingDto 完全一致（勿改原 DTO）。
 */
export class CreateBuildingRequestDto extends CreateBuildingDto {
  @ApiProperty({ description: '场景 ID' })
  @IsString()
  sceneId: string;
}

/** 建筑蓝图新建/更新请求（S6 / Task 6，admin 侧） */
export class BuildingTemplateUpsertDto {
  @ApiProperty({ description: '蓝图名称' })
  @IsString()
  name: string;

  @ApiProperty({ description: '资源键（客户端贴图寻址）' })
  @IsString()
  resKey: string;

  @ApiProperty({ description: '分类' })
  @IsString()
  category: string;

  @ApiProperty({ description: '占地宽（格）' })
  @IsInt()
  @Min(1)
  footprintW: number;

  @ApiProperty({ description: '占地高（格）' })
  @IsInt()
  @Min(1)
  footprintH: number;

  @ApiProperty({ description: '建造消耗', type: 'array', items: { type: 'object' } })
  @IsArray()
  buildCost: Record<string, any>[];

  @ApiProperty({ description: '建造耗时（秒）' })
  @IsInt()
  @Min(0)
  buildSeconds: number;

  @ApiProperty({ description: '耐久' })
  @IsInt()
  @Min(0)
  durability: number;

  @ApiPropertyOptional({ description: '建筑效果（本批只落库不生效）' })
  @IsOptional()
  @IsObject()
  effect?: Record<string, any>;

  @ApiPropertyOptional({ description: '解锁条件（本批不校验）' })
  @IsOptional()
  @IsObject()
  unlockCondition?: Record<string, any>;

  @ApiPropertyOptional({ description: '是否启用', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** 建筑蓝图启停请求（S6 / Task 6，缺省取反） */
export class ToggleBuildingTemplateDto {
  @ApiPropertyOptional({ description: '目标启用状态（缺省取反）' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** 场景建造规则 upsert 请求（S6 / Task 6，admin 侧） */
export class UpsertBuildRuleDto {
  @ApiProperty({ enum: BuildMode, description: '建造模式' })
  @IsEnum(BuildMode)
  mode: BuildMode;

  @ApiPropertyOptional({ description: '每格边长（像素）' })
  @IsOptional()
  @IsInt()
  @Min(1)
  landGridSize?: number;

  @ApiPropertyOptional({ description: '每玩家建造上限' })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxBuildingsPerPlayer?: number;

  @ApiPropertyOptional({ description: '是否允许拆除' })
  @IsOptional()
  @IsBoolean()
  allowDemolish?: boolean;

  @ApiPropertyOptional({ description: '共建人数门槛' })
  @IsOptional()
  @IsInt()
  @Min(1)
  coopMinContributors?: number;

  @ApiPropertyOptional({ description: '共建超时（小时）' })
  @IsOptional()
  @IsInt()
  @Min(0)
  coopExpireHours?: number;

  @ApiPropertyOptional({ description: '保留区（格点矩形）', type: 'array', items: { type: 'object' } })
  @IsOptional()
  @IsArray()
  reservedZones?: Record<string, any>[];
}