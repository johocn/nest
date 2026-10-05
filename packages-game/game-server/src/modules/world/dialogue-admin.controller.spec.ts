import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DialogueAdminController } from './dialogue-admin.controller';
import { Dialogue } from './entities/dialogue.entity';
import { AdminSessionService } from '@modules/auth/admin-session.service';
import { AdminService } from '@modules/admin/admin.service';

function validDialogue(overrides: Partial<Dialogue> = {}): Dialogue {
  return {
    id: '1',
    code: 'dlg_test',
    title: '测试对话',
    nodes: [{ key: 'start', text: 'hello', options: [{ text: 'bye' }] }],
    version: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as Dialogue;
}

const LOG_OP = expect.objectContaining({ operation: expect.stringMatching(/^dialogue\./) });

describe('DialogueAdminController', () => {
  let ctrl: DialogueAdminController;
  let repo: jest.Mocked<Pick<any, 'findAndCount' | 'findOne' | 'save' | 'create'>>;
  let adminSvc: { logOperation: jest.Mock };

  beforeAll(async () => {
    const repoMock = {
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn((x) => x),
    };
    adminSvc = { logOperation: jest.fn().mockResolvedValue(null) };

    const mod = await Test.createTestingModule({
      controllers: [DialogueAdminController],
      providers: [
        { provide: getRepositoryToken(Dialogue), useValue: repoMock },
        { provide: AdminService, useValue: adminSvc },
        // AdminGuard 依赖
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        {
          provide: AdminSessionService,
          useValue: { validate: jest.fn().mockResolvedValue(true) },
        },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(DialogueAdminController);
    repo = mod.get(getRepositoryToken(Dialogue));
  });

  beforeEach(() => jest.clearAllMocks());

  // ---------- Guard ----------

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', DialogueAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  // ---------- listDialogues ----------

  it('listDialogues 返回 items/total/page/limit', async () => {
    const items = [validDialogue()];
    repo.findAndCount.mockResolvedValue([items, 1]);
    const res = await ctrl.listDialogues({ page: 1, limit: 20 } as any);
    expect(repo.findAndCount).toHaveBeenCalled();
    expect(res).toEqual({ items, total: 1, page: 1, limit: 20 });
  });

  // ---------- getDialogue ----------

  it('getDialogue 命中返回实体', async () => {
    const dlg = validDialogue({ id: '42' });
    repo.findOne.mockResolvedValue(dlg);
    const res = await ctrl.getDialogue('42');
    expect(res).toEqual(dlg);
  });

  it('getDialogue 未命中抛 GameException', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(ctrl.getDialogue('404')).rejects.toThrow();
  });

  // ---------- createDialogue ----------

  it('createDialogue 成功落库并调用 logOperation', async () => {
    repo.findOne.mockResolvedValue(null); // 编码不冲突
    const saved = validDialogue({ id: '99', code: 'new_code', title: '新对话' });
    repo.save.mockResolvedValue(saved);

    const res = await ctrl.createDialogue(
      {
        code: 'new_code',
        title: '新对话',
        nodes: [{ key: 'start', text: 'hi', options: [{ text: 'ok' }] }],
      } as any,
      { adminId: 1, username: 'gm' } as any,
    );
    expect(res).toEqual(saved);
    expect(adminSvc.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'dialogue.create', adminId: 1 }),
    );
  });

  it('createDialogue 编码冲突抛 GameException', async () => {
    repo.findOne.mockResolvedValue(validDialogue({ code: 'dup' }));
    await expect(
      ctrl.createDialogue(
        { code: 'dup', title: 'x', nodes: [{ key: 's', text: 't', options: [{ text: 'o' }] }] } as any,
        { adminId: 1, username: 'gm' } as any,
      ),
    ).rejects.toThrow();
  });

  // ---------- updateDialogue ----------

  it('updateDialogue 成功保存并调用 logOperation', async () => {
    const existing = validDialogue({ id: '7', code: 'old', title: '旧标题' });
    repo.findOne.mockResolvedValue(existing);
    const saved = validDialogue({ id: '7', code: 'old', title: '新标题' });
    repo.save.mockResolvedValue(saved);

    const res = await ctrl.updateDialogue(
      '7',
      { title: '新标题' } as any,
      { adminId: 1, username: 'gm' } as any,
    );
    expect(res).toEqual(saved);
    expect(adminSvc.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'dialogue.update' }),
    );
  });

  it('updateDialogue 未命中抛 GameException', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(ctrl.updateDialogue('404', {} as any, { adminId: 1, username: 'gm' } as any)).rejects.toThrow();
  });

  // ---------- toggleDialogue ----------

  it('toggleDialogue 切换 isActive 并调用 logOperation', async () => {
    const existing = validDialogue({ id: '3', isActive: true });
    repo.findOne.mockResolvedValue(existing);
    const saved = validDialogue({ id: '3', isActive: false });
    repo.save.mockResolvedValue(saved);

    const res = await ctrl.toggleDialogue('3', { adminId: 1, username: 'gm' } as any);
    expect(res).toEqual(saved);
    expect(adminSvc.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'dialogue.toggle' }),
    );
  });

  it('toggleDialogue 未命中抛 GameException', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(ctrl.toggleDialogue('404', { adminId: 1, username: 'gm' } as any)).rejects.toThrow();
  });
});
