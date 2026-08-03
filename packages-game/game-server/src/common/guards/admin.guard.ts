import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface AdminJwtPayload {
  adminId: string;
  username: string;
  role: string;
  type: 'admin';
}

export const ADMIN_ROLES_KEY = 'adminRoles';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing admin token');
    }

    const token = authHeader.substring(7);
    const secret =
      this.configService.get<string>('jwt.secret') ?? 'default-secret';

    try {
      const payload = this.jwtService.verify<AdminJwtPayload>(token, {
        secret,
      });

      if (payload.type !== 'admin') {
        throw new UnauthorizedException('Invalid admin token');
      }

      const requiredRoles = this.reflector.getAllAndOverride<string[]>(
        ADMIN_ROLES_KEY,
        [context.getHandler(), context.getClass()],
      );

      if (requiredRoles && requiredRoles.length > 0) {
        if (!requiredRoles.includes(payload.role)) {
          throw new UnauthorizedException('Insufficient permissions');
        }
      }

      request.user = payload;
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid admin token');
    }
  }
}
