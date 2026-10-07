import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { App } from './entities/app.entity';

@Module({
  imports: [TypeOrmModule.forFeature([App])],
  exports: [TypeOrmModule],
})
export class AppsModule {}
