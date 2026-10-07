import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { App } from './entities/app.entity';
import { AppsService } from './apps.service';
import { AppsAdminService } from './apps-admin.service';
import { AppsAdminController } from './apps-admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([App])],
  controllers: [AppsAdminController],
  providers: [AppsService, AppsAdminService],
  exports: [TypeOrmModule, AppsService], // QuizModule 等消费方 import AppsModule 后可用 AppScopeGuard
})
export class AppsModule {}
