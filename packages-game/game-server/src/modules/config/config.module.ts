import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigManageService } from './config.service';
import { ConfigController } from './config.controller';
import { RemoteConfig } from './entities';

@Module({
  imports: [TypeOrmModule.forFeature([RemoteConfig])],
  controllers: [ConfigController],
  providers: [ConfigManageService],
  exports: [ConfigManageService],
})
export class ConfigManageModule {}
