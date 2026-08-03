import { IsString } from 'class-validator';

export class EquipItemDto {
  @IsString()
  inventoryItemId: string;

  @IsString()
  characterId: string;
}
