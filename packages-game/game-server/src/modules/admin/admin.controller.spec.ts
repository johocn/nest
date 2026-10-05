import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as ReflectMetadata from 'reflect-metadata';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { GmCommandService } from './gm-command.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { AdminSessionService } from '@modules/auth/admin-session.service';
import { RoomService } from '@modules/matchmaking/room.service';

const mockAdminService = {
  getOnlineCount: jest.fn(),
  getGmLogs: jest.fn(),
  logOperation: jest.fn(),
};

const mockGmService = {
  list: jest.fn(),
  execute: jest.fn(),
};

const mockRoomService = {
  listByMode: jest.fn(),
};

describe('AdminController', () => {
  let ctrl: AdminController;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        { provide: GmCommandService, useValue: mockGmService },
        { provide: RoomService, useValue: mockRoomService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        {
          provide: AdminSessionService,
          useValue: { validate: jest.fn().mockResolvedValue(true) },
        },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(AdminController);
  });

  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护', () => {
    const guards = Reflect.getMetadata('__guards__', AdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  // ---------- 在线人数 ----------

  it('getOnlineCount 委托 adminService', async () => {
    mockAdminService.getOnlineCount.mockResolvedValue({ count: 42 });
    const res = await ctrl.getOnlineCount();
    expect(mockAdminService.getOnlineCount).toHaveBeenCalled();
    expect(res).toEqual({ count: 42 });
  });

  // ---------- GM 操作日志 ----------

  it('getGmLogs 无参数 → 默认 page=1, limit=20', async () => {
    mockAdminService.getGmLogs.mockResolvedValue({ items: [], total: 0 });
    const res = await ctrl.getGmLogs(undefined as any, undefined as any);
    expect(mockAdminService.getGmLogs).toHaveBeenCalledWith(1, 20);
    expect(res).toEqual({ items: [], total: 0 });
  });

  it('getGmLogs 带参数 → 转 number', async () => {
    mockAdminService.getGmLogs.mockResolvedValue({ items: [], total: 100 });
    await ctrl.getGmLogs('2' as any, '50' as any);
    expect(mockAdminService.getGmLogs).toHaveBeenCalledWith(2, 50);
  });

  it('logOperation 写入操作日志', async () => {
    const body = {
      targetPlayerId: 'p-1',
      operation: 'player.ban',
      changeBefore: { banEnd: null },
      changeAfter: { banEnd: '2026-12-01' },
    };
    const req = { user: { adminId: 'a-1' } };
    mockAdminService.logOperation.mockResolvedValue({ id: 'log-1' } as any);
    const res = await ctrl.logOperation(req as any, body);
    expect(mockAdminService.logOperation).toHaveBeenCalledWith({
      adminId: 'a-1',
      targetPlayerId: 'p-1',
      operation: 'player.ban',
      changeBefore: body.changeBefore,
      changeAfter: body.changeAfter,
    });
    expect(res).toEqual({ id: 'log-1' });
  });

  // ---------- GM 命令 ----------

  it('listGmCommands 包装 gmService.list', async () => {
    const cmds = [
      { name: 'player.give-exp', description: '给经验' },
      { name: 'player.ban', description: '封禁玩家' },
    ];
    mockGmService.list.mockReturnValue(cmds);
    const res = await ctrl.listGmCommands();
    expect(mockGmService.list).toHaveBeenCalled();
    expect(res).toEqual({ commands: cmds });
  });

  it('executeGm 委托 gmService.execute', async () => {
    const body = {
      cmd: 'player.give-exp',
      targetPlayerId: 'p-1',
      args: { amount: 1000 },
    };
    const req = { user: { adminId: 'a-1' } };
    mockGmService.execute.mockResolvedValue({ ok: true, xp: 1000 });
    const res = await ctrl.executeGm(req as any, body);
    expect(mockGmService.execute).toHaveBeenCalledWith({
      adminId: 'a-1',
      targetPlayerId: 'p-1',
      args: { cmd: 'player.give-exp', amount: 1000 },
    });
    expect(res).toEqual({ ok: true, xp: 1000 });
  });

  it('executeGm 无 args → args 里只有 cmd', async () => {
    const body = { cmd: 'player.ban', targetPlayerId: 'p-1' };
    const req = { user: { adminId: 'a-1' } };
    mockGmService.execute.mockResolvedValue({ ok: true });
    await ctrl.executeGm(req as any, body);
    expect(mockGmService.execute).toHaveBeenCalledWith({
      adminId: 'a-1',
      targetPlayerId: 'p-1',
      args: { cmd: 'player.ban' },
    });
  });

  // ---------- Room 管理 ----------

  it('listRooms 按四种 mode 聚合 → { data }', async () => {
    mockRoomService.listByMode
      .mockResolvedValueOnce([{ id: 'r1' }])   // ranked
      .mockResolvedValueOnce([{ id: 'r2' }])   // casual
      .mockResolvedValueOnce([])               // pve
      .mockResolvedValueOnce([{ id: 'r3' }]);  // party
    const res = await ctrl.listRooms();
    expect(mockRoomService.listByMode).toHaveBeenCalledWith('ranked');
    expect(mockRoomService.listByMode).toHaveBeenCalledWith('casual');
    expect(mockRoomService.listByMode).toHaveBeenCalledWith('pve');
    expect(mockRoomService.listByMode).toHaveBeenCalledWith('party');
    expect(res).toEqual({
      data: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
    });
  });
});
