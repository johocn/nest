import { Module } from '@nestjs/common';
import { MatchmakingService } from './matchmaking.service';
import { MatchmakingGateway } from './matchmaking.gateway';
import { PlayerModule } from '@modules/player/player.module';
import { GatewayModule } from '@modules/gateway/gateway.module';

@Module({
  imports: [PlayerModule, GatewayModule],
  providers: [MatchmakingService, MatchmakingGateway],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
