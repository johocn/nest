import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AdminAuthService } from './admin-auth.service';
import { AdminUser } from './entities/admin-user.entity';
import { GameException } from '@common/exceptions/game.exception';
import { AdminRole } from '@constants/enums';

describe('AdminAuthService', () => {
  let service: AdminAuthService;

  const mockAdminRepo = {
    findOne: jest.fn(),
    update: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('admin-jwt-token'),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'jwt')
        return {
          secret: 'test-secret',
          expiresIn: '7d',
          adminExpiresIn: '12h',
        };
      return undefined;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminAuthService,
        { provide: getRepositoryToken(AdminUser), useValue: mockAdminRepo },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = moduleRef.get<AdminAuthService>(AdminAuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should login successfully', async () => {
    const mockAdmin = {
      id: '1',
      username: 'admin',
      passwordHash: '$2b$10$mockhash',
      role: AdminRole.SUPER_ADMIN,
      isActive: true,
      tokenVersion: 0,
    };
    mockAdminRepo.findOne.mockResolvedValue(mockAdmin);
    jest.spyOn(service as any, 'comparePassword').mockResolvedValue(true);

    const result = await service.login('admin', 'password');
    expect(result.token).toBe('admin-jwt-token');
    expect(result.adminId).toBe('1');
    expect(result.role).toBe(AdminRole.SUPER_ADMIN);
    expect(mockJwtService.sign).toHaveBeenCalledWith(
      {
        adminId: '1',
        username: 'admin',
        role: AdminRole.SUPER_ADMIN,
        type: 'admin',
        tokenVersion: 0,
      },
      { secret: 'test-secret', expiresIn: '12h' },
    );
  });

  it('should throw if admin not found', async () => {
    mockAdminRepo.findOne.mockResolvedValue(null);
    await expect(service.login('ghost', 'pass')).rejects.toThrow(GameException);
  });

  it('should throw if admin inactive', async () => {
    mockAdminRepo.findOne.mockResolvedValue({
      id: '1',
      username: 'inactive',
      passwordHash: 'hash',
      isActive: false,
    });
    jest.spyOn(service as any, 'comparePassword').mockResolvedValue(true);
    await expect(service.login('inactive', 'pass')).rejects.toThrow(
      GameException,
    );
  });

  it('should throw if password wrong', async () => {
    mockAdminRepo.findOne.mockResolvedValue({
      id: '1',
      username: 'admin',
      passwordHash: 'hash',
      isActive: true,
    });
    jest.spyOn(service as any, 'comparePassword').mockResolvedValue(false);
    await expect(service.login('admin', 'wrong')).rejects.toThrow(
      GameException,
    );
  });

  it('should bump tokenVersion on logout', async () => {
    mockAdminRepo.findOne.mockResolvedValue({ id: '1', tokenVersion: 4 });

    await expect(service.logout('1')).resolves.toEqual({ ok: true });
    expect(mockAdminRepo.update).toHaveBeenCalledWith(
      { id: '1' },
      { tokenVersion: 5 },
    );
  });

  it('should throw on logout when admin not found', async () => {
    mockAdminRepo.findOne.mockResolvedValue(null);
    await expect(service.logout('9')).rejects.toThrow(GameException);
  });

  it('should throw when old password is wrong on changePassword', async () => {
    mockAdminRepo.findOne.mockResolvedValue({
      id: '1',
      passwordHash: 'hash',
      tokenVersion: 0,
    });
    jest.spyOn(service as any, 'comparePassword').mockResolvedValue(false);

    await expect(
      service.changePassword('1', 'wrong', 'newpass123'),
    ).rejects.toThrow(GameException);
    expect(mockAdminRepo.update).not.toHaveBeenCalled();
  });

  it('should update password hash and bump tokenVersion on changePassword', async () => {
    mockAdminRepo.findOne.mockResolvedValue({
      id: '1',
      passwordHash: 'hash',
      tokenVersion: 2,
    });
    jest.spyOn(service as any, 'comparePassword').mockResolvedValue(true);

    await expect(
      service.changePassword('1', 'oldpass123', 'newpass123'),
    ).resolves.toEqual({ ok: true });

    expect(mockAdminRepo.update).toHaveBeenCalledTimes(1);
    const [criteria, patch] = mockAdminRepo.update.mock.calls[0];
    expect(criteria).toEqual({ id: '1' });
    expect(patch.tokenVersion).toBe(3);
    expect(typeof patch.passwordHash).toBe('string');
    expect(patch.passwordHash).not.toBe('hash');
  });
});
