import { IsString } from 'class-validator';

export class GiftDto {
  @IsString()
  targetId: string;

  @IsString()
  itemId: string;
}
