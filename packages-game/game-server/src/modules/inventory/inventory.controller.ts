import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { UseItemDto } from './dto/use-item.dto';
import { EquipItemDto } from './dto/equip-item.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { EquipmentSlot } from '@constants/enums';

@ApiTags('Inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/client/v1/inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('list')
  @ApiOperation({ summary: '获取背包列表' })
  async getInventory(@CurrentPlayer() player: CurrentPlayerData) {
    return this.inventoryService.getInventory(player.playerId);
  }

  @Post('use')
  @ApiOperation({ summary: '使用消耗品' })
  async useItem(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: UseItemDto,
  ) {
    return this.inventoryService.useItem(player.playerId, dto.itemTemplateId);
  }

  @Post('equip')
  @ApiOperation({ summary: '穿戴装备' })
  async equipItem(@Body() dto: EquipItemDto) {
    return this.inventoryService.equipItem(
      dto.characterId,
      dto.inventoryItemId,
    );
  }

  @Post('unequip')
  @ApiOperation({ summary: '卸下装备' })
  async unequipItem(
    @Body() body: { characterId: string; slot: EquipmentSlot },
  ) {
    return this.inventoryService.unequipItem(body.characterId, body.slot);
  }
}
