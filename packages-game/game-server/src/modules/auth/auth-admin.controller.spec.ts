import { Test } from '@nestjs/testing';
import { AuthAdminController } from './auth-admin.controller';
import { AuthService } from './auth.service';
import { AdminGuard } from '@common/guards/admin.guard';

const mockAuthService = {
  applyPenalty: jest.fn(),
  getPenalties: jest.fn(),
  logout: jest.fn().mockResolvedValue({ ok: true }),
};

describe('AuthAdminController', () => {
  let controller: AuthAdminController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthService.logout.mockResolvedValue({ ok: true });
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthAdminController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AuthAdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate kick to authService.logout', async () => {
    await expect(controller.kickPlayer('42')).resolves.toEqual({ ok: true });
    expect(mockAuthService.logout).toHaveBeenCalledWith('42');
  });
});