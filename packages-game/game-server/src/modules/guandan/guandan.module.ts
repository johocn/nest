import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { GuandanTableService } from './guandan-table.service';
import { GuandanService } from './guandan.service';
import { GuandanGateway } from './guandan.gateway';
import { GuandanController } from './guandan.controller';
import { GuandanRoom, GuandanRecord } from './entities';
import { CacheModule } from '@cache/cache.module';
import { EventBusModule } from '@event-bus/event-bus.module';
import { AuthModule } from '@modules/auth/auth.module';
import { PlayerModule } from '@modules/player/player.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GuandanRoom, GuandanRecord]),
    CacheModule,
    EventBusModule,
    AuthModule,
    PlayerModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret') ?? 'default-secret',
      }),
    }),
  ],
  controllers: [GuandanController],
  providers: [GuandanTableService, GuandanService, GuandanGateway],
  exports: [GuandanService],
})
export class GuandanModule {}
