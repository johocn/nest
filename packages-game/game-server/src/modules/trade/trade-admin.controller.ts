import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuctionItem } from './entities/auction-item.entity';
import { TradeOrder } from './entities/trade-order.entity';
import { Bounty } from './entities/bounty.entity';
import { AuctionStatus, BountyStatus } from '@constants/enums';
import { AdminGuard } from '@common/guards/admin.guard';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import { AdminService } from '@modules/admin/admin.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

@ApiTags('Admin-Trade')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/trade')
export class TradeAdminController {
  constructor(
    @InjectRepository(AuctionItem)
    private readonly auctionRepo: Repository<AuctionItem>,
    @InjectRepository(TradeOrder)
    private readonly orderRepo: Repository<TradeOrder>,
    @InjectRepository(Bounty)
    private readonly bountyRepo: Repository<Bounty>,
    private readonly adminService: AdminService,
  ) {}

  // ---------- Auction ----------

  @Get('auctions')
  @ApiOperation({ summary: '拍卖列表（支持 status / sellerId + 分页）' })
  async listAuctions(
    @Query('status') status?: string,
    @Query('sellerId') sellerId?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const where: any = {};
    if (status) where.status = status;
    if (sellerId) where.sellerId = sellerId;
    const [list, total] = await this.auctionRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    return { list, total, page: Number(page), limit: Number(limit) };
  }

  @Get('auctions/:id')
  @ApiOperation({ summary: '拍卖详情' })
  async getAuction(@Param('id') id: string) {
    const item = await this.auctionRepo.findOne({ where: { id } });
    if (!item) throw new GameException(ErrorCodes.AUCTION_NOT_FOUND, 'Auction not found');
    return item;
  }

  @Post('auctions/:id/force-close')
  @ApiOperation({ summary: '强制关闭拍卖（status=CANCELLED + expireAt=now）' })
  async forceCloseAuction(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const item = await this.auctionRepo.findOne({ where: { id } });
    if (!item) throw new GameException(ErrorCodes.AUCTION_NOT_FOUND, 'Auction not found');
    const before = { status: item.status, expireAt: item.expireAt };
    (item as any).status = AuctionStatus.CANCELLED;
    item.expireAt = new Date();
    const saved = await this.auctionRepo.save(item);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'trade.auction.force_close',
      targetPlayerId: item.sellerId,
      changeBefore: before,
      changeAfter: { status: saved.status, expireAt: saved.expireAt.toISOString() },
    });
    return saved;
  }

  // ---------- TradeOrder ----------

  @Get('orders')
  @ApiOperation({ summary: '交易订单列表（支持 status / buyerId / sellerId + 分页）' })
  async listOrders(
    @Query('status') status?: string,
    @Query('buyerId') buyerId?: string,
    @Query('sellerId') sellerId?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const where: any = {};
    if (status) where.status = status;
    if (buyerId) where.buyerId = buyerId;
    if (sellerId) where.sellerId = sellerId;
    const [list, total] = await this.orderRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    return { list, total, page: Number(page), limit: Number(limit) };
  }

  // ---------- Bounty ----------

  @Get('bounties')
  @ApiOperation({ summary: '悬赏列表（支持 status / publisherId + 分页）' })
  async listBounties(
    @Query('status') status?: string,
    @Query('publisherId') publisherId?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const where: any = {};
    if (status) where.status = status;
    if (publisherId) where.publisherId = publisherId;
    const [list, total] = await this.bountyRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    return { list, total, page: Number(page), limit: Number(limit) };
  }

  @Post('bounties/:id/cancel')
  @ApiOperation({ summary: '取消悬赏（status → CANCELLED）' })
  async cancelBounty(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const item = await this.bountyRepo.findOne({ where: { id } });
    if (!item) throw new GameException(ErrorCodes.BOUNTY_NOT_FOUND, 'Bounty not found');
    const before = { status: item.status };
    (item as any).status = BountyStatus.CANCELLED;
    const saved = await this.bountyRepo.save(item);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'trade.bounty.cancel',
      targetPlayerId: item.publisherId,
      changeBefore: before,
      changeAfter: { status: saved.status },
    });
    return saved;
  }
}
