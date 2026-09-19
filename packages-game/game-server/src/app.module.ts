import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SharedModule } from '@shared/shared.module';
import { LoggerModule } from '@logger/logger.module';
import { CacheModule } from '@cache/cache.module';
import { EventBusModule } from '@event-bus/event-bus.module';
import { EventListenersModule } from '@event-bus/event-listeners.module';
import { AuthModule } from '@modules/auth/auth.module';
import { PlayerModule } from '@modules/player/player.module';
import { EconomyModule } from '@modules/economy/economy.module';
import { CharacterModule } from '@modules/character/character.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { ItemDropModule } from '@modules/item-drop/item-drop.module';
import { WorldModule } from '@modules/world/world.module';
import { GatewayModule } from '@modules/gateway/gateway.module';
import { SkillModule } from '@modules/skill/skill.module';
import { BuffModule } from '@modules/buff/buff.module';
import { CombatModule } from '@modules/combat/combat.module';
import { QuestModule } from '@modules/quest/quest.module';
import { MailModule } from '@modules/mail/mail.module';
import { SocialModule } from '@modules/social/social.module';
import { AdminModule } from '@modules/admin/admin.module';
import { ChatModule } from '@modules/chat/chat.module';
import { NoticeModule } from '@modules/notice/notice.module';
import { CommunityModule } from '@modules/community/community.module';
import { RankingModule } from '@modules/ranking/ranking.module';
import { ServerStatusModule } from '@modules/server-status/server-status.module';
import { ActivityModule } from '@modules/activity/activity.module';
import { TradeModule } from '@modules/trade/trade.module';
import { AchievementModule } from '@modules/achievement/achievement.module';
import { AnalyticsModule } from '@modules/analytics/analytics.module';
import { ConfigManageModule } from '@modules/config/config.module';
import { PaymentModule } from '@modules/payment/payment.module';
import { VipModule } from '@modules/vip/vip.module';
import { SandboxModule } from '@modules/sandbox/sandbox.module';
import { MatchmakingModule } from '@modules/matchmaking/matchmaking.module';
import { OfflineModule } from '@modules/offline/offline.module';
import { EcoModule } from '@modules/eco/eco.module';
import { SchedulerModule } from '@scheduler/scheduler.module';
import { HealthModule } from '@health/health.module';
import { RequestIdMiddleware } from '@common/middleware/request-id.middleware';
import { LoggingMiddleware } from '@common/middleware/logging.middleware';
import { RateLimitGuard } from '@common/guards/rate-limit.guard';

@Module({
  imports: [
    // 第一层：配置 + 数据库
    SharedModule,

    // 第二层：基础设施
    LoggerModule,
    CacheModule,
    EventBusModule,
    EventListenersModule,

    // 第三层：功能模块（后续阶段逐步添加）
    AuthModule,
    PlayerModule,
    EconomyModule,
    CharacterModule,
    InventoryModule,
    ItemDropModule,
    WorldModule,
    GatewayModule,
    SkillModule,
    BuffModule,
    CombatModule,
    QuestModule,
    MailModule,
    SocialModule,
    AdminModule,
    ChatModule,
    NoticeModule,
    CommunityModule,
    RankingModule,
    ServerStatusModule,
    ActivityModule,
    TradeModule,
    AchievementModule,
    AnalyticsModule,
    ConfigManageModule,
    PaymentModule,
    VipModule,
    SandboxModule,
    MatchmakingModule,
    OfflineModule,
    EcoModule,

    // 定时任务
    SchedulerModule,

    // 健康检查（最后）
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, LoggingMiddleware).forRoutes('*');
  }
}
