import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Patch,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { CreateProductDto } from './dto/create-product.dto';
import { AdminGuard } from '@common/guards/admin.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import { RateLimit } from '@common/decorators/rate-limit.decorator';

@ApiTags('支付充值')
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('products')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取充值商品列表' })
  getProductList() {
    return this.paymentService.getProductList();
  }

  @Post('order/:productId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建充值订单' })
  @RateLimit({ windowSeconds: 60, maxRequests: 10 })
  createOrder(
    @CurrentPlayer() player: any,
    @Param('productId') productId: string,
  ) {
    return this.paymentService.createOrder(player.playerId, productId);
  }

  @Post('simulate/:orderNo')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '模拟支付（仅测试环境）' })
  @RateLimit({ windowSeconds: 60, maxRequests: 10 })
  simulatePay(@CurrentPlayer() player: any, @Param('orderNo') orderNo: string) {
    return this.paymentService.simulatePay(orderNo, player.playerId);
  }

  @Post('order/:orderNo/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消待支付订单' })
  cancelOrder(@CurrentPlayer() player: any, @Param('orderNo') orderNo: string) {
    return this.paymentService.cancelOrder(orderNo, player.playerId);
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取我的订单列表' })
  getOrderList(
    @CurrentPlayer() player: any,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.paymentService.getOrderList(
      player.playerId,
      Number(page),
      Number(limit),
    );
  }

  @Post('callback')
  @ApiOperation({ summary: '支付回调Webhook（无需认证）' })
  async handleCallback(
    @Body() body: { orderNo: string; amount: string; sign: string },
  ) {
    return this.paymentService.handleCallback(body);
  }

  // ===== Admin =====

  @Get('admin/orders')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[管理] 获取所有订单' })
  getAdminOrderList(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.paymentService.getAdminOrderList(Number(page), Number(limit));
  }

  @Post('admin/orders/:id/deliver')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[管理] 补单发货' })
  adminDeliver(@Param('id') id: string) {
    return this.paymentService.adminDeliver('system', id);
  }

  @Post('admin/products')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[管理] 创建充值商品' })
  createProduct(@Body() dto: CreateProductDto) {
    return this.paymentService.createProduct(dto);
  }

  @Get('admin/orders/:id')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[管理] 获取订单详情' })
  getAdminOrderDetail(@Param('id') id: string) {
    return this.paymentService.getAdminOrderDetail(id);
  }

  @Patch('admin/products/:id')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[管理] 更新充值商品' })
  updateProduct(
    @Param('id') id: string,
    @Body() dto: Partial<CreateProductDto>,
  ) {
    return this.paymentService.updateProduct(id, dto);
  }

  @Delete('admin/products/:id')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[管理] 删除充值商品' })
  deleteProduct(@Param('id') id: string) {
    return this.paymentService.deleteProduct(id);
  }
}
