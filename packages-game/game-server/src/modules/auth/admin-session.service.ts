import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminUser } from './entities/admin-user.entity';

export interface AdminSessionClaims {
  adminId: string;
  tokenVersion: number;
}

@Injectable()
export class AdminSessionService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly adminRepo: Repository<AdminUser>,
  ) {}

  async validate(claims: AdminSessionClaims): Promise<boolean> {
    if (!/^\d+$/.test(claims.adminId)) return false;
    const admin = await this.adminRepo.findOne({
      where: { id: claims.adminId },
    });
    if (!admin) return false;
    if (!admin.isActive) return false;
    if (admin.tokenVersion !== claims.tokenVersion) return false;
    return true;
  }
}