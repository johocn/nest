import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateResourceDto {
  @IsOptional() @IsInt() @Min(0) food?: number;
  @IsOptional() @IsInt() @Min(0) wood?: number;
  @IsOptional() @IsInt() @Min(0) iron?: number;
  @IsOptional() @IsInt() @Min(0) herb?: number;
  @IsOptional() @IsInt() @Min(0) gold?: number;
}
