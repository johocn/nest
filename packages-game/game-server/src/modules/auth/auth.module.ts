import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
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
    JwtModule.register({ global: true }),
    PlayerModule,
  ],
  controllers: [AuthController, AdminAuthController, AuthAdminController],
  providers: [AuthService, AdminAuthService, JwtStrategy],
  exports: [AuthService, AdminAuthService, JwtModule],
})
export class AuthModule {}
