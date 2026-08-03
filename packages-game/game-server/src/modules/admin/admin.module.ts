import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { GmOperateLog } from './entities';
import { GatewayModule } from '@modules/gateway/gateway.module';

@Module({
  imports: [TypeOrmModule.forFeature([GmOperateLog]), GatewayModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
