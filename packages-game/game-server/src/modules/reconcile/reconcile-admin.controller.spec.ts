import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ReconcileAdminController } from './reconcile-admin.controller';
import { ReconcileService } from './reconcile.service';
import { AdminService } from '@modules/admin/admin.service';
import { ReconcileType } from '@constants/enums';

describe('ReconcileAdminController', () => {
  let ctrl: ReconcileAdminController;
  const reconcileService = {
    reconcileDaily: jest.fn().mockResolvedValue([
      { statDate: '2026-09-19', reconcileType: ReconcileType.TRADE, checked: '1', mismatch: '1' },
      { statDate: '2026-09-19', reconcileType: ReconcileType.AUCTION, checked: '0', mismatch: '0' },
    ]),
    listResults: jest.fn().mockResolvedValue([]),
  };
  const adminService = {
    logOperation: jest.fn().mockResolvedValue({}),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ReconcileAdminController],
      providers: [
        { provide: ReconcileService, useValue: reconcileService },
        { provide: AdminService, useValue: adminService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(ReconcileAdminController);
  });
  beforeEach(() => jest.clearAllMocks());

  it('GET results 列表转发类型参数', async () => {
    reconcileService.listResults.mockResolvedValue([{ id: 'r1' }]);
    const res = await ctrl.listResults(ReconcileType.TRADE as string);
    expect(reconcileService.listResults).toHaveBeenCalledWith(ReconcileType.TRADE);
    expect(res.list).toHaveLength(1);
  });

  it('GET results 无类型时不传过滤', async () => {
    await ctrl.listResults(undefined);
    expect(reconcileService.listResults).toHaveBeenCalledWith(undefined);
  });

  it('POST run 触发对账并留 gm-log', async () => {
    const res = await ctrl.run({ username: 'GM1' } as any);
    expect(reconcileService.reconcileDaily).toHaveBeenCalled();
    expect(adminService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'reconcile.run', adminId: 'GM1' }),
    );
    expect(res.results).toHaveLength(2);
  });
});