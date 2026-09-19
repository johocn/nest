import { Module } from '@nestjs/common';
import { MatchmakingService } from './matchmaking.service';
import { MatchmakingGateway } from './matchmaking.gateway';
import { PlayerModule } from '@modules/player/player.module';
import { ConnectionModule } from '@modules/gateway/connection.module';

@Module({
  imports: [PlayerModule, ConnectionModule],
  providers: [MatchmakingService, MatchmakingGateway],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
