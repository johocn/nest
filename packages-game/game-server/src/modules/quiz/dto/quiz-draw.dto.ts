import { IsInt, IsOptional, IsString } from 'class-validator';

export class DrawQuizDto {
  @IsOptional()
  @IsString()
  category?: string;

  /** 非法值由服务端钳制：默认 1，上限 20 */
  @IsOptional()
  @IsInt()
  count?: number;
}
