import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  Ip,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RealNameDto, VerifyDto, AntiAddictionDto } from './dto/realname.dto';
import { Public } from '@common/decorators/public.decorator';
import { RateLimit } from '@common/decorators/rate-limit.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

@ApiTags('Auth')
@Controller('api/client/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: '账号注册' })
  @RateLimit({ windowSeconds: 60, maxRequests: 5 })
  async register(@Body() dto: RegisterDto, @Ip() ip: string) {
    return this.authService.register(
      dto.username,
      dto.password,
      dto.nickname,
      dto.deviceId,
    );
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: '账号登录' })
  @RateLimit({ windowSeconds: 60, maxRequests: 5 })
  async login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto.username, dto.password, ip, dto.deviceId);
  }

  @Public()
  @Post('guest')
  @ApiOperation({ summary: '游客登录' })
  async guest(@Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.authService.createGuest(ip, userAgent);
  }

  @UseGuards(JwtAuthGuard)
  @Post('security/verify')
  @ApiOperation({ summary: '风控确认（记录本人确认事件）' })
  async verify(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: VerifyDto,
    @Ip() ip: string,
  ) {
    await this.authService.recordSecurityConfirm(
      player.accountId,
      ip,
      dto.deviceInfo,
    );
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('realname')
  @ApiOperation({ summary: '实名绑定' })
  async bindRealName(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: RealNameDto,
  ) {
    await this.authService.bindRealName(player.accountId, dto.realName, dto.idNo);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('security-status')
  @ApiOperation({ summary: '账号安全状态（禁言/限交易/实名/防沉迷）' })
  async securityStatus(@CurrentPlayer() player: CurrentPlayerData) {
    const restrictions = await this.authService.getAccountRestrictions(
      player.accountId,
    );
    const security = await this.authService.getSecurityStatus(player.accountId);
    return { ...restrictions, ...security };
  }

  @UseGuards(JwtAuthGuard)
  @Post('anti-addiction')
  @ApiOperation({ summary: '切换防沉迷' })
  async setAntiAddiction(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: AntiAddictionDto,
  ) {
    await this.authService.setAntiAddiction(player.accountId, dto.on);
    return { ok: true };
  }
}
