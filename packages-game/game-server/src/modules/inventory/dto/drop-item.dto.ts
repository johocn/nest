import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Matches, Min } from 'class-validator';

export class DropItemDto {
  @ApiProperty({ description: '背包物品行 id（inventory_items.id）' })
  @IsString()
  @Matches(/^\d+$/, { message: 'inventoryItemId 必须为数字' })
  inventoryItemId: string;

  @ApiProperty({ description: '丢弃数量（≤该行现有数量）', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}
