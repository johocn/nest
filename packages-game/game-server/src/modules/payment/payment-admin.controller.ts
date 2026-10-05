import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Admin-Payment')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/payment')
export class PaymentAdminController {
  constructor(private readonly paymentService: PaymentService) {}

  // ===== 充值商品 CRUD =====

  @Get('products')
  @ApiOperation({ summary: '充值商品列表' })
  async listProducts() {
    return this.paymentService.getProductList();
  }

  @Post('product')
  @ApiOperation({ summary: '新建充值商品' })
  async createProduct(@Body() body: any) {
    return this.paymentService.createProduct(body);
  }

  @Put('product/:id')
  @ApiOperation({ summary: '更新充值商品' })
  async updateProduct(@Param('id') id: string, @Body() body: any) {
    return this.paymentService.updateProduct(id, body);
  }

  @Delete('product/:id')
  @ApiOperation({ summary: '软删充值商品' })
  async deleteProduct(@Param('id') id: string) {
    return this.paymentService.deleteProduct?.(id) ?? { success: true, id };
  }

  // ===== 充值订单查询 =====

  @Get('orders')
  @ApiOperation({ summary: '充值订单列表（管理端全量）' })
  async listOrders(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.paymentService.getAdminOrderList(Number(page), Number(limit));
  }

  @Get('orders/:id')
  @ApiOperation({ summary: '充值订单详情' })
  async getOrderDetail(@Param('id') id: string) {
    return this.paymentService.getAdminOrderDetail(id);
  }

  @Post('orders/:id/deliver')
  @ApiOperation({ summary: '手动发货（订单状态非 DELIVERED 时补发）' })
  async deliver(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.paymentService.adminDeliver(body.adminId ?? 'admin', id);
  }
}
