import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { InventoryAdminController } from './inventory-admin.controller';
import { ItemChangeLogProcessor } from './inventory.processor';
import {
  ItemTemplate,
  InventoryItem,
  CharacterEquipment,
  PlayerItemChangeLog,
} from './entities';
import { QueueModule } from '@queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ItemTemplate,
      InventoryItem,
      CharacterEquipment,
      PlayerItemChangeLog,
    ]),
    QueueModule,
  ],
  controllers: [InventoryController, InventoryAdminController],
  providers: [InventoryService, ItemChangeLogProcessor],
  exports: [InventoryService],
})
export class InventoryModule {}
