import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SichuanMahjongTableService } from './sichuanmajiang-table.service';
import { SichuanMahjongService } from './sichuanmajiang.service';
import { SichuanMahjongGateway } from './sichuanmajiang.gateway';
import { SichuanMahjongController } from './sichuanmajiang.controller';
import { SichuanMahjongRoom, SichuanMahjongRecord } from './entities';
import { CacheModule } from '@cache/cache.module';
import { EventBusModule } from '@event-bus/event-bus.module';

@Module({
  imports: [TypeOrmModule.forFeature([SichuanMahjongRoom, SichuanMahjongRecord]), CacheModule, EventBusModule],
  controllers: [SichuanMahjongController],
  providers: [SichuanMahjongTableService, SichuanMahjongService, SichuanMahjongGateway],
  exports: [SichuanMahjongService],
})
export class SichuanMahjongModule {}
