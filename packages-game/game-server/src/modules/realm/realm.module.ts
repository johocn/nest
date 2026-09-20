import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealmService } from './realm.service';
import { RealmController } from './realm.controller';
import { RealmAdminController } from './realm-admin.controller';
import { RealmTemplate } from './entities';
import { Character, CharacterAttribute } from '@modules/character/entities';
import { CharacterModule } from '@modules/character/character.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { EconomyModule } from '@modules/economy/economy.module';
import { MailModule } from '@modules/mail/mail.module';
import { AdminModule } from '@modules/admin/admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RealmTemplate, Character, CharacterAttribute]),
    CharacterModule,
    InventoryModule,
    EconomyModule,
    MailModule,
    AdminModule,
  ],
  controllers: [RealmController, RealmAdminController],
  providers: [RealmService],
  exports: [RealmService],
})
export class RealmModule {}