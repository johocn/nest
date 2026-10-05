import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as ReflectMetadata from 'reflect-metadata';
import { TradeAdminController } from './trade-admin.controller';
import { AuctionItem } from './entities/auction-item.entity';
import { TradeOrder } from './entities/trade-order.entity';
import { Bounty } from './entities/bounty.entity';
import { AuctionStatus, BountyStatus } from '@constants/enums';
import { AdminSessionService } from '@modules/auth/admin-session.service';
import { AdminService } from '@modules/admin/admin.service';

describe('TradeAdminController', () => {
  let ctrl: TradeAdminController;
  let auctionRepo: any;
  let orderRepo: any;
  let bountyRepo: any;
  let adminService: any;
  const admin = { adminId: 'a-1' };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [TradeAdminController],
      providers: [
        {
          provide: getRepositoryToken(AuctionItem),
          useValue: { findAndCount: jest.fn(), findOne: jest.fn(), save: jest.fn() },
        },
        {
          provide: getRepositoryToken(TradeOrder),
          useValue: { findAndCount: jest.fn() },
        },
        {
          provide: getRepositoryToken(Bounty),
          useValue: { findAndCount: jest.fn(), findOne: jest.fn(), save: jest.fn() },
        },
        { provide: AdminService, useValue: { logOperation: jest.fn().mockResolvedValue(null) } },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        { provide: AdminSessionService, useValue: { validate: jest.fn().mockResolvedValue(true) } },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(TradeAdminController);
    auctionRepo = mod.get(getRepositoryToken(AuctionItem));
    orderRepo = mod.get(getRepositoryToken(TradeOrder));
    bountyRepo = mod.get(getRepositoryToken(Bounty));
    adminService = mod.get(AdminService);
  });

  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', TradeAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  // ---------- Auction ----------

  it('listAuctions 过滤并分页', async () => {
    const rows = [{ id: 'au1', status: AuctionStatus.ACTIVE, sellerId: 'p1' }];
    auctionRepo.findAndCount.mockResolvedValue([rows, 1]);
    const res = await ctrl.listAuctions(AuctionStatus.ACTIVE, 'p1', '1', '20');
    expect(res.list).toEqual(rows);
    expect(res.total).toBe(1);
  });

  it('getAuction 返回详情', async () => {
    const row = { id: 'au1' };
    auctionRepo.findOne.mockResolvedValue(row);
    const res = await ctrl.getAuction('au1');
    expect(res).toEqual(row);
  });

  it('forceCloseAuction 设为 CANCELLED 并记操作', async () => {
    const item: any = {
      id: 'au1', status: AuctionStatus.ACTIVE, expireAt: new Date(Date.now() + 3600_000),
      sellerId: 'p1',
    };
    auctionRepo.findOne.mockResolvedValue(item);
    auctionRepo.save.mockImplementation(async (x: any) => x);
    const res = await ctrl.forceCloseAuction('au1', admin as any);
    expect(res.status).toBe(AuctionStatus.CANCELLED);
    expect(adminService.logOperation).toHaveBeenCalled();
  });

  // ---------- TradeOrder ----------

  it('listOrders 过滤并分页', async () => {
    const rows = [{ id: 'o1', status: 'PAID', buyerId: 'b1', sellerId: 's1' }];
    orderRepo.findAndCount.mockResolvedValue([rows, 1]);
    const res = await ctrl.listOrders('PAID', 'b1', 's1', '1', '20');
    expect(res.list).toEqual(rows);
    expect(res.total).toBe(1);
  });

  // ---------- Bounty ----------

  it('listBounties 过滤并分页', async () => {
    const rows = [{ id: 'b1', status: BountyStatus.OPEN, publisherId: 'p1' }];
    bountyRepo.findAndCount.mockResolvedValue([rows, 1]);
    const res = await ctrl.listBounties(BountyStatus.OPEN, 'p1', '1', '20');
    expect(res.list).toEqual(rows);
    expect(res.total).toBe(1);
  });

  it('cancelBounty 设为 CANCELLED 并记操作', async () => {
    const item: any = { id: 'b1', status: BountyStatus.OPEN, publisherId: 'p1' };
    bountyRepo.findOne.mockResolvedValue(item);
    bountyRepo.save.mockImplementation(async (x: any) => x);
    const res = await ctrl.cancelBounty('b1', admin as any);
    expect(res.status).toBe(BountyStatus.CANCELLED);
    expect(adminService.logOperation).toHaveBeenCalled();
  });
});
