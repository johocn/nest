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
  private readonly jwtAdminExpiresIn: string;

  constructor(
    @InjectRepository(AdminUser)
    private readonly adminRepo: Repository<AdminUser>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    const jwtConfig = this.configService.get('jwt');
    this.jwtSecret = jwtConfig?.secret ?? 'default-secret';
    this.jwtAdminExpiresIn = jwtConfig?.adminExpiresIn ?? '12h';
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
      tokenVersion: admin.tokenVersion,
    };
    const token = this.jwtService.sign(payload, {
      secret: this.jwtSecret,
      expiresIn: this.jwtAdminExpiresIn,
    } as JwtSignOptions);

    return {
      token,
      adminId: admin.id,
      username: admin.username,
      role: admin.role,
    };
  }

  async logout(adminId: string): Promise<{ ok: true }> {
    const admin = await this.adminRepo.findOne({ where: { id: adminId } });
    if (!admin) {
      throw new GameException(ErrorCodes.ADMIN_NOT_FOUND, '管理员不存在');
    }
    await this.adminRepo.update(
      { id: admin.id },
      { tokenVersion: admin.tokenVersion + 1 },
    );
    return { ok: true };
  }

  async changePassword(
    adminId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    const admin = await this.adminRepo.findOne({ where: { id: adminId } });
    if (!admin) {
      throw new GameException(ErrorCodes.ADMIN_NOT_FOUND, '管理员不存在');
    }
    const isOldValid = await this.comparePassword(
      oldPassword,
      admin.passwordHash,
    );
    if (!isOldValid) {
      throw new GameException(ErrorCodes.ADMIN_PASSWORD_WRONG, '原密码错误');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.adminRepo.update(
      { id: admin.id },
      { passwordHash, tokenVersion: admin.tokenVersion + 1 },
    );
    return { ok: true };
  }

  private async comparePassword(
    password: string,
    hash: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
