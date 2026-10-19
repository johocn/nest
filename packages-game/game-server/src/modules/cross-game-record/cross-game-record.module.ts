import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrossGameRecord } from './cross-game-record.entity';
import { CrossGameRecordService } from './cross-game-record.service';
import { CrossGameRecordController } from './cross-game-record.controller';
import { AppsModule } from '@modules/apps/apps.module';

/**
 * 跨游戏关卡评分记录模块（与 scoring 模块解耦的独立表）。
 * 玩家在消消乐通关「属于其他游戏的关卡」后，把评分写入对应目标游戏的记录，
 * 数据按 targetGameId 隔离，配合 JWT 身份确保准确关联到目标游戏。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CrossGameRecord]),
    AppsModule, // AppScopeGuard 依赖 AppsService（由 AppsModule exports）
  ],
  controllers: [CrossGameRecordController],
  providers: [CrossGameRecordService],
  exports: [CrossGameRecordService],
})
export class CrossGameRecordModule {}
