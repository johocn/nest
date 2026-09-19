import { IsObject, IsString } from 'class-validator';

export class CreateBarterDto {
  @IsObject()
  itemsAJson: Record<string, any>;

  @IsString()
  goldAmount: string;
}

export class AcceptBarterDto {
  @IsObject()
  itemsBJson: Record<string, any>;
}
