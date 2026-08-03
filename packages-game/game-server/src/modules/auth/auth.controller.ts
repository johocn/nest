import { Body, Controller, Post, Ip, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from '@common/decorators/public.decorator';
import { RateLimit } from '@common/decorators/rate-limit.decorator';

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
}
