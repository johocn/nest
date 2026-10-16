import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SanguoshaTableService } from './sanguosha-table.service';
import { SanguoshaService } from './sanguosha.service';
import { SanguoshaGateway } from './sanguosha.gateway';
import { SanguoshaController } from './sanguosha.controller';
import { SanguoshaRoom, SanguoshaRecord } from './entities';
import { CacheModule } from '@cache/cache.module';
import { EventBusModule } from '@event-bus/event-bus.module';
import { AuthModule } from '@modules/auth/auth.module';
import { PlayerModule } from '@modules/player/player.module';
import { TenantModule } from '@modules/tenant';

@Module({
  imports: [
    TypeOrmModule.forFeature([SanguoshaRoom, SanguoshaRecord]),
    CacheModule,
    EventBusModule,
    AuthModule,
    PlayerModule,
    TenantModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret') ?? 'default-secret',
      }),
    }),
  ],
  controllers: [SanguoshaController],
  providers: [SanguoshaTableService, SanguoshaService, SanguoshaGateway],
  exports: [SanguoshaService],
})
export class SanguoshaModule {}
