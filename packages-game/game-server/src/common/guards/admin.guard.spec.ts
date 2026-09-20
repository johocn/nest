import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AdminGuard } from './admin.guard';
import { AdminSessionService } from '@modules/auth/admin-session.service';
import { AdminRole } from '@constants/enums';

describe('AdminGuard', () => {
  let guard: AdminGuard;
  let jwtService: { verify: jest.Mock };
  let sessionService: { validate: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };

  const payload = {
    adminId: '1',
    username: 'admin',
    role: AdminRole.SUPER_ADMIN,
    type: 'admin' as const,
    tokenVersion: 0,
  };

  function buildContext(authHeader?: string): ExecutionContext {
    const request: Record<string, any> = {
      headers: authHeader ? { authorization: authHeader } : {},
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jwtService = { verify: jest.fn() };
    sessionService = { validate: jest.fn().mockResolvedValue(true) };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(null) };
    const configService = {
      get: jest.fn().mockReturnValue('test-secret'),
    };
    guard = new AdminGuard(
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      reflector as unknown as Reflector,
      sessionService as unknown as AdminSessionService,
    );
  });

  it('should throw when authorization header is missing', async () => {
    await expect(guard.canActivate(buildContext())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw when token is invalid', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('bad token');
    });
    await expect(
      guard.canActivate(buildContext('Bearer bad')),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should throw when token type is not admin', async () => {
    jwtService.verify.mockReturnValue({ ...payload, type: 'player' });
    await expect(
      guard.canActivate(buildContext('Bearer t')),
    ).rejects.toThrow(UnauthorizedException);
    expect(sessionService.validate).not.toHaveBeenCalled();
  });

  it('should throw when session is revoked', async () => {
    jwtService.verify.mockReturnValue(payload);
    sessionService.validate.mockResolvedValue(false);
    await expect(
      guard.canActivate(buildContext('Bearer t')),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should pass and attach payload to request when session is valid', async () => {
    jwtService.verify.mockReturnValue(payload);
    const context = buildContext('Bearer t');
    const request = context.switchToHttp().getRequest();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessionService.validate).toHaveBeenCalledWith(payload);
    expect(request.user).toEqual(payload);
  });

  it('should throw when required role is missing', async () => {
    jwtService.verify.mockReturnValue(payload);
    reflector.getAllAndOverride.mockReturnValue(['operator']);
    await expect(
      guard.canActivate(buildContext('Bearer t')),
    ).rejects.toThrow(UnauthorizedException);
  });
});