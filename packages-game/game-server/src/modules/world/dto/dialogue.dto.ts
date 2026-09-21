import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

/**
 * 客户端对话推进（D2/D7）：客户端只回 `optionIndex`（**原始下标**），
 * 不传目标节点 key，防止伪造跳节点；`nodeKey` 仅用于服务端校验「当前确实在该节点」。
 */
export class ChooseDialogueDto {
  @ApiProperty({ description: '对话编码，如 npc_blacksmith_main' })
  @IsString()
  @Length(1, 64)
  code: string;

  @ApiProperty({ description: '当前节点 key' })
  @IsString()
  @Length(1, 64)
  nodeKey: string;

  @ApiProperty({ description: '选项原始下标（见 talk 返回的 optionIndexes）' })
  @IsInt()
  @Min(0)
  @Type(() => Number)
  optionIndex: number;
}

/** 对话列表查询（分页 + 关键字，关键字匹配 code / title） */
export class DialogueQueryDto {
  @ApiPropertyOptional({ description: '页码，从 1 开始' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页条数' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 20;

  @ApiPropertyOptional({ description: '关键字（匹配 code / title）' })
  @IsOptional()
  @IsString()
  keyword?: string;
}

/** 新建对话树 */
export class CreateDialogueDto {
  @ApiProperty({ description: '对话唯一编码，如 npc_blacksmith_main' })
  @IsString()
  @Length(1, 64)
  code: string;

  @ApiProperty({ description: '标题（运营备注）' })
  @IsString()
  @Length(1, 128)
  title: string;

  @ApiProperty({ description: '节点数组（结构由 assertDialogueNodes 校验）' })
  @IsArray()
  nodes: Record<string, any>[];

  @ApiPropertyOptional({ description: '文本版本' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** 更新对话树（字段均可选） */
export class UpdateDialogueDto {
  @ApiPropertyOptional({ description: '对话唯一编码' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  code?: string;

  @ApiPropertyOptional({ description: '标题（运营备注）' })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  title?: string;

  @ApiPropertyOptional({ description: '节点数组（结构由 assertDialogueNodes 校验）' })
  @IsOptional()
  @IsArray()
  nodes?: Record<string, any>[];

  @ApiPropertyOptional({ description: '文本版本' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
