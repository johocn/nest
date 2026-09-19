import { IsString } from 'class-validator';

export class ShameDto {
  @IsString()
  targetId: string;
}
