import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DropService } from './drop.service';
import { DropController } from './drop-admin.controller';
import { DropClientController } from './drop.client.controller';
import { DropTemplate } from './entities';
import { InventoryModule } from '@modules/inventory/inventory.module';

@Module({
  imports: [TypeOrmModule.forFeature([DropTemplate]), InventoryModule],
  controllers: [DropController, DropClientController],
  providers: [DropService],
  exports: [DropService],
})
export class ItemDropModule {}
