import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { EcoEventsService } from './eco-events.service';
import { EcoEventDto } from './dto/eco-event.dto';
import { Public } from '@common/decorators/public.decorator';
import { AdminGuard } from '@common/guards/admin.guard';
import { Roles } from '@common/decorators/roles.decorator';

@ApiTags('Eco')
@Controller('api')
export class EcoEventsController {
  constructor(private readonly ecoEventsService: EcoEventsService) {}

  @Public()
  @Post('client/v1/eco/events')
  @ApiOperation({ summary: '业务生态行为回调（HMAC 签名自证）' })
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-eco-sign') sign: string,
    @Headers('x-eco-ts') ts: string,
    @Body() dto: EcoEventDto,
  ) {
    return this.ecoEventsService.handle(
      req.rawBody?.toString() ?? '',
      ts,
      sign,
      dto,
    );
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Roles('super_admin', 'admin', 'operator')
  @Get('admin/v1/eco/events/stats')
  @ApiOperation({ summary: '生态事件接收统计' })
  async stats() {
    return this.ecoEventsService.getStats();
  }
}
