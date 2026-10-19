import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsObject, Min, Max } from 'class-validator';

/**
 * 上报跨游戏评分 DTO。
 * 注意：playerId 不在此处——由控制器从 JWT（@CurrentPlayer）注入，本 DTO 只含表现数据，
 * 避免客户端伪造身份。targetGameId 仅接受白名单值（服务端再校验）。
 */
export class SubmitCrossGameRecordDto {
  @ApiProperty({ description: '目标游戏 id（仅允许白名单值）' })
  @IsString()
  targetGameId: string;

  @ApiProperty({ description: '关卡 id（如 1-1）' })
  @IsString()
  levelId: string;

  @ApiProperty({ description: '玩法 mode' })
  @IsString()
  mode: string;

  @ApiProperty({ description: '综合评分 0-100（仅保留最佳）' })
  @IsInt()
  @Min(0)
  @Max(100)
  score: number;

  @ApiProperty({ description: '分维度标准化得分（准确率/速度/稳定性等）' })
  @IsObject()
  axes: Record<string, number>;

  @ApiProperty({ description: '原始表现指标（透传，便于追溯）' })
  @IsObject()
  rawMetrics: Record<string, number>;
}
