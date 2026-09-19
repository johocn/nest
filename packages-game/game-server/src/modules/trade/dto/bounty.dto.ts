import { IsString, IsObject, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBountyDto {
  @IsString()
  type: string;

  @IsObject()
  targetJson: Record<string, any>;

  @IsString()
  goldReward: string;

  @IsOptional()
  @IsString()
  deadline?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  maxAcceptors?: number;
}
