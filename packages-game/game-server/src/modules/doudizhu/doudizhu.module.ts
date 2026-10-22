import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DoudizhuTableService } from './doudizhu-table.service';
import { DoudizhuService } from './doudizhu.service';
import { DoudizhuGateway } from './doudizhu.gateway';
import { DoudizhuController } from './doudizhu.controller';
import { DoudizhuMatchService } from './doudizhu-match.service';
import { DoudizhuSettlementService } from './doudizhu-settlement.service';
import { DoudizhuRoom, DoudizhuRecord, DoudizhuReplay } from './entities';
import { CacheModule } from '@cache/cache.module';
import { EventBusModule } from '@event-bus/event-bus.module';
import { AuthModule } from '@modules/auth/auth.module';
import { PlayerModule } from '@modules/player/player.module';
import { LadderModule } from '@modules/ladder/ladder.module';
import { EconomyModule } from '@modules/economy/economy.module';
import { ConnectionModule } from '@modules/gateway/connection.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DoudizhuRoom, DoudizhuRecord, DoudizhuReplay]),
    CacheModule,
    EventBusModule,
    AuthModule,
    PlayerModule,
    LadderModule,
    EconomyModule,
    ConnectionModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret') ?? 'default-secret',
      }),
    }),
  ],
  controllers: [DoudizhuController],
  providers: [
    DoudizhuTableService,
    DoudizhuService,
    DoudizhuGateway,
    DoudizhuMatchService,
    DoudizhuSettlementService,
  ],
  exports: [DoudizhuService],
})
export class DoudizhuModule {}
