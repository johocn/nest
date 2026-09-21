import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthAdminController } from './auth-admin.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthAccount } from './entities/auth-account.entity';
import { AccountLoginLog } from './entities/account-login-log.entity';
import { AdminUser } from './entities/admin-user.entity';
import { AccountPenalty } from './entities/account-penalty.entity';
import { AccountSecurityEvent } from './entities/account-security-event.entity';
import { PlayerModule } from '@modules/player/player.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuthAccount,
      AccountLoginLog,
      AdminUser,
      AccountPenalty,
      AccountSecurityEvent,
    ]),
    PassportModule,
    // 必须带上 secret：本模块注册的 JwtService 是 global 的，WS 网关等处直接用
    // jwtService.verify(token)（未显式传 secret），无 secret 会导致校验必然失败。
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret') ?? 'default-secret',
      }),
    }),
    PlayerModule,
  ],
  controllers: [AuthController, AdminAuthController, AuthAdminController],
  providers: [AuthService, AdminAuthService, JwtStrategy],
  exports: [AuthService, AdminAuthService, JwtModule],
})
export class AuthModule {}
