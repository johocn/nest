import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class PublishSceneConfigDto {
  @ApiProperty({ description: '要发布的配置版本号' })
  @IsInt()
  @Min(1)
  version: number;
}

export class RollbackSceneConfigDto {
  @ApiProperty({
    description: '要回滚到的配置版本号（必须早于当前已发布版本）',
  })
  @IsInt()
  @Min(1)
  version: number;
}
