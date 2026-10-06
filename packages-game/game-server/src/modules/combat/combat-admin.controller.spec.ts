import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as ReflectMetadata from 'reflect-metadata';
import { CombatAdminController } from './combat-admin.controller';
import { CombatLog } from './entities/combat-log.entity';
import { Formation } from './entities/formation.entity';
import { CombatArbitration } from './entities/combat-arbitration.entity';
import { AdminSessionService } from '@modules/auth/admin-session.service';
import { AdminService } from '@modules/admin/admin.service';
import { FaceService } from './face.service';
import { ErrorCodes } from '@constants/error-codes';

describe('CombatAdminController', () => {
  let ctrl: CombatAdminController;
  let logRepo: any;
  let formationRepo: any;
  let arbitrationRepo: any;
  let adminService: any;
  const admin = { adminId: 'a-1' };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [CombatAdminController],
      providers: [
        {
          provide: getRepositoryToken(CombatLog),
          useValue: {
            findAndCount: jest.fn(),
            findOne: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Formation),
          useValue: {
            findAndCount: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn((body: any) => ({ ...body })),
            save: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(CombatArbitration),
          useValue: {
            findAndCount: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
          },
        },
        { provide: AdminService, useValue: { logOperation: jest.fn().mockResolvedValue(null) } },
        { provide: FaceService, useValue: { adjustFace: jest.fn().mockResolvedValue({ playerId: '1001', face: 10 }) } },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        { provide: AdminSessionService, useValue: { validate: jest.fn().mockResolvedValue(true) } },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(CombatAdminController);
    logRepo = mod.get(getRepositoryToken(CombatLog));
    formationRepo = mod.get(getRepositoryToken(Formation));
    arbitrationRepo = mod.get(getRepositoryToken(CombatArbitration));
    adminService = mod.get(AdminService);
  });

  beforeEach(() => jest.clearAllMocks());

  // ---------- Guard ----------

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', CombatAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  // ---------- CombatLog ----------

  it('listLogs 过滤并分页', async () => {
    const rows = [{ id: 'c1', attackerId: 'p1', defenderId: 'p2', combatType: 'PVP', result: 'WIN' }];
    logRepo.findAndCount.mockResolvedValue([rows, 1]);
    const res = await ctrl.listLogs('p1', 'p2', 'PVP', 'WIN', '1', '20');
    expect(logRepo.findAndCount).toHaveBeenCalled();
    expect(res.list).toEqual(rows);
    expect(res.total).toBe(1);
    expect(res.page).toBe(1);
  });

  it('getLog 返回详情', async () => {
    const row = { id: 'c1' };
    logRepo.findOne.mockResolvedValue(row);
    const res = await ctrl.getLog('c1');
    expect(res).toEqual(row);
  });

  it('deleteLog 硬删并记操作', async () => {
    const row = { id: 'c1', attackerId: 'p1', defenderId: 'p2' };
    logRepo.findOne.mockResolvedValue(row);
    logRepo.delete.mockResolvedValue({});
    const res = await ctrl.deleteLog('c1', admin as any);
    expect(logRepo.delete).toHaveBeenCalledWith('c1');
    expect(adminService.logOperation).toHaveBeenCalled();
    expect(res).toEqual({ removed: 'c1' });
  });

  // ---------- Formation ----------

  it('listFormations 过滤并分页', async () => {
    const rows = [{ id: 'f1', name: 'std', type: 'PVP' }];
    formationRepo.findAndCount.mockResolvedValue([rows, 1]);
    const res = await ctrl.listFormations('PVP', '1', '20');
    expect(res.list).toEqual(rows);
    expect(res.total).toBe(1);
  });

  it('createFormation 保存并记操作', async () => {
    const body = { name: 'std', type: 'PVP' } as any;
    const created = { ...body, id: 'f1' };
    formationRepo.create.mockReturnValue(created);
    formationRepo.save.mockResolvedValue(created);
    const res = await ctrl.createFormation(body, admin as any);
    expect(formationRepo.save).toHaveBeenCalled();
    expect(adminService.logOperation).toHaveBeenCalled();
    expect(res.id).toBe('f1');
  });

  it('updateFormation 更新并记操作', async () => {
    const existing = { id: 'f1', name: 'old', type: 'PVE' };
    const updated = { ...existing, name: 'new' };
    formationRepo.findOne.mockResolvedValue(existing);
    formationRepo.save.mockResolvedValue(updated);
    const res = await ctrl.updateFormation('f1', { name: 'new' } as any, admin as any);
    expect(res.name).toBe('new');
    expect(adminService.logOperation).toHaveBeenCalled();
  });

  it('deleteFormation 硬删并记操作', async () => {
    const existing = { id: 'f1', name: 'std' };
    formationRepo.findOne.mockResolvedValue(existing);
    formationRepo.delete.mockResolvedValue({});
    const res = await ctrl.deleteFormation('f1', admin as any);
    expect(formationRepo.delete).toHaveBeenCalledWith('f1');
    expect(adminService.logOperation).toHaveBeenCalled();
    expect(res).toEqual({ removed: 'f1' });
  });

  // ---------- CombatArbitration ----------

  it('listArbitrations 过滤并分页', async () => {
    const rows = [{ id: 'a1', status: 'PENDING', result: null }];
    arbitrationRepo.findAndCount.mockResolvedValue([rows, 1]);
    const res = await ctrl.listArbitrations('PENDING', '1', '20');
    expect(res.list).toEqual(rows);
    expect(res.total).toBe(1);
  });

  it('getArbitration 返回详情', async () => {
    const row = { id: 'a1' };
    arbitrationRepo.findOne.mockResolvedValue(row);
    const res = await ctrl.getArbitration('a1');
    expect(res).toEqual(row);
  });

  it('resolveArbitration 介入并记操作', async () => {
    const existing = { id: 'a1', status: 'PENDING', result: null };
    const saved = { id: 'a1', status: 'RESOLVED', result: 'WIN_A' };
    arbitrationRepo.findOne.mockResolvedValue(existing);
    arbitrationRepo.save.mockResolvedValue(saved);
    const res = await ctrl.resolveArbitration('a1', { status: 'RESOLVED', result: 'WIN_A' }, admin as any);
    expect(res.status).toBe('RESOLVED');
    expect(adminService.logOperation).toHaveBeenCalled();
  });

  // ---------- Face ----------

  it('adjustFace 调整并记操作', async () => {
    const faceService = ctrl['faceService'] as any;
    const res = await ctrl.adjustFace({ playerId: '1001', delta: 10, reason: 'gm' } as any, admin as any);
    expect(faceService.adjustFace).toHaveBeenCalledWith('1001', 10, 'gm');
    expect(adminService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'combat.face.adjust' }),
    );
    expect(res).toMatchObject({ playerId: '1001' });
  });

  it('adjustFace 拒绝非数字 playerId', async () => {
    await expect(
      ctrl.adjustFace({ playerId: 'abc', delta: 10, reason: 'gm' } as any, admin as any),
    ).rejects.toMatchObject({ response: { code: ErrorCodes.PARAM_INVALID } });
    expect(adminService.logOperation).not.toHaveBeenCalled();
  });
});
