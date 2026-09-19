import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from '@common/filters/http-exception.filter';
import { ResponseInterceptor } from '@common/interceptors/response.interceptor';
import { LoggerService } from '@logger/logger.service';
import helmet from 'helmet';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // 使用自定义日志服务
  const logger = app.get(LoggerService);
  app.useLogger(logger);

  // 全局管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 全局异常过滤器
  app.useGlobalFilters(new HttpExceptionFilter());

  // 全局拦截器
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector)),
    new ResponseInterceptor(),
  );

  // Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Game Server API')
    .setDescription(
      `
      3D 游戏服务端 API 文档

      ## 模块概览
      - **Auth**: 账号注册、登录、Token 管理
      - **Player**: 玩家基础信息、货币系统
      - **Character**: 角色创建、属性、武学
      - **Inventory**: 背包、道具、装备
      - **World**: 场景、NPC、怪物、传送
      - **Combat**: 战斗、技能、Buff
      - **Quest**: 任务系统
      - **Mail**: 邮件系统
      - **Social**: 好友、公会
      - **Chat**: 聊天、敏感词过滤
      - **Notice**: 公告系统
      - **Ranking**: 排行榜
      - **Activity**: 活动系统、签到
      - **Trade**: 交易市场、拍卖行
      - **Achievement**: 成就系统
      - **Analytics**: 数据统计、留存分析
      - **Config**: 远程配置管理

      ## 认证方式
      - Client API: Bearer JWT Token (玩家令牌)
      - Admin API: Bearer JWT Token (管理员令牌)
    `,
    )
    .setVersion('2.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
      },
      'access-token',
    )
    .addTag('Auth', '认证模块')
    .addTag('Player', '玩家模块')
    .addTag('Character', '角色模块')
    .addTag('Inventory', '背包模块')
    .addTag('World', '世界场景模块')
    .addTag('Combat', '战斗模块')
    .addTag('Quest', '任务模块')
    .addTag('Mail', '邮件模块')
    .addTag('Social', '社交模块')
    .addTag('Chat', '聊天模块')
    .addTag('Notice', '公告模块')
    .addTag('Ranking', '排行榜模块')
    .addTag('Activity', '活动模块')
    .addTag('Trade', '交易拍卖模块')
    .addTag('Achievement', '成就模块')
    .addTag('Analytics', '数据统计模块')
    .addTag('Config', '配置管理模块')
    .addTag('ServerStatus', '服务器状态模块')
    .addTag('Payment', '支付充值模块')
    .addTag('VIP', 'VIP系统模块')
    .addTag('Matchmaking', '匹配系统模块')
    .addTag('Offline', '离线同步模块')
    .addTag('Health', '健康检查')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      docExpansion: 'none',
      filter: true,
      persistAuthorization: true,
    },
  });

  // Static files - admin panel
  app.useStaticAssets(join(__dirname, '..', '..', 'admin'), { prefix: '/admin' });

  // Static files - sandbox
  app.useStaticAssets(join(__dirname, '..', '..', 'sandbox', 'dist'), { prefix: '/sandbox' });

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
          styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'cdn.jsdelivr.net'],
        },
      },
    }),
  );

  // CORS whitelist
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o: string) => o.trim())
    : ['http://localhost:3000'];
  app.enableCors({ origin: corsOrigins, credentials: true });

  // 优雅关闭
  app.enableShutdownHooks();

  const port = process.env.APP_PORT || 3000;
  await app.listen(port);
  logger.log(`Game server started on port ${port}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  console.error('Failed to start game server:', err);
  process.exit(1);
});
