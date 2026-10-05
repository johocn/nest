import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as ReflectMetadata from 'reflect-metadata';
import { SocialGuildAdminController } from './social-guild-admin.controller';
import { Guild } from './entities/guild.entity';
import { GuildMember } from './entities/guild-member.entity';
import { AdminSessionService } from '@modules/auth/admin-session.service';
import { AdminService } from '@modules/admin/admin.service';

describe('SocialGuildAdminController', () => {
  let ctrl: SocialGuildAdminController;
  let guildRepo: any;
  let memberRepo: any;
  let adminService: any;
  const admin = { adminId: 'a-1' };

  beforeAll(async () => {
    // listGuilds 使用 createQueryBuilder 链式调用，需要在这里完整 mock
    const qb = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    guildRepo = {
      createQueryBuilder: jest.fn(() => qb),
      findOne: jest.fn(),
      save: jest.fn(),
    };
    memberRepo = {
      count: jest.fn(),
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    };

    const mod = await Test.createTestingModule({
      controllers: [SocialGuildAdminController],
      providers: [
        { provide: getRepositoryToken(Guild), useValue: guildRepo },
        { provide: getRepositoryToken(GuildMember), useValue: memberRepo },
        { provide: AdminService, useValue: { logOperation: jest.fn().mockResolvedValue(null) } },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        { provide: AdminSessionService, useValue: { validate: jest.fn().mockResolvedValue(true) } },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(SocialGuildAdminController);
    adminService = mod.get(AdminService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // 重置 createQueryBuilder 默认返回
    const qb = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    guildRepo.createQueryBuilder.mockReturnValue(qb);
  });

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', SocialGuildAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  // ---------- listGuilds (createQueryBuilder) ----------

  it('listGuilds 使用 createQueryBuilder 支持 name 模糊搜索', async () => {
    const rows = [{ id: 'g1', name: 'Alpha' }];
    const qb = guildRepo.createQueryBuilder();
    qb.getManyAndCount.mockResolvedValue([rows, 1]);
    const res = await ctrl.listGuilds('Alpha', '1', '20');
    expect(guildRepo.createQueryBuilder).toHaveBeenCalledWith('g');
    expect(res.list).toEqual(rows);
    expect(res.total).toBe(1);
    expect(res.page).toBe(1);
  });

  // ---------- getGuild ----------

  it('getGuild 返回详情 + 成员数', async () => {
    const guild = { id: 'g1', name: 'Alpha' };
    guildRepo.findOne.mockResolvedValue(guild);
    memberRepo.count.mockResolvedValue(42);
    const res = await ctrl.getGuild('g1');
    expect(res).toEqual({ guild, memberCount: 42 });
  });

  // ---------- updateNotice ----------

  it('updateNotice 更新公告并记操作', async () => {
    const guild: any = { id: 'g1', name: 'Alpha', announcement: 'old' };
    const saved = { ...guild, announcement: 'new' };
    guildRepo.findOne.mockResolvedValue(guild);
    guildRepo.save.mockResolvedValue(saved);
    const res = await ctrl.updateNotice('g1', { announcement: 'new' }, admin as any);
    expect(res.announcement).toBe('new');
    expect(adminService.logOperation).toHaveBeenCalled();
  });

  // ---------- listMembers ----------

  it('listMembers 分页返回成员', async () => {
    const rows = [{ id: 'm1', guildId: 'g1', playerId: 'p1' }];
    memberRepo.findAndCount.mockResolvedValue([rows, 1]);
    const res = await ctrl.listMembers('g1', '1', '20');
    expect(res.list).toEqual(rows);
    expect(res.total).toBe(1);
  });

  // ---------- kickMember ----------

  it('kickMember 踢出成员并记操作', async () => {
    const guild: any = { id: 'g1', name: 'Alpha', memberCount: 10 };
    const member: any = { id: 'm1', guildId: 'g1', playerId: 'p1', role: 'MEMBER' };
    guildRepo.findOne.mockResolvedValue(guild);
    memberRepo.findOne.mockResolvedValue(member);
    memberRepo.delete.mockResolvedValue({});
    memberRepo.count.mockResolvedValue(9);
    guildRepo.save.mockResolvedValue({ ...guild, memberCount: 9 });
    const res = await ctrl.kickMember('g1', 'p1', admin as any);
    expect(memberRepo.delete).toHaveBeenCalledWith('m1');
    expect(adminService.logOperation).toHaveBeenCalled();
    expect(res).toEqual({ kicked: 'p1', guildId: 'g1' });
  });
});
