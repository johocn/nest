import { Test } from '@nestjs/testing';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from '@common/guards/admin.guard';

const mockAdminAuthService = {
  login: jest.fn(),
  logout: jest.fn(),
  changePassword: jest.fn(),
};

describe('AdminAuthController', () => {
  let ctrl: AdminAuthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      controllers: [AdminAuthController],
      providers: [
        { provide: AdminAuthService, useValue: mockAdminAuthService },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    ctrl = mod.get(AdminAuthController);
  });

  it('should be defined', () => {
    expect(ctrl).toBeDefined();
  });

  // ---------- login（@Public，不需要 guard 覆盖） ----------

  it('login 委托 adminAuthService.login', async () => {
    const dto = { username: 'gm01', password: 'pw' };
    mockAdminAuthService.login.mockResolvedValue({
      token: 't-1',
      adminId: 'a-1',
    });
    const res = await ctrl.login(dto as any);
    expect(mockAdminAuthService.login).toHaveBeenCalledWith('gm01', 'pw');
    expect(res).toEqual({ token: 't-1', adminId: 'a-1' });
  });

  // ---------- logout ----------

  it('logout 委托 adminAuthService.logout', async () => {
    mockAdminAuthService.logout.mockResolvedValue({ ok: true });
    const res = await ctrl.logout({ adminId: 'a-1' } as any);
    expect(mockAdminAuthService.logout).toHaveBeenCalledWith('a-1');
    expect(res).toEqual({ ok: true });
  });

  // ---------- changePassword ----------

  it('changePassword 委托 adminAuthService.changePassword', async () => {
    const dto = { oldPassword: 'old', newPassword: 'new' };
    mockAdminAuthService.changePassword.mockResolvedValue({ ok: true });
    const res = await ctrl.changePassword({ adminId: 'a-1' } as any, dto as any);
    expect(mockAdminAuthService.changePassword).toHaveBeenCalledWith(
      'a-1',
      'old',
      'new',
    );
    expect(res).toEqual({ ok: true });
  });
});
