import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminService } from './admin.service';
import { GmCommandService } from './gm-command.service';
import { AdminController } from './admin.controller';
import { GmOperateLog } from './entities';
import { ConnectionModule } from '@modules/gateway/connection.module';
import { PlayerModule } from '@modules/player/player.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { BuffModule } from '@modules/buff/buff.module';
import { CharacterModule } from '@modules/character/character.module';
import { MatchmakingModule } from '@modules/matchmaking/matchmaking.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GmOperateLog]),
    ConnectionModule,
    forwardRef(() => PlayerModule),
    InventoryModule,
    BuffModule,
    CharacterModule,
    forwardRef(() => MatchmakingModule),
  ],
  controllers: [AdminController],
  providers: [AdminService, GmCommandService],
  exports: [AdminService],
})
export class AdminModule {}
