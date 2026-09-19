import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigManageService } from './config.service';
import { ConfigController } from './config.controller';
import { RemoteConfig, ConfigVersion } from './entities';
import { AdminModule } from '@modules/admin/admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RemoteConfig, ConfigVersion]),
    AdminModule,
  ],
  controllers: [ConfigController],
  providers: [ConfigManageService],
  exports: [ConfigManageService],
})
export class ConfigManageModule {}
