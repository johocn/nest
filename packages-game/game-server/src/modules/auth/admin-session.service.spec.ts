import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdminSessionService } from './admin-session.service';
import { AdminUser } from './entities/admin-user.entity';
import { AdminRole } from '@constants/enums';

const mockAdminRepo = {
  findOne: jest.fn(),
};

describe('AdminSessionService', () => {
  let service: AdminSessionService;

  const basePayload = {
    adminId: '1',
    username: 'admin',
    role: AdminRole.SUPER_ADMIN,
    type: 'admin' as const,
    tokenVersion: 0,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminSessionService,
        { provide: getRepositoryToken(AdminUser), useValue: mockAdminRepo },
      ],
    }).compile();
    service = moduleRef.get<AdminSessionService>(AdminSessionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return true when admin is active and tokenVersion matches', async () => {
    mockAdminRepo.findOne.mockResolvedValue({
      id: '1',
      isActive: true,
      tokenVersion: 0,
    });

    await expect(service.validate(basePayload)).resolves.toBe(true);
    expect(mockAdminRepo.findOne).toHaveBeenCalledWith({
      where: { id: '1' },
    });
  });

  it('should return false when admin not found', async () => {
    mockAdminRepo.findOne.mockResolvedValue(null);
    await expect(service.validate(basePayload)).resolves.toBe(false);
  });

  it('should return false when admin is disabled', async () => {
    mockAdminRepo.findOne.mockResolvedValue({
      id: '1',
      isActive: false,
      tokenVersion: 0,
    });
    await expect(service.validate(basePayload)).resolves.toBe(false);
  });

  it('should return false when tokenVersion mismatches', async () => {
    mockAdminRepo.findOne.mockResolvedValue({
      id: '1',
      isActive: true,
      tokenVersion: 3,
    });
    await expect(service.validate(basePayload)).resolves.toBe(false);
  });

  it('should return false and skip query when adminId is not numeric', async () => {
    await expect(
      service.validate({ ...basePayload, adminId: 'not-a-number' }),
    ).resolves.toBe(false);
    expect(mockAdminRepo.findOne).not.toHaveBeenCalled();
  });
});