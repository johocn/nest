import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AdminUser } from './entities/admin-user.entity';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { AdminJwtPayload } from '@common/guards/admin.guard';

export interface AdminAuthResult {
  token: string;
  adminId: string;
  username: string;
  role: string;
}

@Injectable()
export class AdminAuthService {
  private readonly jwtSecret: string;

  constructor(
    @InjectRepository(AdminUser)
    private readonly adminRepo: Repository<AdminUser>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.jwtSecret =
      this.configService.get<string>('jwt.secret') ?? 'default-secret';
  }

  async login(username: string, password: string): Promise<AdminAuthResult> {
    const admin = await this.adminRepo.findOne({ where: { username } });
    if (!admin) {
      throw new GameException(ErrorCodes.ADMIN_NOT_FOUND, '管理员不存在');
    }
    if (!admin.isActive) {
      throw new GameException(ErrorCodes.ADMIN_INACTIVE, '管理员账号已禁用');
    }
    const isPasswordValid = await this.comparePassword(
      password,
      admin.passwordHash,
    );
    if (!isPasswordValid) {
      throw new GameException(ErrorCodes.ADMIN_PASSWORD_WRONG, '密码错误');
    }

    await this.adminRepo.update({ id: admin.id }, { lastLoginAt: new Date() });

    const payload: AdminJwtPayload = {
      adminId: admin.id,
      username: admin.username,
      role: admin.role,
      type: 'admin',
    };
    const token = this.jwtService.sign(payload, {
      secret: this.jwtSecret,
    } as JwtSignOptions);

    return {
      token,
      adminId: admin.id,
      username: admin.username,
      role: admin.role,
    };
  }

  private async comparePassword(
    password: string,
    hash: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
