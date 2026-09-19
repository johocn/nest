import { IsString, IsInt, Min } from 'class-validator';

export class IntelListDto {
  @IsString()
  intelId: string;

  @IsInt()
  @Min(1)
  price: number;
}
