import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigManageService } from './config.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';

@ApiTags('Config')
@ApiBearerAuth()
@Controller()
export class ConfigController {
  constructor(private readonly configService: ConfigManageService) {}

  // ===== Client (read-only) =====

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/config/:key')
  @ApiOperation({ summary: '获取配置值' })
  async getConfig(@Param('key') key: string) {
    return this.configService.getConfig(key);
  }
}
