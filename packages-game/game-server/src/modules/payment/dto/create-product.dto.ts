import {
  IsString,
  IsObject,
  IsBoolean,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsString()
  amount: string;

  @IsObject()
  rewardJson: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  isHot?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
