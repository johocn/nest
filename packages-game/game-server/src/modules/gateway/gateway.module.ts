import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GameGateway } from './game.gateway';
import { ConnectionModule } from './connection.module';
import { AuthModule } from '@modules/auth/auth.module';
import { WorldModule } from '@modules/world/world.module';
import { ChatModule } from '@modules/chat/chat.module';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    AuthModule,
    WorldModule,
    ChatModule,
    ConnectionModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret') ?? 'default-secret',
      }),
    }),
  ],
  providers: [GameGateway],
})
export class GatewayModule {}
