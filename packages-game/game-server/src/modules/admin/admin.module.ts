import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { GmOperateLog } from './entities';
import { ConnectionModule } from '@modules/gateway/connection.module';

@Module({
  imports: [TypeOrmModule.forFeature([GmOperateLog]), ConnectionModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
