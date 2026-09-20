import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExploreService } from './explore.service';
import { ExploreController } from './explore.client.controller';
import { ExploreAdminController } from './explore-admin.controller';
import { EncounterTemplate, PlayerExploration } from './entities';
import { Scene } from '@modules/world/entities';
import { CharacterModule } from '@modules/character/character.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { EconomyModule } from '@modules/economy/economy.module';
import { BuffModule } from '@modules/buff/buff.module';
import { ConfigManageModule } from '@modules/config/config.module';
import { AdminModule } from '@modules/admin/admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EncounterTemplate, PlayerExploration, Scene]),
    CharacterModule,
    InventoryModule,
    EconomyModule,
    BuffModule,
    ConfigManageModule,
    AdminModule,
  ],
  controllers: [ExploreController, ExploreAdminController],
  providers: [ExploreService],
  exports: [ExploreService],
})
export class ExploreModule {}