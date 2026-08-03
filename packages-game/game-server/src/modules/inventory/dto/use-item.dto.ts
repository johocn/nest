import { IsString } from 'class-validator';

export class UseItemDto {
  @IsString()
  itemTemplateId: string;
}
