import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { NpcPatrolLoopMode, NpcSpawnRuleType } from '@constants/enums';

/** 巡逻路径点（坐标为地图像素，pauseSec 为到达后停留秒数） */
export class NpcRoutePointDto {
  @ApiProperty({ description: '路点 X（像素）' })
  @IsInt()
  @Min(0)
  x: number;

  @ApiProperty({ description: '路点 Y（像素）' })
  @IsInt()
  @Min(0)
  y: number;

  @ApiPropertyOptional({ description: '到达该点后停留秒数' })
  @IsOptional()
  @IsInt()
  @Min(0)
  pauseSec?: number;
}

/** NPC 规则/路径列表查询 */
export class NpcRuleQueryDto {
  @ApiPropertyOptional({ description: '场景 ID，缺省返回全部' })
  @IsOptional()
  @IsString()
  sceneId?: string;
}

/** 新建 NPC 出现规则 */
export class CreateNpcRuleDto {
  @ApiProperty({ description: '场景 ID' })
  @IsString()
  sceneId: string;

  @ApiProperty({ description: 'NPC 模板 ID' })
  @IsString()
  npcTemplateId: string;

  @ApiProperty({ description: '规则类型', enum: NpcSpawnRuleType })
  @IsEnum(NpcSpawnRuleType)
  ruleType: NpcSpawnRuleType;

  @ApiPropertyOptional({ description: '出生点 X（像素）' })
  @IsOptional()
  @IsInt()
  @Min(0)
  spawnX?: number;

  @ApiPropertyOptional({ description: '出生点 Y（像素）' })
  @IsOptional()
  @IsInt()
  @Min(0)
  spawnY?: number;

  @ApiPropertyOptional({ description: '随机半径（像素）' })
  @IsOptional()
  @IsInt()
  @Min(0)
  spawnRadius?: number;

  @ApiPropertyOptional({ description: '生成数量' })
  @IsOptional()
  @IsInt()
  @Min(1)
  spawnCount?: number;

  @ApiPropertyOptional({ description: '可见条件，如 { minLevel, questId }' })
  @IsOptional()
  @IsObject()
  condition?: Record<string, any> | null;

  @ApiPropertyOptional({ description: '巡逻路径 ID（patrol 规则使用）' })
  @IsOptional()
  @IsString()
  patrolRouteId?: string | null;

  @ApiProperty({ description: '规则名称' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** 更新 NPC 出现规则（字段均可选） */
export class UpdateNpcRuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  npcTemplateId?: string;

  @ApiPropertyOptional({ enum: NpcSpawnRuleType })
  @IsOptional()
  @IsEnum(NpcSpawnRuleType)
  ruleType?: NpcSpawnRuleType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  spawnX?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  spawnY?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  spawnRadius?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  spawnCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  condition?: Record<string, any> | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  patrolRouteId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** 新建巡逻路径 */
export class CreateNpcRouteDto {
  @ApiProperty({ description: '场景 ID' })
  @IsString()
  sceneId: string;

  @ApiProperty({ description: 'NPC 模板 ID' })
  @IsString()
  npcTemplateId: string;

  @ApiProperty({ description: '路径名称' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @ApiPropertyOptional({ description: '循环模式', enum: NpcPatrolLoopMode })
  @IsOptional()
  @IsEnum(NpcPatrolLoopMode)
  loopMode?: NpcPatrolLoopMode;

  @ApiPropertyOptional({ description: '移动速度（像素/秒）' })
  @IsOptional()
  @IsInt()
  @Min(1)
  speed?: number;

  @ApiProperty({ description: '路点数组', type: [NpcRoutePointDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NpcRoutePointDto)
  points: NpcRoutePointDto[];

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** 更新巡逻路径（字段均可选） */
export class UpdateNpcRouteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  npcTemplateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({ enum: NpcPatrolLoopMode })
  @IsOptional()
  @IsEnum(NpcPatrolLoopMode)
  loopMode?: NpcPatrolLoopMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  speed?: number;

  @ApiPropertyOptional({ type: [NpcRoutePointDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NpcRoutePointDto)
  points?: NpcRoutePointDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
