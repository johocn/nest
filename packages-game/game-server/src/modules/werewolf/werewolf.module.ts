import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WerewolfService } from './werewolf.service';
import { WerewolfGateway } from './werewolf.gateway';
import { WerewolfMatch } from './entities/werewolf-match.entity';
import { WerewolfPlayerStat } from './entities/werewolf-player-stat.entity';
import { ConnectionModule } from '@modules/gateway/connection.module';
import { EventBusModule } from '@event-bus/event-bus.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WerewolfMatch, WerewolfPlayerStat]),
    ConnectionModule,
    EventBusModule,
  ],
  providers: [WerewolfService, WerewolfGateway],
  exports: [WerewolfService],
})
export class WerewolfModule {}
