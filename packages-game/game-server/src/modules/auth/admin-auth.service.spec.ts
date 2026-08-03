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
      if (key === 'jwt') return { secret: 'test-secret', expiresIn: '7d' };
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
    };
    mockAdminRepo.findOne.mockResolvedValue(mockAdmin);
    jest.spyOn(service as any, 'comparePassword').mockResolvedValue(true);

    const result = await service.login('admin', 'password');
    expect(result.token).toBe('admin-jwt-token');
    expect(result.adminId).toBe('1');
    expect(result.role).toBe(AdminRole.SUPER_ADMIN);
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
});
