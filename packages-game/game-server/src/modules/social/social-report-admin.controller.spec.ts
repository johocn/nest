import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as ReflectMetadata from 'reflect-metadata';
import { SocialReportAdminController } from './social-report-admin.controller';
import { PlayerReport } from './entities/player-report.entity';
import { ReportStatus } from '@constants/enums';
import { AdminSessionService } from '@modules/auth/admin-session.service';
import { AdminService } from '@modules/admin/admin.service';

describe('SocialReportAdminController', () => {
  let ctrl: SocialReportAdminController;
  let reportRepo: any;
  let adminService: any;
  const admin = { adminId: 'a-1' };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [SocialReportAdminController],
      providers: [
        {
          provide: getRepositoryToken(PlayerReport),
          useValue: {
            findAndCount: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
          },
        },
        { provide: AdminService, useValue: { logOperation: jest.fn().mockResolvedValue(null) } },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        { provide: AdminSessionService, useValue: { validate: jest.fn().mockResolvedValue(true) } },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(SocialReportAdminController);
    reportRepo = mod.get(getRepositoryToken(PlayerReport));
    adminService = mod.get(AdminService);
  });

  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', SocialReportAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  // ---------- listReports ----------

  it('listReports 过滤并分页', async () => {
    const rows = [{ id: 'r1', reporterId: 'rp1', targetId: 't1', status: ReportStatus.PENDING }];
    reportRepo.findAndCount.mockResolvedValue([rows, 1]);
    const res = await ctrl.listReports('rp1', 't1', ReportStatus.PENDING, '1', '20');
    expect(res.list).toEqual(rows);
    expect(res.total).toBe(1);
  });

  // ---------- getReport ----------

  it('getReport 返回详情', async () => {
    const row = { id: 'r1', reason: 'spam' };
    reportRepo.findOne.mockResolvedValue(row);
    const res = await ctrl.getReport('r1');
    expect(res).toEqual(row);
  });

  // ---------- handleReport ----------

  it('handleReport 处理并记操作', async () => {
    const item: any = { id: 'r1', status: ReportStatus.PENDING, handleAction: null, targetId: 't1' };
    const saved = { ...item, status: ReportStatus.PROCESSED, handleAction: 'BAN', handlerAdminId: admin.adminId };
    reportRepo.findOne.mockResolvedValue(item);
    reportRepo.save.mockResolvedValue(saved);
    const res = await ctrl.handleReport('r1', { handleAction: 'BAN', handleRemark: 'spam confirmed' }, admin as any);
    expect(res.status).toBe(ReportStatus.PROCESSED);
    expect(res.handleAction).toBe('BAN');
    expect(adminService.logOperation).toHaveBeenCalled();
  });

  // ---------- deleteReport ----------

  it('deleteReport 硬删并记操作', async () => {
    const item: any = { id: 'r1', reason: 'spam', targetId: 't1' };
    reportRepo.findOne.mockResolvedValue(item);
    reportRepo.delete.mockResolvedValue({});
    const res = await ctrl.deleteReport('r1', admin as any);
    expect(reportRepo.delete).toHaveBeenCalledWith('r1');
    expect(adminService.logOperation).toHaveBeenCalled();
    expect(res).toEqual({ removed: 'r1' });
  });
});
