import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServerStatusService } from './server-status.service';
import { ServerStatusController } from './server-status.controller';
import { ServerStatus } from './entities';
import { GatewayModule } from '@modules/gateway/gateway.module';

@Module({
  imports: [TypeOrmModule.forFeature([ServerStatus]), GatewayModule],
  controllers: [ServerStatusController],
  providers: [ServerStatusService],
  exports: [ServerStatusService],
})
export class ServerStatusModule {}
