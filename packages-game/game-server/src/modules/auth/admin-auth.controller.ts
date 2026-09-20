import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminChangePasswordDto } from './dto/admin-password.dto';
import { Public } from '@common/decorators/public.decorator';
import { AdminGuard } from '@common/guards/admin.guard';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';

@ApiTags('Admin-Auth')
@Controller('api/admin/v1')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'GM登录' })
  async login(@Body() dto: AdminLoginDto) {
    return this.adminAuthService.login(dto.username, dto.password);
  }

  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({ summary: 'GM登出（当前 token 立即失效）' })
  async logout(@CurrentAdmin() admin: AdminJwtPayload) {
    return this.adminAuthService.logout(admin.adminId);
  }

  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @Post('password')
  @ApiOperation({ summary: 'GM修改密码（改后需重新登录）' })
  async changePassword(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Body() dto: AdminChangePasswordDto,
  ) {
    return this.adminAuthService.changePassword(
      admin.adminId,
      dto.oldPassword,
      dto.newPassword,
    );
  }
}