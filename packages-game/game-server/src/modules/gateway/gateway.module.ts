import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GameGateway } from './game.gateway';
import { ConnectionService } from './connection.service';
import { AuthModule } from '@modules/auth/auth.module';
import { WorldModule } from '@modules/world/world.module';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    AuthModule,
    WorldModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret') ?? 'default-secret',
      }),
    }),
  ],
  providers: [GameGateway, ConnectionService],
  exports: [ConnectionService],
})
export class GatewayModule {}
