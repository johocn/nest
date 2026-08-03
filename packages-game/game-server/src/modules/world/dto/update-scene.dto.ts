import {
  IsString,
  IsEnum,
  IsInt,
  IsOptional,
  IsArray,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { SceneType, SceneStatus } from '@constants/enums';

export class UpdateSceneDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsEnum(SceneType)
  sceneType?: SceneType;

  @IsOptional()
  @IsString()
  mapResKey?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  mapWidth?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  mapHeight?: number;

  @IsOptional()
  layerConfig?: Record<string, any>;

  @IsOptional()
  refreshRule?: Record<string, any>;

  @IsOptional()
  @IsArray()
  triggerGroupIds?: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  minLevel?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPlayers?: number;

  @IsOptional()
  @IsEnum(SceneStatus)
  status?: SceneStatus;
}
