import { Module } from '@nestjs/common';
import { MatchmakingService } from './matchmaking.service';
import { MatchmakingGateway } from './matchmaking.gateway';
import { RoomService } from './room.service';
import { PlayerModule } from '@modules/player/player.module';
import { ConnectionModule } from '@modules/gateway/connection.module';
import { CacheModule } from '@cache/cache.module';

@Module({
  imports: [PlayerModule, ConnectionModule, CacheModule],
  providers: [MatchmakingService, MatchmakingGateway, RoomService],
  exports: [MatchmakingService, RoomService],
})
export class MatchmakingModule {}
